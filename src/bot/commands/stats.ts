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
        content: 'This command is restricted to the bot owner.',
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
    const memoryStr = `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB / ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`;

    const embed = new EmbedBuilder()
      .setTitle('NET.ai Statistics')
      .setColor(0x5865F2)
      .addFields(
        {
          name: '📊 Usage Stats',
          value: [
            `**Total Users:** ${stats.totalUsers}`,
            `**Total Chats:** ${stats.totalChats}`,
            `**Total Messages:** ${stats.totalMessages}`,
            `**Messages Today:** ${stats.messagesToday}`,
            `**Active Users Today:** ${stats.activeUsersToday}`,
          ].join('\n'),
          inline: true,
        },
        {
          name: '⚙️ Configuration',
          value: [
            `**Chat Model:** ${config.ollama.chatModel}`,
            `**Vision Model:** ${config.ollama.visionModel}`,
            `**Max Chats/User:** ${config.bot.maxChatsPerUser}`,
            `**Response Format:** ${config.bot.responseFormat}`,
            `**Tools Enabled:** ${config.tools.enabled ? 'Yes' : 'No'}`,
          ].join('\n'),
          inline: true,
        },
        {
          name: '🔌 Service Status',
          value: [
            `**Ollama:** ${ollamaConnected ? '🟢 Connected' : '🔴 Disconnected'}`,
            `**Tools API:** ${toolsConnected ? '🟢 Connected' : '🔴 Disconnected'}`,
            `**Discord:** 🟢 Connected`,
          ].join('\n'),
          inline: true,
        },
        {
          name: '💻 System',
          value: [
            `**Uptime:** ${uptimeStr}`,
            `**Memory:** ${memoryStr}`,
            `**Node.js:** ${process.version}`,
          ].join('\n'),
          inline: true,
        },
        {
          name: '🛡️ Security',
          value: [
            `**Blacklisted Users:** ${config.users.blacklist.length}`,
            `**Allowed Channels:** ${config.channels.allowed.length || 'All'}`,
            `**Blocked Channels:** ${config.channels.blocked.length}`,
          ].join('\n'),
          inline: true,
        },
        {
          name: '⏱️ Rate Limits',
          value: [
            `**Cooldown:** ${config.rateLimit.cooldownMs / 1000}s`,
            `**Per Minute:** ${config.rateLimit.maxRequestsPerMinute}`,
            `**Per Hour:** ${config.rateLimit.maxRequestsPerHour}`,
          ].join('\n'),
          inline: true,
        }
      )
      .setFooter({ text: 'NET.ai - Network Assistant' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}
