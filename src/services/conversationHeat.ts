// Pure scoring/turn-taking logic for Answer Machine channels — no Discord or
// Ollama imports, so it can be exercised directly from dist/ in a test
// script. Code owns *when and how often* the bot speaks (cooldowns, turn
// rules, thresholds); the decision model only supplies an intent and an
// interest score for the current moment.

export type Intent = 'none' | 'answer' | 'correct' | 'react' | 'chat';

export interface Entry {
  author: string;
  isBot: boolean;
  content: string;
  // Pictures in the message (attachments, link-preview images/GIFs,
  // stickers). Kept for the life of the session so a later "look at his
  // face" can refer back to one.
  images?: ImageRef[];
  ts: number;
  // Set when the message @-mentions or replies to a specific other person
  // (not the bot) -- it's their exchange, not an open invitation.
  addressedTo?: string;
  messageId?: string;
  // Discord message this one is a reply to (any author).
  replyToId?: string;
  // Who/what it replies to, shown as `[Rixo ↩ you: "scared of what?…"]`.
  // author is 'you' when replying to the bot.
  replyTo?: { author: string; snippet: string };
  // Emoji (display form, e.g. "😂" or ":kek:") -> display names of who
  // reacted ("you" for the bot). Background context only -- reactions never
  // trigger an evaluation by themselves.
  reactions?: Record<string, string[]>;
  // Link-preview text for non-image links ("YouTube: Some Video Title").
  links?: string[];
}

export interface ImageRef {
  // A still to fall back on (attachment, or a GIF's preview frame).
  url: string;
  kind: 'image' | 'gif' | 'sticker' | 'video';
  // For GIFs and video clips: the animated source (mp4/gif) to sample
  // several frames from. Video has no usable still -- frames or nothing.
  video?: string;
  // GIF uploader's title/slug or sticker name -- a hint, not the truth.
  title?: string;
}

export interface LevelParams {
  replyCooldownMs: number;
  reactCooldownMs: number;
  debounceMs: number;
  maxWaitMs: number;
  thresholdAnswer: number;
  thresholdReact: number;
  // null = casual chat not allowed at this heat (answer-machine behavior only)
  thresholdChat: number | null;
  followUpWindowMs: number;
}

// Heat anchors. Low/Medium/High reply cooldowns match the pre-heat values
// so servers on those presets don't shift; TalksALot (85) and above are
// where casual chat opens up.
const ANCHORS: Array<{ heat: number } & Omit<LevelParams, 'thresholdChat'>> = [
  // React thresholds calibrated against the decision model: genuine
  // reactable moments rate 6-10, so Medium (6) keeps reacting to them the
  // way the pre-heat Answer Machine did; Low (7) trims the weakest.
  { heat: 0,   replyCooldownMs: 15 * 60_000, reactCooldownMs: 90_000, debounceMs: 3000, maxWaitMs: 12_000, thresholdAnswer: 6.5, thresholdReact: 8,   followUpWindowMs: 90_000 },
  { heat: 15,  replyCooldownMs: 10 * 60_000, reactCooldownMs: 60_000, debounceMs: 3000, maxWaitMs: 12_000, thresholdAnswer: 6,   thresholdReact: 7,   followUpWindowMs: 90_000 },
  { heat: 35,  replyCooldownMs: 5 * 60_000,  reactCooldownMs: 30_000, debounceMs: 2500, maxWaitMs: 12_000, thresholdAnswer: 5.5, thresholdReact: 6,   followUpWindowMs: 90_000 },
  { heat: 60,  replyCooldownMs: 2 * 60_000,  reactCooldownMs: 20_000, debounceMs: 2500, maxWaitMs: 10_000, thresholdAnswer: 5,   thresholdReact: 5.5, followUpWindowMs: 120_000 },
  { heat: 85,  replyCooldownMs: 20_000,      reactCooldownMs: 10_000, debounceMs: 1500, maxWaitMs: 6_000,  thresholdAnswer: 4,   thresholdReact: 5,   followUpWindowMs: 180_000 },
  { heat: 100, replyCooldownMs: 10_000,      reactCooldownMs: 6_000,  debounceMs: 1200, maxWaitMs: 5_000,  thresholdAnswer: 3.5, thresholdReact: 4.5, followUpWindowMs: 240_000 },
];

