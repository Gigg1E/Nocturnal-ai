import {
  Interaction,
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import { logger } from '../../utils/logger';
import { commands } from '../commands';
import {
  getUserMemoryFacts,
  recordMemoryFact,
  forgetUserMemorySlot,
  clearUserMemory,
  MAX_FACT_LENGTH,
} from '../../services/memory';
import { setUserPersonality, resetUserPersonality, MAX_PERSONALITY_LENGTH } from '../../services/personality';
import {
  parsePreferencesInput,
  setUserPreferences,
  disableUserPreferences,
  resetUserPreferences,
  MAX_PREFERENCES_LENGTH,
} from '../../services/preferences';

export async function handleInteractionCreate(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    } else if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction);
    } else if (interaction.isModalSubmit()) {
      await handleModalSubmit(interaction);
    }
  } catch (error) {
    logger.error('Error handling interaction:', error);

    // Try to respond with error
    try {
      const errorResponse = {
        content: 'Error.',
        ephemeral: true,
      };

      if (interaction.isRepliable()) {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorResponse);
        } else {
          await interaction.reply(errorResponse);
        }
      }
    } catch (replyError) {
      logger.error('Failed to send error response:', replyError);
    }
  }
}

async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const command = commands.get(interaction.commandName);

  if (!command) {
    await interaction.reply({
      content: 'Unknown command.',
      ephemeral: true,
    });
    return;
  }

  logger.info(`Command: /${interaction.commandName} by ${interaction.user.tag}`);

  // Defense-in-depth on top of each command's setDefaultMemberPermissions —
  // was declared per-command (adminOnly: true) but never actually enforced
  // at the routing layer until now.
  if (command.adminOnly && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: 'This command requires Administrator permission in this server.',
      ephemeral: true,
    });
    return;
  }

  await command.execute(interaction);
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const [action] = interaction.customId.split(':');

  logger.info(`Button: ${action} by ${interaction.user.tag}`);

  // No button handlers needed currently
  await interaction.reply({
    content: 'Action not available.',
    ephemeral: true,
  });
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const [action] = interaction.customId.split(':');

  logger.info(`Select: ${action} by ${interaction.user.tag}`);

  switch (action) {
    case 'memory_action':
      await handleMemoryActionSelect(interaction);
      break;
    case 'memory_forget_select':
      await handleMemoryForgetSelect(interaction);
      break;
    case 'personality_action':
      await handlePersonalityActionSelect(interaction);
      break;
    case 'preferences_action':
      await handlePreferencesActionSelect(interaction);
      break;
    default:
      await interaction.reply({
        content: 'Action not available.',
        ephemeral: true,
      });
  }
}

async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const [action, ...params] = interaction.customId.split(':');

  logger.info(`Modal: ${action} by ${interaction.user.tag}`);

  switch (action) {
    case 'config_edit':
      await handleConfigEditModal(interaction, params[0]);
      break;
    case 'memory_add_modal':
      await handleMemoryAddModal(interaction);
      break;
    case 'personality_set_modal':
      await handlePersonalitySetModal(interaction);
      break;
    case 'preferences_set_modal':
      await handlePreferencesSetModal(interaction);
      break;
    default:
      await interaction.reply({
        content: 'Unknown action.',
        ephemeral: true,
      });
  }
}

// ==================== /memory component handlers ====================

async function handleMemoryActionSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const choice = interaction.values[0];
  const userId = interaction.user.id;

  if (choice === 'add') {
    const modal = new ModalBuilder()
      .setCustomId('memory_add_modal')
      .setTitle('Add a memory')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('fact')
            .setLabel('What should I remember?')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g. I have a dog named Rex')
            .setMaxLength(MAX_FACT_LENGTH)
            .setRequired(true)
        )
      );
    await interaction.showModal(modal);
    return;
  }

  if (choice === 'forget') {
    const facts = getUserMemoryFacts(userId);
    if (facts.length === 0) {
      await interaction.update({ content: 'Nothing to forget.', embeds: [], components: [] });
      return;
    }
    const menu = new StringSelectMenuBuilder()
      .setCustomId('memory_forget_select')
      .setPlaceholder('Which one?')
      .addOptions(facts.map((f) => ({ label: f.fact.slice(0, 100), value: String(f.slot) })));
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
    await interaction.update({ content: 'Which one do you want to forget?', embeds: [], components: [row] });
    return;
  }

  if (choice === 'clear') {
    clearUserMemory(userId);
    await interaction.update({ content: 'Cleared everything Nocturnal remembered about you.', embeds: [], components: [] });
  }
}

async function handleMemoryForgetSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const slot = parseInt(interaction.values[0], 10);
  forgetUserMemorySlot(interaction.user.id, slot);
  await interaction.update({ content: `Forgot slot ${slot}.`, embeds: [], components: [] });
}

