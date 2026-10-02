import {
  Interaction,
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
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
  handleWebhookActionSelect,
  handleWebhookPickSelect,
  handleWebhookChannelSelect,
  handleWebhookAddModal,
} from '../commands/webhook';
import {
  addAllowedChannel,
  removeAllowedChannel,
  addBlockedChannel,
  removeBlockedChannel,
  addCasualChannel,
  removeCasualChannel,
  setCasualChattiness,
  loadGuildConfig,
  saveGuildConfig,
  resolveHeat,
  HeatPreset,
  HEAT_PRESET_LABELS,
} from '../../config/guildConfig';

export async function handleInteractionCreate(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    } else if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction);
    } else if (interaction.isChannelSelectMenu()) {
      await handleChannelSelectMenu(interaction);
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
    case 'channel_action':
      await handleChannelActionSelect(interaction);
      break;
    case 'channel_chattiness':
      await handleChannelChattinessSelect(interaction);
      break;
    case 'webhook_action':
      await handleWebhookActionSelect(interaction);
      break;
    case 'webhook_pick':
      await handleWebhookPickSelect(interaction);
      break;
    default:
      await interaction.reply({
        content: 'Action not available.',
        ephemeral: true,
      });
  }
}

async function handleChannelSelectMenu(interaction: ChannelSelectMenuInteraction): Promise<void> {
  const [action, op] = interaction.customId.split(':');
  logger.info(`ChannelSelect: ${action}:${op} by ${interaction.user.tag} -> ${interaction.values[0]}`);
  if (action === 'webhook_add_channel') {
    await handleWebhookChannelSelect(interaction);
    return;
  }
  if (action !== 'channel_pick') {
    await interaction.reply({ content: 'Action not available.', ephemeral: true });
    return;
  }
  await handleChannelPick(interaction, op);
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
    case 'webhook_add_modal':
      await handleWebhookAddModal(interaction);
      break;
    case 'channel_heat_modal':
      await handleChannelHeatModal(interaction);
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

// ==================== /channel component handlers ====================

const CHANNEL_PICK_LABELS: Record<string, string> = {
  allow: 'Pick a channel to allow (mentions/replies)',
  disallow: 'Pick a channel to remove from the allowed list',
  block: 'Pick a channel to block',
  unblock: 'Pick a channel to unblock',
  casual_enable: 'Pick a channel to enable the Answer Machine in',
  casual_disable: 'Pick a channel to disable the Answer Machine in',
};

async function handleChannelActionSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const choice = interaction.values[0];
  const guildId = interaction.guildId!;

  if (choice === 'reset') {
    const config = loadGuildConfig(guildId);
    config.channels.allowed = [];
    config.channels.blocked = [];
    config.casualChat.channels = [];
    saveGuildConfig(guildId, config);
    await interaction.update({ content: 'All channel restrictions and Answer Machine channels have been reset.', embeds: [], components: [] });
    return;
  }

  if (choice === 'chattiness') {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('channel_chattiness')
      .setPlaceholder('How much should it talk?')
      .addOptions(
        { label: 'Low (15)', value: 'low', description: 'Answers & corrections only, rarely' },
        { label: 'Medium (35)', value: 'medium', description: 'Answers & corrections, occasionally' },
        { label: 'High (60)', value: 'high', description: 'Answers & corrections, more often; reacts more' },
        { label: 'TalksALot (85)', value: 'talksalot', description: 'Also joins casual conversation and holds a back-and-forth' },
        { label: 'Custom (0-100)', value: 'custom', description: 'Set an exact heat — 70+ unlocks casual chat' }
      );
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
    await interaction.update({ content: 'How much heat should the Answer Machine have?', embeds: [], components: [row] });
    return;
  }

  const label = CHANNEL_PICK_LABELS[choice];
  if (!label) {
    await interaction.reply({ content: 'Action not available.', ephemeral: true });
    return;
  }

  const picker = new ChannelSelectMenuBuilder()
    .setCustomId(`channel_pick:${choice}`)
    .setPlaceholder(label)
    .addChannelTypes(ChannelType.GuildText);
  const row = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(picker);
  await interaction.update({ content: label, embeds: [], components: [row] });
}

async function handleChannelChattinessSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const preset = interaction.values[0] as HeatPreset;

  if (preset === 'custom') {
    // Modal has to be the first response to this select interaction.
    const modal = new ModalBuilder()
      .setCustomId('channel_heat_modal')
      .setTitle('Custom Answer Machine heat')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('heat')
            .setLabel('Heat (0-100) — 70+ unlocks casual chat')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('e.g. 75')
            .setMaxLength(3)
            .setRequired(true)
        )
      );
    await interaction.showModal(modal);
    return;
  }

  setCasualChattiness(interaction.guildId!, preset);
  const heat = resolveHeat(loadGuildConfig(interaction.guildId!));
  await interaction.update({ content: `Answer Machine heat set to **${HEAT_PRESET_LABELS[preset]} (${heat})**.`, embeds: [], components: [] });
}

async function handleChannelHeatModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: 'This requires Administrator permission in this server.', ephemeral: true });
    return;
  }
  const raw = interaction.fields.getTextInputValue('heat').trim();
  const heat = /^\d{1,3}$/.test(raw) ? parseInt(raw, 10) : NaN;
  if (!Number.isInteger(heat) || heat < 0 || heat > 100) {
    await interaction.reply({ content: 'Heat must be a whole number from 0 to 100.', ephemeral: true });
    return;
  }
  setCasualChattiness(interaction.guildId!, 'custom', heat);
  const content = `Answer Machine heat set to **Custom (${heat})**${heat >= 70 ? ' — casual chat is on.' : '.'}`;
  if (interaction.isFromMessage()) {
    await interaction.update({ content, embeds: [], components: [] });
  } else {
    await interaction.reply({ content, ephemeral: true });
  }
}

async function handleChannelPick(interaction: ChannelSelectMenuInteraction, op: string): Promise<void> {
  const guildId = interaction.guildId!;
  const channelId = interaction.values[0];

  switch (op) {
    case 'allow':
      addAllowedChannel(guildId, channelId);
      await interaction.update({ content: `<#${channelId}> added to the allowed list.`, embeds: [], components: [] });
      break;
    case 'disallow':
      removeAllowedChannel(guildId, channelId);
      await interaction.update({ content: `<#${channelId}> removed from the allowed list.`, embeds: [], components: [] });
      break;
    case 'block':
      addBlockedChannel(guildId, channelId);
      await interaction.update({ content: `<#${channelId}> blocked.`, embeds: [], components: [] });
      break;
    case 'unblock':
      removeBlockedChannel(guildId, channelId);
      await interaction.update({ content: `<#${channelId}> unblocked.`, embeds: [], components: [] });
      break;
    case 'casual_enable':
      addCasualChannel(guildId, channelId);
      await interaction.update({ content: `Answer Machine enabled in <#${channelId}>.`, embeds: [], components: [] });
      break;
    case 'casual_disable':
      removeCasualChannel(guildId, channelId);
      await interaction.update({ content: `Answer Machine disabled in <#${channelId}>.`, embeds: [], components: [] });
      break;
    default:
      await interaction.reply({ content: 'Action not available.', ephemeral: true });
  }
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
