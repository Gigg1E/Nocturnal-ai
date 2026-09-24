import {
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  ChatInputCommandInteraction,
  REST,
  Routes,
  Client,
  Collection,
} from 'discord.js';
import { logger } from '../../utils/logger';
import { getAllowedGuilds } from '../../utils/guildAllowlist';

// Import commands
import { modelCommand } from './model';
import { configCommand } from './config';
import { blacklistCommand } from './blacklist';
import { channelCommand } from './channel';
import { statsCommand } from './stats';
import { helpCommand } from './help';
import { webhookCommand } from './webhook';
import { statusCommand } from './status';
import { personalityCommand } from './personality';
import { memoryCommand } from './memory';

export interface Command {
  data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  adminOnly?: boolean;
}

// Create commands collection
export const commands = new Collection<string, Command>();

// Register all commands
const commandList: Command[] = [
  modelCommand,
  configCommand,
  blacklistCommand,
  channelCommand,
  statsCommand,
  helpCommand,
  webhookCommand,
  statusCommand,
  personalityCommand,
  memoryCommand,
];

for (const command of commandList) {
  commands.set(command.data.name, command);
}

// Returns how many of the allowlisted guilds actually got commands
// registered, so the caller can log an accurate outcome instead of always
// claiming success even when every guild failed (e.g. bot not actually a
// member yet — "Missing Access").
export async function registerCommands(client: Client): Promise<{ succeeded: number; total: number }> {
  const token = process.env.DISCORD_TOKEN;

  if (!token) {
    throw new Error('DISCORD_TOKEN not set');
  }

  const guilds = getAllowedGuilds();
  if (guilds.length === 0) {
    logger.warn('No guilds in data/guilds.json — no commands registered. Use scripts/manage-guilds.js add first.');
    return { succeeded: 0, total: 0 };
  }

  const rest = new REST({ version: '10' }).setToken(token);
  const commandData = commandList.map((cmd) => cmd.data.toJSON());

  let succeeded = 0;
  for (const guild of guilds) {
    try {
      logger.info(`Registering ${commandData.length} slash commands to ${guild.name} (${guild.id})...`);
      await rest.put(
        Routes.applicationGuildCommands(client.user!.id, guild.id),
        { body: commandData }
      );
      logger.info(`Successfully registered slash commands to ${guild.name}`);
      succeeded++;
    } catch (error) {
      logger.error(`Failed to register commands to ${guild.name} (${guild.id}):`, error);
    }
  }
  return { succeeded, total: guilds.length };
}
