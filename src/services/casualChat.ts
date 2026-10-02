import { TextChannel, NewsChannel, ThreadChannel, DMChannel, Message } from 'discord.js';
import { getConfig } from '../config';
import { loadGuildConfig, resolveHeat } from '../config/guildConfig';
import { logger } from '../utils/logger';
import { imageUrlToBase64, OllamaMessage } from '../ollama/client';
import { runAgentLoop } from './chat';
import {
  Entry,
  Intent,
  levelParams,
  isSessionStale,
  trimOverflow,
  formatEntry,
  computeMomentum,
  conversationSignals,
  bonusTotal,
  fairShareExceeded,
  yieldPenalty,
  shouldEngage,
  randomJitter,
  allAddressedElsewhere,
} from './conversationHeat';

// "Answer Machine" mode: a channel-scoped alternative to the normal
// mention/reply chat-bot pipeline (see messageCreate.ts) -- no per-user
// memory, a separate (much faster) model. At low heat it only answers
// questions and corrects misinformation; at TalksALot heat it also joins
// casual conversation. How often it speaks is decided by the server's heat
// level (conversationHeat.ts); the model only rates each moment. A channel
// with this enabled never falls through to the chat-bot/Kimi pipeline,
// even when directly mentioned -- see messageCreate.ts's routing.
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
// kimi taking ~4.5s even for a one-line reply, while gemma4:cloud produced
// good in-character replies in 300-600ms -- speed matters here because it's
// interjecting into a conversation people are actively having. Reply
// generation still goes through runAgentLoop (search/weather/time/crypto
// tools) so a question needing current info doesn't get a stale answer.
const DECISION_MODEL = 'gemma4:cloud';
const REPLY_MODEL = 'gemma4:cloud';

interface ChannelState {
  // The current conversation session ("burst" memory). Wiped after an idle
  // gap, oldest entries trimmed on overflow -- see conversationHeat.ts.
  buffer: Entry[];
  lastBotReplyAt: number;
  lastReactAt: number;
  // Entries newer than this haven't been looked at yet -- they're the only
  // part of the transcript the model is allowed to act on.
  lastEvaluatedTs: number;
  debounceTimer: NodeJS.Timeout | null;
  pendingImageUrl: string | null;
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
      lastEvaluatedTs: 0,
      debounceTimer: null,
      pendingImageUrl: null,
      burstStartedAt: null,
    };
    channelStates.set(channelId, state);
  }
  return state;
}

function pushEntry(channelId: string, entry: Entry): void {
  const state = getState(channelId);
  if (isSessionStale(state.buffer, entry.ts)) {
    state.buffer = [];
    state.lastEvaluatedTs = 0;
    logger.debug(`Answer machine: session in ${channelId} went idle — starting fresh`);
  }
  state.buffer.push(entry);
  state.buffer = trimOverflow(state.buffer);
}

// Called when a message directly addresses the bot (mention/reply) -- that's
// handled immediately via evaluateNow, so any debounce timer queued from
// earlier ambient chatter is cancelled rather than firing on top of it.
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
  entry: { author: string; content: string; hasImage: boolean; ts: number; addressedTo?: string }
): void {
  pushEntry(channelId, { ...entry, isBot: false });
  logger.debug(`Answer machine: buffered message in ${channelId} from ${entry.author}`);
}

/**
 * Debounces ambient (unprompted) engagement checks: a burst of messages in a
 * channel collapses into a single decision after the conversation actually
 * pauses, instead of firing a model call per message. Debounce length and
 * the hard ceiling for a continuously-busy channel both scale with heat.
 * Not used for direct mentions/replies -- those go through evaluateNow.
 */
export function scheduleEngagementCheck(
  channelId: string,
  guildId: string,
  channel: SendableChannel,
  triggerImageUrl: string | null,
  reactFn: (emoji: string) => Promise<void>,
  botName: string
): void {
  const state = getState(channelId);
  if (triggerImageUrl) state.pendingImageUrl = triggerImageUrl;
  if (state.burstStartedAt === null) state.burstStartedAt = Date.now();

  const p = levelParams(resolveHeat(loadGuildConfig(guildId)));
  const elapsed = Date.now() - state.burstStartedAt;
  const delay = elapsed >= p.maxWaitMs ? 0 : Math.min(p.debounceMs, p.maxWaitMs - elapsed);

  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null;
    state.burstStartedAt = null;
    evaluateEngagement(channelId, guildId, channel, reactFn, false, botName).catch((err) => {
      logger.warn('Answer machine ambient check failed:', err);
    });
  }, delay);
}

/**
 * A direct mention/reply: evaluated right away and not subject to the
 * reply/react cooldowns or the fair-share cap (those exist to stop it
 * butting into ambient chatter too often, not to block someone who's
 * actually talking to it). Still goes through the same heat-based decision
 * -- being addressed is a big score boost, not a guaranteed reply.
 */