// Casual chat only opens at heat >= 70.
const CHAT_ANCHORS = [
  { heat: 70, threshold: 6 },
  { heat: 85, threshold: 4.5 },
  { heat: 100, threshold: 3.5 },
];
const CHAT_MIN_HEAT = 70;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function levelParams(heatRaw: number): LevelParams {
  const heat = Math.max(0, Math.min(100, heatRaw));
  let lo = ANCHORS[0];
  let hi = ANCHORS[ANCHORS.length - 1];
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    if (heat >= ANCHORS[i].heat && heat <= ANCHORS[i + 1].heat) {
      lo = ANCHORS[i];
      hi = ANCHORS[i + 1];
      break;
    }
  }
  const t = hi.heat === lo.heat ? 0 : (heat - lo.heat) / (hi.heat - lo.heat);

  let thresholdChat: number | null = null;
  if (heat >= CHAT_MIN_HEAT) {
    let clo = CHAT_ANCHORS[0];
    let chi = CHAT_ANCHORS[CHAT_ANCHORS.length - 1];
    for (let i = 0; i < CHAT_ANCHORS.length - 1; i++) {
      if (heat >= CHAT_ANCHORS[i].heat && heat <= CHAT_ANCHORS[i + 1].heat) {
        clo = CHAT_ANCHORS[i];
        chi = CHAT_ANCHORS[i + 1];
        break;
      }
    }
    const ct = chi.heat === clo.heat ? 0 : (heat - clo.heat) / (chi.heat - clo.heat);
    thresholdChat = lerp(clo.threshold, chi.threshold, ct);
  }

  return {
    replyCooldownMs: Math.round(lerp(lo.replyCooldownMs, hi.replyCooldownMs, t)),
    reactCooldownMs: Math.round(lerp(lo.reactCooldownMs, hi.reactCooldownMs, t)),
    debounceMs: Math.round(lerp(lo.debounceMs, hi.debounceMs, t)),
    maxWaitMs: Math.round(lerp(lo.maxWaitMs, hi.maxWaitMs, t)),
    thresholdAnswer: lerp(lo.thresholdAnswer, hi.thresholdAnswer, t),
    thresholdReact: lerp(lo.thresholdReact, hi.thresholdReact, t),
    thresholdChat,
    followUpWindowMs: Math.round(lerp(lo.followUpWindowMs, hi.followUpWindowMs, t)),
  };
}

// ── Burst (session) memory ─────────────────────────────────────────────────

export const SESSION_IDLE_MS = 10 * 60_000;
export const SESSION_MAX_COUNT = 40;
export const SESSION_MAX_CHARS = 6000;

// Idle gap past SESSION_IDLE_MS wipes the session entirely (so nothing from
// an old conversation leaks into a new one); otherwise the oldest entries
// drop off once the count or character budget is exceeded.
export function isSessionStale(entries: Entry[], now: number, idleMs = SESSION_IDLE_MS): boolean {
  return entries.length > 0 && now - entries[entries.length - 1].ts > idleMs;
}

export function trimOverflow(entries: Entry[], maxCount = SESSION_MAX_COUNT, maxChars = SESSION_MAX_CHARS): Entry[] {
  let out = entries.length > maxCount ? entries.slice(-maxCount) : entries.slice();
  let chars = out.reduce((n, e) => n + e.content.length, 0);
  while (out.length > 1 && chars > maxChars) {
    chars -= out[0].content.length;
    out = out.slice(1);
  }
  return out;
}

export function formatAgo(ts: number, now: number): string {
  const secs = Math.max(0, Math.round((now - ts) / 1000));
  if (secs < 45) return 'just now';
  return `${Math.max(1, Math.round(secs / 60))}m ago`;
}

// Chat text goes into the transcript as one line per message. Line breaks
// and square brackets would let someone forge a "[you] (just now): ..."
// line or a section header inside their own message (or display name), so
// both are neutralized before anything is buffered.
export function sanitizeText(s: string): string {
  return s
    .replace(/<a?:(\w+):\d+>/g, ':$1:') // custom emoji -> readable :name:
    .replace(/\s*[\r\n]+\s*/g, ' / ')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/[{}]/g, '');
}

