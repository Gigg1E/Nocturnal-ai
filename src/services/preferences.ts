import { getDatabase } from '../database/schema';
import { getConfig } from '../config';

export const MAX_PREFERENCES_LENGTH = 2000;

export interface PreferenceItem {
  topic: string;
  value: string;
}

export type ParseResult =
  | { ok: true; items: PreferenceItem[] }
  | { ok: false; error: string };

/**
 * Parses "topic: value, topic: value, ..." into structured pairs.
 * Rejects the whole input on any malformed segment rather than silently
 * dropping it, so the user gets clear feedback about exactly what to fix
 * instead of guessing later why something didn't take.
 */
export function parsePreferencesInput(text: string): ParseResult {
  const segments = text.split(',').map((s) => s.trim()).filter((s) => s.length > 0);

  if (segments.length === 0) {
    return { ok: false, error: "That's empty — give me at least one \"topic: value\" pair." };
  }

  const items: PreferenceItem[] = [];
  for (const segment of segments) {
    const colonIndex = segment.indexOf(':');
    if (colonIndex === -1) {
      return {
        ok: false,
        error: `"${segment}" has no colon. Each comma-separated piece needs a \`topic: value\` format, e.g. \`favorite anime: X, favorite food: ramen\`.`,
      };
    }

    const topic = segment.slice(0, colonIndex).trim();
    const value = segment.slice(colonIndex + 1).trim();

    if (!topic || !value) {
      return {
        ok: false,
        error: `"${segment}" is missing a topic or a value on one side of the colon.`,
      };
    }

    items.push({ topic, value });
  }

  return { ok: true, items };
}

// Raw per-user lookup only — null means "hasn't customized," distinct from
// getEffectivePreferences() which falls back to the global default. Kept
// separate so /personality preferences view can tell the difference (same
// pattern as getUserPersonality vs getEffectiveSystemPrompt).
export function getUserPreferences(userId: string): PreferenceItem[] | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT preferences FROM user_preferences WHERE user_id = ?')
    .get(userId) as { preferences: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.preferences) as PreferenceItem[];
  } catch {
    return null;
  }
}

// What actually gets used: this user's own preferences if they've set any,
// otherwise the global default from config.json.
export function getEffectivePreferences(userId: string): PreferenceItem[] {
  return getUserPreferences(userId) ?? getConfig().bot.defaultPreferences ?? [];
}

export function setUserPreferences(userId: string, items: PreferenceItem[]): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO user_preferences (user_id, preferences, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET preferences = excluded.preferences, updated_at = excluded.updated_at`
  ).run(userId, JSON.stringify(items));
}

export function resetUserPreferences(userId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM user_preferences WHERE user_id = ?').run(userId);
}

// Framed the same way the memory block already is (proven to keep facts
// from getting force-fed into unrelated replies): background flavor to
// draw on situationally, not a script to recite.
export function formatPreferencesBlock(userId: string): string | null {
  const items = getEffectivePreferences(userId);
  if (!items || items.length === 0) return null;
  const lines = items.map((i) => `- ${i.topic}: ${i.value}`).join('\n');
  return `Your own preferences/opinions — bring one up naturally if it's actually relevant to what's being discussed, don't list them or force them into unrelated conversation:\n${lines}`;
}
