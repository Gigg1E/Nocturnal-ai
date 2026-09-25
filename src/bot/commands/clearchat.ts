import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import { Command } from './index';
import { clearHistory } from '../../services/chat';

export const clearChatCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('clearchat')
    .setDescription("Forget the current conversation and start fresh (doesn't touch /memory or /personality)"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const userId = interaction.user.id;
    const guildId = interaction.guildId ?? 'dm';

    const hadHistory = clearHistory(userId, guildId);

    await interaction.reply({
      content: hadHistory
        ? "Cleared. I've forgotten the recent back-and-forth — mention me again to start a new conversation."
        : "Nothing to clear — we haven't talked yet in this server.",
      ephemeral: true,
    });
  },
};
