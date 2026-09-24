import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import { Command } from './index';
import {
  getConfig,
  addToBlacklist,
  removeFromBlacklist,
} from '../../config';
import { logger } from '../../utils/logger';

const OWNER_ID = process.env.OWNER_ID;

export const blacklistCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Manage user blacklist (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Add a user to the blacklist')
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('User to blacklist')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remove a user from the blacklist')
        .addUserOption((option) =>
          option
            .setName('user')
            .setDescription('User to unblacklist')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('View all blacklisted users')
    ),
  adminOnly: true,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Check if user is owner
    if (interaction.user.id !== OWNER_ID) {
      await interaction.reply({
        content: 'This command is restricted to the bot owner.',
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'add':
        await handleAdd(interaction);
        break;
      case 'remove':
        await handleRemove(interaction);
        break;
      case 'list':
        await handleList(interaction);
        break;
    }
  },
};

async function handleAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  const user = interaction.options.getUser('user', true);

  // Prevent blacklisting the owner
  if (user.id === OWNER_ID) {
    await interaction.reply({
      content: 'You cannot blacklist the bot owner.',
      ephemeral: true,
    });
    return;
  }

  // Prevent blacklisting the bot
  if (user.id === interaction.client.user?.id) {
    await interaction.reply({
      content: 'You cannot blacklist the bot itself.',
      ephemeral: true,
    });
    return;
  }

  const config = getConfig();
  if (config.users.blacklist.includes(user.id)) {
    await interaction.reply({
      content: `${user.tag} is already blacklisted.`,
      ephemeral: true,
    });
    return;
  }

  addToBlacklist(user.id);

  await interaction.reply({
    content: `${user.tag} has been added to the blacklist. They can no longer interact with the bot.`,
    ephemeral: true,
  });

  logger.info(`User ${user.tag} (${user.id}) blacklisted by ${interaction.user.tag}`);
}

async function handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const user = interaction.options.getUser('user', true);

  const config = getConfig();
  if (!config.users.blacklist.includes(user.id)) {
    await interaction.reply({
      content: `${user.tag} is not on the blacklist.`,
      ephemeral: true,
    });
    return;
  }

  removeFromBlacklist(user.id);

  await interaction.reply({
    content: `${user.tag} has been removed from the blacklist.`,
    ephemeral: true,
  });

  logger.info(`User ${user.tag} (${user.id}) removed from blacklist by ${interaction.user.tag}`);
}

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const config = getConfig();
  const blacklist = config.users.blacklist;

  if (blacklist.length === 0) {
    await interaction.reply({
      content: 'No users are currently blacklisted.',
      ephemeral: true,
    });
    return;
  }

  // Try to fetch usernames
  const userList: string[] = [];
  for (const userId of blacklist) {
    try {
      const user = await interaction.client.users.fetch(userId);
      userList.push(`• ${user.tag} (\`${userId}\`)`);
    } catch {
      userList.push(`• Unknown User (\`${userId}\`)`);
    }
  }

  await interaction.reply({
    content: `**Blacklisted Users (${blacklist.length})**\n\n${userList.join('\n')}`,
    ephemeral: true,
  });
}
