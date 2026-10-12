import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { Command } from './index';
import { loadGuildConfig } from '../../config/guildConfig';

// Bare command, no subcommands — shows current state plus a dropdown for
// what to do next, matching the /memory and /personality pattern. Picking
// most actions here follows up with a native Discord channel picker
// (ChannelSelectMenuBuilder, wired in interactionCreate.ts) instead of
// requiring a channel option up front.
export const channelCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('channel')
    .setDescription('Manage channel restrictions (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  adminOnly: true,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const guildId = interaction.guildId!;
    const config = loadGuildConfig(guildId);

    const embed = new EmbedBuilder()
      .setTitle('Channel Configuration')
      .setColor(0x2f3136)
      .addFields(
        {
          name: 'Allowed (mentions/replies)',
          value: config.channels.allowed.length
            ? config.channels.allowed.map((id) => `<#${id}>`).join(', ')
            : 'All channels (no restrictions)',
        },
        {
          name: 'Blocked',
          value: config.channels.blocked.length
            ? config.channels.blocked.map((id) => `<#${id}>`).join(', ')
            : 'None',
        }
      )
      .setFooter({ text: 'Blocked always overrides allowed/Answer Machine for that channel. Use /answer-machine for participation, timing and logs.' });

    const menu = new StringSelectMenuBuilder()
      .setCustomId('channel_action')
      .setPlaceholder('What do you want to do?')
      .addOptions(
        { label: 'Allow a channel (mentions)', value: 'allow', description: 'Bot only responds here when addressed' },
        { label: 'Disallow a channel', value: 'disallow', description: 'Remove from the allowed list' },
        { label: 'Block a channel', value: 'block', description: 'Bot never responds here at all' },
        { label: 'Unblock a channel', value: 'unblock', description: 'Remove from the blocked list' },
        { label: 'Reset channel restrictions', value: 'reset', description: 'Clear channel restrictions' }
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  },
};
