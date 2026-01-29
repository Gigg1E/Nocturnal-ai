import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

export interface BotConfig {
  name: string;
  systemPrompt: string;
  responseFormat: 'text' | 'embed';
  maxResponseLength: number;
  maxChatsPerUser: number;
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
  };
  keywords: {
    search: string[];
    weather: string[];
    time: string[];
    location: string[];
    network: string[];
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

// Validation helpers
export function isUserBlacklisted(userId: string): boolean {
  return getConfig().users.blacklist.includes(userId);
}

export function isChannelAllowed(channelId: string): boolean {
  const config = getConfig();
  // If no allowed channels specified, all non-blocked channels are allowed
  if (config.channels.allowed.length === 0) {
    return !config.channels.blocked.includes(channelId);
  }
  return config.channels.allowed.includes(channelId) && !config.channels.blocked.includes(channelId);
}

export function addToBlacklist(userId: string): void {
  const config = getConfig();
  if (!config.users.blacklist.includes(userId)) {
    config.users.blacklist.push(userId);
    saveConfig(config);
    logger.info(`User ${userId} added to blacklist`);
  }
}

export function removeFromBlacklist(userId: string): void {
  const config = getConfig();
  const index = config.users.blacklist.indexOf(userId);
  if (index > -1) {
    config.users.blacklist.splice(index, 1);
    saveConfig(config);
    logger.info(`User ${userId} removed from blacklist`);
  }
}

export function addAllowedChannel(channelId: string): void {
  const config = getConfig();
  if (!config.channels.allowed.includes(channelId)) {
    config.channels.allowed.push(channelId);
    saveConfig(config);
    logger.info(`Channel ${channelId} added to allowed list`);
  }
}

export function removeAllowedChannel(channelId: string): void {
  const config = getConfig();
  const index = config.channels.allowed.indexOf(channelId);
  if (index > -1) {
    config.channels.allowed.splice(index, 1);
    saveConfig(config);
    logger.info(`Channel ${channelId} removed from allowed list`);
  }
}

export function addBlockedChannel(channelId: string): void {
  const config = getConfig();
  if (!config.channels.blocked.includes(channelId)) {
    config.channels.blocked.push(channelId);
    saveConfig(config);
    logger.info(`Channel ${channelId} added to blocked list`);
  }
}

export function removeBlockedChannel(channelId: string): void {
  const config = getConfig();
  const index = config.channels.blocked.indexOf(channelId);
  if (index > -1) {
    config.channels.blocked.splice(index, 1);
    saveConfig(config);
    logger.info(`Channel ${channelId} removed from blocked list`);
  }
}
