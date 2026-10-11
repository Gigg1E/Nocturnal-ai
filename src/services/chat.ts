import { Message as DiscordMessage } from 'discord.js';
import { getConfig } from '../config';
import { loadGuildConfig } from '../config/guildConfig';
import { getEffectiveSystemPrompt } from './personality';
import { maybeExtractMemory } from './memoryExtractor';
import { logger, logBotUsage } from '../utils/logger';
import { checkRateLimit, updateRateLimit, trackUsage } from '../database/queries';
import { generateChat, imageUrlToBase64, OllamaMessage } from '../ollama/client';
import { TOOL_SCHEMAS, TOOL_GUIDANCE, dispatchTool } from '../ollama/tools';
import { formatResponse, buildOutgoingMessages, detectLongFormRequest, getLongFormRejection, OutgoingMessage } from '../ollama/formatter';

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

// Concurrent in-flight request count per user+guild. Separate from the
// DB-backed cooldown/rate limit, which is pace-based and only updates its
// timestamp once a response finishes — so several rapid messages sent
// before the first one completes can all pass the cooldown check and each
// spawn their own agent loop. This closes that gap and is what actually
// caps how many requests one user can have running at once (e.g. under
// CPU contention from several people talking at the same time).
const inFlightCounts = new Map<string, number>();

// Config is per-guild now; a DM has no guild to scope by, so it falls back
// to the shipped default config (loadGuildConfig('dm') never has a saved
// override file, so it always resolves to DEFAULT_GUILD_CONFIG).
function configGuildId(discordMessage: DiscordMessage): string {
  return discordMessage.guildId ?? 'dm';
}

// Takes a guildId string directly (not a DiscordMessage) so it's callable
// from both message-handling (via configGuildId above) and slash commands
// (which have interaction.guildId, not a Message) — e.g. /clearchat.
function historyKey(userId: string, guildId: string): string {
  return `${userId}:${guildId}`;
}

function getHistory(userId: string, guildId: string): HistoryEntry[] {
  return userHistory.get(historyKey(userId, guildId)) || [];
}

function addToHistory(userId: string, guildId: string, userMsg: string, assistantMsg: string): void {
  // historySize isn't in the per-guild config (it was never made editable via
  // /config, unlike systemPrompt etc.), so it stays global.
  const globalConfig = getConfig();
  const key = historyKey(userId, guildId);
  let history = userHistory.get(key) || [];
  history.push({ role: 'user', content: userMsg });
  history.push({ role: 'assistant', content: assistantMsg });
  const maxEntries = (globalConfig.bot.historySize || 3) * 2;
  if (history.length > maxEntries) {
    history = history.slice(-maxEntries);
  }
  userHistory.set(key, history);
}

// Clears only the rolling conversation history (recent back-and-forth) —
// not the persistent per-user memory facts (see services/memory.ts /
// /memory), which are a completely separate, intentionally durable store.
export function clearHistory(userId: string, guildId: string): boolean {
  const key = historyKey(userId, guildId);
  const had = userHistory.has(key);
  userHistory.delete(key);
  return had;
}

/**
 * Builds the user-turn message, attaching an image (base64) when the
 * Discord message has one. Same model, same call, same conversation either
 * way — there's no separate vision model/pathway anymore. If the
 * configured chat model doesn't support vision, Ollama just won't do
 * anything useful with the images field; that's an acceptable failure mode
 * (no separate fallback model to maintain or drift out of sync).
 */
async function buildUserMessage(discordMessage: DiscordMessage, mentionContent: string): Promise<{ message: OllamaMessage; hasImage: boolean }> {
  const imageAttachments = discordMessage.attachments.filter(
    (att) => att.contentType?.startsWith('image/') ?? false
  );
  const hasImage = imageAttachments.size > 0;

  const message: OllamaMessage = {
    role: 'user',
    // No synthesized fallback prompt when an image has no caption —
    // 'What do you see in this image?' used to force description-mode
    // (headers, bullet points, a report) instead of a natural in-character
    // reaction. Empty content + the image is enough; the persona and
    // system prompt already carry the tone.
    content: mentionContent,
  };

  if (hasImage) {
    const firstImage = imageAttachments.first()!;
    const imageBase64 = await imageUrlToBase64(firstImage.url);
    message.images = [imageBase64];
  }

  return { message, hasImage };
}

// Personality (+ memory), then the when-to-use-tools guidance if this
// guild has tools on. Kept out of the personality text itself so a user's
// custom /personality doesn't lose it.
function systemPrompt(userId: string, toolsEnabled: boolean): string {
  const base = getEffectiveSystemPrompt(userId);
  return toolsEnabled ? `${base}\n\n${TOOL_GUIDANCE}` : base;
}

// ==================== RESPONSE TYPES ====================

export interface ChatResponse {
  success: boolean;
  parts: OutgoingMessage[];
  error?: string;
  rateLimited?: boolean;
  cooldownRemaining?: number;
}

// ==================== AGENTIC LOOP ====================

