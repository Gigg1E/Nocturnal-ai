import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { logger } from '../utils/logger';

// A GIF's first frame often isn't what it's about (the punchline is the
// motion), so for GIFs the vision model gets a 2x2 grid of 4 frames spread
// across the whole clip instead of one still. Needs ffmpeg/ffprobe on PATH
// (optional); any failure just returns null and the caller falls
// back to the single preview frame.

const run = promisify(execFile);
const MAX_BYTES = 15 * 1024 * 1024;
const FRAMES = 4;

// Same GIFs get posted over and over (reaction GIFs) -- don't re-sample them.
const cache = new Map<string, string>();
const CACHE_MAX = 100;

export async function gifFrameGrid(url: string): Promise<{ b64: string; frames: number } | null> {
  const hit = cache.get(url);
  if (hit) return { b64: hit, frames: FRAMES };

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gif-'));
  const input = path.join(dir, 'in');
  const output = path.join(dir, 'grid.jpg');
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return null;
    await fs.writeFile(input, buf);

    const { stdout } = await run(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input],
      { timeout: 5000 }
    );
    const duration = parseFloat(stdout.trim());
    if (!Number.isFinite(duration) || duration < 0.3) return null;

    await run(
      'ffmpeg',
      [
        '-v', 'error', '-i', input,
        '-vf', `fps=${FRAMES}/${duration.toFixed(3)},scale=320:-2,tile=2x2`,
        '-frames:v', '1', '-q:v', '4', '-y', output,
      ],
      { timeout: 10000 }
    );
    const b64 = (await fs.readFile(output)).toString('base64');

    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
    cache.set(url, b64);
    return { b64, frames: FRAMES };
  } catch (err) {
    logger.debug('GIF frame sampling failed (falling back to one frame):', err);
    return null;
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
