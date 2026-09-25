import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { Command } from './index';
import { getConfig } from '../../config';
import { getUserPersonality } from '../../services/personality';

// Bare command, no subcommands — preferences moved to its own top-level
// /preferences command (see preferences.ts) rather than nesting a
// subcommand group under here; two clean single-purpose commands read
// easier than one command with a subgroup buried inside it.
export const personalityCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('personality')
    .setDescription('Customize how Nocturnal talks to you (applies everywhere, not just this server)'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const userId = interaction.user.id;
    const custom = getUserPersonality(userId);

    const embed = new EmbedBuilder()
      .setTitle('Your Nocturnal Personality')
      .setColor(0x2f3136)
      .setDescription(custom ? `**Custom:**\n${custom}` : `**Default** (you haven't customized this):\n${getConfig().bot.systemPrompt}`)
      .setFooter({ text: 'This applies to you everywhere Nocturnal is.' });

    const options = [{ label: 'Set a new personality', value: 'set', description: 'Replace it with your own' }];
    if (custom) {
      options.push({ label: 'Reset to default', value: 'reset', description: 'Go back to the shipped default' });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('personality_action')
      .setPlaceholder('What do you want to do?')
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  },
};
