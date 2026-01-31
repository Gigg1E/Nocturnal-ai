import {
  Interaction,
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { logger } from '../../utils/logger';
import { commands } from '../commands';

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

  // No select menu handlers needed currently
  await interaction.reply({
    content: 'Action not available.',
    ephemeral: true,
  });
}

async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const [action, ...params] = interaction.customId.split(':');

  logger.info(`Modal: ${action} by ${interaction.user.tag}`);

  switch (action) {
    case 'config_edit':
      await handleConfigEditModal(interaction, params[0]);
      break;
    default:
      await interaction.reply({
        content: 'Unknown action.',
        ephemeral: true,
      });
  }
}

// Modal handlers
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
