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
import { getConfig } from '../config';
import { handleMessageCreate } from './events/messageCreate';
import { handleInteractionCreate } from './events/interactionCreate';
import { commands, registerCommands } from './commands';

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
    logger.info(`NET.ai is online as ${readyClient.user.tag}`);

    // Register slash commands
    try {
      await registerCommands(readyClient);
      logger.info('Slash commands registered successfully');
    } catch (error) {
      logger.error('Failed to register slash commands:', error);
    }
  });

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
