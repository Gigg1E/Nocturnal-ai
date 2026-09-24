import { getDatabase } from '../database/schema';

export const MAX_MEMORY_SLOTS = 10;
export const MAX_FACT_LENGTH = 150;

export interface MemoryFact {
  slot: number;
  fact: string;
  updated_at: string;
}

export function getUserMemoryFacts(userId: string): MemoryFact[] {
  const db = getDatabase();
  return db
    .prepare('SELECT slot, fact, updated_at FROM user_memory WHERE user_id = ? ORDER BY slot ASC')
    .all(userId) as MemoryFact[];
}

// Moves `fact` into slot 1, shifting everything else down and dropping
// whatever falls off the end past MAX_MEMORY_SLOTS. If replaceSlot is given,
// that slot's old content is dropped first (the extractor decided this
// message corrects/replaces something already remembered, not adds to it).
export function recordMemoryFact(userId: string, fact: string, replaceSlot?: number): void {
  const db = getDatabase();
  const existing = getUserMemoryFacts(userId).filter((f) => f.slot !== replaceSlot);
  const reordered = [fact, ...existing.map((f) => f.fact)].slice(0, MAX_MEMORY_SLOTS);

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM user_memory WHERE user_id = ?').run(userId);
    const insert = db.prepare(
      `INSERT INTO user_memory (user_id, slot, fact, updated_at) VALUES (?, ?, ?, datetime('now'))`
    );
    reordered.forEach((f, i) => insert.run(userId, i + 1, f));
  });
  tx();
}

export function forgetUserMemorySlot(userId: string, slot: number): void {
  const db = getDatabase();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM user_memory WHERE user_id = ? AND slot = ?').run(userId, slot);
    // Close the gap so slots stay a contiguous 1..N with no holes.
    const remaining = db
      .prepare('SELECT slot FROM user_memory WHERE user_id = ? AND slot > ? ORDER BY slot ASC')
      .all(userId, slot) as { slot: number }[];
    for (const row of remaining) {
      db.prepare('UPDATE user_memory SET slot = ? WHERE user_id = ? AND slot = ?').run(row.slot - 1, userId, row.slot);
    }
  });
  tx();
}

export function clearUserMemory(userId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM user_memory WHERE user_id = ?').run(userId);
}

// Quiet background-context block appended to the system prompt. Deliberately
// phrased so the model weaves facts in naturally instead of announcing that
// it "remembers" things.
export function formatMemoryBlock(userId: string): string | null {
  const facts = getUserMemoryFacts(userId);
  if (facts.length === 0) return null;
  const lines = facts.map((f) => `- ${f.fact}`).join('\n');
  return `Background context you know about this user from past conversations — bring it up naturally if relevant, don't announce that you "remember" it or state facts unprompted:\n${lines}`;
}
