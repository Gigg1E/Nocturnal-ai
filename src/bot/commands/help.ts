import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { Command } from './index';
import { getConfig } from '../../config';

export const helpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Get help with using NET.ai'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const config = getConfig();

    const embed = new EmbedBuilder()
      .setTitle('NET.ai')
      .setDescription('Technical assistant. Direct answers, no fluff.')
      .setColor(0x2f3136)
      .addFields(
        {
          name: 'How to Use',
          value: [
            '**Mention me:** `@NET.ai your question`',
            '**Reply to me:** Continue the conversation',
            '**Send images:** `@NET.ai` + attachment',
          ].join('\n'),
        },
        {
          name: 'What I Do',
          value: [
            '• Tech questions & networking',
            '• Programming help',
            '• Image/screenshot analysis',
            '• Web search, weather, DNS lookups',
          ].join('\n'),
        },
        {
          name: 'Context',
          value: `I remember your last ${config.bot.historySize} exchanges. Reply to continue, or just mention me again.`,
        }
      )
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  },
};
