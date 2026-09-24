import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  Collection,
} from 'discord.js';
import { logger } from '../utils/logger';
import { handleMessageCreate } from './events/messageCreate';
import { handleInteractionCreate } from './events/interactionCreate';
import { handleGuildCreate } from './events/guildCreate';
import { commands, registerCommands } from './commands';
import { isAllowed } from '../utils/guildAllowlist';

export interface BotClient extends Client {
  commands: Collection<string, unknown>;
}

export function createClient(): BotClient {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
    ],
  }) as BotClient;

  // Initialize commands collection
  client.commands = new Collection();

  // Register event handlers
  client.once(Events.ClientReady, async (readyClient) => {
    logger.info(`Nocturnal is online as ${readyClient.user.tag}`);

    // Reconcile against the allowlist on startup — guildCreate only catches a
    // guild being de-listed going forward (on new joins), not a guild the bot
    // was already in before removal from data/guilds.json.
    for (const guild of readyClient.guilds.cache.values()) {
      if (isAllowed(guild.id)) continue;
      logger.warn(`Leaving de-listed guild: ${guild.name} (${guild.id})`);
      try {
        await guild.leave();
      } catch (error) {
        logger.error(`Failed to leave ${guild.id}:`, error);
      }
    }

    // Register slash commands
    try {
      await registerCommands(readyClient);
      logger.info('Slash commands registered successfully');
    } catch (error) {
      logger.error('Failed to register slash commands:', error);
    }
  });

  client.on(Events.GuildCreate, handleGuildCreate);
  client.on(Events.MessageCreate, handleMessageCreate);
  client.on(Events.InteractionCreate, handleInteractionCreate);

  // Error handling
  client.on(Events.Error, (error) => {
    logger.error('Discord client error:', error);
  });

  client.on(Events.Warn, (warning) => {
    logger.warn('Discord client warning:', warning);
  });

  return client;
}

export async function startBot(): Promise<BotClient> {
  const token = process.env.DISCORD_TOKEN;

  if (!token) {
    throw new Error('DISCORD_TOKEN is not set in environment variables');
  }

  const client = createClient();

  await client.login(token);

  return client;
}
