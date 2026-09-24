import { Message as DiscordMessage } from 'discord.js';
import { getConfig } from '../config';
import { loadGuildConfig } from '../config/guildConfig';
import { logger, logBotUsage } from '../utils/logger';
import { checkRateLimit, updateRateLimit, trackUsage } from '../database/queries';
import {
  generateChat,
  generateVision,
  imageUrlToBase64,
  OllamaMessage,
  shouldUseVisionModel,
} from '../ollama/client';
import { TOOL_SCHEMAS, dispatchTool } from '../ollama/tools';
import { formatResponse, splitIntoMessages, detectLongFormRequest, getLongFormRejection } from '../ollama/formatter';

// ==================== AGENT LOOP LIMITS ====================

const MAX_STEPS = 8;
const MAX_FAILURES = 3;

// ==================== CALLBACKS ====================

export interface AgentCallbacks {
  onToolStart?: (toolName: string, args: Record<string, unknown>) => Promise<void>;
  onToolDone?: (toolName: string) => Promise<void>;
}

// ==================== IN-MEMORY HISTORY ====================

interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

// Keyed by "userId:guildId" (DMs use "dm" in place of a guild id) — was
// keyed by userId alone, which meant a user's conversation context bled
// across every guild/DM they talked to the bot in.
const userHistory = new Map<string, HistoryEntry[]>();

// Config is per-guild now; a DM has no guild to scope by, so it falls back
// to the shipped default config (loadGuildConfig('dm') never has a saved
// override file, so it always resolves to DEFAULT_GUILD_CONFIG).
function configGuildId(discordMessage: DiscordMessage): string {
  return discordMessage.guildId ?? 'dm';
}

function historyKey(userId: string, discordMessage: DiscordMessage): string {
  return `${userId}:${configGuildId(discordMessage)}`;
}

function getHistory(userId: string, discordMessage: DiscordMessage): HistoryEntry[] {
  return userHistory.get(historyKey(userId, discordMessage)) || [];
}

function addToHistory(userId: string, discordMessage: DiscordMessage, userMsg: string, assistantMsg: string): void {
  // historySize isn't in the per-guild config (it was never made editable via
  // /config, unlike systemPrompt etc.), so it stays global.
  const globalConfig = getConfig();
  const key = historyKey(userId, discordMessage);
  let history = userHistory.get(key) || [];
  history.push({ role: 'user', content: userMsg });
  history.push({ role: 'assistant', content: assistantMsg });
  const maxEntries = (globalConfig.bot.historySize || 3) * 2;
  if (history.length > maxEntries) {
    history = history.slice(-maxEntries);
  }
  userHistory.set(key, history);
}

function clearHistory(userId: string, discordMessage: DiscordMessage): void {
  userHistory.delete(historyKey(userId, discordMessage));
}

export { clearHistory };

// ==================== RESPONSE TYPES ====================

export interface ChatResponse {
  success: boolean;
  messages: string[];
  attachments?: Array<{ name: string; data: Buffer }>;
  error?: string;
  rateLimited?: boolean;
  cooldownRemaining?: number;
}

// ==================== AGENTIC LOOP ====================

async function runAgentLoop(
  messages: OllamaMessage[],
  toolsEnabled: boolean,
  callbacks?: AgentCallbacks,
): Promise<string> {
  const tools = toolsEnabled ? TOOL_SCHEMAS : [];
  let totalFailures = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await generateChat({ messages, tools: tools.length > 0 ? tools : undefined });
    const msg = response.message;

    // No tool calls — this is the final answer
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return msg.content || '';
    }

    // Append assistant message with its tool calls so the model has context
    messages.push({
      role: 'assistant',
      content: msg.content || '',
      tool_calls: msg.tool_calls,
    });

    // Execute each requested tool
    for (const tc of msg.tool_calls) {
      const toolName = tc.function.name;
      const rawArgs = tc.function.arguments;
      const args: Record<string, unknown> =
        typeof rawArgs === 'string' ? JSON.parse(rawArgs) : (rawArgs as Record<string, unknown>);

      if (callbacks?.onToolStart) {
        await callbacks.onToolStart(toolName, args);
      }

      let resultContent: string;
      try {
        const result = await dispatchTool(toolName, args);
        resultContent = JSON.stringify(result.success ? result.data : { error: result.error });
        if (!result.success) totalFailures++;
      } catch (err) {
        resultContent = JSON.stringify({ error: (err as Error).message });
        totalFailures++;
      }

      if (callbacks?.onToolDone) {
        await callbacks.onToolDone(toolName);
      }

      messages.push({ role: 'tool', content: resultContent });
    }

    if (totalFailures >= MAX_FAILURES) {
      logger.warn(`Agent failure budget reached (${totalFailures} failures)`);
      messages.push({
        role: 'user',
        content: 'Some tools failed. Answer with what you have or let the user know.',
      });
      const fallback = await generateChat({ messages });
      return fallback.message.content || '';
    }
  }

  // Step budget exhausted — ask for a best-effort answer
  logger.warn(`Agent step budget reached (${MAX_STEPS} steps)`);
  messages.push({
    role: 'user',
    content: 'Answer with the best information gathered so far.',
  });
  const fallback = await generateChat({ messages });
  return fallback.message.content || '';
}

// ==================== MESSAGE PROCESSING ====================

