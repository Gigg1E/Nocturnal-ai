import { boundedFetch } from '../utils/http';
import { logger } from '../utils/logger';
import { getUserMemoryFacts, recordMemoryFact, MAX_FACT_LENGTH, memoryRevision } from './memory';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
// Was qwen2.5:1.5b (the same tiny local model used for tool-routing entity
// extraction in ../ollama/extractor.ts) -- confirmed unreliable for this
// specific job via direct side-by-side testing: it fabricated a pet's name
// that was never mentioned, and invented "studying computer science" out of
// a conversation about shoes. deepseek-v4-flash:cloud got every test case
// right at the time, but its backing cloud model was retired 2026-09-25,
// which silently broke this feature in production -- the retirement
// response is a 200 with an {error} body, not a failed request, so the
// `if (!response.ok) return` check below never caught it. gemma4:cloud
// re-verified correct on the same test cases (NONE for irrelevant chatter,
// no hallucinated details) and is currently live. Deliberately NOT tied to
// extractor.ts's model -- they're unrelated jobs and don't need to match.
const EXTRACTOR_MODEL = 'gemma4:cloud';

// Cheap pre-filter so this doesn't fire a model call on every message — only
// ones that plausibly contain something personal/durable. False negatives
// are fine (nothing breaks if a fact gets missed); false positives just cost
// one extra background model call.
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
    const revision = memoryRevision(userId);
    const existing = getUserMemoryFacts(userId);
    const existingList = existing.length
      ? existing.map((f) => `${f.slot}. ${f.fact}`).join('\n')
      : '(none yet)';

    const prompt = `${PROMPT_HEADER}\n\nExisting facts:\n${existingList}\n\nLatest message: "${message}"\n\nResponse:`;

    const response = await boundedFetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EXTRACTOR_MODEL,
        prompt,
        stream: false,
        // 150 not 60 -- some cloud models spend part of their budget on hidden
        // reasoning before the actual one-line answer; too tight a budget can
        // mean the response comes back empty.
        options: { temperature: 0.1, num_predict: 150 },
      }),
    });
    if (!response.ok) return;

    const data = (await response.json()) as { response?: string };
    const line = (data.response ?? '').trim().split('\n')[0] ?? '';

    if (!line || /^NONE\b/i.test(line) || memoryRevision(userId) !== revision) return;

    const updateMatch = line.match(/^UPDATE\s+(\d+)\s*:\s*(.+)$/i);
    const newMatch = line.match(/^NEW\s*:\s*(.+)$/i);

    if (updateMatch) {
      const slot = parseInt(updateMatch[1], 10);
      const fact = updateMatch[2].trim().substring(0, MAX_FACT_LENGTH);
      if (fact && existing.some((f) => f.slot === slot)) {
        recordMemoryFact(userId, fact, slot);
        logger.debug('Memory updated');
      }
    } else if (newMatch) {
      const fact = newMatch[1].trim().substring(0, MAX_FACT_LENGTH);
      if (fact) {
        recordMemoryFact(userId, fact);
        logger.debug('Memory added');
      }
    }
  } catch (error) {
    logger.debug('Memory extraction skipped (non-fatal):', error);
  }
}
