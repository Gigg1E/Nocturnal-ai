import * as fs from 'fs';
import * as path from 'path';

// The subset of the old single global config.json that's now per-guild —
// operational knobs (channels, rate limits, tools, blacklist), not voice or
// memory. Personality/system-prompt moved to src/services/personality.ts
// (per-user, global) and ollama.*/logging.*/tools.weights stay in the
// global config.json — host-resource / shared-baseline concerns, not
// something individual guild admins (or even individual users) control.
export interface GuildConfig {
  bot: {
    responseFormat: 'text' | 'embed';
    maxResponseLength: number;
    maxChatsPerUser: number;
    cooldownSeconds: number;
  };
  tools: {
    enabled: boolean;
    triggerThreshold: number;
  };
  rateLimit: {
    cooldownMs: number;
    maxRequestsPerMinute: number;
    maxRequestsPerHour: number;
  };
  channels: {
    allowed: string[];
    blocked: string[];
  };
  users: {
    blacklist: string[];
  };
}

// Factory defaults for a brand-new guild that hasn't customized anything yet.
// Matches the pre-existing /config reset defaults so behavior doesn't change
// for a guild until an admin actually touches something.
export const DEFAULT_GUILD_CONFIG: GuildConfig = {
  bot: {
    responseFormat: 'text',
    maxResponseLength: 1999,
    maxChatsPerUser: 5,
    cooldownSeconds: 5,
  },
  tools: {
    enabled: true,
    triggerThreshold: 0.6,
  },
  rateLimit: {
    cooldownMs: 5000,
    maxRequestsPerMinute: 12,
    maxRequestsPerHour: 100,
  },
  channels: {
    allowed: [],
    blocked: [],
  },
  users: {
    blacklist: [],
  },
};

function guildConfigPath(guildId: string): string {
  return path.join(process.cwd(), 'data', 'guilds', guildId, 'config.json');
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  const result = { ...base } as T;
  for (const key of Object.keys(override) as (keyof T)[]) {
    const overrideVal = override[key];
    const baseVal = base[key];
    if (
      overrideVal && typeof overrideVal === 'object' && !Array.isArray(overrideVal) &&
      baseVal && typeof baseVal === 'object' && !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(baseVal, overrideVal as Partial<typeof baseVal>);
    } else if (overrideVal !== undefined) {
      result[key] = overrideVal as T[keyof T];
    }
  }
  return result;
}

export function loadGuildConfig(guildId: string): GuildConfig {
  try {
    const raw = fs.readFileSync(guildConfigPath(guildId), 'utf-8');
    const override = JSON.parse(raw) as Partial<GuildConfig>;
    return deepMerge(DEFAULT_GUILD_CONFIG, override);
  } catch {
    return { ...DEFAULT_GUILD_CONFIG };
  }
}

export function saveGuildConfig(guildId: string, config: GuildConfig): void {
  const dir = path.join(process.cwd(), 'data', 'guilds', guildId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(guildConfigPath(guildId), JSON.stringify(config, null, 2));
}

export function updateGuildConfig<S extends keyof GuildConfig>(
  guildId: string,
  section: S,
  key: keyof GuildConfig[S],
  value: GuildConfig[S][keyof GuildConfig[S]]
): void {
  const config = loadGuildConfig(guildId);
  (config[section] as GuildConfig[S])[key] = value;
  saveGuildConfig(guildId, config);
}

export function isUserBlacklisted(guildId: string, userId: string): boolean {
  return loadGuildConfig(guildId).users.blacklist.includes(userId);
}

export function isChannelAllowed(guildId: string, channelId: string): boolean {
  const config = loadGuildConfig(guildId);
  if (config.channels.allowed.length === 0) {
    return !config.channels.blocked.includes(channelId);
  }
  return config.channels.allowed.includes(channelId) && !config.channels.blocked.includes(channelId);
}

export function addToBlacklist(guildId: string, userId: string): void {
  const config = loadGuildConfig(guildId);
  if (!config.users.blacklist.includes(userId)) {
    config.users.blacklist.push(userId);
    saveGuildConfig(guildId, config);
  }
}

export function removeFromBlacklist(guildId: string, userId: string): void {
  const config = loadGuildConfig(guildId);
  const index = config.users.blacklist.indexOf(userId);
  if (index > -1) {
    config.users.blacklist.splice(index, 1);
    saveGuildConfig(guildId, config);
  }
}

export function addAllowedChannel(guildId: string, channelId: string): void {
  const config = loadGuildConfig(guildId);
  if (!config.channels.allowed.includes(channelId)) {
    config.channels.allowed.push(channelId);
    saveGuildConfig(guildId, config);
  }
}

export function removeAllowedChannel(guildId: string, channelId: string): void {
  const config = loadGuildConfig(guildId);
  const index = config.channels.allowed.indexOf(channelId);
  if (index > -1) {
    config.channels.allowed.splice(index, 1);
    saveGuildConfig(guildId, config);
  }
}

export function addBlockedChannel(guildId: string, channelId: string): void {
  const config = loadGuildConfig(guildId);
  if (!config.channels.blocked.includes(channelId)) {
    config.channels.blocked.push(channelId);
    saveGuildConfig(guildId, config);
  }
}

export function removeBlockedChannel(guildId: string, channelId: string): void {
  const config = loadGuildConfig(guildId);
  const index = config.channels.blocked.indexOf(channelId);
  if (index > -1) {
    config.channels.blocked.splice(index, 1);
    saveGuildConfig(guildId, config);
  }
}