export async function evaluateNow(
  channelId: string,
  guildId: string,
  channel: SendableChannel,
  imageUrl: string | null,
  reactFn: (emoji: string) => Promise<void>,
  botName: string
): Promise<void> {
  cancelPendingEngagement(channelId);
  const state = getState(channelId);
  if (imageUrl) state.pendingImageUrl = imageUrl;
  await evaluateEngagement(channelId, guildId, channel, reactFn, true, botName);
}

interface Decision {
  intent: Intent;
  interest: number;
  emoji?: string;
}

const DECISION_PROMPT = `You're a regular member of a Discord group chat, reading along. Rate the NEW messages only — the EARLIER section is background you've already seen; never respond to it again, and don't let an emotional moment from EARLIER color a new, unrelated message. Lines marked [you] are things you already said — don't repeat them. A line marked [name → @other] is aimed at that other person (greeting them, replying to them) — it's their exchange, not an invitation for you; don't act like it was said to you.

Pick ONE intent:
- answer: someone asked a genuine, answerable question nobody has answered correctly yet
- correct: someone stated something factually wrong nobody has corrected yet
- react: something concrete and emotionally notable just happened (achievement, good/bad news, something funny or embarrassing) — an emoji fits, a full reply would be overkill. It still counts if someone else already responded to it in NEW (e.g. "my coworker got laid off" then "dang, I feel bad") — a short reaction from someone else doesn't change what's being talked about. Vague mood with no specific event doesn't count.
- chat: there's a natural opening for a regular chat member to say something casual (an opinion, a joke, a relatable comment, or continuing a conversation someone is having with you)
- none: nothing worth saying

interest: 0-10, how natural or valuable it would be for you to say something right now. Be honest — don't inflate it.

Reply with ONLY a JSON object, no code fences: {"intent": "<answer|correct|react|chat|none>", "interest": <integer 0-10>, "emoji": "<single emoji, only for react>"}`;

const INTENTS: Intent[] = ['none', 'answer', 'correct', 'react', 'chat'];

function buildSections(earlier: Entry[], fresh: Entry[], now: number): string {
  const earlierText = earlier.length ? earlier.map((e) => formatEntry(e, now)).join('\n') : '(nothing)';
  const freshText = fresh.map((e) => formatEntry(e, now)).join('\n');
  return `EARLIER (already seen — context only):\n${earlierText}\n\nNEW since your last look:\n${freshText}`;
}

// gemma4:cloud ignores Ollama's JSON-schema `format` option (confirmed by
// direct testing -- it returns fenced JSON with made-up intents), so the
// shape is requested in the prompt and validated here instead.
function parseDecision(raw: string): Decision {
  const s = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const o = JSON.parse(s) as { intent?: string; interest?: number; emoji?: string };
    const intent = INTENTS.includes(o.intent as Intent) ? (o.intent as Intent) : 'none';
    const interest = typeof o.interest === 'number' ? Math.max(0, Math.min(10, Math.round(o.interest))) : 0;
    const emoji = typeof o.emoji === 'string' && o.emoji.trim() ? o.emoji.trim() : undefined;
    return { intent, interest, emoji };
  } catch {
    return { intent: 'none', interest: 0 };
  }
}