export function snippet(s: string, max = 50): string {
  const t = sanitizeText(s).replace(/"/g, "'").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const MAX_REACTORS_SHOWN = 3;

function formatReactions(r: Record<string, string[]> | undefined): string {
  if (!r) return '';
  const parts = Object.entries(r)
    .filter(([, who]) => who.length)
    .map(([emoji, who]) => {
      const names = who.slice(0, MAX_REACTORS_SHOWN).join(', ') + (who.length > MAX_REACTORS_SHOWN ? ', …' : '');
      return `${emoji}×${who.length}: ${names}`;
    });
  return parts.length ? ` {reactions ${parts.join('; ')}}` : '';
}

function unseenImageNote(images: ImageRef[]): string {
  const sticker = images.find((i) => i.kind === 'sticker');
  if (sticker) return ` (sent a sticker${sticker.title ? ` "${sticker.title}"` : ''})`;
  if (images.some((i) => i.kind === 'video')) return ' (sent a video)';
  return images.some((i) => i.kind === 'gif') ? ' (sent a GIF)' : ' (sent an image)';
}

export function sanitizeName(s: string): string {
  return sanitizeText(s).replace(/[():→@]/g, '').trim().slice(0, 32) || 'someone';
}

// imageTag: which attached picture(s) this line's image(s) are ("image 1").
// An entry with images but no tag gets a plain "(sent an image)" -- the
// model can't see it this time and shouldn't guess what's in it.
export function formatEntry(e: Entry, now: number, imageTag?: string): string {
  const who = e.isBot
    ? 'you'
    : e.replyTo
      ? `${e.author} ↩ ${e.replyTo.author}: "${e.replyTo.snippet}"`
      : e.addressedTo
        ? `${e.author} → @${e.addressedTo}`
        : e.author;
  const img = imageTag ? ` [${imageTag}]` : e.images?.length ? unseenImageNote(e.images) : '';
  const links = e.links?.length ? ` (link preview: ${e.links.map((l) => `"${l}"`).join(', ')})` : '';
  return `[${who}] (${formatAgo(e.ts, now)})${img}: ${e.content}${links}${formatReactions(e.reactions)}`;
}

// Label for an image the model is actually shown: "image 1", plus what kind
// it is and the uploader's title as an explicitly untrusted hint.
export function imageLabel(n: number, ref: ImageRef, frames: number): string {
  if (ref.kind === 'sticker') return `image ${n}: sticker${ref.title ? ` "${ref.title}"` : ''}`;
  if (ref.kind === 'video') return `image ${n}: video clip, ${frames} frames left-to-right top-to-bottom (no sound)`;
  if (ref.kind !== 'gif') return `image ${n}`;
  const how = frames > 1 ? `GIF, ${frames} frames left-to-right top-to-bottom` : 'GIF, one frame';
  return `image ${n}: ${how}${ref.title ? `, uploader's title "${ref.title}" (may not match how it's used)` : ''}`;
}

// ── Images ─────────────────────────────────────────────────────────────────

export const MAX_IMAGES = 3;

// A new message pointing back at an earlier picture without replying to it.
const LOOKBACK_RE = /\b(that|this|the|his|her|their|ur|your)\s+(pic|pics|picture|image|photo|meme|gif|screenshot|ss|face|fit|outfit|video|vid|clip)\b|\blook(ing)? at\b|\bwhat (is|was) (this|that)\b/i;

export interface SelectedImage {
  entry: Entry;
  ref: ImageRef;
}

// Which pictures the model actually gets to look at this time, oldest
// first, at most MAX_IMAGES:
//  1. every image in NEW (newest wins if over the cap),
//  2. an earlier image a NEW message is a Discord reply to,
//  3. if NEW has no images but points back at one ("that pic"), the most
//     recent earlier image.
// Anything else stays a text-only "(sent an image)".
export function selectImages(snapshot: Entry[], fresh: Entry[]): SelectedImage[] {
  const picked: SelectedImage[] = [];
  const add = (entry: Entry, ref: ImageRef): void => {
    if (picked.length < MAX_IMAGES && !picked.some((p) => p.ref.url === ref.url)) picked.push({ entry, ref });
  };

  for (const e of [...fresh].reverse()) for (const ref of e.images ?? []) add(e, ref);

  for (const e of fresh) {
    if (!e.replyToId) continue;
    const target = snapshot.find((s) => s.messageId === e.replyToId);
    for (const ref of target?.images ?? []) add(target!, ref);
  }

  if (!fresh.some((e) => e.images?.length) && fresh.some((e) => LOOKBACK_RE.test(e.content))) {
    const prev = [...snapshot].reverse().find((e) => !fresh.includes(e) && e.images?.length);
    if (prev) add(prev, prev.images![prev.images!.length - 1]);
  }

  return picked.sort((a, b) => snapshot.indexOf(a.entry) - snapshot.indexOf(b.entry));
}

// 0-1: how "out of nowhere" a NEW image is. Context of a picture is hard to
// judge, so this only looks at timing: a picture dropped into a quiet
// channel after a lull stands on its own (1); one posted mid-flow in a busy
// chat is part of that conversation (~0), where momentum already carries it.
export const IMAGE_LULL_MS = 90_000;

export function imageStandalone(snapshot: Entry[], fresh: Entry[], momentum: number): number {
  let best = 0;
  for (const e of fresh) {
    if (!e.images?.length || e.addressedTo) continue;
    const idx = snapshot.indexOf(e);
    const prev = idx > 0 ? snapshot[idx - 1] : undefined;
    const gapScore = prev ? Math.min(1, Math.max(0, e.ts - prev.ts) / IMAGE_LULL_MS) : 1;
    best = Math.max(best, 0.5 * (1 - momentum) + 0.5 * gapScore);
  }
  return best;
}

// Extra score for a standalone image, scaled by how interesting the model
// found the moment: a dull screenshot dropped out of nowhere gets nothing
// (interest <= 3), something outrageous/cool gets up to IMAGE_MAX_BOOST.
export const IMAGE_MAX_BOOST = 3;

export function imageBoost(standalone: number, interest: number): number {
  return IMAGE_MAX_BOOST * standalone * Math.max(0, Math.min(1, (interest - 3) / 7));
}

// A bare acknowledgement ("lol", "fr fr", "ok bet", an emoji) -- answering
// every one of these with a full reply reads as the bot chasing the
// conversation. Empty text (an image/GIF-only reply) counts too.
const ACK_WORDS = new Set([
  'lol', 'lmao', 'lmfao', 'lmaoo', 'lmaooo', 'haha', 'hahaha', 'ha', 'fr', 'frfr', 'ok', 'okay', 'k', 'kk',
  'bet', 'true', 'facts', 'real', 'ye', 'yea', 'yeah', 'yep', 'yup', 'nah', 'no', 'ty', 'thx', 'thanks',
  'nice', 'damn', 'dang', 'bruh', 'bro', 'word', 'same', 'mhm', 'hm', 'hmm', 'ight', 'aight', 'sure', 'cool', 'w', 'l',
]);

export function isAcknowledgement(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/<a?:\w+:\d+>/g, ' ') // custom emoji
    .replace(/[\p{Extended_Pictographic}‍️]/gu, ' ')
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return words.length <= 3 && words.every((w) => ACK_WORDS.has(w));
}

