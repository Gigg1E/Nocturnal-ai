import { TextChannel, NewsChannel, ThreadChannel, DMChannel, Message } from 'discord.js';
import { getConfig } from '../config';
import { loadGuildConfig, GuildConfig } from '../config/guildConfig';
import { logger } from '../utils/logger';
import { imageUrlToBase64, OllamaMessage } from '../ollama/client';
import { runAgentLoop } from './chat';

// "Answer Machine" mode: a channel-scoped alternative to the normal
// mention/reply chat-bot pipeline (see messageCreate.ts) -- no memory, no
// per-user history, a separate (much faster) model, and a narrow purpose:
// answer genuine questions and correct misinformation, nothing else. A
// channel with this enabled never falls through to the chat-bot/Kimi
// pipeline, even when directly mentioned -- see messageCreate.ts's routing.
type SendableChannel = TextChannel | DMChannel | NewsChannel | ThreadChannel;

// Same idea as messageCreate.ts's THINKING_PHRASES -- a casual placeholder
// so a search that takes a couple seconds doesn't read as dead air, posted
// only when it's actually doing a search (not for every reply, and not for
// the near-instant weather/time/crypto tools).
const SEARCHING_PHRASES = [
  'one sec, looking that up',
  'give me a sec, searching',
  'hold on, digging into this',
  'one sec, researching this',
  'lemme check on that',
  'hold up, looking into it',
  'give me a moment, checking',
];

function randomSearchingPhrase(): string {
  return SEARCHING_PHRASES[Math.floor(Math.random() * SEARCHING_PHRASES.length)];
}

// Small, fast, cheap model used for BOTH the "should I engage" decision and
// the actual reply text. Deliberately separate from the main chat-bot model
// (currently kimi-k2.6:cloud): direct side-by-side latency testing found
// kimi taking ~4.5s even for a one-line correction, while gemma4:cloud
// produced good in-character corrections in 300-600ms. That's the actual
// fix for "the answer machine feels slow" -- the decision step itself was
// never the bottleneck (also ~300ms). Reply generation still goes through
// runAgentLoop (search/weather/time/crypto tools available) so a genuine
// question needing current info doesn't just get a stale/hallucinated
// answer -- confirmed via direct testing that gemma4:cloud only reaches
// for a tool when the question actually needs one (a math correction or
// static fact stays a single ~300ms call; only real-time questions pay
// the extra tool round trip).
const DECISION_MODEL = 'gemma4:cloud';
const REPLY_MODEL = 'gemma4:cloud';

const BUFFER_SIZE = 15;
const DEBOUNCE_MS = 2500;
// Hard ceiling on how long a continuously-active channel can keep resetting
// the debounce timer before getting evaluated anyway -- without this, a
// channel where messages keep arriving faster than DEBOUNCE_MS apart would
// never pause long enough to trigger a check at all.
const MAX_WAIT_MS = 12_000;
const REACT_COOLDOWN_MS = 30_000;
const REPLY_COOLDOWN_MS: Record<GuildConfig['casualChat']['chattiness'], number> = {
  low: 10 * 60_000,
  medium: 5 * 60_000,
  high: 2 * 60_000,
};

// Deterministic "is this a follow-up to what I just said" signal, mirroring
// the base/boost + threshold pattern already used for tool-routing weights
// (ToolWeightConfig in src/config/index.ts) rather than leaning entirely on
// the LLM to notice a continuation buried in a long, noisy transcript.
// Confirmed via direct testing that a *clean* 3-line follow-up transcript
// reliably gets REPLY from the decision model -- a miss in a busy channel
// is a signal-dilution problem (the follow-up gets lost in buffer clutter),
// not a model-capability one, so a structural signal independent of
// transcript content is the more reliable fix. Further candidates (e.g.
// same-author continuity, keyword-based boosts) can be added the same way
// if specific patterns keep getting missed.
const FOLLOWUP_WINDOW_MS = 90_000;

interface AmbientEntry {
  author: string;
  content: string;
  hasImage: boolean;
  ts: number;
}

interface ChannelState {
  buffer: AmbientEntry[];
  lastBotReplyAt: number;
  lastReactAt: number;
  debounceTimer: NodeJS.Timeout | null;
  pendingImageUrl: string | null;
  pendingMessageId: string | null;
  burstStartedAt: number | null;
}

const channelStates = new Map<string, ChannelState>();

function getState(channelId: string): ChannelState {
  let state = channelStates.get(channelId);
  if (!state) {
    state = {
      buffer: [],
      lastBotReplyAt: 0,
      lastReactAt: 0,
      debounceTimer: null,
      pendingImageUrl: null,
      pendingMessageId: null,
      burstStartedAt: null,
    };
    channelStates.set(channelId, state);
  }
  return state;
}

// Called when a message directly addresses the bot (mention/reply) in an
// answer-machine channel -- that's now handled immediately (see
// evaluateNow below), not through the debounced ambient path. A debounce
// timer queued from *earlier* ambient chatter could still be sitting there
// though, and firing moments later with stale context would land right on
// top of the direct exchange as an unrelated second voice. Cancelling it
// here means the next ambient check starts fresh afterward.
export function cancelPendingEngagement(channelId: string): void {
  const state = getState(channelId);
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
  state.burstStartedAt = null;
}

