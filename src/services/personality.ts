import { getDatabase } from '../database/schema';
import { getConfig } from '../config';
import { formatMemoryBlock } from './memory';

// Discord hard-caps a slash command string option at 6000 chars
// (s.number().greaterThanOrEqual(1).lessThanOrEqual(6000) in
// @discordjs/builders). 4000 leaves headroom under that ceiling while
// still being a big jump from the old 800 -- this becomes the entire
// system prompt, but with a 262k-token context window on the models in
// use, a few thousand extra characters isn't a real cost concern.
export const MAX_PERSONALITY_LENGTH = 4000;

export function getUserPersonality(userId: string): string | null {
  const db = getDatabase();
  const row = db
    .prepare('SELECT personality FROM user_personality WHERE user_id = ?')
    .get(userId) as { personality: string } | undefined;
  return row?.personality ?? null;
}

export function setUserPersonality(userId: string, personality: string): void {
  const db = getDatabase();
  db.prepare(
    `INSERT INTO user_personality (user_id, personality, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET personality = excluded.personality, updated_at = excluded.updated_at`
  ).run(userId, personality);
}

export function resetUserPersonality(userId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM user_personality WHERE user_id = ?').run(userId);
}

// The single global default (config.json's bot.systemPrompt) unless this
// user has customized their own — personality is per-user and global now,
// not per-guild; a guild's only remaining bot-behavior knobs are the
// operational ones in GuildConfig (channels, rate limits, tools).
export function getEffectiveSystemPrompt(userId: string): string {
  const base = getUserPersonality(userId) ?? getConfig().bot.systemPrompt;
  const memoryBlock = formatMemoryBlock(userId);
  return memoryBlock ? `${base}\n\n${memoryBlock}` : base;
}
