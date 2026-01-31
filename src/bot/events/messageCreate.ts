import { Message, AttachmentBuilder, TextChannel, DMChannel, NewsChannel, ThreadChannel } from 'discord.js';
import { logger, logRateLimit } from '../../utils/logger';
import { isUserBlacklisted, isChannelAllowed } from '../../config';
import { processMessage, processReply } from '../../services/chat';

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
  const repliedToMessage = await getRepliedToMessage(message);
  const isReplyToBot = repliedToMessage?.author.id === botId;

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
      content: "What?",
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

    // Check if this is a reply to a previous message (bot or user)
    if (repliedToMessage) {
      response = await processReply(message, repliedToMessage, cleanContent);
    } else {
      response = await processMessage(message, cleanContent);
    }

    // Handle rate limiting
    if (response.rateLimited) {
      const cooldownMsg = response.cooldownRemaining
        ? `Wait ${response.cooldownRemaining}s.`
        : 'Slow down.';

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
        content: response.messages[0] || 'Something went wrong.',
        allowedMentions: { repliedUser: false },
      });
    }
  } catch (error) {
    logger.error('Error in messageCreate handler:', error);
    try {
      await message.reply({
        content: 'Error. Try again.',
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
 * Get the message being replied to, if any
 */
async function getRepliedToMessage(message: Message): Promise<Message | null> {
  if (!message.reference?.messageId) return null;

  try {
    return await message.channel.messages.fetch(message.reference.messageId);
  } catch {
    // Message might have been deleted or not accessible
    return null;
  }
}
