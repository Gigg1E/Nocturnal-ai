import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import { Command } from './index';
import { getStats } from '../../database/queries';
import { getConfig } from '../../config';
import { loadGuildConfig } from '../../config/guildConfig';
import { checkOllamaConnection } from '../../ollama/client';
import { checkToolsApiConnection } from '../../ollama/tools';

export const statsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View bot statistics (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  adminOnly: true,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Gated by setDefaultMemberPermissions(Administrator) — any admin of this
    // guild can view stats for their own guild.
    await interaction.deferReply({ ephemeral: true });

    const guildId = interaction.guildId!;
    const stats = getStats(guildId);
    const config = getConfig();
    const guildConfig = loadGuildConfig(guildId);

    // Check service connections
    const [ollamaConnected, toolsConnected] = await Promise.all([
      checkOllamaConnection(),
      checkToolsApiConnection(),
    ]);

    // Calculate uptime
    const uptime = process.uptime();
    const uptimeStr = formatUptime(uptime);

    // Memory usage
    const memUsage = process.memoryUsage();
    const memoryStr = `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`;

    const embed = new EmbedBuilder()
      .setTitle('NET.ai Stats')
      .setColor(0x2f3136)
      .addFields(
        {
          name: 'Usage',
          value: [
            `Users: ${stats.totalUsers}`,
            `Requests: ${stats.totalRequests}`,
            `Today: ${stats.requestsToday}`,
            `Active Today: ${stats.activeUsersToday}`,
          ].join('\n'),
          inline: true,
        },
        {
          name: 'Config',
          value: [
            `Model: ${config.ollama.chatModel}`,
            `Tools: ${guildConfig.tools.enabled ? 'On' : 'Off'}`,
          ].join('\n'),
          inline: true,
        },
        {
          name: 'Status',
          value: [
            `Ollama: ${ollamaConnected ? '🟢' : '🔴'}`,
            `Tools API: ${toolsConnected ? '🟢' : '🔴'}`,
            `Discord: 🟢`,
          ].join('\n'),
          inline: true,
        },
        {
          name: 'System',
          value: [
            `Uptime: ${uptimeStr}`,
            `Memory: ${memoryStr}`,
          ].join('\n'),
          inline: true,
        },
        {
          name: 'Rate Limits',
          value: [
            `Cooldown: ${guildConfig.rateLimit.cooldownMs / 1000}s`,
            `Per Min: ${guildConfig.rateLimit.maxRequestsPerMinute}`,
            `Per Hour: ${guildConfig.rateLimit.maxRequestsPerHour}`,
          ].join('\n'),
          inline: true,
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push('<1m');

  return parts.join(' ');
}