// Every new message is aimed at some other specific person -- someone
// else's exchange, not an opening for the bot to chat into.
export function allAddressedElsewhere(fresh: Entry[]): boolean {
  return fresh.length > 0 && fresh.every((e) => !!e.addressedTo);
}

// ── Signals ────────────────────────────────────────────────────────────────

// 0-1: how lively the channel is right now (message rate + how many
// different people are talking in the last 2 minutes).
export function computeMomentum(entries: Entry[], now: number): number {
  const recent = entries.filter((e) => !e.isBot && now - e.ts <= 120_000);
  const rate = Math.min(1, recent.length / 8);
  const people = new Set(recent.map((e) => e.author)).size;
  const peopleScore = Math.min(1, Math.max(0, (people - 1) / 2));
  return 0.6 * rate + 0.4 * peopleScore;
}

export interface ConversationSignals {
  inConversation: boolean;
  firstReplyAfterBot: boolean;
  nameMentioned: boolean;
  direct: boolean;
  // Latest message is a question to the whole room ("y'all", "anyone") --
  // an invitation that includes the bot, not a private exchange.
  openQuestion: boolean;
}

const GROUP_ASK_RE = /\b(y'?all|you guys|you all|everyone|everybody|anyone|anybody)\b/i;

export function isOpenQuestion(e: Entry): boolean {
  return !e.isBot && !e.addressedTo && e.content.includes('?') && GROUP_ASK_RE.test(e.content);
}

export function conversationSignals(
  entries: Entry[],
  newEntries: Entry[],
  now: number,
  followUpWindowMs: number,
  botName: string,
  direct: boolean,
): ConversationSignals {
  let lastBotIdx = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].isBot) {
      lastBotIdx = i;
      break;
    }
  }

  // Only messages that could be aimed at the bot keep the conversation going
  // -- one aimed at someone else ("@Rixo told you lol") right after the bot
  // spoke is their exchange, not a reply to it.
  let inConversation = false;
  let firstReplyAfterBot = false;
  if (lastBotIdx >= 0 && now - entries[lastBotIdx].ts <= followUpWindowMs) {
    const after = entries.slice(lastBotIdx + 1).filter((e) => !e.isBot && !e.addressedTo);
    inConversation = after.length > 0;
    firstReplyAfterBot = after.length > 0 && newEntries.includes(after[0]);
  }

  const name = botName.trim().toLowerCase();
  const nameRe = name ? new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') : null;
  const nameMentioned = !!nameRe && newEntries.some((e) => nameRe.test(e.content));

  const latest = newEntries[newEntries.length - 1];
  const openQuestion = !!latest && isOpenQuestion(latest);

  return { inConversation, firstReplyAfterBot, nameMentioned, direct, openQuestion };
}

