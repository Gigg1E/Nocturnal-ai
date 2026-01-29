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
        content: 'Sorry, an error occurred while processing your request.',
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

  logger.info(`Command executed: /${interaction.commandName} by ${interaction.user.tag}`);

  await command.execute(interaction);
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const [action, ...params] = interaction.customId.split(':');

  logger.info(`Button pressed: ${action} by ${interaction.user.tag}`);

  switch (action) {
    case 'chat_delete_confirm':
      await handleChatDeleteConfirm(interaction, params[0]);
      break;
    case 'chat_delete_cancel':
      await handleChatDeleteCancel(interaction);
      break;
    case 'chat_clear_confirm':
      await handleChatClearConfirm(interaction, params[0]);
      break;
    case 'chat_clear_cancel':
      await handleChatClearCancel(interaction);
      break;
    default:
      await interaction.reply({
        content: 'Unknown button action.',
        ephemeral: true,
      });
  }
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const [action, ...params] = interaction.customId.split(':');

  logger.info(`Select menu: ${action} by ${interaction.user.tag}`);

  switch (action) {
    case 'chat_switch':
      await handleChatSwitchSelect(interaction);
      break;
    case 'chat_delete_select':
      await handleChatDeleteSelect(interaction);
      break;
    default:
      await interaction.reply({
        content: 'Unknown menu action.',
        ephemeral: true,
      });
  }
}

async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const [action, ...params] = interaction.customId.split(':');

  logger.info(`Modal submitted: ${action} by ${interaction.user.tag}`);

  switch (action) {
    case 'config_edit':
      await handleConfigEditModal(interaction, params[0]);
      break;
    default:
      await interaction.reply({
        content: 'Unknown modal action.',
        ephemeral: true,
      });
  }
}

// Button handlers
import { deleteChat, clearChat, setActiveChat } from '../../database/queries';
import { logChat } from '../../utils/logger';

async function handleChatDeleteConfirm(interaction: ButtonInteraction, chatId: string): Promise<void> {
  const success = deleteChat(chatId, interaction.user.id);

  if (success) {
    await interaction.update({
      content: 'Chat deleted successfully.',
      components: [],
    });
  } else {
    await interaction.update({
      content: 'Failed to delete chat. It may have already been deleted.',
      components: [],
    });
  }
}

async function handleChatDeleteCancel(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    content: 'Chat deletion cancelled.',
    components: [],
  });
}

async function handleChatClearConfirm(interaction: ButtonInteraction, chatId: string): Promise<void> {
  const success = clearChat(chatId, interaction.user.id);

  if (success) {
    await interaction.update({
      content: 'Chat history cleared successfully.',
      components: [],
    });
  } else {
    await interaction.update({
      content: 'Failed to clear chat history.',
      components: [],
    });
  }
}

async function handleChatClearCancel(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    content: 'Chat clear cancelled.',
    components: [],
  });
}

async function handleChatSwitchSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const chatId = interaction.values[0];
  setActiveChat(interaction.user.id, chatId);

  await interaction.update({
    content: `Switched to chat. Your messages will now continue this conversation.`,
    components: [],
  });
}

async function handleChatDeleteSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  // This is handled in the chat delete command flow
  // The select menu selection triggers the confirmation dialog
  await interaction.deferUpdate();
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
      content: `Configuration updated: \`${configPath}\` = \`${JSON.stringify(parsedValue)}\``,
      ephemeral: true,
    });
  } catch (error) {
    logger.error('Failed to update config:', error);
    await interaction.reply({
      content: 'Failed to update configuration. Please check the value format.',
      ephemeral: true,
    });
  }
}
