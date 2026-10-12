import { recordDiagnostic, errorReason, DiagnosticTrace } from '../../services/diagnostics';
import { Message, StickerFormatType, AttachmentBuilder, EmbedBuilder, TextChannel, DMChannel, NewsChannel, ThreadChannel } from 'discord.js';
import { logger, logRateLimit } from '../../utils/logger';
import { isUserBlacklisted, isChannelAllowed, isCasualChatChannel } from '../../config/guildConfig';
import { processMessage, processReply } from '../../services/chat';
import { recordAmbientMessage, scheduleEngagementCheck, evaluateNow } from '../../services/casualChat';
import { formatToolArgs } from '../../ollama/tools';
import { isAcknowledgement, ImageRef } from '../../services/conversationHeat';

type SendableChannel = TextChannel | DMChannel | NewsChannel | ThreadChannel;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isSendableChannel(channel: any): channel is SendableChannel {
  return typeof channel.send === 'function';
}

// Varied, casual stand-ins for the old hardcoded "🤔 Thinking..." -- picked
// randomly so it doesn't read as a copy-pasted template every time. Plain
// text on purpose (no emoji spam) to match how someone would actually text
// "one sec" rather than a templated bot status line.
const THINKING_PHRASES = [
  'one sec',
  'hold on',
  'hang on',
  'gimme a sec',
  'give me a sec',
  'one moment',
  'hold up',
  'lemme think',
  'let me think about that',
  'hmm, one sec',
];

function randomThinkingPhrase(): string {
  return THINKING_PHRASES[Math.floor(Math.random() * THINKING_PHRASES.length)];
}

const MAX_IMAGE_DIM = 1280;
const MAX_VIDEO_BYTES = 15 * 1024 * 1024;

// "black-guy-in-suit-black-guy-suit" / "risitas-cunao-gif-1234567" -> a
// readable title hint. It's the uploader's tag, so the prompt labels it as
// possibly not matching how the GIF is being used.
function gifTitleFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    // Klipy slugs can carry an app suffix ("side-eye--k1a5GTEAE") -- drop it.
    const slug = (new URL(url).pathname.split('/').filter(Boolean).pop() ?? '').replace(/--\w+$/, '');
    const words = slug.replace(/[-_]+/g, ' ').replace(/\bgif\b/gi, ' ').replace(/\b\d{4,}\b/g, ' ').replace(/\s+/g, ' ').trim();
    return words || undefined;
  } catch {
    return undefined;
  }
}

// Everything visual or linked in a message, for the Answer Machine:
//  - image attachments (big ones fetched through Discord's media proxy at a
//    smaller size); GIF attachments keep their animated source,
//  - link previews that are themselves an image or GIF (Tenor/GIPHY/Klipy,
//    pasted image links) -- GIFs keep the mp4/gif to sample frames from,
//  - stickers (except Lottie ones, which aren't images -- named instead),
//  - other link previews (YouTube, articles) as text only: "YouTube: title".
export function messagePreviews(message: Message): { images: ImageRef[]; links: string[] } {
  const images: ImageRef[] = [];
  const links: string[] = [];
  for (const att of message.attachments.values()) {
    // Short video clips: sampled as frames like a GIF (no audio). Big ones
    // are skipped -- gifFrameGrid won't download past its size cap anyway.
    if (att.contentType?.startsWith('video/')) {
      if (att.size <= MAX_VIDEO_BYTES) images.push({ url: att.url, kind: 'video', video: att.url });
      continue;
    }
    if (!att.contentType?.startsWith('image/')) continue;
    if (att.contentType === 'image/gif') {
      images.push({ url: att.url, kind: 'gif', video: att.url });
      continue;
    }
    let url = att.url;
    if (att.width && att.height && Math.max(att.width, att.height) > MAX_IMAGE_DIM) {
      const scale = MAX_IMAGE_DIM / Math.max(att.width, att.height);
      const u = new URL(att.proxyURL);
      u.searchParams.set('width', String(Math.round(att.width * scale)));
      u.searchParams.set('height', String(Math.round(att.height * scale)));
      url = u.toString();
    }
    images.push({ url, kind: 'image' });
  }
  for (const embed of message.embeds) {
    const type = embed.data.type;
    if (type === 'gifv') {
      const still = embed.thumbnail?.proxyURL ?? embed.thumbnail?.url;
      const video = embed.video?.proxyURL ?? embed.video?.url;
      if (still || video) {
        images.push({ url: still ?? video!, kind: 'gif', video, title: gifTitleFromUrl(embed.url ?? undefined) });
      }
    } else if (type === 'image') {
      const img = embed.image ?? embed.thumbnail;
      const url = img?.proxyURL ?? img?.url;
      if (url) images.push(/\.gif(\?|$)/i.test(url) ? { url, kind: 'gif', video: url } : { url, kind: 'image' });
    } else if (embed.title) {
      links.push(`${embed.provider?.name ? `${embed.provider.name}: ` : ''}${embed.title}`);
    }
  }
  for (const sticker of message.stickers.values()) {
    if (sticker.format === StickerFormatType.Lottie) links.push(`sticker "${sticker.name}"`);
    else images.push({ url: sticker.url, kind: 'sticker', title: sticker.name });
  }
  return { images, links };
}

