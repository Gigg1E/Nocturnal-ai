import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { Command } from './index';
import {
  getOrCreateUser,
  getUserChats,
  getActiveChat,
  createChat,
  deleteChat,
  clearChat,
  setActiveChat,
  renameChat,
} from '../../database/queries';
import { getConfig } from '../../config';
import { logger, logChat } from '../../utils/logger';

export const chatCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('chat')
    .setDescription('Manage your chat sessions')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('View all your chat sessions')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('create')
        .setDescription('Create a new chat session')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Name for the new chat')
            .setRequired(true)
            .setMaxLength(50)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('switch')
        .setDescription('Switch to a different chat session')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('delete')
        .setDescription('Delete a chat session')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('clear')
        .setDescription('Clear the current chat history')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('rename')
        .setDescription('Rename a chat session')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('New name for the chat')
            .setRequired(true)
            .setMaxLength(50)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const username = interaction.user.username;

    // Ensure user exists
    getOrCreateUser(userId, username);

    switch (subcommand) {
      case 'list':
        await handleList(interaction);
        break;
      case 'create':
        await handleCreate(interaction);
        break;
      case 'switch':
        await handleSwitch(interaction);
        break;
      case 'delete':
        await handleDelete(interaction);
        break;
      case 'clear':
        await handleClear(interaction);
        break;
      case 'rename':
        await handleRename(interaction);
        break;
    }
  },
};

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const chats = getUserChats(interaction.user.id);
  const activeChat = getActiveChat(interaction.user.id);
  const config = getConfig();

  if (chats.length === 0) {
    await interaction.reply({
      content: 'You have no chat sessions. Use `/chat create` to start one.',
      ephemeral: true,
    });
    return;
  }

  const chatList = chats
    .map((chat, index) => {
      const isActive = chat.id === activeChat?.id;
      const date = new Date(chat.last_message_at).toLocaleDateString();
      return `${isActive ? '**►**' : '  '} ${index + 1}. **${chat.name}** (Last active: ${date})${isActive ? ' *(current)*' : ''}`;
    })
    .join('\n');

  await interaction.reply({
    content: `**Your Chat Sessions** (${chats.length}/${config.bot.maxChatsPerUser})\n\n${chatList}\n\nUse \`/chat switch\` to change chats.`,
    ephemeral: true,
  });
}

async function handleCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.options.getString('name', true);
  const config = getConfig();
  const chats = getUserChats(interaction.user.id);

  if (chats.length >= config.bot.maxChatsPerUser) {
    await interaction.reply({
      content: `You've reached the maximum of ${config.bot.maxChatsPerUser} chats. Delete one first with \`/chat delete\`.`,
      ephemeral: true,
    });
    return;
  }

  const newChat = createChat(interaction.user.id, name);

  if (newChat) {
    await interaction.reply({
      content: `Chat **${name}** created and set as active. Start chatting by mentioning me!`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      content: 'Failed to create chat. Please try again.',
      ephemeral: true,
    });
  }
}

async function handleSwitch(interaction: ChatInputCommandInteraction): Promise<void> {
  const chats = getUserChats(interaction.user.id);

  if (chats.length === 0) {
    await interaction.reply({
      content: 'You have no chat sessions to switch to.',
      ephemeral: true,
    });
    return;
  }

  if (chats.length === 1) {
    await interaction.reply({
      content: 'You only have one chat session.',
      ephemeral: true,
    });
    return;
  }

  const activeChat = getActiveChat(interaction.user.id);

  const options = chats.map((chat) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(chat.name)
      .setDescription(`Last active: ${new Date(chat.last_message_at).toLocaleDateString()}`)
      .setValue(chat.id)
      .setDefault(chat.id === activeChat?.id)
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('chat_switch')
    .setPlaceholder('Select a chat to switch to')
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  await interaction.reply({
    content: 'Select a chat session to switch to:',
    components: [row],
    ephemeral: true,
  });
}

async function handleDelete(interaction: ChatInputCommandInteraction): Promise<void> {
  const chats = getUserChats(interaction.user.id);

  if (chats.length === 0) {
    await interaction.reply({
      content: 'You have no chat sessions to delete.',
      ephemeral: true,
    });
    return;
  }

  const options = chats.map((chat) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(chat.name)
      .setDescription(`Created: ${new Date(chat.created_at).toLocaleDateString()}`)
      .setValue(chat.id)
  );

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('chat_delete_select')
    .setPlaceholder('Select a chat to delete')
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  // We need to handle the selection in the interaction handler
  // For now, let's use a simpler approach with buttons for confirmation
  await interaction.reply({
    content: 'Select a chat session to delete:',
    components: [row],
    ephemeral: true,
  });

  // Wait for selection
  try {
    const filter = (i: any) =>
      i.customId === 'chat_delete_select' && i.user.id === interaction.user.id;

    const selectInteraction = await interaction.channel?.awaitMessageComponent({
      filter,
      time: 60000,
    });

    if (selectInteraction && selectInteraction.isStringSelectMenu()) {
      const chatId = selectInteraction.values[0];
      const chat = chats.find((c) => c.id === chatId);

      // Show confirmation
      const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`chat_delete_confirm:${chatId}`)
          .setLabel('Delete')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId('chat_delete_cancel')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );

      await selectInteraction.update({
        content: `Are you sure you want to delete **${chat?.name}**? This cannot be undone.`,
        components: [confirmRow],
      });
    }
  } catch (error) {
    // Timeout - do nothing, the message will stay with the select menu
  }
}

async function handleClear(interaction: ChatInputCommandInteraction): Promise<void> {
  const activeChat = getActiveChat(interaction.user.id);

  if (!activeChat) {
    await interaction.reply({
      content: 'You have no active chat to clear.',
      ephemeral: true,
    });
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`chat_clear_confirm:${activeChat.id}`)
      .setLabel('Clear History')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('chat_clear_cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    content: `Are you sure you want to clear the history of **${activeChat.name}**? This cannot be undone.`,
    components: [row],
    ephemeral: true,
  });
}

async function handleRename(interaction: ChatInputCommandInteraction): Promise<void> {
  const newName = interaction.options.getString('name', true);
  const activeChat = getActiveChat(interaction.user.id);

  if (!activeChat) {
    await interaction.reply({
      content: 'You have no active chat to rename.',
      ephemeral: true,
    });
    return;
  }

  const success = renameChat(activeChat.id, interaction.user.id, newName);

  if (success) {
    await interaction.reply({
      content: `Chat renamed to **${newName}**.`,
      ephemeral: true,
    });
  } else {
    await interaction.reply({
      content: 'Failed to rename chat.',
      ephemeral: true,
    });
  }
}
