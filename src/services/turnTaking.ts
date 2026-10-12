import { Entry } from './conversationHeat';

export interface TurnTiming { typingProtection?: boolean; turnSpacingMs?: number; groupPauseMs: number; typingGraceMs: number; maxTurnWaitMs: number }
export interface TurnWindow {
  now: number; burstStartedAt: number; lastHumanAt: number; lastBotAt: number;
  people: number; typingUntil: number; direct: boolean;
}
export function humanCount(entries: Entry[], now: number): number {
  return new Set(entries.filter(e => !e.isBot && now - e.ts <= 120_000).map(e => e.authorId ?? e.author)).size;
}
export function turnDelay(window: TurnWindow, timing: TurnTiming): { delayMs: number; reason: 'quiet_window' | 'human_typing' | 'turn_spacing' | null } {
  const spacingUntil = window.people >= 2 && window.lastBotAt ? window.lastBotAt + (timing.turnSpacingMs ?? timing.groupPauseMs * 2) : 0;
  const cap = Math.max(window.burstStartedAt + (window.direct ? Math.min(3000, timing.maxTurnWaitMs) : timing.maxTurnWaitMs), spacingUntil);
  const typingUntil = timing.typingProtection === false ? 0 : window.typingUntil;
  if (window.now >= cap) return { delayMs: 0, reason: null };
  const pause = window.direct ? Math.min(500, timing.groupPauseMs) : window.people >= 2 ? timing.groupPauseMs : 1500;
  const quietUntil = (window.direct ? window.burstStartedAt : window.lastHumanAt) + pause;
  const until = Math.min(cap, Math.max(quietUntil, spacingUntil, typingUntil));
  const delayMs = Math.max(0, until - window.now);
  const reason = !delayMs ? null : typingUntil > 0 && typingUntil >= Math.max(quietUntil, spacingUntil) ? 'human_typing' : spacingUntil > quietUntil ? 'turn_spacing' : 'quiet_window';
  return { delayMs, reason };
}
