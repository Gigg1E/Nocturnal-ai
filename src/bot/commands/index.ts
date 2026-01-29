import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  REST,
  Routes,
  Client,
  Collection,
} from 'discord.js';
import { logger } from '../../utils/logger';

// Import commands
import { chatCommand } from './chat';
import { modelCommand } from './model';
import { configCommand } from './config';
import { blacklistCommand } from './blacklist';
import { channelCommand } from './channel';
import { statsCommand } from './stats';
import { helpCommand } from './help';

export interface Command {
  data: SlashCommandBuilder | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  adminOnly?: boolean;
}

// Create commands collection
export const commands = new Collection<string, Command>();

// Register all commands
const commandList: Command[] = [
  chatCommand,
  modelCommand,
  configCommand,
  blacklistCommand,
  channelCommand,
  statsCommand,
  helpCommand,
];

for (const command of commandList) {
  commands.set(command.data.name, command);
}

export async function registerCommands(client: Client): Promise<void> {
  const token = process.env.DISCORD_TOKEN;
  const serverId = process.env.DISCORD_SERVER_ID;

  if (!token || !serverId) {
    throw new Error('DISCORD_TOKEN or DISCORD_SERVER_ID not set');
  }

  const rest = new REST({ version: '10' }).setToken(token);

  const commandData = commandList.map((cmd) => cmd.data.toJSON());

  try {
    logger.info(`Registering ${commandData.length} slash commands...`);

    // Register commands to the specific guild (faster updates during development)
    await rest.put(
      Routes.applicationGuildCommands(client.user!.id, serverId),
      { body: commandData }
    );

    logger.info('Successfully registered slash commands');
  } catch (error) {
    logger.error('Failed to register commands:', error);
    throw error;
  }
}