export async function handleMessageCreate(message: Message): Promise<void> {
  if (message.author.bot) return;

  const botId = message.client.user?.id;
  if (!botId) return;

  const isMentioned = message.mentions.has(botId);
  const repliedToMessage = await getRepliedToMessage(message);
  const isReplyToBot = repliedToMessage?.author.id === botId;

  // A DM has no guild to scope against — falls back to a dedicated "dm"
  // pseudo-guild config (empty blacklist/channel lists by default, same
  // effective behavior as before this was guild-scoped).
  const guildId = message.guildId ?? 'dm';

  // Answer Machine channels intercept everything -- ambient chatter AND
  // direct mentions/replies -- before the chat-bot/Kimi pipeline below ever
  // sees them. A channel opted into this mode never falls through to the
  // normal mention pipeline: mentioning the bot here is evaluated
  // through the turn-taking scheduler. Explicit mentions and substantive
  // replies are queued for an answer; ambient messages use heat scoring. No per-user memory either way; only the
  // channel's short-lived conversation session.
  if (message.guildId && isSendableChannel(message.channel) && isCasualChatChannel(guildId, message.channel.id)) {
    if (isUserBlacklisted(guildId, message.author.id)) return;

    // Raw content has user mentions as numeric <@id> tokens, which the
    // model can't read -- turn them into @names so it can tell who a
    // message is aimed at. The bot's own mention is dropped (being
    // addressed is tracked separately).
    const nameFor = (id: string, fallback: string): string =>
      message.guild?.members.cache.get(id)?.displayName ?? fallback;
    let bufferedContent = message.content.replace(new RegExp(`<@!?${botId}>`, 'g'), '');
    for (const user of message.mentions.users.values()) {
      if (user.id === botId) continue;
      bufferedContent = bufferedContent.replace(new RegExp(`<@!?${user.id}>`, 'g'), `@${nameFor(user.id, user.username)}`);
    }
    bufferedContent = bufferedContent.trim();

    // Aimed at a specific other person: @-mentions someone else, or is a
    // Discord reply to someone else's message. That's their exchange, not
    // an opening for the bot to chat into.
    let addressedTo: string | undefined;
    if (!isMentioned && !isReplyToBot) {
      const other = [...message.mentions.users.values()].find(
        (u) => u.id !== botId && u.id !== message.author.id && !u.bot
      );
      if (other) {
        addressedTo = nameFor(other.id, other.username);
      } else if (repliedToMessage && repliedToMessage.author.id !== message.author.id && !repliedToMessage.author.bot) {
        addressedTo = nameFor(repliedToMessage.author.id, repliedToMessage.author.username);
      }
    }

    // Which message this replies to, with a short quote -- matters most
    // when it's answering something from a while back, not the line above.
    const replyTo = repliedToMessage
      ? {
          author: isReplyToBot ? 'you' : nameFor(repliedToMessage.author.id, repliedToMessage.author.username),
          snippet:
            repliedToMessage.content.replace(/<@!?\d+>/g, '@someone').trim() ||
            (repliedToMessage.attachments.size || repliedToMessage.embeds.length ? '(image/GIF)' : '(message)'),
        }
      : undefined;

    recordAmbientMessage(message.channel.id, {
      author: nameFor(message.author.id, message.author.username),
      authorId: message.author.id,
      directToBot: new RegExp(`<@!?${botId}>`).test(message.content) || isReplyToBot,
      content: bufferedContent,
      ...messagePreviews(message),
      ts: Date.now(),
      addressedTo,
      messageId: message.id,
      replyToId: message.reference?.messageId,
      replyTo,
    });

    const botName = message.client.user?.username ?? '';

    // Someone talking to the bot directly gets an answer, like the normal
    // chat pipeline would give: a typed @mention always, a Discord reply to
    // the bot unless it's a bare "lol"/"fr"/emoji (that goes through the
    // normal decision, where a reaction usually fits). mentions.has() isn't
    // used here -- it also matches @everyone, role pings and the automatic
    // ping a Discord reply carries.
    const typedMention = new RegExp(`<@!?${botId}>`).test(message.content);
    const forceReply = typedMention || (isReplyToBot && !isAcknowledgement(bufferedContent));

    if (isMentioned || isReplyToBot) {
      await evaluateNow(message.channel.id, guildId, message.channel, botName, forceReply ? { userId: message.author.id, messageId: message.id } : null);
    } else {
      scheduleEngagementCheck(message.channel.id, guildId, message.channel, botName);
    }
    return;
  }

  if (!isMentioned && !isReplyToBot) return;

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
      .reply({ content: randomThinkingPhrase(), allowedMentions: { repliedUser: false } })
      .then((m) => {
        status.msg = m;
        status.creating = false;
      })
      .catch((err) => {
        status.creating = false;
        logger.warn('Failed to send thinking indicator:', err);
      });
  }, THINKING_DELAY_MS);

  let trace: DiagnosticTrace | undefined;
  try {
    let response;
    if (repliedToMessage) {
      response = await processReply(message, repliedToMessage, cleanContent, { onToolStart, onToolDone });
    } else {
      response = await processMessage(message, cleanContent, { onToolStart, onToolDone });
    }

    trace = response.trace;
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
      // rides along with whichever chunk of text introduced it). Every part
      // replies directly to the triggering message — not just the first —
      // so in a channel with several people talking at once, it's
      // unambiguous which request each part of a multi-message answer
      // belongs to.
      //
      // 'image' attachments (rendered diagrams/tables) get wrapped in a
      // small embed — a short title plus the image via attachment://,
      // reading as one cohesive card instead of a floating file below
      // plain text. 'file' attachments (large extracted code) aren't
      // images, so they're sent bare, same as before.
      const EMBED_COLOR = 0x2f3136;
      const buildExtras = (
        attachments: { name: string; data: Buffer; kind: 'image' | 'file'; title?: string }[]
      ): { files?: AttachmentBuilder[]; embeds?: EmbedBuilder[] } => {
        if (attachments.length === 0) return {};
        const files = attachments.map((att) => new AttachmentBuilder(att.data, { name: att.name }));
        const embeds = attachments
          .filter((att) => att.kind === 'image')
          .map((att) => {
            const embed = new EmbedBuilder().setColor(EMBED_COLOR).setImage(`attachment://${att.name}`);
            if (att.title) embed.setTitle(att.title);
            return embed;
          });
        return { files, embeds: embeds.length > 0 ? embeds : undefined };
      };

      let startIndex = 0;

      if (status.msg && toolEntries.length === 0) {
        // Only the "thinking" placeholder fired, no tools ran — edit it
        // into the first part instead of leaving two messages sitting
        // there for one exchange (it's already a reply, so this still
        // satisfies "every part replies to the triggering message").
        const first = response.parts[0];
        const editOptions: { content: string; files?: AttachmentBuilder[]; embeds?: EmbedBuilder[] } = {
          content: first.content,
          ...buildExtras(first.attachments),
        };

        let editFailed = false;
        await status.msg.edit(editOptions).catch(() => {
          editFailed = true;
        });
        if (!editFailed) {
          startIndex = 1;
        }
        // If the edit failed (e.g. message deleted), fall through — part[0]
        // gets sent as a fresh reply by the loop below instead.
      }

      for (let i = startIndex; i < response.parts.length; i++) {
        const part = response.parts[i];
        const opts: {
          content: string;
          files?: AttachmentBuilder[];
          embeds?: EmbedBuilder[];
          allowedMentions: { repliedUser: boolean };
        } = {
          content: part.content,
          allowedMentions: { repliedUser: false },
          ...buildExtras(part.attachments),
        };
        await message.reply(opts);
      }
      recordDiagnostic(trace, { action: 'sent', reason: 'delivery_complete', durationMs: Date.now() - turnStart, responseMs: Date.now() - message.createdTimestamp, success: true }, true);
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
    recordDiagnostic(trace, { action: 'error', reason: errorReason(error), durationMs: Date.now() - turnStart, success: false }, true);
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
