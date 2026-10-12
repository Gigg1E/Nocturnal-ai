import { parseSetting } from '../../config/validation';
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
import { loadGuildConfig, updateGuildConfig, GuildConfig, DEFAULT_GUILD_CONFIG } from '../../config/guildConfig';
import { logger, logConfigChange } from '../../utils/logger';

const OWNER_ID = process.env.OWNER_ID;

// Host-resource-affecting settings — deliberately stay owner-only and global,
// not per-guild. This is running on the owner's own hardware; a guild admin
// shouldn't be able to change which model loads or how much it generates.
const OWNER_ONLY_CONFIGS: Record<string, { description: string; type: string }> = {
  'ollama.maxTokens': { description: 'Max tokens for AI', type: 'number' },
  'ollama.temperature': { description: 'AI temperature (0-1)', type: 'number' },
  'ollama.topP': { description: 'AI top_p (0-1)', type: 'number' },
  'logging.level': { description: 'Logging level', type: 'string' },
};

// Per-guild settings — any Administrator of the guild the command is run in
// can edit these; they only affect that guild. Personality/system-prompt
// isn't here anymore — that's per-user now, see /personality.
const GUILD_CONFIGS: Record<string, { description: string; type: string }> = {
  'bot.maxResponseLength': { description: 'Max response length', type: 'number' },
  'bot.maxChatsPerUser': { description: 'Max concurrent in-flight requests per user', type: 'number' },
  'tools.enabled': { description: 'Enable external tools', type: 'boolean' },
  'rateLimit.cooldownMs': { description: 'Cooldown in milliseconds', type: 'number' },
  'rateLimit.maxRequestsPerMinute': { description: 'Max requests per minute', type: 'number' },
  'rateLimit.maxRequestsPerHour': { description: 'Max requests per hour', type: 'number' },
};

const EDITABLE_CONFIGS: Record<string, { description: string; type: string }> = {
  ...GUILD_CONFIGS,
  ...OWNER_ONLY_CONFIGS,
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
    // Gated by setDefaultMemberPermissions(Administrator) above for the
    // per-guild fields; handleSet/handleReset additionally require OWNER_ID
    // for anything in OWNER_ONLY_CONFIGS.
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

// bot/tools/rateLimit/channels/users are per-guild now; ollama/logging stay
// global. "tools" is a merge — enabled/triggerThreshold are per-guild but
// weights/keywords are still shared global baseline data.
function getViewableSection(section: string, globalConfig: Config, guildConfig: GuildConfig): unknown {
  switch (section) {
    case 'bot':
      return guildConfig.bot;
    case 'rateLimit':
      return guildConfig.rateLimit;
    case 'channels':
      return guildConfig.channels;
    case 'users':
      return guildConfig.users;
    case 'tools':
      return { enabled: guildConfig.tools.enabled, triggerThreshold: guildConfig.tools.triggerThreshold, weights: globalConfig.tools.weights, keywords: globalConfig.tools.keywords };
    case 'ollama':
      return globalConfig.ollama;
    case 'logging':
      return globalConfig.logging;
    default:
      return undefined;
  }
}

async function handleView(interaction: ChatInputCommandInteraction): Promise<void> {
  const section = interaction.options.getString('section');
  const globalConfig = getConfig();
  const guildConfig = loadGuildConfig(interaction.guildId!);

  if (section) {
    const sectionConfig = getViewableSection(section, globalConfig, guildConfig);
    const formatted = formatConfigSection(section, sectionConfig);

    await interaction.reply({
      content: `**Configuration: ${section}**\n\`\`\`json\n${formatted}\n\`\`\``,
      ephemeral: true,
    });
  } else {
    // Show overview across both global and per-guild sections
    const sections = ['bot', 'ollama', 'tools', 'rateLimit', 'channels', 'users', 'logging'];
    const overview = sections
      .map((key) => {
        const sectionConfig = getViewableSection(key, globalConfig, guildConfig) as Record<string, unknown>;
        const scope = key === 'ollama' || key === 'logging' ? 'global' : 'this server';
        return `• **${key}** (${scope}): ${Object.keys(sectionConfig).length} settings`;
      })
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

  const isOwnerOnly = key in OWNER_ONLY_CONFIGS;
  if (isOwnerOnly && interaction.user.id !== OWNER_ID) {
    await interaction.reply({
      content: `\`${key}\` affects the AI model/host directly and is restricted to the bot owner.`,
      ephemeral: true,
    });
    return;
  }

  const [section, settingKey] = key.split('.');
  const guildId = interaction.guildId!;
  const oldValue = isOwnerOnly
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (getConfig() as any)[section]?.[settingKey]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    : (loadGuildConfig(guildId) as any)[section]?.[settingKey];

  // Parse value based on type
  let parsedValue: unknown;
  try {
    parsedValue = parseSetting(key, valueStr);
  } catch (error) {
    await interaction.reply({
      content: (error as Error).message,
      ephemeral: true,
    });
    return;
  }

  try {
    if (isOwnerOnly) {
      updateConfig(section as keyof Config, settingKey as never, parsedValue as never);
    } else {
      updateGuildConfig(guildId, section as keyof GuildConfig, settingKey as never, parsedValue as never);
    }
    logConfigChange(key, oldValue, parsedValue, interaction.user.id);

    await interaction.reply({
      content: `Configuration updated${isOwnerOnly ? '' : ' for this server'}:\n\`${key}\`: \`${JSON.stringify(oldValue)}\` → \`${JSON.stringify(parsedValue)}\``,
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

  const isOwnerOnly = key in OWNER_ONLY_CONFIGS;
  if (isOwnerOnly && interaction.user.id !== OWNER_ID) {
    await interaction.reply({
      content: `\`${key}\` affects the AI model/host directly and is restricted to the bot owner.`,
      ephemeral: true,
    });
    return;
  }

  // Owner-only defaults (unchanged, global config). Per-guild defaults come
  // straight from DEFAULT_GUILD_CONFIG so there's one source of truth.
  const ownerDefaults: Record<string, unknown> = {
    'ollama.maxTokens': 4096,
    'ollama.temperature': 0.7,
    'ollama.topP': 0.9,
    'logging.level': 'info',
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const guildDefaults: Record<string, unknown> = Object.fromEntries(
    Object.keys(GUILD_CONFIGS).map((k) => {
      const [section, settingKey] = k.split('.');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return [k, (DEFAULT_GUILD_CONFIG as any)[section]?.[settingKey]];
    })
  );

  const defaultValue = isOwnerOnly ? ownerDefaults[key] : guildDefaults[key];
  if (defaultValue === undefined) {
    await interaction.reply({
      content: 'No default value available for this key.',
      ephemeral: true,
    });
    return;
  }

  const [section, settingKey] = key.split('.');
  const guildId = interaction.guildId!;
  const oldValue = isOwnerOnly
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? (getConfig() as any)[section]?.[settingKey]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    : (loadGuildConfig(guildId) as any)[section]?.[settingKey];

  if (isOwnerOnly) {
    updateConfig(section as keyof Config, settingKey as never, defaultValue as never);
  } else {
    updateGuildConfig(guildId, section as keyof GuildConfig, settingKey as never, defaultValue as never);
  }
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
