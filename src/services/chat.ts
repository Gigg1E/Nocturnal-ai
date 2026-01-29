import { Message as DiscordMessage, Attachment } from 'discord.js';
import { getConfig } from '../config';
import { logger, logBotUsage } from '../utils/logger';
import {
  getOrCreateUser,
  getActiveChat,
  createChat,
  addMessage,
  getRecentMessages,
  getMessageByDiscordId,
  getMessageContext,
  checkRateLimit,
  updateRateLimit,
} from '../database/queries';
import { Message as DbMessage } from '../database/schema';
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
  FormattedResponse,
} from '../ollama/formatter';

export interface ChatResponse {
  success: boolean;
  messages: string[];
  attachments?: Array<{ name: string; data: Buffer }>;
  error?: string;
  rateLimited?: boolean;
  cooldownRemaining?: number;
}

/**
 * Process a user message and generate a response
 */
export async function processMessage(
  discordMessage: DiscordMessage,
  mentionContent: string,
): Promise<ChatResponse> {
  const config = getConfig();
  const userId = discordMessage.author.id;
  const username = discordMessage.author.username;

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
    // Get or create user and their active chat
    const user = getOrCreateUser(userId, username);
    let activeChat = getActiveChat(userId);

    if (!activeChat) {
      activeChat = createChat(userId, 'General');
      if (!activeChat) {
        return {
          success: false,
          messages: ['Failed to create chat session. Please try again.'],
          error: 'chat_creation_failed',
        };
      }
    }

    // Check for images in the message
    const imageAttachments = discordMessage.attachments.filter(
      (att) => att.contentType?.startsWith('image/')
    );
    const hasImage = imageAttachments.size > 0;

    // Determine if we should use vision model
    const useVision = hasImage && shouldUseVisionModel(true, mentionContent);

    // Build conversation context
    const context = await buildContext(
      activeChat.id,
      discordMessage,
      mentionContent,
      useVision,
    );

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
        content: `External data retrieved:\n${toolResults}`,
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
        context.slice(0, -1), // Exclude the last message we just added
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
          // Regenerate with tool results
          context.splice(-1, 0, {
            role: 'system',
            content: `External data retrieved:\n${forcedToolResults}`,
          });

          const retryResponse = await generateChat({ messages: context });
          const formatted = await formatResponse(retryResponse.message.content);

          // Save messages to database
          await saveMessages(
            activeChat.id,
            mentionContent,
            retryResponse.message.content,
            discordMessage.id,
            hasImage,
            hasImage ? imageAttachments.first()?.url : undefined,
          );

          updateRateLimit(userId);
          logBotUsage(userId, 'message_with_retry_tools', {
            chatId: activeChat.id,
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

    // Save messages to database
    await saveMessages(
      activeChat.id,
      mentionContent,
      aiContent,
      discordMessage.id,
      hasImage,
      hasImage ? imageAttachments.first()?.url : undefined,
    );

    // Update rate limit
    updateRateLimit(userId);

    logBotUsage(userId, 'message', {
      chatId: activeChat.id,
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
      messages: ['Sorry, I encountered an error processing your request. Please try again.'],
      error: (error as Error).message,
    };
  }
}

/**
 * Process a reply to a previous message
 */
export async function processReply(
  discordMessage: DiscordMessage,
  replyToMessageId: string,
  mentionContent: string,
): Promise<ChatResponse> {
  const config = getConfig();
  const userId = discordMessage.author.id;
  const username = discordMessage.author.username;

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
    // Get or create user
    getOrCreateUser(userId, username);

    // Get context from the replied message
    const contextMessages = getMessageContext(replyToMessageId, 5);

    // Build context from the reply chain
    const context: OllamaMessage[] = [
      {
        role: 'system',
        content: config.bot.systemPrompt,
      },
    ];

    // Add messages from context
    for (const msg of contextMessages) {
      context.push({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      });
    }

    // Check for images
    const imageAttachments = discordMessage.attachments.filter(
      (att) => att.contentType?.startsWith('image/')
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
          content: `External data retrieved:\n${toolResults}`,
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

    const formatted = await formatResponse(response.message.content);

    // Get user's active chat or create one for saving this message
    let activeChat = getActiveChat(userId);
    if (!activeChat) {
      activeChat = createChat(userId, 'General');
    }

    if (activeChat) {
      await saveMessages(
        activeChat.id,
        mentionContent,
        response.message.content,
        discordMessage.id,
        hasImage,
        hasImage ? imageAttachments.first()?.url : undefined,
      );
    }

    updateRateLimit(userId);

    logBotUsage(userId, 'reply', {
      replyTo: replyToMessageId,
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
      messages: ['Sorry, I encountered an error processing your reply. Please try again.'],
      error: (error as Error).message,
    };
  }
}

/**
 * Build conversation context from chat history
 */
async function buildContext(
  chatId: string,
  discordMessage: DiscordMessage,
  currentMessage: string,
  useVision: boolean,
): Promise<OllamaMessage[]> {
  const config = getConfig();
  const context: OllamaMessage[] = [];

  // Add system prompt
  context.push({
    role: 'system',
    content: config.bot.systemPrompt,
  });

  // Get recent messages from the chat
  const recentMessages = getRecentMessages(chatId, 10);

  for (const msg of recentMessages) {
    context.push({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    });
  }

  return context;
}

/**
 * Save user and assistant messages to the database
 */
async function saveMessages(
  chatId: string,
  userContent: string,
  assistantContent: string,
  discordMessageId: string,
  hasImage: boolean = false,
  imageUrl?: string,
): Promise<void> {
  // Save user message
  addMessage(chatId, 'user', userContent, {
    hasImage,
    imageUrl,
    discordMessageId,
  });

  // Save assistant response
  addMessage(chatId, 'assistant', assistantContent);
}