async function decideEngagement(
  earlier: Entry[],
  fresh: Entry[],
  now: number,
  imageUrl: string | null,
  talkingToBot: boolean,
  openQuestion: boolean,
): Promise<Decision> {
  const note = talkingToBot
    ? '\n\nNote: the NEW messages are addressed to you or responding to something you said.'
    : openQuestion
      ? "\n\nNote: the latest message is a question to the whole room — that includes you. Treat it like you were asked, not like overhearing someone else's conversation."
      : '';
  const prompt = `${DECISION_PROMPT}${note}\n\n${buildSections(earlier, fresh, now)}\n\nAnswer:`;

  const body: Record<string, unknown> = {
    model: DECISION_MODEL,
    prompt,
    stream: false,
    options: { temperature: 0.2, num_predict: 150 },
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
  if (!response.ok) return { intent: 'none', interest: 0 };

  const data = (await response.json()) as { response?: string };
  return parseDecision(data.response ?? '');
}

const ANSWER_INSTRUCTIONS = `You're an answer machine in a group chat -- you only speak up to answer a genuine question or correct misinformation in the NEW messages. Keep it short (1-3 sentences), stay in character/tone, and don't narrate or summarize the conversation back. Use the search tool if you need current/real-time information you don't already know -- don't guess at things that have likely changed since your training. Important: you already decided this deserves a real answer, so give one -- your personality flavors HOW you answer (dry, blunt, funny, whatever fits), it is never a reason to deflect, refuse, or brush off the actual question. NEVER respond with a refusal or a deflecting joke that avoids answering (e.g. "go look it up yourself", "I'm not doing that for you", "figure it out"). Every reply must contain the actual answer or correction -- attitude is seasoning, not a substitute.`;

const CHAT_INSTRUCTIONS = `You're a regular member of this group chat and just decided to chime in on your own. Respond to what's in NEW -- EARLIER is background, don't bring it back up unless it's directly relevant to what's new. Write like a real chat message: short (usually one or two sentences), casual, no greetings, no summarizing what people said, don't force a question just to keep the conversation going, and don't repeat anything you already said (your earlier lines are marked [you]). Use the search tool only if you genuinely need current information.`;

async function evaluateEngagement(
  channelId: string,
  guildId: string,
  channel: SendableChannel,
  reactFn: (emoji: string) => Promise<void>,
  immediate: boolean,
  botName: string
): Promise<void> {
  const state = getState(channelId);
  const now = Date.now();
  if (isSessionStale(state.buffer, now)) {
    state.buffer = [];
    state.lastEvaluatedTs = 0;
  }
  if (!state.buffer.length) return;

  const snapshot = state.buffer.slice();
  const fresh = snapshot.filter((e) => !e.isBot && e.ts > state.lastEvaluatedTs);
  if (!fresh.length) return;
  const earlier = snapshot.filter((e) => !fresh.includes(e));
  // Advance regardless of outcome -- anything arriving during the model
  // call stays "new" for the next look.
  state.lastEvaluatedTs = snapshot[snapshot.length - 1].ts;

  const guildConfig = loadGuildConfig(guildId);
  const heat = resolveHeat(guildConfig);
  const p = levelParams(heat);

  const signals = conversationSignals(snapshot, fresh, now, p.followUpWindowMs, botName, immediate);
  const bonus = bonusTotal(signals);
  const momentum = computeMomentum(snapshot, now);

  const replyAllowed = (immediate || signals.inConversation || now - state.lastBotReplyAt >= p.replyCooldownMs)
    && (immediate || !fairShareExceeded(snapshot));
  const reactAllowed = immediate || now - state.lastReactAt >= p.reactCooldownMs;
  if (!replyAllowed && !reactAllowed) {
    logger.debug(`Answer machine: ${channelId} gated (cooldown/fair-share)`);
    return;
  }

  const imageUrl = state.pendingImageUrl;
  state.pendingImageUrl = null;
  const talkingToBot = signals.direct || signals.inConversation || signals.nameMentioned;
  const decision = await decideEngagement(earlier, fresh, now, imageUrl, talkingToBot, signals.openQuestion);

  const verdict = shouldEngage(
    decision.intent,
    decision.interest,
    p,
    momentum,
    bonus,
    yieldPenalty(snapshot, now, bonus),
    randomJitter(),
    allAddressedElsewhere(fresh),
  );
  logger.info(
    `Answer machine ${channelId} heat=${heat}${immediate ? ' (direct)' : ''}: ` +
    `intent=${decision.intent} interest=${decision.interest} bonus=${bonus} momentum=${momentum.toFixed(2)} ` +
    `score=${verdict.score.toFixed(1)} threshold=${verdict.threshold === null ? 'n/a' : verdict.threshold.toFixed(1)} ` +
    `→ ${verdict.engage ? 'ENGAGE' : 'skip'}${decision.emoji ? ' ' + decision.emoji : ''}`
  );
  if (!verdict.engage) return;

  if (decision.intent === 'react') {
    if (!reactAllowed || !decision.emoji) return;
    try {
      await reactFn(decision.emoji);
      state.lastReactAt = now;
    } catch (err) {
      logger.debug('Answer machine reaction failed (non-fatal):', err);
    }
    return;
  }

  if (!replyAllowed) return;

  const typingInterval = setInterval(() => {
    channel.sendTyping().catch(() => {});
  }, 9000);
  await channel.sendTyping().catch(() => {});
  // Object wrapper so TypeScript doesn't narrow this to `never` across the
  // async onToolStart closure mutating it -- same pattern messageCreate.ts
  // uses for its own status-message placeholder.
  const status = { msg: null as Message | null };
  try {
    const instructions = decision.intent === 'chat' ? CHAT_INSTRUCTIONS : ANSWER_INSTRUCTIONS;
    const context: OllamaMessage[] = [
      { role: 'system', content: `${getConfig().bot.systemPrompt}\n\n${instructions}` },
      { role: 'user', content: buildSections(earlier, fresh, now) },
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
      pushEntry(channelId, { author: 'you', isBot: true, content: aiContent, hasImage: false, ts: Date.now() });
      state.lastBotReplyAt = Date.now();
    }
  } catch (err) {
    clearInterval(typingInterval);
    logger.warn('Answer machine reply failed:', err);
  }
}
