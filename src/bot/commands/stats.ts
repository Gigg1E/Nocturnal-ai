import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import { Command } from './index';
import { getStats } from '../../database/queries';
import { getConfig } from '../../config';
import { checkOllamaConnection } from '../../ollama/client';
import { checkToolsApiConnection } from '../../ollama/tools';

const OWNER_ID = process.env.OWNER_ID;

export const statsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('View bot statistics (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  adminOnly: true,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Check if user is owner
    if (interaction.user.id !== OWNER_ID) {
      await interaction.reply({
        content: 'Owner only.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const stats = getStats();
    const config = getConfig();

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
            `Vision: ${config.ollama.visionModel}`,
            `Tools: ${config.tools.enabled ? 'On' : 'Off'}`,
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
            `Cooldown: ${config.rateLimit.cooldownMs / 1000}s`,
            `Per Min: ${config.rateLimit.maxRequestsPerMinute}`,
            `Per Hour: ${config.rateLimit.maxRequestsPerHour}`,
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
