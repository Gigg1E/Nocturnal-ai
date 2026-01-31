import { Message as DiscordMessage } from 'discord.js';
import { getConfig } from '../config';
import { logger, logBotUsage } from '../utils/logger';
import {
  checkRateLimit,
  updateRateLimit,
  trackUsage,
} from '../database/queries';
import {
  generateChat,
  generateVision,
  imageUrlToBase64,
  OllamaMessage,
  shouldUseVisionModel,
} from '../ollama/client';
import {
  calculateToolWeights,
  getToolsToCall,
  executeTools,
  formatToolResultsForAI,
} from '../ollama/tools';
import {
  formatResponse,
  splitIntoMessages,
  detectLongFormRequest,
  getLongFormRejection,
} from '../ollama/formatter';

// ==================== IN-MEMORY HISTORY ====================

interface HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

const userHistory = new Map<string, HistoryEntry[]>();

function getHistory(userId: string): HistoryEntry[] {
  return userHistory.get(userId) || [];
}

function addToHistory(userId: string, userMsg: string, assistantMsg: string): void {
  const config = getConfig();
  let history = userHistory.get(userId) || [];

  // Add the new exchange
  history.push({ role: 'user', content: userMsg });
  history.push({ role: 'assistant', content: assistantMsg });

  // Keep only last N exchanges (2 entries per exchange)
  const maxEntries = (config.bot.historySize || 3) * 2;
  if (history.length > maxEntries) {
    history = history.slice(-maxEntries);
  }

  userHistory.set(userId, history);
}

function clearHistory(userId: string): void {
  userHistory.delete(userId);
}

// Export for potential use elsewhere
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

// ==================== MESSAGE PROCESSING ====================

/**
 * Process a user message and generate a response
 */
export async function processMessage(
  discordMessage: DiscordMessage,
  mentionContent: string,
): Promise<ChatResponse> {
  const config = getConfig();
  const userId = discordMessage.author.id;

  // Check rate limit
  const rateLimitCheck = checkRateLimit(userId);
  if (!rateLimitCheck.allowed) {
    return {
      success: false,
      messages: [],
      rateLimited: true,
      cooldownRemaining: rateLimitCheck.cooldownRemaining,
      error: rateLimitCheck.reason,
    };
  }

  // Check for long-form request rejection
  if (detectLongFormRequest(mentionContent)) {
    return {
      success: true,
      messages: [getLongFormRejection()],
    };
  }

  try {
    // Check for images in the message
    const imageAttachments = discordMessage.attachments.filter(
      (att) => att.contentType?.startsWith('image/') ?? false
    );
    const hasImage = imageAttachments.size > 0;
    const useVision = hasImage && shouldUseVisionModel(true, mentionContent);

    // Build context with system prompt
    const context: OllamaMessage[] = [
      {
        role: 'system',
        content: config.bot.systemPrompt,
      },
    ];

    // Add user's recent history
    const history = getHistory(userId);
    for (const entry of history) {
      context.push({
        role: entry.role,
        content: entry.content,
      });
    }

    // Calculate tool weights and determine which tools to call
    const toolWeights = calculateToolWeights(mentionContent);
    const toolsToCall = getToolsToCall(toolWeights);

    let toolResults = '';
    if (config.tools.enabled && toolsToCall.length > 0) {
      const results = await executeTools({
        message: mentionContent,
        toolsToCall,
      });
      toolResults = formatToolResultsForAI(results);
    }

    // Add tool results to context if any
    if (toolResults) {
      context.push({
        role: 'system',
        content: `External data:\n${toolResults}`,
      });
    }

    // Add user message to context
    if (useVision && imageAttachments.size > 0) {
      const firstImage = imageAttachments.first()!;
      const imageBase64 = await imageUrlToBase64(firstImage.url);

      context.push({
        role: 'user',
        content: mentionContent || 'What do you see in this image?',
        images: [imageBase64],
      });
    } else {
      context.push({
        role: 'user',
        content: mentionContent,
      });
    }

    // Generate response
    let response;
    if (useVision && imageAttachments.size > 0) {
      const firstImage = imageAttachments.first()!;
      const imageBase64 = await imageUrlToBase64(firstImage.url);
      response = await generateVision(
        mentionContent || 'What do you see in this image?',
        imageBase64,
        context.slice(0, -1),
      );
    } else {
      response = await generateChat({
        messages: context,
      });
    }

    const aiContent = response.message.content;

    // Check if AI indicates uncertainty and might benefit from tools
    const uncertaintyIndicators = [
      "i don't know",
      "i'm not sure",
      "i cannot",
      "i don't have",
      "my knowledge",
      "as of my",
      "i am not able",
      "no information",
    ];

    const isUncertain = uncertaintyIndicators.some(
      (indicator) => aiContent.toLowerCase().includes(indicator)
    );

    // If uncertain and tools weren't used, try again with forced tools
    if (isUncertain && toolsToCall.length === 0 && config.tools.enabled) {
      const forcedWeights = calculateToolWeights(mentionContent, true);
      const forcedTools = getToolsToCall(forcedWeights);

      if (forcedTools.length > 0) {
        const forcedResults = await executeTools({
          message: mentionContent,
          toolsToCall: forcedTools,
        });
        const forcedToolResults = formatToolResultsForAI(forcedResults);

        if (forcedToolResults) {
          context.splice(-1, 0, {
            role: 'system',
            content: `External data:\n${forcedToolResults}`,
          });

          const retryResponse = await generateChat({ messages: context });
          const retryContent = retryResponse.message.content;
          const formatted = await formatResponse(retryContent);

          // Add to history
          addToHistory(userId, mentionContent, retryContent);

          updateRateLimit(userId);
          trackUsage(userId, 'message_retry');
          logBotUsage(userId, 'message_with_retry_tools', {
            hasImage,
            toolsUsed: forcedTools,
          });

          const messages = await splitIntoMessages(formatted.content);
          return {
            success: true,
            messages,
            attachments: formatted.attachments,
          };
        }
      }
    }

    // Format the response
    const formatted = await formatResponse(aiContent);

    // Add to history
    addToHistory(userId, mentionContent, aiContent);

    // Update rate limit and track usage
    updateRateLimit(userId);
    trackUsage(userId, 'message');

    logBotUsage(userId, 'message', {
      hasImage,
      useVision,
      toolsUsed: toolsToCall,
    });

    const messages = await splitIntoMessages(formatted.content);

    return {
      success: true,
      messages,
      attachments: formatted.attachments,
    };
  } catch (error) {
    logger.error('Error processing message:', error);
    return {
      success: false,
      messages: ['Something went wrong. Try again.'],
      error: (error as Error).message,
    };
  }
}

