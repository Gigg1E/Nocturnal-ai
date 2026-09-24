import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { Command } from './index';
import { getConfig, updateConfig, Config } from '../../config';
import { logger, logConfigChange } from '../../utils/logger';

const OWNER_ID = process.env.OWNER_ID;

// Allowed config paths for editing
const EDITABLE_CONFIGS: Record<string, { description: string; type: string }> = {
  'bot.systemPrompt': { description: 'System prompt for AI', type: 'string' },
  'bot.responseFormat': { description: 'Response format (text/embed)', type: 'string' },
  'bot.maxResponseLength': { description: 'Max response length', type: 'number' },
  'bot.maxChatsPerUser': { description: 'Max chats per user', type: 'number' },
  'bot.cooldownSeconds': { description: 'Cooldown between messages', type: 'number' },
  'ollama.maxTokens': { description: 'Max tokens for AI', type: 'number' },
  'ollama.temperature': { description: 'AI temperature (0-1)', type: 'number' },
  'ollama.topP': { description: 'AI top_p (0-1)', type: 'number' },
  'tools.enabled': { description: 'Enable external tools', type: 'boolean' },
  'tools.triggerThreshold': { description: 'Tool trigger threshold', type: 'number' },
  'rateLimit.cooldownMs': { description: 'Cooldown in milliseconds', type: 'number' },
  'rateLimit.maxRequestsPerMinute': { description: 'Max requests per minute', type: 'number' },
  'rateLimit.maxRequestsPerHour': { description: 'Max requests per hour', type: 'number' },
  'logging.level': { description: 'Logging level', type: 'string' },
};

