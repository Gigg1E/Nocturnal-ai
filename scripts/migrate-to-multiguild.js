// One-time migration: copies the per-guild subset of the old global
// config.json into data/guilds/<DISCORD_SERVER_ID>/config.json, so The
// Network's existing customized settings (blacklist, channel restrictions,
// persona, rate limits) carry over exactly instead of resetting to factory
// defaults. Safe to run more than once — skips if the guild config already exists.
// Run by hand BEFORE restarting the bot on the new multi-server code:
//   node scripts/migrate-to-multiguild.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const guildId = process.env.DISCORD_SERVER_ID;
if (!guildId) {
  console.error('DISCORD_SERVER_ID not set in .env — nothing to migrate to.');
  process.exit(1);
}

const GLOBAL_CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const GUILD_DIR = path.join(__dirname, '..', 'data', 'guilds', guildId);
const GUILD_CONFIG_PATH = path.join(GUILD_DIR, 'config.json');

if (fs.existsSync(GUILD_CONFIG_PATH)) {
  console.log(`skip — data/guilds/${guildId}/config.json already exists.`);
  process.exit(0);
}

const globalConfig = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf8'));

const guildConfig = {
  bot: {
    systemPrompt: globalConfig.bot.systemPrompt,
    responseFormat: globalConfig.bot.responseFormat,
    maxResponseLength: globalConfig.bot.maxResponseLength,
    maxChatsPerUser: globalConfig.bot.maxChatsPerUser ?? 5,
    cooldownSeconds: globalConfig.bot.cooldownSeconds,
  },
  tools: {
    enabled: globalConfig.tools.enabled,
    triggerThreshold: globalConfig.tools.triggerThreshold,
  },
  rateLimit: {
    cooldownMs: globalConfig.rateLimit.cooldownMs,
    maxRequestsPerMinute: globalConfig.rateLimit.maxRequestsPerMinute,
    maxRequestsPerHour: globalConfig.rateLimit.maxRequestsPerHour,
  },
  channels: {
    allowed: globalConfig.channels.allowed,
    blocked: globalConfig.channels.blocked,
  },
  users: {
    blacklist: globalConfig.users.blacklist,
  },
};

fs.mkdirSync(GUILD_DIR, { recursive: true });
fs.writeFileSync(GUILD_CONFIG_PATH, JSON.stringify(guildConfig, null, 2));

console.log(`Migrated The Network's config -> data/guilds/${guildId}/config.json`);
console.log('The global config.json is left as-is (ollama/logging/tools.weights/keywords still live there — that data stays global, no need to remove it).');
console.log('\nDone. Rebuild (npm run build) and restart the bot (pm2 restart NETai) to pick up the new config layout.');
