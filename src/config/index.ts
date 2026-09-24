import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

export interface BotConfig {
  name: string;
  systemPrompt: string;
  responseFormat: 'text' | 'embed';
  maxResponseLength: number;
  historySize: number;
  cooldownSeconds: number;
}

export interface OllamaConfig {
  chatModel: string;
  visionModel: string;
  maxTokens: number;
  temperature: number;
  topP: number;
}

export interface ToolWeightConfig {
  base: number;
  keywordBoost: number;
  uncertaintyBoost: number;
}

export interface ToolsConfig {
  enabled: boolean;
  defaultWeight: number;
  triggerThreshold: number;
  weights: {
    search: ToolWeightConfig;
    weather: ToolWeightConfig;
    time: ToolWeightConfig;
    location: ToolWeightConfig;
    network: ToolWeightConfig;
    phone: ToolWeightConfig;
    status: ToolWeightConfig;
    compute: ToolWeightConfig;
    crypto: ToolWeightConfig;
    security: ToolWeightConfig;
  };
  keywords: {
    search: string[];
    weather: string[];
    time: string[];
    location: string[];
    network: string[];
    phone: string[];
    status: string[];
    compute: string[];
    crypto: string[];
    security: string[];
  };
}

export interface RateLimitConfig {
  cooldownMs: number;
  maxRequestsPerMinute: number;
  maxRequestsPerHour: number;
}

export interface ChannelsConfig {
  allowed: string[];
  blocked: string[];
}

export interface UsersConfig {
  blacklist: string[];
}

export interface LoggingConfig {
  level: string;
  logToFile: boolean;
  logDirectory: string;
}

export interface Config {
  bot: BotConfig;
  ollama: OllamaConfig;
  tools: ToolsConfig;
  rateLimit: RateLimitConfig;
  channels: ChannelsConfig;
  users: UsersConfig;
  logging: LoggingConfig;
}

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

let currentConfig: Config;

export function loadConfig(): Config {
  try {
    const configData = fs.readFileSync(CONFIG_PATH, 'utf-8');
    currentConfig = JSON.parse(configData) as Config;
    return currentConfig;
  } catch (error) {
    console.error('Failed to load config:', error);
    process.exit(1);
  }
}

export function getConfig(): Config {
  if (!currentConfig) {
    return loadConfig();
  }
  return currentConfig;
}

export function saveConfig(config: Config): void {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    currentConfig = config;
    logger.info('Configuration saved successfully');
  } catch (error) {
    logger.error('Failed to save config:', error);
    throw error;
  }
}

export function updateConfig<K extends keyof Config>(
  section: K,
  key: keyof Config[K],
  value: Config[K][keyof Config[K]]
): void {
  const config = getConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (config[section] as any)[key as string] = value;
  saveConfig(config);
  logger.info(`Config updated: ${section}.${String(key)} = ${JSON.stringify(value)}`);
}

export function getConfigValue<K extends keyof Config>(
  section: K,
  key: keyof Config[K]
): Config[K][keyof Config[K]] {
  const config = getConfig();
  return config[section][key];
}

// Note: blacklist/channel-allowlist helpers (isUserBlacklisted, isChannelAllowed,
// addToBlacklist, etc.) moved to ../config/guildConfig.ts — those are per-guild
// now, this file only backs the settings that stay global (ollama/logging/tools
// baseline data, plus whatever's still in OWNER_ONLY_CONFIGS in commands/config.ts).