export async function processMessage(
  discordMessage: DiscordMessage,
  mentionContent: string,
  callbacks?: AgentCallbacks,
): Promise<ChatResponse> {
  const guildId = configGuildId(discordMessage);
  const config = loadGuildConfig(guildId);
  const userId = discordMessage.author.id;

  const rateLimitCheck = checkRateLimit(userId, guildId);
  if (!rateLimitCheck.allowed) {
    return {
      success: false,
      messages: [],
      rateLimited: true,
      cooldownRemaining: rateLimitCheck.cooldownRemaining,
      error: rateLimitCheck.reason,
    };
  }

  if (detectLongFormRequest(mentionContent)) {
    return { success: true, messages: [getLongFormRejection()] };
  }

  try {
    const imageAttachments = discordMessage.attachments.filter(
      (att) => att.contentType?.startsWith('image/') ?? false
    );
    const hasImage = imageAttachments.size > 0;
    const useVision = hasImage && shouldUseVisionModel(true, mentionContent);

    const context: OllamaMessage[] = [
      { role: 'system', content: config.bot.systemPrompt },
    ];

    for (const entry of getHistory(userId, discordMessage)) {
      context.push({ role: entry.role, content: entry.content });
    }

    let aiContent: string;

    if (useVision && imageAttachments.size > 0) {
      const firstImage = imageAttachments.first()!;
      const imageBase64 = await imageUrlToBase64(firstImage.url);
      context.push({
        role: 'user',
        content: mentionContent || 'What do you see in this image?',
        images: [imageBase64],
      });
      const response = await generateVision(
        mentionContent || 'What do you see in this image?',
        imageBase64,
        context.slice(0, -1),
      );
      aiContent = response.message.content;
    } else {
      context.push({ role: 'user', content: mentionContent });
      aiContent = await runAgentLoop(context, config.tools.enabled, callbacks);
    }

    const formatted = await formatResponse(aiContent);
    addToHistory(userId, discordMessage, mentionContent, aiContent);
    updateRateLimit(userId, guildId);
    trackUsage(userId, guildId, 'message');
    logBotUsage(userId, 'message', { hasImage, useVision });

    const messages = await splitIntoMessages(formatted.content);
    return { success: true, messages, attachments: formatted.attachments };
  } catch (error) {
    logger.error('Error processing message:', error);
    return { success: false, messages: ['Something went wrong. Try again.'], error: (error as Error).message };
  }
}

export async function processReply(
  discordMessage: DiscordMessage,
  repliedToMessage: DiscordMessage,
  mentionContent: string,
  callbacks?: AgentCallbacks,
): Promise<ChatResponse> {
  const guildId = configGuildId(discordMessage);
  const config = loadGuildConfig(guildId);
  const userId = discordMessage.author.id;

  const rateLimitCheck = checkRateLimit(userId, guildId);
  if (!rateLimitCheck.allowed) {
    return {
      success: false,
      messages: [],
      rateLimited: true,
      cooldownRemaining: rateLimitCheck.cooldownRemaining,
      error: rateLimitCheck.reason,
    };
  }

  if (detectLongFormRequest(mentionContent)) {
    return { success: true, messages: [getLongFormRejection()] };
  }

  try {
    const context: OllamaMessage[] = [
      { role: 'system', content: config.bot.systemPrompt },
    ];

    for (const entry of getHistory(userId, discordMessage)) {
      context.push({ role: entry.role, content: entry.content });
    }

    // Inject the replied-to message as context
    const repliedContent = repliedToMessage.content;
    const isFromBot = repliedToMessage.author.bot;

    if (isFromBot) {
      if (repliedToMessage.reference?.messageId) {
        try {
          const original = await discordMessage.channel.messages.fetch(
            repliedToMessage.reference.messageId
          );
          if (original && !original.author.bot) {
            context.push({
              role: 'user',
              content: original.content.replace(/<@!?\d+>/g, '').trim(),
            });
          }
        } catch {
          // Couldn't fetch original — that's fine
        }
      }
      context.push({ role: 'assistant', content: repliedContent });
    } else {
      context.push({
        role: 'user',
        content: `[${repliedToMessage.author.username}]: ${repliedContent}`,
      });
    }

    const imageAttachments = discordMessage.attachments.filter(
      (att) => att.contentType?.startsWith('image/') ?? false
    );
    const hasImage = imageAttachments.size > 0;
    const useVision = hasImage && shouldUseVisionModel(true, mentionContent);

    let aiContent: string;

    if (useVision && imageAttachments.size > 0) {
      const firstImage = imageAttachments.first()!;
      const imageBase64 = await imageUrlToBase64(firstImage.url);
      context.push({
        role: 'user',
        content: mentionContent || 'What do you see in this image?',
        images: [imageBase64],
      });
      const response = await generateVision(
        mentionContent || 'What do you see in this image?',
        imageBase64,
        context.slice(0, -1),
      );
      aiContent = response.message.content;
    } else {
      context.push({ role: 'user', content: mentionContent });
      aiContent = await runAgentLoop(context, config.tools.enabled, callbacks);
    }

    const formatted = await formatResponse(aiContent);
    addToHistory(userId, discordMessage, mentionContent, aiContent);
    updateRateLimit(userId, guildId);
    trackUsage(userId, guildId, 'reply');
    logBotUsage(userId, 'reply', { hasImage, useVision });

    const messages = await splitIntoMessages(formatted.content);
    return { success: true, messages, attachments: formatted.attachments };
  } catch (error) {
    logger.error('Error processing reply:', error);
    return { success: false, messages: ['Something went wrong. Try again.'], error: (error as Error).message };
  }
}
