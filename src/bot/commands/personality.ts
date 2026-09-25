import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { Command } from './index';
import { getConfig } from '../../config';
import {
  getUserPersonality,
  setUserPersonality,
  resetUserPersonality,
  MAX_PERSONALITY_LENGTH,
} from '../../services/personality';

export const personalityCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('personality')
    .setDescription('Customize how Nocturnal talks to you (applies everywhere, not just this server)')
    .addSubcommand((sub) => sub.setName('view').setDescription('See your current personality setting'))
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Set your own personality for Nocturnal')
        .addStringOption((opt) =>
          opt
            .setName('description')
            .setDescription(`How Nocturnal should act with you (max ${MAX_PERSONALITY_LENGTH} chars)`)
            .setRequired(true)
            .setMaxLength(MAX_PERSONALITY_LENGTH)
        )
    )
    .addSubcommand((sub) => sub.setName('reset').setDescription('Go back to the default personality')),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (subcommand === 'view') {
      const custom = getUserPersonality(userId);
      const embed = new EmbedBuilder()
        .setTitle('Your Nocturnal Personality')
        .setColor(0x2f3136)
        .setDescription(custom ? `**Custom:**\n${custom}` : `**Default** (you haven't customized this):\n${getConfig().bot.systemPrompt}`)
        .setFooter({
          text: custom ? 'This applies to you everywhere Nocturnal is.' : 'Use /personality set to make it yours.',
        });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (subcommand === 'set') {
      const description = interaction.options.getString('description', true).trim();
      if (description.length === 0) {
        await interaction.reply({ content: "Personality can't be empty.", ephemeral: true });
        return;
      }
      if (description.length > MAX_PERSONALITY_LENGTH) {
        await interaction.reply({
          content: `That's ${description.length} characters — keep it under ${MAX_PERSONALITY_LENGTH}.`,
          ephemeral: true,
        });
        return;
      }
      setUserPersonality(userId, description);
      await interaction.reply({
        content: 'Personality updated. This follows you across every server Nocturnal is in.',
        ephemeral: true,
      });
      return;
    }

    if (subcommand === 'reset') {
      resetUserPersonality(userId);
      await interaction.reply({ content: 'Personality reset to default.', ephemeral: true });
    }
  },
};