export function recordAmbientMessage(
  channelId: string,
  entry: AmbientEntry
): void {
  const state = getState(channelId);
  state.buffer.push(entry);
  if (state.buffer.length > BUFFER_SIZE) {
    state.buffer = state.buffer.slice(-BUFFER_SIZE);
  }
  logger.debug(`Answer machine: buffered message in ${channelId} from ${entry.author}`);
}

/**
 * Debounces ambient (unprompted) engagement checks: a burst of messages in a
 * channel collapses into a single decision after the conversation actually
 * pauses, instead of firing a model call per message. `messageId`/`imageUrl`
 * track the specific triggering message so a REACT lands on the right one
 * and a REPLY/vision check can see the latest image, even if a few
 * text-only messages followed it before the debounce fired. Not used for
 * direct mentions/replies -- those go through evaluateNow instead, which
 * skips the wait entirely.
 */
export function scheduleEngagementCheck(
  channelId: string,
  guildId: string,
  channel: SendableChannel,
  triggerMessageId: string,
  triggerImageUrl: string | null,
  reactFn: (emoji: string) => Promise<void>
): void {
  const state = getState(channelId);
  state.pendingMessageId = triggerMessageId;
  if (triggerImageUrl) state.pendingImageUrl = triggerImageUrl;
  if (state.burstStartedAt === null) state.burstStartedAt = Date.now();

  const elapsed = Date.now() - state.burstStartedAt;
  const delay = elapsed >= MAX_WAIT_MS ? 0 : Math.min(DEBOUNCE_MS, MAX_WAIT_MS - elapsed);

  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null;
    state.burstStartedAt = null;
    logger.debug(`Answer machine: evaluating ambient engagement for ${channelId}`);
    evaluateEngagement(channelId, guildId, channel, reactFn, false).catch((err) => {
      logger.warn('Answer machine ambient check failed:', err);
    });
  }, delay);
}

/**
 * A direct mention/reply in an answer-machine channel: evaluated right
 * away (no debounce -- someone directly addressing it deserves an
 * immediate look, not a wait-for-a-lull check) and not subject to the
 * reply/react cooldowns (those exist to stop it butting into ambient
 * chatter too often; they were never meant to block a real answer to
 * someone who actually asked). Still runs through the exact same
 * genuine-question/misinformation criteria as ambient messages -- being
 * mentioned doesn't force a response if there's nothing to answer or
 * correct (e.g. "@Nocturnal say something" with no actual question stays
 * silent, by design).
 */
export async function evaluateNow(
  channelId: string,
  guildId: string,
  channel: SendableChannel,
  imageUrl: string | null,
  reactFn: (emoji: string) => Promise<void>
): Promise<void> {
  cancelPendingEngagement(channelId);
  const state = getState(channelId);
  if (imageUrl) state.pendingImageUrl = imageUrl;
  await evaluateEngagement(channelId, guildId, channel, reactFn, true);
}

interface Decision {
  action: 'ignore' | 'react' | 'reply';
  emoji?: string;
}

const DECISION_PROMPT = `You're an AI passively watching a group chat. You mostly stay quiet.

Respond with exactly ONE line, no explanation:
- IGNORE - the common case: small talk, opinions, jokes, venting/mood with no concrete detail, social coordination. A conversation being interesting is NOT enough on its own to respond.
- REACT:<emoji> - something concrete and emotionally notable just happened or was just described -- good OR bad (an achievement, good news, sad news, a frustrating moment, something funny or embarrassing) -- worth a quick emoji acknowledgment, not a full reply. A short reaction from someone else ("congrats!", "lol", "dang") doesn't change what's being talked about. BUT once the conversation has clearly moved on to something new and unrelated, don't let an earlier emotional moment carry over and color that new, separate message -- judge the new message on its own.
- REPLY - ONLY when: (a) someone asks a genuine, answerable question nobody has already answered correctly, or (b) someone states something factually incorrect that nobody has already corrected. Do not reply just because a conversation is happening or a topic is interesting.`;

async function decideEngagement(buffer: AmbientEntry[], imageUrl: string | null, isLikelyFollowUp: boolean): Promise<Decision> {
  const transcript = buffer.map((e) => `[${e.author}]${e.hasImage ? ' (sent an image)' : ''}: ${e.content}`).join('\n');
  const hint = isLikelyFollowUp
    ? "\n\nNote: the latest message immediately follows your own last reply in this thread and looks like a direct follow-up on it -- lean toward REPLY unless it's clearly unrelated."
    : '';
  const prompt = `${DECISION_PROMPT}${hint}\n\nRecent conversation:\n${transcript}\n\nDecision:`;

  const body: Record<string, unknown> = {
    model: DECISION_MODEL,
    prompt,
    stream: false,
    options: { temperature: 0.1, num_predict: 150 },
  };

  if (imageUrl) {
    try {
      body.images = [await imageUrlToBase64(imageUrl)];
    } catch {
      // Fall through without the image -- still worth a text-only decision.
    }
  }

  const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
  const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) return { action: 'ignore' };

  const data = (await response.json()) as { response?: string };
  const line = (data.response ?? '').trim().split('\n')[0] ?? '';

  const reactMatch = line.match(/^REACT\s*:\s*(\S+)/i);
  if (reactMatch) return { action: 'react', emoji: reactMatch[1] };
  if (/^REPLY\b/i.test(line)) return { action: 'reply' };
  return { action: 'ignore' };
}