// Bonuses represent "someone is talking to me" — they boost speaking, not
// reacting. Any bonus also lifts the yield penalty (see yieldPenalty).
export function bonusTotal(s: ConversationSignals): number {
  return (s.inConversation ? 3 : 0) + (s.firstReplyAfterBot ? 1 : 0) + (s.nameMentioned ? 3 : 0)
    + (s.direct ? 4 : 0) + (s.openQuestion ? 2 : 0);
}

// Fair-share cap: the bot shouldn't hold more than its share of recent
// messages. A 1:1 conversation can alternate (cap 0.5); a busy multi-person
// chat can't be dominated (floor 0.2).
export function fairShareExceeded(entries: Entry[]): boolean {
  const last = entries.slice(-12);
  if (!last.length) return false;
  const bot = last.filter((e) => e.isBot).length;
  const humans = new Set(last.filter((e) => !e.isBot).map((e) => e.author)).size;
  const cap = Math.max(0.2, 1 / (humans + 1));
  return bot / last.length > cap;
}

// Someone the bot has been trading lines with is writing again (not aimed at
// someone else). Fair share exists so the bot doesn't take over a group
// chat -- not to cut off a person who's actually talking to it, so this
// exempts them. "Partners" are whoever the bot's recent messages followed.
export function partnerContinuing(entries: Entry[], fresh: Entry[]): boolean {
  const recent = entries.slice(-12);
  const partners = new Set<string>();
  let lastBotIdx = -1;
  recent.forEach((e, i) => {
    if (!e.isBot) return;
    lastBotIdx = i;
    const before = recent.slice(0, i).reverse().find((x) => !x.isBot);
    if (before && !before.addressedTo) partners.add(before.author);
  });
  if (lastBotIdx < 0) return false;
  const after = recent.slice(lastBotIdx + 1);
  return fresh.some((e) => after.includes(e) && !e.addressedTo && partners.has(e.author));
}

// Two or more people rapid-firing at each other, not involving the bot:
// make casual chat harder to break into (answers/corrections unaffected).
export function yieldPenalty(entries: Entry[], now: number, bonus: number): number {
  if (bonus > 0) return 0;
  const recent = entries.filter((e) => !e.isBot && now - e.ts <= 60_000);
  const people = new Set(recent.map((e) => e.author)).size;
  return recent.length >= 4 && people >= 2 ? 2 : 0;
}

export interface Verdict {
  engage: boolean;
  score: number;
  threshold: number | null;
}

export function shouldEngage(
  intent: Intent,
  interest: number,
  p: LevelParams,
  momentum: number,
  bonus: number,
  chatPenalty: number,
  jitter: number,
  // Hard rule: casual chat never cuts into an exchange aimed at someone
  // else unless the bot itself is being talked to. Answers/corrections and
  // reactions are unaffected.
  chatBlocked = false,
  // From imageBoost(). Counts toward every intent, but -- unlike bonus --
  // never lifts chatBlocked: an image aimed at someone else isn't an opening.
  imgBoost = 0,
): Verdict {
  if (intent === 'none') return { engage: false, score: interest, threshold: null };
  if (intent === 'chat' && chatBlocked && bonus === 0) {
    return { engage: false, score: interest, threshold: null };
  }

  if (intent === 'react') {
    const score = interest + momentum * 2 + imgBoost + jitter;
    return { engage: score >= p.thresholdReact, score, threshold: p.thresholdReact };
  }

  const threshold = intent === 'chat'
    ? (p.thresholdChat === null ? null : p.thresholdChat + chatPenalty)
    : p.thresholdAnswer;
  const score = interest + bonus + momentum * 2 + imgBoost + jitter;
  if (threshold === null) return { engage: false, score, threshold: null };
  return { engage: score >= threshold, score, threshold };
}

export function randomJitter(): number {
  return (Math.random() - 0.5); // ±0.5
}
