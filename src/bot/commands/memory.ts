import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { Command } from './index';
import {
  getUserMemoryFacts,
  recordMemoryFact,
  forgetUserMemorySlot,
  clearUserMemory,
  MAX_MEMORY_SLOTS,
  MAX_FACT_LENGTH,
} from '../../services/memory';

export const memoryCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('memory')
    .setDescription('See or manage what Nocturnal remembers about you')
    .addSubcommand((sub) => sub.setName('view').setDescription('List what Nocturnal remembers about you'))
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription("Manually tell me something to remember, instead of waiting for me to pick it up")
        .addStringOption((opt) =>
          opt
            .setName('fact')
            .setDescription(`Short fact, e.g. "I have a dog named Rex" (max ${MAX_FACT_LENGTH} chars)`)
            .setRequired(true)
        )
    )
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
          facts.length ? facts.map((f) => `**${f.slot}.** ${f.fact}`).join('\n') : 'Nothing yet — this fills in naturally as we talk, or add one with /memory add.'
        )
        .setFooter({ text: 'This is global, not tied to any one server. /memory add to teach me something, /memory forget <slot> to remove one.' });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    if (subcommand === 'add') {
      const fact = interaction.options.getString('fact', true).trim();
      if (!fact) {
        await interaction.reply({ content: "Can't add an empty fact.", ephemeral: true });
        return;
      }
      if (fact.length > MAX_FACT_LENGTH) {
        await interaction.reply({
          content: `That's ${fact.length} characters — keep it under ${MAX_FACT_LENGTH}.`,
          ephemeral: true,
        });
        return;
      }
      // Same capped-at-10, moves-to-slot-1 store the passive extractor
      // writes to — a manually added fact behaves exactly like one it
      // picked up on its own, just without waiting to see it in context.
      recordMemoryFact(userId, fact);
      await interaction.reply({ content: `Got it, I'll remember: "${fact}"`, ephemeral: true });
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
