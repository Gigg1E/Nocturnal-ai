import { logger } from '../utils/logger';
import { getUserMemoryFacts, recordMemoryFact, MAX_FACT_LENGTH } from './memory';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const EXTRACTOR_MODEL = 'qwen2.5:1.5b'; // must match src/ollama/extractor.ts

// Cheap pre-filter so this doesn't fire a model call on every message — only
// ones that plausibly contain something personal/durable. False negatives
// are fine (nothing breaks if a fact gets missed); false positives just cost
// one small, fast, local model call.
const SELF_REFERENTIAL = /\b(i'?m|i am|i've|i have|my \w|working on|studying|homework|class|project|pet|dog|cat|favorite|favourite|birthday|i live|i'?m from)\b/i;

const PROMPT_HEADER = `You quietly track short, durable facts about a Discord user across conversations - the kind of thing a friend would remember (their name, a pet, a project, what they're studying, a hobby, where they live). Not one-off details, not whatever today's conversation topic happens to be.

You'll see the user's existing remembered facts (numbered) and their latest message. Respond with exactly ONE line:
- NONE - nothing new or durable enough to remember
- NEW: <fact> - a short new fact worth adding (under 15 words)
- UPDATE <n>: <fact> - the message corrects or replaces fact number n

Respond with ONLY that one line, no explanation.`;

// Fire-and-forget: runs after a reply is already sent, never blocks or
// affects the user-facing response. Any failure here is silently swallowed.
export async function maybeExtractMemory(userId: string, message: string): Promise<void> {
  if (!message || message.length > 800 || !SELF_REFERENTIAL.test(message)) return;

  try {
    const existing = getUserMemoryFacts(userId);
    const existingList = existing.length
      ? existing.map((f) => `${f.slot}. ${f.fact}`).join('\n')
      : '(none yet)';

    const prompt = `${PROMPT_HEADER}\n\nExisting facts:\n${existingList}\n\nLatest message: "${message}"\n\nResponse:`;

    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EXTRACTOR_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.1, num_predict: 60 },
      }),
    });
    if (!response.ok) return;

    const data = (await response.json()) as { response?: string };
    const line = (data.response ?? '').trim().split('\n')[0] ?? '';

    if (!line || /^NONE\b/i.test(line)) return;

    const updateMatch = line.match(/^UPDATE\s+(\d+)\s*:\s*(.+)$/i);
    const newMatch = line.match(/^NEW\s*:\s*(.+)$/i);

    if (updateMatch) {
      const slot = parseInt(updateMatch[1], 10);
      const fact = updateMatch[2].trim().substring(0, MAX_FACT_LENGTH);
      if (fact && existing.some((f) => f.slot === slot)) {
        recordMemoryFact(userId, fact, slot);
        logger.debug(`Memory updated for ${userId}: slot ${slot} -> "${fact}"`);
      }
    } else if (newMatch) {
      const fact = newMatch[1].trim().substring(0, MAX_FACT_LENGTH);
      if (fact) {
        recordMemoryFact(userId, fact);
        logger.debug(`Memory added for ${userId}: "${fact}"`);
      }
    }
  } catch (error) {
    logger.debug('Memory extraction skipped (non-fatal):', error);
  }
}
