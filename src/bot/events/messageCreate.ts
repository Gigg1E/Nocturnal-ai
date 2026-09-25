import { Message, AttachmentBuilder, TextChannel, DMChannel, NewsChannel, ThreadChannel } from 'discord.js';
import { logger, logRateLimit } from '../../utils/logger';
import { isUserBlacklisted, isChannelAllowed } from '../../config/guildConfig';
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

  // A DM has no guild to scope against — falls back to a dedicated "dm"
  // pseudo-guild config (empty blacklist/channel lists by default, same
  // effective behavior as before this was guild-scoped).
  const guildId = message.guildId ?? 'dm';

  if (isUserBlacklisted(guildId, message.author.id)) {
    logger.info(`Blacklisted user ${message.author.id} tried to interact`);
    return;
  }

  if (!isChannelAllowed(guildId, message.channel.id)) return;
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
  // `creating` closes a race between the thinking-timer below and onToolStart
  // both trying to create the status message at nearly the same moment.
  const status = { msg: null as Message | null, creating: false };
  const turnStart = Date.now();
  const THINKING_DELAY_MS = 4000;

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
      if (status.msg) {
        await status.msg.edit(content);
      } else if (!status.creating) {
        status.creating = true;
        status.msg = await message.reply({ content, allowedMentions: { repliedUser: false } });
        status.creating = false;
      }
      // else: the thinking-timer is mid-creation — it'll pick up tool
      // progress on its next onToolStart/onToolDone call once status.msg lands.
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

  // If nothing (no tool call) has produced a status message within
  // THINKING_DELAY_MS, this is taking a while — post a visible placeholder
  // that's an actual reply to the triggering message, so it's unambiguous
  // which request it belongs to even with several people talking at once.
  const thinkingTimer: NodeJS.Timeout = setTimeout(() => {
    if (status.msg || status.creating) return;
    status.creating = true;
    message
      .reply({ content: '🤔 Thinking...', allowedMentions: { repliedUser: false } })
      .then((m) => {
        status.msg = m;
        status.creating = false;
      })
      .catch((err) => {
        status.creating = false;
        logger.warn('Failed to send thinking indicator:', err);
      });
  }, THINKING_DELAY_MS);

  try {
    let response;
    if (repliedToMessage) {
      response = await processReply(message, repliedToMessage, cleanContent, { onToolStart, onToolDone });
    } else {
      response = await processMessage(message, cleanContent, { onToolStart, onToolDone });
    }

    clearInterval(typingInterval);
    clearTimeout(thinkingTimer);

    // Compact final summary: `✓ tool`  `✓ tool`  •  3.1s
    if (status.msg && toolEntries.length > 0) {
      const elapsed = ((Date.now() - turnStart) / 1000).toFixed(1);
      const badges = toolEntries.map((e) => `\`✓ ${e.name}\``).join('  ');
      await status.msg.edit(`${badges}  •  ${elapsed}s`).catch(() => {});
    }

    if (response.rateLimited) {
      const cooldownMsg =
        response.error === 'concurrent_limit'
          ? "Still working on your last message — hang tight."
          : response.cooldownRemaining
            ? `Wait ${response.cooldownRemaining}s.`
            : 'Slow down.';
      const target = status.msg ?? message;
      await target.reply({ content: cooldownMsg, allowedMentions: { repliedUser: false } });
      logRateLimit(message.author.id, response.error || 'rate_limited');
      return;
    }

    if (response.success && response.parts.length > 0) {
      // Each part carries its own attachments (an image/diagram/table/file
      // rides along with whichever chunk of text introduced it), so a
      // response with several attachments becomes several sequential
      // messages instead of one message with everything bundled at the end.
      const toFiles = (attachments: { name: string; data: Buffer }[]): AttachmentBuilder[] | undefined =>
        attachments.length > 0 ? attachments.map((att) => new AttachmentBuilder(att.data, { name: att.name })) : undefined;

      if (status.msg && toolEntries.length === 0) {
        // Only the "thinking" placeholder fired, no tools ran — edit it
        // into the first part of the real answer instead of leaving two
        // messages sitting there for one exchange.
        const first = response.parts[0];
        const editOptions: { content: string; files?: AttachmentBuilder[] } = { content: first.content };
        const firstFiles = toFiles(first.attachments);
        if (firstFiles) editOptions.files = firstFiles;
        const edited = status.msg;
        await edited.edit(editOptions).catch(async () => {
          // Edit failed (e.g. message deleted) — fall back to a fresh reply.
          await message.reply({ content: first.content, allowedMentions: { repliedUser: false } });
        });
        for (let i = 1; i < response.parts.length; i++) {
          const part = response.parts[i];
          const opts: { content: string; files?: AttachmentBuilder[]; allowedMentions: { users: string[] } } = {
            content: part.content,
            allowedMentions: { users: [] },
          };
          const partFiles = toFiles(part.attachments);
          if (partFiles) opts.files = partFiles;
          await channel.send(opts);
        }
      } else if (status.msg) {
        // Tools were used — send the answer as separate channel message(s)
        for (const part of response.parts) {
          const opts: { content: string; files?: AttachmentBuilder[]; allowedMentions: { users: string[] } } = {
            content: part.content,
            allowedMentions: { users: [] },
          };
          const partFiles = toFiles(part.attachments);
          if (partFiles) opts.files = partFiles;
          await channel.send(opts);
        }
      } else {
        // No tools, no thinking placeholder — reply directly to the user's
        // message with the first part, rest follow as channel messages.
        for (let i = 0; i < response.parts.length; i++) {
          const part = response.parts[i];
          const partFiles = toFiles(part.attachments);
          if (i === 0) {
            const opts: { content: string; files?: AttachmentBuilder[]; allowedMentions: { repliedUser: boolean } } = {
              content: part.content,
              allowedMentions: { repliedUser: false },
            };
            if (partFiles) opts.files = partFiles;
            await message.reply(opts);
          } else {
            const opts: { content: string; files?: AttachmentBuilder[]; allowedMentions: { users: string[] } } = {
              content: part.content,
              allowedMentions: { users: [] },
            };
            if (partFiles) opts.files = partFiles;
            await channel.send(opts);
          }
        }
      }
    } else if (!response.success) {
      const target = status.msg ?? message;
      await target.reply({
        content: response.parts[0]?.content || 'Something went wrong.',
        allowedMentions: { repliedUser: false },
      });
    }
  } catch (error) {
    clearInterval(typingInterval);
    clearTimeout(thinkingTimer);
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
