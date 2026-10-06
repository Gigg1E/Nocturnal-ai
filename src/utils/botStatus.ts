import fs from 'fs';
import path from 'path';
import { ActivityType, Client } from 'discord.js';
import { logger } from './logger';

// Maintenance status, flipped from outside the bot by editing
// data/status.json -- e.g. before a deploy/restart, so people see why it's
// quiet instead of thinking it's broken:
//   {"maintenance": true}                       -> DND + default text
//   {"maintenance": true, "text": "custom..."}  -> DND + that text
//   {"maintenance": false} / no file            -> online, no status
// Checked every 10s; a change applies without a restart.

const STATUS_FILE = path.join(process.cwd(), 'data', 'status.json');
const DEFAULT_TEXT = '🔧 getting tuned up — back in a sec';

export function startStatusWatcher(client: Client): void {
  let last = '';
  const apply = (): void => {
    let st: { maintenance?: boolean; text?: string } = {};
    try {
      st = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf-8'));
    } catch {
      // no file / bad JSON = normal
    }
    const on = st.maintenance === true;
    const text = (typeof st.text === 'string' && st.text.trim() ? st.text.trim() : DEFAULT_TEXT).slice(0, 128);
    const key = on ? `on:${text}` : 'off';
    if (key === last || !client.user) return;
    last = key;
    if (on) {
      client.user.setPresence({ status: 'dnd', activities: [{ type: ActivityType.Custom, name: 'Custom Status', state: text }] });
      logger.info(`Status: maintenance — "${text}"`);
    } else {
      client.user.setPresence({ status: 'online', activities: [] });
      logger.info('Status: normal');
    }
  };
  apply();
  setInterval(apply, 10_000).unref();
}
