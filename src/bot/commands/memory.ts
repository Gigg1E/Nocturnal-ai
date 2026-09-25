import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { Command } from './index';
import { getUserMemoryFacts } from '../../services/memory';

// Bare command, no subcommands — /memory shows what's remembered plus a
// dropdown for what to do next (add/forget/clear), rather than making
// users pick the right subcommand (view/add/forget/reset) up front. The
// actual add/forget flows are handled as component interactions in
// interactionCreate.ts (a modal for "add", a second dropdown listing the
// actual facts for "forget" so nobody has to remember a slot number).
export const memoryCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('memory')
    .setDescription("See or manage what Nocturnal remembers about you"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const userId = interaction.user.id;
    const facts = getUserMemoryFacts(userId);

    const embed = new EmbedBuilder()
      .setTitle("What Nocturnal Remembers About You")
      .setColor(0x2f3136)
      .setDescription(
        facts.length ? facts.map((f) => `**${f.slot}.** ${f.fact}`).join('\n') : 'Nothing yet — add one below, or it fills in naturally as we talk.'
      )
      .setFooter({ text: 'This is global, not tied to any one server.' });

    const options = [{ label: 'Add a memory', value: 'add', description: 'Tell it something to remember directly' }];
    if (facts.length > 0) {
      options.push(
        { label: 'Forget one', value: 'forget', description: 'Pick one to remove' },
        { label: 'Clear everything', value: 'clear', description: 'Wipe all of it' }
      );
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('memory_action')
      .setPlaceholder('What do you want to do?')
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  },
};