async function evaluateEngagement(
  channelId: string,
  guildId: string,
  channel: SendableChannel,
  reactFn: (emoji: string) => Promise<void>,
  immediate: boolean
): Promise<void> {
  const state = getState(channelId);
  if (state.buffer.length === 0) return;

  const guildConfig = loadGuildConfig(guildId);
  const now = Date.now();
  const replyCooldown = REPLY_COOLDOWN_MS[guildConfig.casualChat.chattiness];

  // The message right before the newest one (the one that triggered this
  // check) being the bot's own, within FOLLOWUP_WINDOW_MS, means this is
  // very likely someone continuing the exchange the bot just started --
  // that shouldn't get blocked by the "don't butt in unprompted too often"
  // cooldown, which exists for a different problem entirely.
  const secondLastEntry = state.buffer[state.buffer.length - 2];
  const isLikelyFollowUp =
    secondLastEntry?.author === 'you' && now - state.lastBotReplyAt <= FOLLOWUP_WINDOW_MS;

  const canReply = immediate || isLikelyFollowUp || now - state.lastBotReplyAt >= replyCooldown;
  const canReact = immediate || now - state.lastReactAt >= REACT_COOLDOWN_MS;
  if (!canReply && !canReact) {
    logger.debug(`Answer machine: ${channelId} on cooldown (canReply=${canReply}, canReact=${canReact})`);
    return;
  }

  const decision = await decideEngagement(state.buffer, state.pendingImageUrl, isLikelyFollowUp);
  state.pendingImageUrl = null;
  logger.info(`Answer machine decision for ${channelId}${immediate ? ' (direct)' : ''}${isLikelyFollowUp ? ' (follow-up)' : ''}: ${decision.action}${decision.emoji ? ':' + decision.emoji : ''}`);

  if (decision.action === 'react' && canReact) {
    try {
      await reactFn(decision.emoji!);
      state.lastReactAt = now;
    } catch (err) {
      logger.debug('Answer machine reaction failed (non-fatal):', err);
    }
    return;
  }

  if (decision.action === 'reply' && canReply) {
    const typingInterval = setInterval(() => {
      channel.sendTyping().catch(() => {});
    }, 9000);
    await channel.sendTyping().catch(() => {});
    // Object wrapper so TypeScript doesn't narrow this to `never` across the
    // async onToolStart closure mutating it -- same pattern messageCreate.ts
    // uses for its own status-message placeholder.
    const status = { msg: null as Message | null };
    try {
      const globalConfig = getConfig();
      const transcript = state.buffer.map((e) => `[${e.author}]: ${e.content}`);
      const context: OllamaMessage[] = [
        {
          role: 'system',
          content: `${globalConfig.bot.systemPrompt}\n\nYou're an answer machine in a group chat -- you only speak up to answer a genuine question or correct misinformation, nothing else. Keep it short (1-3 sentences), stay in character/tone, and don't narrate or summarize the conversation back. Use the search tool if you need current/real-time information you don't already know -- don't guess at things that have likely changed since your training. Important: you already decided this question deserves a real answer, so give one -- your personality flavors HOW you answer (dry, blunt, funny, whatever fits), it is never a reason to deflect, refuse, or brush off the actual question instead of answering it. NEVER respond with a refusal or a deflecting joke that avoids answering (e.g. "go look it up yourself", "I'm not doing that for you", "figure it out"). Every reply must contain the actual answer or correction, delivered with whatever attitude fits -- attitude is seasoning, not a substitute for the answer.`,
        },
        { role: 'user', content: transcript.join('\n') },
      ];

      const onToolStart = async (toolName: string): Promise<void> => {
        if (toolName === 'search_web' && !status.msg) {
          try {
            status.msg = await channel.send(randomSearchingPhrase());
          } catch (err) {
            logger.debug('Answer machine searching-placeholder failed (non-fatal):', err);
          }
        }
      };

      const aiContent = await runAgentLoop(context, guildConfig.tools.enabled, { onToolStart }, REPLY_MODEL);
      clearInterval(typingInterval);
      if (aiContent.trim()) {
        const trimmed = aiContent.slice(0, 1999);
        if (status.msg) {
          await status.msg.edit(trimmed).catch(async () => {
            await channel.send(trimmed);
          });
        } else {
          await channel.send(trimmed);
        }
        recordAmbientMessage(channelId, {
          author: 'you',
          content: aiContent,
          hasImage: false,
          ts: Date.now(),
        });
        state.lastBotReplyAt = now;
      }
    } catch (err) {
      clearInterval(typingInterval);
      logger.warn('Answer machine reply failed:', err);
    }
  }
}
