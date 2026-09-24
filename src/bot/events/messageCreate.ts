import { Message, AttachmentBuilder, TextChannel, DMChannel, NewsChannel, ThreadChannel } from 'discord.js';
import { logger, logRateLimit } from '../../utils/logger';
import { isUserBlacklisted, isChannelAllowed } from '../../config';
import { processMessage, processReply } from '../../services/chat';
import { formatToolArgs } from '../../ollama/tools';

type SendableChannel = TextChannel | DMChannel | NewsChannel | ThreadChannel;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isSendableChannel(channel: any): channel is SendableChannel {
  return typeof channel.send === 'function';
}

export async function handleMessageCreate(message: Message): Promise<void> {
  if (message.author.bot) return;

  const botId = message.client.user?.id;
  if (!botId) return;

  const isMentioned = message.mentions.has(botId);
  const repliedToMessage = await getRepliedToMessage(message);
  const isReplyToBot = repliedToMessage?.author.id === botId;

  if (!isMentioned && !isReplyToBot) return;

  if (isUserBlacklisted(message.author.id)) {
    logger.info(`Blacklisted user ${message.author.id} tried to interact`);
    return;
  }

  if (!isChannelAllowed(message.channel.id)) return;
  if (!isSendableChannel(message.channel)) return;

  const channel = message.channel;

  const mentionPattern = new RegExp(`<@!?${botId}>`, 'g');
  const cleanContent = message.content.replace(mentionPattern, '').trim();

  if (!cleanContent && message.attachments.size === 0) {
    await message.reply({ content: 'What?', allowedMentions: { repliedUser: false } });
    return;
  }

  await channel.sendTyping();
  const typingInterval = setInterval(() => {
    channel.sendTyping().catch(() => {});
  }, 9000);

  // Object wrapper so TypeScript doesn't narrow the property to null via
  // control-flow analysis after async closures mutate it.
  // Each turn gets its own object, so concurrent users are fully isolated by reference.
  const status = { msg: null as Message | null };
  const turnStart = Date.now();

  interface ToolEntry { name: string; args: Record<string, unknown>; done: boolean }
  const toolEntries: ToolEntry[] = [];

  const buildStatusLines = (): string =>
    toolEntries.map((e) => {
      const icon = e.done ? '✓' : '▶';
      const argStr = formatToolArgs(e.name, e.args);
      return `\`${icon} ${e.name}\`${argStr ? `  ${argStr}` : ''}`;
    }).join('\n');

  const onToolStart = async (toolName: string, args: Record<string, unknown>): Promise<void> => {
    toolEntries.push({ name: toolName, args, done: false });
    try {
      const content = buildStatusLines();
      if (!status.msg) {
        status.msg = await message.reply({ content, allowedMentions: { repliedUser: false } });
      } else {
        await status.msg.edit(content);
      }
    } catch (err) {
      logger.warn('Failed to send/edit status message:', err);
    }
  };

  const onToolDone = async (_toolName: string): Promise<void> => {
    const last = [...toolEntries].reverse().find((e) => !e.done);
    if (last) last.done = true;
    if (status.msg) {
      await status.msg.edit(buildStatusLines()).catch(() => {});
    }
  };

  try {
    let response;
    if (repliedToMessage) {
      response = await processReply(message, repliedToMessage, cleanContent, { onToolStart, onToolDone });
    } else {
      response = await processMessage(message, cleanContent, { onToolStart, onToolDone });
    }

    clearInterval(typingInterval);

    // Compact final summary: `✓ tool`  `✓ tool`  •  3.1s
    if (status.msg && toolEntries.length > 0) {
      const elapsed = ((Date.now() - turnStart) / 1000).toFixed(1);
      const badges = toolEntries.map((e) => `\`✓ ${e.name}\``).join('  ');
      await status.msg.edit(`${badges}  •  ${elapsed}s`).catch(() => {});
    }

    if (response.rateLimited) {
      const cooldownMsg = response.cooldownRemaining
        ? `Wait ${response.cooldownRemaining}s.`
        : 'Slow down.';
      const target = status.msg ?? message;
      await target.reply({ content: cooldownMsg, allowedMentions: { repliedUser: false } });
      logRateLimit(message.author.id, response.error || 'rate_limited');
      return;
    }

    if (response.success && response.messages.length > 0) {
      if (status.msg) {
        // Tools were used — send the answer as a separate channel message
        const firstOptions: {
          content: string;
          files?: AttachmentBuilder[];
          allowedMentions: { users: string[] };
        } = {
          content: response.messages[0],
          allowedMentions: { users: [] },
        };
        if (response.attachments && response.attachments.length > 0) {
          firstOptions.files = response.attachments.map(
            (att) => new AttachmentBuilder(att.data, { name: att.name })
          );
        }
        await channel.send(firstOptions);
        for (let i = 1; i < response.messages.length; i++) {
          await channel.send({ content: response.messages[i], allowedMentions: { users: [] } });
        }
      } else {
        // No tools — reply directly to the user's message
        const firstOptions: {
          content: string;
          files?: AttachmentBuilder[];
          allowedMentions: { repliedUser: boolean };
        } = {
          content: response.messages[0],
          allowedMentions: { repliedUser: false },
        };
        if (response.attachments && response.attachments.length > 0) {
          firstOptions.files = response.attachments.map(
            (att) => new AttachmentBuilder(att.data, { name: att.name })
          );
        }
        await message.reply(firstOptions);
        for (let i = 1; i < response.messages.length; i++) {
          await channel.send({ content: response.messages[i], allowedMentions: { users: [] } });
        }
      }
    } else if (!response.success) {
      const target = status.msg ?? message;
      await target.reply({
        content: response.messages[0] || 'Something went wrong.',
        allowedMentions: { repliedUser: false },
      });
    }
  } catch (error) {
    clearInterval(typingInterval);
    logger.error('Error in messageCreate handler:', error);
    try {
      const target = status.msg ?? message;
      await target.reply({ content: 'Error. Try again.', allowedMentions: { repliedUser: false } });
    } catch (replyError) {
      logger.error('Failed to send error reply:', replyError);
    }
  }
}

async function getRepliedToMessage(message: Message): Promise<Message | null> {
  if (!message.reference?.messageId) return null;
  try {
    return await message.channel.messages.fetch(message.reference.messageId);
  } catch {
    return null;
  }
}