async function handleMemoryAddModal(interaction: ModalSubmitInteraction): Promise<void> {
  const fact = interaction.fields.getTextInputValue('fact').trim();
  if (!fact) {
    await interaction.reply({ content: "Can't add an empty memory.", ephemeral: true });
    return;
  }
  recordMemoryFact(interaction.user.id, fact.slice(0, MAX_FACT_LENGTH));
  await interaction.reply({ content: `Got it, I'll remember: "${fact}"`, ephemeral: true });
}

// ==================== /personality component handlers ====================

async function handlePersonalityActionSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const choice = interaction.values[0];
  const userId = interaction.user.id;

  if (choice === 'set') {
    const modal = new ModalBuilder()
      .setCustomId('personality_set_modal')
      .setTitle('Set your personality')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('description')
            .setLabel('How should Nocturnal act with you?')
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(MAX_PERSONALITY_LENGTH)
            .setRequired(true)
        )
      );
    await interaction.showModal(modal);
    return;
  }

  if (choice === 'reset') {
    resetUserPersonality(userId);
    await interaction.update({ content: 'Personality reset to default.', embeds: [], components: [] });
  }
}

async function handlePersonalitySetModal(interaction: ModalSubmitInteraction): Promise<void> {
  const description = interaction.fields.getTextInputValue('description').trim();
  if (!description) {
    await interaction.reply({ content: "Personality can't be empty.", ephemeral: true });
    return;
  }
  setUserPersonality(interaction.user.id, description);
  await interaction.reply({
    content: 'Personality updated. This follows you across every server Nocturnal is in.',
    ephemeral: true,
  });
}

// ==================== /preferences component handlers ====================

async function handlePreferencesActionSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const choice = interaction.values[0];
  const userId = interaction.user.id;

  if (choice === 'set') {
    const modal = new ModalBuilder()
      .setCustomId('preferences_set_modal')
      .setTitle('Set your preferences')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('list')
            .setLabel('topic: value, topic: value, ... (or "false")')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('favorite anime: X, favorite food: ramen, hates: mornings')
            .setMaxLength(MAX_PREFERENCES_LENGTH)
            .setRequired(true)
        )
      );
    await interaction.showModal(modal);
    return;
  }

  if (choice === 'off') {
    disableUserPreferences(userId);
    await interaction.update({
      content: "Preferences turned off — nothing gets injected, not even the default.",
      embeds: [],
      components: [],
    });
    return;
  }

  if (choice === 'reset') {
    resetUserPreferences(userId);
    await interaction.update({ content: 'Preferences reset to default.', embeds: [], components: [] });
  }
}

async function handlePreferencesSetModal(interaction: ModalSubmitInteraction): Promise<void> {
  const list = interaction.fields.getTextInputValue('list').trim();
  const userId = interaction.user.id;

  if (list.toLowerCase() === 'false') {
    disableUserPreferences(userId);
    await interaction.reply({
      content: "Preferences turned off — nothing gets injected, not even the default.",
      ephemeral: true,
    });
    return;
  }

  const result = parsePreferencesInput(list);
  if (!result.ok) {
    await interaction.reply({
      content: `Couldn't parse that: ${result.error}\nFormat: \`topic: value, topic: value, ...\` — e.g. \`favorite anime: X, favorite food: ramen\`. Avoid extra commas inside a single value. Type \`false\` instead to turn preferences off entirely.`,
      ephemeral: true,
    });
    return;
  }
  setUserPreferences(userId, result.items);
  await interaction.reply({
    content: `Set ${result.items.length} preference${result.items.length === 1 ? '' : 's'}.`,
    ephemeral: true,
  });
}

// ==================== /config modal handler (existing) ====================
import { updateConfig, getConfig } from '../../config';
import { logConfigChange } from '../../utils/logger';

async function handleConfigEditModal(interaction: ModalSubmitInteraction, configPath: string): Promise<void> {
  const newValue = interaction.fields.getTextInputValue('value');

  try {
    const [section, key] = configPath.split('.');
    const config = getConfig();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const oldValue = (config as any)[section]?.[key];

    // Try to parse as JSON if it looks like it
    let parsedValue: unknown = newValue;
    try {
      parsedValue = JSON.parse(newValue);
    } catch {
      // Keep as string if not valid JSON
    }

    updateConfig(
      section as keyof typeof config,
      key as never,
      parsedValue as never
    );

    logConfigChange(configPath, oldValue, parsedValue, interaction.user.id);

    await interaction.reply({
      content: `Updated: \`${configPath}\` = \`${JSON.stringify(parsedValue)}\``,
      ephemeral: true,
    });
  } catch (error) {
    logger.error('Failed to update config:', error);
    await interaction.reply({
      content: 'Failed to update.',
      ephemeral: true,
    });
  }
}
