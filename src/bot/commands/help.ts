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
    .setDescription('Get help with using Nocturnal'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const config = getConfig();

    const embed = new EmbedBuilder()
      .setTitle('Nocturnal')
      .setDescription('Chat assistant. Direct answers, no fluff.')
      .setColor(0x2f3136)
      .addFields(
        {
          name: 'How to Use',
          value: [
            '**Mention me:** `@Nocturnal your question`',
            '**Reply to me:** Continue the conversation',
            '**Send images:** `@Nocturnal` + attachment',
          ].join('\n'),
        },
        {
          name: 'What I Do',
          value: [
            '• General chat & questions',
            '• Image/screenshot analysis',
            '• Web search, weather, time, location, crypto prices',
          ].join('\n'),
        },
        {
          name: 'Make Me Yours',
          value: [
            '`/personality` — customize how I talk to you (follows you everywhere)',
            '`/preferences` — my own likes/opinions, referenced when relevant',
            '`/memory` — see, add, or clear what I remember about you long-term',
            '`/clearchat` — forget the current conversation only (not /memory)',
          ].join('\n'),
        },
        {
          name: 'Context',
          value: `I remember your last ${config.bot.historySize} exchanges in a conversation. Reply to continue, or just mention me again.`,
        }
      )
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  },
};
