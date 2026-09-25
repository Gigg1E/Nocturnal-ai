import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { Command } from './index';
import { getUserPreferences, getEffectivePreferences } from '../../services/preferences';

// Bare command, no subcommands — was /personality preferences set/view/
// reset (a subcommand group nested under /personality); split into its
// own top-level command since it's a genuinely separate concern (what the
// AI likes vs. how it talks) and the nesting was exactly the kind of
// "list of things" the flattening was meant to fix.
export const preferencesCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('preferences')
    .setDescription("Nocturnal's own opinions/likes — secondary flavor, not how it talks"),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const userId = interaction.user.id;
    const custom = getUserPreferences(userId);
    const isOff = custom === false;
    const items = getEffectivePreferences(userId);

    const embed = new EmbedBuilder()
      .setTitle("Nocturnal's Preferences")
      .setColor(0x2f3136)
      .setDescription(
        isOff
          ? '**Off** — turned off, nothing gets injected, not even the default.'
          : items.length > 0
            ? `${custom ? '**Custom:**' : "**Default** (you haven't customized this):"}\n` +
              items.map((i) => `**${i.topic}:** ${i.value}`).join('\n')
            : 'None set.'
      )
      .setFooter({ text: 'Secondary flavor, referenced when relevant — not repeated every message.' });

    const options = [{ label: 'Set preferences', value: 'set', description: 'Replace them with your own list' }];
    if (!isOff) {
      options.push({ label: 'Turn off', value: 'off', description: "Don't use any, not even the default" });
    }
    if (custom !== null) {
      options.push({ label: 'Reset to default', value: 'reset', description: 'Go back to the shipped default' });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId('preferences_action')
      .setPlaceholder('What do you want to do?')
      .addOptions(options);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  },
};
