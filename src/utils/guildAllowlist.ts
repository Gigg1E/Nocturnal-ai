import * as fs from 'fs';
import * as path from 'path';

export interface AllowedGuild {
  id: string;
  name: string;
}

const ALLOWLIST_PATH = path.join(process.cwd(), 'data', 'guilds.json');

export function getAllowedGuilds(): AllowedGuild[] {
  try {
    const data = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf-8')) as { guilds?: AllowedGuild[] };
    return Array.isArray(data.guilds) ? data.guilds : [];
  } catch {
    return [];
  }
}

export function isAllowed(guildId: string): boolean {
  return getAllowedGuilds().some((g) => g.id === guildId);
}