/**
 * Process a reply to a previous message (uses Discord context + history)
 */
export async function processReply(
  discordMessage: DiscordMessage,
  repliedToMessage: DiscordMessage,
  mentionContent: string,
): Promise<ChatResponse> {
  const config = getConfig();
  const userId = discordMessage.author.id;

  // Check rate limit
  const rateLimitCheck = checkRateLimit(userId);
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
    return {
      success: true,
      messages: [getLongFormRejection()],
    };
  }

  try {
    // Build context with system prompt
    const context: OllamaMessage[] = [
      {
        role: 'system',
        content: config.bot.systemPrompt,
      },
    ];

    // Add user's recent history first
    const history = getHistory(userId);
    for (const entry of history) {
      context.push({
        role: entry.role,
        content: entry.content,
      });
    }

    // Add the replied-to message as additional context
    const repliedContent = repliedToMessage.content;
    const isFromBot = repliedToMessage.author.bot;

    if (isFromBot) {
      // If replying to bot's message, try to find original user message
      if (repliedToMessage.reference?.messageId) {
        try {
          const originalMessage = await discordMessage.channel.messages.fetch(
            repliedToMessage.reference.messageId
          );
          if (originalMessage && !originalMessage.author.bot) {
            context.push({
              role: 'user',
              content: originalMessage.content.replace(/<@!?\d+>/g, '').trim(),
            });
          }
        } catch {
          // Couldn't fetch original, that's ok
        }
      }
      context.push({
        role: 'assistant',
        content: repliedContent,
      });
    } else {
      // Replying to another user's message
      context.push({
        role: 'user',
        content: `[${repliedToMessage.author.username}]: ${repliedContent}`,
      });
    }

    // Check for images
    const imageAttachments = discordMessage.attachments.filter(
      (att) => att.contentType?.startsWith('image/') ?? false
    );
    const hasImage = imageAttachments.size > 0;
    const useVision = hasImage && shouldUseVisionModel(true, mentionContent);

    // Calculate and execute tools
    const toolWeights = calculateToolWeights(mentionContent);
    const toolsToCall = getToolsToCall(toolWeights);

    if (config.tools.enabled && toolsToCall.length > 0) {
      const results = await executeTools({
        message: mentionContent,
        toolsToCall,
      });
      const toolResults = formatToolResultsForAI(results);
      if (toolResults) {
        context.push({
          role: 'system',
          content: `External data:\n${toolResults}`,
        });
      }
    }

    // Add the new user message
    if (useVision && imageAttachments.size > 0) {
      const firstImage = imageAttachments.first()!;
      const imageBase64 = await imageUrlToBase64(firstImage.url);
      context.push({
        role: 'user',
        content: mentionContent || 'What do you see in this image?',
        images: [imageBase64],
      });
    } else {
      context.push({
        role: 'user',
        content: mentionContent,
      });
    }

    // Generate response
    let response;
    if (useVision && imageAttachments.size > 0) {
      const firstImage = imageAttachments.first()!;
      const imageBase64 = await imageUrlToBase64(firstImage.url);
      response = await generateVision(
        mentionContent || 'What do you see in this image?',
        imageBase64,
        context.slice(0, -1),
      );
    } else {
      response = await generateChat({ messages: context });
    }

    const aiContent = response.message.content;
    const formatted = await formatResponse(aiContent);

    // Add to history
    addToHistory(userId, mentionContent, aiContent);

    updateRateLimit(userId);
    trackUsage(userId, 'reply');

    logBotUsage(userId, 'reply', {
      hasImage,
      useVision,
    });

    const messages = await splitIntoMessages(formatted.content);

    return {
      success: true,
      messages,
      attachments: formatted.attachments,
    };
  } catch (error) {
    logger.error('Error processing reply:', error);
    return {
      success: false,
      messages: ['Something went wrong. Try again.'],
      error: (error as Error).message,
    };
  }
}
