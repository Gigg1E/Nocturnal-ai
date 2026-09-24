import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
} from 'discord.js';
import { Command } from './index';
import {
  loadGuildConfig,
  addAllowedChannel,
  removeAllowedChannel,
  addBlockedChannel,
  removeBlockedChannel,
  saveGuildConfig,
} from '../../config/guildConfig';
import { logger } from '../../utils/logger';

export const channelCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('channel')
    .setDescription('Manage channel restrictions (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('allow')
        .setDescription('Add a channel to the allowed list')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel to allow')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('disallow')
        .setDescription('Remove a channel from the allowed list')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel to disallow')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('block')
        .setDescription('Block a channel from bot interaction')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel to block')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('unblock')
        .setDescription('Unblock a channel')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Channel to unblock')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('View channel configuration')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('reset')
        .setDescription('Reset channel restrictions (allow all)')
    ),
  adminOnly: true,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Gated by setDefaultMemberPermissions(Administrator) above — any admin
    // of this specific guild can manage its own channel restrictions.
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'allow':
        await handleAllow(interaction);
        break;
      case 'disallow':
        await handleDisallow(interaction);
        break;
      case 'block':
        await handleBlock(interaction);
        break;
      case 'unblock':
        await handleUnblock(interaction);
        break;
      case 'list':
        await handleList(interaction);
        break;
      case 'reset':
        await handleReset(interaction);
        break;
    }
  },
};

async function handleAllow(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.options.getChannel('channel', true);
  const guildId = interaction.guildId!;

  const config = loadGuildConfig(guildId);
  if (config.channels.allowed.includes(channel.id)) {
    await interaction.reply({
      content: `<#${channel.id}> is already in the allowed list.`,
      ephemeral: true,
    });
    return;
  }

  addAllowedChannel(guildId, channel.id);

  await interaction.reply({
    content: `<#${channel.id}> has been added to the allowed list.\n\n**Note:** When allowed channels are specified, the bot will ONLY respond in those channels.`,
    ephemeral: true,
  });

  logger.info(`Channel ${channel.id} added to allowed list by ${interaction.user.tag}`);
}

async function handleDisallow(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.options.getChannel('channel', true);
  const guildId = interaction.guildId!;

  const config = loadGuildConfig(guildId);
  if (!config.channels.allowed.includes(channel.id)) {
    await interaction.reply({
      content: `<#${channel.id}> is not in the allowed list.`,
      ephemeral: true,
    });
    return;
  }

  removeAllowedChannel(guildId, channel.id);

  await interaction.reply({
    content: `<#${channel.id}> has been removed from the allowed list.`,
    ephemeral: true,
  });

  logger.info(`Channel ${channel.id} removed from allowed list by ${interaction.user.tag}`);
}

async function handleBlock(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.options.getChannel('channel', true);
  const guildId = interaction.guildId!;

  const config = loadGuildConfig(guildId);
  if (config.channels.blocked.includes(channel.id)) {
    await interaction.reply({
      content: `<#${channel.id}> is already blocked.`,
      ephemeral: true,
    });
    return;
  }

  addBlockedChannel(guildId, channel.id);

  await interaction.reply({
    content: `<#${channel.id}> has been blocked. The bot will not respond in this channel.`,
    ephemeral: true,
  });

  logger.info(`Channel ${channel.id} blocked by ${interaction.user.tag}`);
}

async function handleUnblock(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.options.getChannel('channel', true);
  const guildId = interaction.guildId!;

  const config = loadGuildConfig(guildId);
  if (!config.channels.blocked.includes(channel.id)) {
    await interaction.reply({
      content: `<#${channel.id}> is not blocked.`,
      ephemeral: true,
    });
    return;
  }

  removeBlockedChannel(guildId, channel.id);

  await interaction.reply({
    content: `<#${channel.id}> has been unblocked.`,
    ephemeral: true,
  });

  logger.info(`Channel ${channel.id} unblocked by ${interaction.user.tag}`);
}

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const config = loadGuildConfig(interaction.guildId!);

  let content = '**Channel Configuration**\n\n';

  // Allowed channels
  if (config.channels.allowed.length === 0) {
    content += '**Allowed Channels:** All channels (no restrictions)\n';
  } else {
    const allowedList = config.channels.allowed.map((id) => `<#${id}>`).join(', ');
    content += `**Allowed Channels:** ${allowedList}\n`;
  }

  // Blocked channels
  if (config.channels.blocked.length === 0) {
    content += '**Blocked Channels:** None\n';
  } else {
    const blockedList = config.channels.blocked.map((id) => `<#${id}>`).join(', ');
    content += `**Blocked Channels:** ${blockedList}\n`;
  }

  content += '\n**How it works:**\n';
  content += '• If allowed list is empty, bot responds in all non-blocked channels\n';
  content += '• If allowed list has channels, bot ONLY responds in those (unless blocked)\n';
  content += '• Blocked channels are always ignored';

  await interaction.reply({
    content,
    ephemeral: true,
  });
}

async function handleReset(interaction: ChatInputCommandInteraction): Promise<void> {
  const guildId = interaction.guildId!;
  const config = loadGuildConfig(guildId);

  // Clear both lists
  config.channels.allowed = [];
  config.channels.blocked = [];

  saveGuildConfig(guildId, config);

  await interaction.reply({
    content: 'Channel restrictions have been reset. The bot will now respond in all channels.',
    ephemeral: true,
  });

  logger.info(`Channel restrictions reset by ${interaction.user.tag}`);
}