export async function runAgentLoop(
  messages: OllamaMessage[],
  toolsEnabled: boolean,
  callbacks?: AgentCallbacks,
  model?: string,
): Promise<string> {
  const tools = toolsEnabled ? TOOL_SCHEMAS : [];
  let totalFailures = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await generateChat({ messages, tools: tools.length > 0 ? tools : undefined, model });
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
      const fallback = await generateChat({ messages, model });
      return fallback.message.content || '';
    }
  }

  // Step budget exhausted — ask for a best-effort answer
  logger.warn(`Agent step budget reached (${MAX_STEPS} steps)`);
  messages.push({
    role: 'user',
    content: 'Answer with the best information gathered so far.',
  });
  const fallback = await generateChat({ messages, model });
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
  const concurrencyKey = historyKey(userId, guildId);

  if ((inFlightCounts.get(concurrencyKey) ?? 0) >= config.bot.maxChatsPerUser) {
    return { success: false, parts: [], rateLimited: true, error: 'concurrent_limit' };
  }

  const rateLimitCheck = checkRateLimit(userId, guildId);
  if (!rateLimitCheck.allowed) {
    return {
      success: false,
      parts: [],
      rateLimited: true,
      cooldownRemaining: rateLimitCheck.cooldownRemaining,
      error: rateLimitCheck.reason,
    };
  }

  if (detectLongFormRequest(mentionContent)) {
    return { success: true, parts: [{ content: getLongFormRejection(), attachments: [] }] };
  }

  inFlightCounts.set(concurrencyKey, (inFlightCounts.get(concurrencyKey) ?? 0) + 1);
  try {
    const context: OllamaMessage[] = [
      { role: 'system', content: systemPrompt(userId, config.tools.enabled) },
    ];

    for (const entry of getHistory(userId, guildId)) {
      context.push({ role: entry.role, content: entry.content });
    }

    const { message: userMessage, hasImage } = await buildUserMessage(discordMessage, mentionContent);
    context.push(userMessage);

    const aiContent = await runAgentLoop(context, config.tools.enabled, callbacks);

    const formatted = await formatResponse(aiContent);
    addToHistory(userId, guildId, mentionContent, aiContent);
    updateRateLimit(userId, guildId);
    trackUsage(userId, guildId, 'message');
    logBotUsage(userId, 'message', { hasImage });
    maybeExtractMemory(userId, mentionContent).catch(() => {});

    const parts = buildOutgoingMessages(formatted.segments);
    return { success: true, parts };
  } catch (error) {
    logger.error('Error processing message:', error);
    return {
      success: false,
      parts: [{ content: 'Something went wrong. Try again.', attachments: [] }],
      error: (error as Error).message,
    };
  } finally {
    const remaining = (inFlightCounts.get(concurrencyKey) ?? 1) - 1;
    if (remaining <= 0) inFlightCounts.delete(concurrencyKey);
    else inFlightCounts.set(concurrencyKey, remaining);
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
  const concurrencyKey = historyKey(userId, guildId);

  if ((inFlightCounts.get(concurrencyKey) ?? 0) >= config.bot.maxChatsPerUser) {
    return { success: false, parts: [], rateLimited: true, error: 'concurrent_limit' };
  }

  const rateLimitCheck = checkRateLimit(userId, guildId);
  if (!rateLimitCheck.allowed) {
    return {
      success: false,
      parts: [],
      rateLimited: true,
      cooldownRemaining: rateLimitCheck.cooldownRemaining,
      error: rateLimitCheck.reason,
    };
  }

  if (detectLongFormRequest(mentionContent)) {
    return { success: true, parts: [{ content: getLongFormRejection(), attachments: [] }] };
  }

  inFlightCounts.set(concurrencyKey, (inFlightCounts.get(concurrencyKey) ?? 0) + 1);
  try {
    const context: OllamaMessage[] = [
      { role: 'system', content: systemPrompt(userId, config.tools.enabled) },
    ];

    for (const entry of getHistory(userId, guildId)) {
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

    const { message: userMessage, hasImage } = await buildUserMessage(discordMessage, mentionContent);
    context.push(userMessage);

    const aiContent = await runAgentLoop(context, config.tools.enabled, callbacks);

    const formatted = await formatResponse(aiContent);
    addToHistory(userId, guildId, mentionContent, aiContent);
    updateRateLimit(userId, guildId);
    trackUsage(userId, guildId, 'reply');
    logBotUsage(userId, 'reply', { hasImage });
    maybeExtractMemory(userId, mentionContent).catch(() => {});

    const parts = buildOutgoingMessages(formatted.segments);
    return { success: true, parts };
  } catch (error) {
    logger.error('Error processing reply:', error);
    return {
      success: false,
      parts: [{ content: 'Something went wrong. Try again.', attachments: [] }],
      error: (error as Error).message,
    };
  } finally {
    const remaining = (inFlightCounts.get(concurrencyKey) ?? 1) - 1;
    if (remaining <= 0) inFlightCounts.delete(concurrencyKey);
    else inFlightCounts.set(concurrencyKey, remaining);
  }
}
