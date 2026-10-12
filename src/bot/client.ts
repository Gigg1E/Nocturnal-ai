import { recordHumanTyping } from '../services/casualChat';
import { initializeDiagnosticChannels } from '../services/diagnosticChannels';
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
import { handleMessageUpdate } from './events/messageUpdate';
import { handleReactionAdd, handleReactionRemove, handleMessageDelete } from './events/reactions';
import { handleInteractionCreate } from './events/interactionCreate';
import { handleGuildCreate } from './events/guildCreate';
import { commands, registerCommands } from './commands';
import { isAllowed } from '../utils/guildAllowlist';
import { startStatusWatcher } from '../utils/botStatus';

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
      // Answer Machine sees reactions as context (non-privileged intent).
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildMessageTyping,
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
    ],
    // Model output must never mass-ping: no @everyone/@here or role pings
    // even if someone talks the model into writing one. Applies to every
    // send/edit that doesn't set its own allowedMentions.
    allowedMentions: { parse: ['users'], repliedUser: false },
  }) as BotClient;

  // Initialize commands collection
  client.commands = new Collection();

  // Register event handlers
  client.once(Events.ClientReady, async (readyClient) => {
    logger.info(`Nocturnal is online as ${readyClient.user.tag}`);
    startStatusWatcher(readyClient);
    initializeDiagnosticChannels(readyClient);

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
      const { succeeded, total } = await registerCommands(readyClient);
      if (total === 0) {
        // registerCommands already logged the "no guilds" warning
      } else if (succeeded === total) {
        logger.info(`Slash commands registered successfully (${succeeded}/${total} guilds)`);
      } else {
        logger.warn(`Slash commands registered to ${succeeded}/${total} guilds — check the errors above (usually the bot isn't actually a member of the guild yet)`);
      }
    } catch (error) {
      logger.error('Failed to register slash commands:', error);
    }
  });

  client.on(Events.TypingStart, typing => {
    if (typing.user.bot || typing.user.id === client.user?.id) return;
    recordHumanTyping(typing.channel.id, typing.user.id);
  });
  client.on(Events.GuildCreate, handleGuildCreate);
  client.on(Events.MessageCreate, handleMessageCreate);
  client.on(Events.MessageUpdate, (oldMsg, newMsg) => {
    handleMessageUpdate(oldMsg, newMsg).catch((err) => logger.debug('messageUpdate handler failed:', err));
  });
  client.on(Events.MessageReactionAdd, (r, u) => {
    handleReactionAdd(r, u).catch((err) => logger.debug('reactionAdd handler failed:', err));
  });
  client.on(Events.MessageReactionRemove, (r, u) => {
    handleReactionRemove(r, u).catch((err) => logger.debug('reactionRemove handler failed:', err));
  });
  client.on(Events.MessageDelete, (m) => {
    handleMessageDelete(m).catch((err) => logger.debug('messageDelete handler failed:', err));
  });
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
