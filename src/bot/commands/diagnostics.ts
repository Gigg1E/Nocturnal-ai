import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { Command } from './index';
import { loadGuildConfig, saveGuildConfig } from '../../config/guildConfig';
import { recentDiagnostics, clearDiagnostics, formatDiagnostic } from '../../services/diagnostics';

export const diagnosticsCommand: Command = {
  adminOnly: true,
  data: new SlashCommandBuilder().setName('diagnostics').setDescription('Manage this server’s conversation diagnostics')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator).setDMPermission(false)
    .addSubcommand(s => s.setName('channel').setDescription('Choose a log channel, or omit it to stop live posting')
      .addChannelOption(o => o.setName('channel').setDescription('Channel visible to your chosen admins').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s => s.setName('recent').setDescription('View recent activity from this server')
      .addBooleanOption(o => o.setName('failures').setDescription('Only failed requests')))
    .addSubcommand(s => s.setName('enabled').setDescription('Enable or disable collection and live posting')
      .addBooleanOption(o => o.setName('value').setDescription('Collect diagnostics').setRequired(true)))
    .addSubcommand(s => s.setName('clear').setDescription('Delete this server’s stored diagnostics')),
  async execute(interaction) {
    if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: 'This requires Administrator permission in a server.', ephemeral: true }); return;
    }
    await interaction.deferReply({ ephemeral: true });
    const guildId = interaction.guildId;
    const config = loadGuildConfig(guildId);
    const op = interaction.options.getSubcommand();
    if (op === 'channel') {
      const channel = interaction.options.getChannel('channel');
      if (channel) {
        const resolved = await interaction.guild!.channels.fetch(channel.id);
        const me = interaction.guild!.members.me ?? await interaction.guild!.members.fetchMe();
        if (!resolved || resolved.type !== ChannelType.GuildText || !resolved.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
          await interaction.editReply({ content: 'Choose a text channel I can view and send messages in.' }); return;
        }
        if (config.casualChat.channels.includes(channel.id)) {
          await interaction.editReply({ content: 'Choose a separate channel for diagnostics, outside Answer Machine channels.' }); return;
        }
      }
      config.diagnostics.channelId = channel?.id ?? null;
      saveGuildConfig(guildId, config);
      await interaction.editReply({ content: channel ? `Diagnostics will post in <#${channel.id}>${config.diagnostics.enabled ? '.' : ' when collection is enabled.'} Everyone who can view that channel can see the operational metadata; no conversation text is included.` : 'Live posting stopped. Recent diagnostics remain available.' });
    } else if (op === 'enabled') {
      config.diagnostics.enabled = interaction.options.getBoolean('value', true);
      saveGuildConfig(guildId, config);
      await interaction.editReply({ content: `Diagnostic collection is ${config.diagnostics.enabled ? 'enabled' : 'disabled'} for this server.` });
    } else if (op === 'clear') {
      clearDiagnostics(guildId);
      await interaction.editReply({ content: 'Stored diagnostics cleared for this server. Existing messages in the log channel remain.' });
    } else {
      const events = recentDiagnostics(guildId, 1000);
      const failures = interaction.options.getBoolean('failures') ?? false;
      const terminal = events.filter(e => failures ? e.action === 'error' || e.success === false : ['sent', 'reacted', 'skipped', 'error', 'wait', 'generated'].includes(e.action)).slice(0, 5);
      await interaction.editReply({ content: terminal.length ? formatDiagnostic(terminal[0], events.filter(e => e.requestId === terminal[0].requestId).reverse()) : 'No matching diagnostics stored for this server.', allowedMentions: { parse: [] } });
      for (const event of terminal.slice(1)) await interaction.followUp({ ephemeral: true, content: formatDiagnostic(event, events.filter(e => e.requestId === event.requestId).reverse()), allowedMentions: { parse: [] } });
    }
  },
};
