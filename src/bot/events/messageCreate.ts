import { Message, AttachmentBuilder, TextChannel, DMChannel, NewsChannel, ThreadChannel } from 'discord.js';
import { logger, logRateLimit } from '../../utils/logger';
import { getConfig, isUserBlacklisted, isChannelAllowed } from '../../config';
import { processMessage, processReply } from '../../services/chat';
import { getMessageByDiscordId } from '../../database/queries';

type SendableChannel = TextChannel | DMChannel | NewsChannel | ThreadChannel;

function isSendableChannel(channel: any): channel is SendableChannel {
  return 'send' in channel && typeof channel.send === 'function';
}

export async function handleMessageCreate(message: Message): Promise<void> {
  // Ignore bot messages
  if (message.author.bot) return;

  // Check if the bot was mentioned or this is a reply to the bot
  const botId = message.client.user?.id;
  if (!botId) return;

  const isMentioned = message.mentions.has(botId);
  const isReplyToBot = await checkIfReplyToBot(message, botId);

  // If neither mentioned nor replying to bot, ignore
  if (!isMentioned && !isReplyToBot) return;

  // Check if user is blacklisted
  if (isUserBlacklisted(message.author.id)) {
    logger.info(`Blacklisted user ${message.author.id} tried to interact`);
    return;
  }

  // Check if channel is allowed
  if (!isChannelAllowed(message.channel.id)) {
    return;
  }

  // Ensure we can send to this channel
  if (!isSendableChannel(message.channel)) {
    return;
  }

  const channel = message.channel;

  // Extract the actual message content (remove bot mention)
  const mentionPattern = new RegExp(`<@!?${botId}>`, 'g');
  const cleanContent = message.content.replace(mentionPattern, '').trim();

  // Don't respond to empty messages (just a mention)
  if (!cleanContent && message.attachments.size === 0) {
    await message.reply({
      content: "Hello! How can I help you? Just mention me with your question or send an image for me to analyze.",
      allowedMentions: { repliedUser: false },
    });
    return;
  }

  // Show typing indicator
  await channel.sendTyping();

  // Keep typing indicator active for long responses
  const typingInterval = setInterval(() => {
    channel.sendTyping().catch(() => {});
  }, 9000);

  try {
    let response;

    // Check if this is a reply to a previous bot message
    if (isReplyToBot && message.reference?.messageId) {
      response = await processReply(message, message.reference.messageId, cleanContent);
    } else {
      response = await processMessage(message, cleanContent);
    }

    // Handle rate limiting
    if (response.rateLimited) {
      const cooldownMsg = response.cooldownRemaining
        ? `Please wait ${response.cooldownRemaining} seconds before sending another message.`
        : 'You\'re sending messages too quickly. Please slow down.';

      await message.reply({
        content: cooldownMsg,
        allowedMentions: { repliedUser: false },
      });
      logRateLimit(message.author.id, response.error || 'rate_limited');
      return;
    }

    // Send responses
    if (response.success && response.messages.length > 0) {
      // Send first message as reply
      const firstMessageOptions: {
        content: string;
        files?: AttachmentBuilder[];
        allowedMentions: { repliedUser: boolean };
      } = {
        content: response.messages[0],
        allowedMentions: { repliedUser: false },
      };

      // Add attachments to first message if any
      if (response.attachments && response.attachments.length > 0) {
        firstMessageOptions.files = response.attachments.map(
          (att) => new AttachmentBuilder(att.data, { name: att.name })
        );
      }

      await message.reply(firstMessageOptions);

      // Send remaining messages as follow-ups
      for (let i = 1; i < response.messages.length; i++) {
        await channel.send({
          content: response.messages[i],
          allowedMentions: { users: [] },
        });
      }
    } else if (!response.success) {
      await message.reply({
        content: response.messages[0] || 'Sorry, something went wrong. Please try again.',
        allowedMentions: { repliedUser: false },
      });
    }
  } catch (error) {
    logger.error('Error in messageCreate handler:', error);
    try {
      await message.reply({
        content: 'Sorry, I encountered an unexpected error. Please try again later.',
        allowedMentions: { repliedUser: false },
      });
    } catch (replyError) {
      logger.error('Failed to send error reply:', replyError);
    }
  } finally {
    clearInterval(typingInterval);
  }
}

/**
 * Check if the message is a reply to a bot message
 */
async function checkIfReplyToBot(message: Message, botId: string): Promise<boolean> {
  if (!message.reference?.messageId) return false;

  try {
    const repliedMessage = await message.channel.messages.fetch(message.reference.messageId);
    return repliedMessage.author.id === botId;
  } catch {
    // Message might have been deleted or not accessible
    // Check our database for the message
    const dbMessage = getMessageByDiscordId(message.reference.messageId);
    return dbMessage !== undefined;
  }
}