export const configCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Manage bot configuration (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('view')
        .setDescription('View current configuration')
        .addStringOption((option) =>
          option
            .setName('section')
            .setDescription('Config section to view')
            .setRequired(false)
            .addChoices(
              { name: 'Bot', value: 'bot' },
              { name: 'Ollama', value: 'ollama' },
              { name: 'Tools', value: 'tools' },
              { name: 'Rate Limits', value: 'rateLimit' },
              { name: 'Channels', value: 'channels' },
              { name: 'Users', value: 'users' },
              { name: 'Logging', value: 'logging' }
            )
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('set')
        .setDescription('Set a configuration value')
        .addStringOption((option) =>
          option
            .setName('key')
            .setDescription('Configuration key')
            .setRequired(true)
            .addChoices(
              ...Object.entries(EDITABLE_CONFIGS).map(([key, info]) => ({
                name: `${key} - ${info.description}`,
                value: key,
              }))
            )
        )
        .addStringOption((option) =>
          option
            .setName('value')
            .setDescription('New value')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('reset')
        .setDescription('Reset a configuration to default')
        .addStringOption((option) =>
          option
            .setName('key')
            .setDescription('Configuration key to reset')
            .setRequired(true)
            .addChoices(
              ...Object.entries(EDITABLE_CONFIGS).map(([key, info]) => ({
                name: `${key} - ${info.description}`,
                value: key,
              }))
            )
        )
    ),
  adminOnly: true,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Check if user is owner
    if (interaction.user.id !== OWNER_ID) {
      await interaction.reply({
        content: 'This command is restricted to the bot owner.',
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'view':
        await handleView(interaction);
        break;
      case 'set':
        await handleSet(interaction);
        break;
      case 'reset':
        await handleReset(interaction);
        break;
    }
  },
};

async function handleView(interaction: ChatInputCommandInteraction): Promise<void> {
  const section = interaction.options.getString('section');
  const config = getConfig();

  if (section) {
    const sectionConfig = config[section as keyof Config];
    const formatted = formatConfigSection(section, sectionConfig);

    await interaction.reply({
      content: `**Configuration: ${section}**\n\`\`\`json\n${formatted}\n\`\`\``,
      ephemeral: true,
    });
  } else {
    // Show overview
    const overview = Object.keys(config)
      .map((key) => `• **${key}**: ${Object.keys(config[key as keyof Config]).length} settings`)
      .join('\n');

    await interaction.reply({
      content: `**Configuration Overview**\n\n${overview}\n\nUse \`/config view section:<name>\` to see details.`,
      ephemeral: true,
    });
  }
}

async function handleSet(interaction: ChatInputCommandInteraction): Promise<void> {
  const key = interaction.options.getString('key', true);
  const valueStr = interaction.options.getString('value', true);
  const configInfo = EDITABLE_CONFIGS[key];

  if (!configInfo) {
    await interaction.reply({
      content: 'Invalid configuration key.',
      ephemeral: true,
    });
    return;
  }

  const [section, settingKey] = key.split('.');
  const config = getConfig();
  const oldValue = // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (config as any)[section]?.[settingKey];

  // Parse value based on type
  let parsedValue: unknown;
  try {
    switch (configInfo.type) {
      case 'number':
        parsedValue = parseFloat(valueStr);
        if (isNaN(parsedValue as number)) {
          throw new Error('Invalid number');
        }
        break;
      case 'boolean':
        parsedValue = valueStr.toLowerCase() === 'true';
        break;
      default:
        parsedValue = valueStr;
    }
  } catch {
    await interaction.reply({
      content: `Invalid value for ${configInfo.type} type.`,
      ephemeral: true,
    });
    return;
  }

  try {
    updateConfig(section as keyof Config, settingKey as never, parsedValue as never);
    logConfigChange(key, oldValue, parsedValue, interaction.user.id);

    await interaction.reply({
      content: `Configuration updated:\n\`${key}\`: \`${JSON.stringify(oldValue)}\` → \`${JSON.stringify(parsedValue)}\``,
      ephemeral: true,
    });
  } catch (error) {
    logger.error('Failed to update config:', error);
    await interaction.reply({
      content: 'Failed to update configuration.',
      ephemeral: true,
    });
  }
}

async function handleReset(interaction: ChatInputCommandInteraction): Promise<void> {
  const key = interaction.options.getString('key', true);

  // Default values
  const defaults: Record<string, unknown> = {
    'bot.systemPrompt': "You are NET.ai, a technical assistant for a networking-focused community. You provide clear, accurate, and helpful responses about technology, networking, programming, and general topics. Be professional yet approachable. When you lack information or are uncertain, indicate this clearly. You have access to external tools for web search, weather, time, and location data - use them when needed to provide accurate, up-to-date information. Keep responses concise and well-formatted for Discord.",
    'bot.responseFormat': 'text',
    'bot.maxResponseLength': 1999,
    'bot.maxChatsPerUser': 5,
    'bot.cooldownSeconds': 5,
    'ollama.maxTokens': 4096,
    'ollama.temperature': 0.7,
    'ollama.topP': 0.9,
    'tools.enabled': true,
    'tools.triggerThreshold': 0.6,
    'rateLimit.cooldownMs': 5000,
    'rateLimit.maxRequestsPerMinute': 12,
    'rateLimit.maxRequestsPerHour': 100,
    'logging.level': 'info',
  };

  const defaultValue = defaults[key];
  if (defaultValue === undefined) {
    await interaction.reply({
      content: 'No default value available for this key.',
      ephemeral: true,
    });
    return;
  }

  const [section, settingKey] = key.split('.');
  const config = getConfig();
  const oldValue = // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (config as any)[section]?.[settingKey];

  updateConfig(section as keyof Config, settingKey as never, defaultValue as never);
  logConfigChange(key, oldValue, defaultValue, interaction.user.id);

  await interaction.reply({
    content: `Configuration reset:\n\`${key}\`: \`${JSON.stringify(oldValue)}\` → \`${JSON.stringify(defaultValue)}\` (default)`,
    ephemeral: true,
  });
}

function formatConfigSection(name: string, section: unknown): string {
  // Truncate long strings for display
  const formatted = JSON.stringify(section, (key, value) => {
    if (typeof value === 'string' && value.length > 100) {
      return value.substring(0, 100) + '...';
    }
    return value;
  }, 2);

  return formatted;
}
