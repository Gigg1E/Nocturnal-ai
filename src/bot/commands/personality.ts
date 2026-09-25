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
import {
  parsePreferencesInput,
  getUserPreferences,
  setUserPreferences,
  resetUserPreferences,
  MAX_PREFERENCES_LENGTH,
} from '../../services/preferences';

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
    .addSubcommand((sub) => sub.setName('reset').setDescription('Go back to the default personality'))
    .addSubcommandGroup((group) =>
      group
        .setName('preferences')
        .setDescription("Nocturnal's own opinions/likes — secondary flavor, not how it talks")
        .addSubcommand((sub) =>
          sub
            .setName('set')
            .setDescription('Set a comma-separated list of "topic: value" pairs')
            .addStringOption((opt) =>
              opt
                .setName('list')
                .setDescription('e.g. "favorite anime: X, favorite food: ramen, hates: mornings"')
                .setRequired(true)
                .setMaxLength(MAX_PREFERENCES_LENGTH)
            )
        )
        .addSubcommand((sub) => sub.setName('view').setDescription("See Nocturnal's current preferences"))
        .addSubcommand((sub) => sub.setName('reset').setDescription('Clear all preferences'))
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);
    const userId = interaction.user.id;

    if (group === 'preferences') {
      await handlePreferences(interaction, subcommand, userId);
      return;
    }

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

async function handlePreferences(
  interaction: ChatInputCommandInteraction,
  subcommand: string,
  userId: string
): Promise<void> {
  if (subcommand === 'view') {
    const items = getUserPreferences(userId);
    const embed = new EmbedBuilder()
      .setTitle("Nocturnal's Preferences")
      .setColor(0x2f3136)
      .setDescription(
        items && items.length > 0
          ? items.map((i) => `**${i.topic}:** ${i.value}`).join('\n')
          : 'None set — use /personality preferences set to give it some.'
      )
      .setFooter({
        text: 'Secondary flavor, referenced when relevant — not repeated every message.',
      });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (subcommand === 'set') {
    const list = interaction.options.getString('list', true).trim();
    const result = parsePreferencesInput(list);
    if (!result.ok) {
      await interaction.reply({
        content: `Couldn't parse that: ${result.error}\nFormat: \`topic: value, topic: value, ...\` — e.g. \`favorite anime: X, favorite food: ramen\`. Avoid extra commas inside a single value.`,
        ephemeral: true,
      });
      return;
    }
    setUserPreferences(userId, result.items);
    await interaction.reply({
      content: `Set ${result.items.length} preference${result.items.length === 1 ? '' : 's'}. Use /personality preferences view to see them.`,
      ephemeral: true,
    });
    return;
  }

  if (subcommand === 'reset') {
    resetUserPreferences(userId);
    await interaction.reply({ content: 'Cleared all preferences.', ephemeral: true });
  }
}
