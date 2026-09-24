import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { Command } from './index';
import {
  getUserMemoryFacts,
  forgetUserMemorySlot,
  clearUserMemory,
  MAX_MEMORY_SLOTS,
} from '../../services/memory';

export const memoryCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('memory')
    .setDescription('See or manage what Nocturnal remembers about you')
    .addSubcommand((sub) => sub.setName('view').setDescription('List what Nocturnal remembers about you'))
    .addSubcommand((sub) =>
      sub
        .setName('forget')
        .setDescription('Remove one remembered thing')
        .addIntegerOption((opt) =>
          opt
            .setName('slot')
            .setDescription('The number shown in /memory view')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(MAX_MEMORY_SLOTS)
        )
    )
    .addSubcommand((sub) => sub.setName('clear').setDescription('Forget everything')),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (subcommand === 'view') {
      const facts = getUserMemoryFacts(userId);
      const embed = new EmbedBuilder()
        .setTitle('What Nocturnal Remembers About You')
        .setColor(0x2f3136)
        .setDescription(
          facts.length ? facts.map((f) => `**${f.slot}.** ${f.fact}`).join('\n') : 'Nothing yet — this fills in naturally as we talk.'
        )
        .setFooter({ text: 'This is global, not tied to any one server. Use /memory forget <slot> to remove one.' });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (subcommand === 'forget') {
      const slot = interaction.options.getInteger('slot', true);
      const facts = getUserMemoryFacts(userId);
      if (!facts.some((f) => f.slot === slot)) {
        await interaction.reply({ content: `Nothing in slot ${slot}.`, ephemeral: true });
        return;
      }
      forgetUserMemorySlot(userId, slot);
      await interaction.reply({ content: `Forgot slot ${slot}.`, ephemeral: true });
      return;
    }

    if (subcommand === 'clear') {
      clearUserMemory(userId);
      await interaction.reply({ content: 'Cleared everything Nocturnal remembered about you.', ephemeral: true });
    }
  },
};
