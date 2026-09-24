import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
} from 'discord.js';
import { Command } from './index';
import { getConfig, updateConfig } from '../../config';
import { listModels } from '../../ollama/client';
import { logger, logConfigChange } from '../../utils/logger';

const OWNER_ID = process.env.OWNER_ID;

export const modelCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('model')
    .setDescription('Manage Ollama models (Owner only)')
    // 0 = nobody by default, not even guild Administrators — this only
    // affects Ollama model selection on the owner's own hardware (see
    // OWNER_ID check below), so unlike /config etc. it shouldn't be
    // guild-admin-visible at all. The owner has to grant themselves an
    // exception per-guild in Discord's Integrations settings since bots
    // can't set per-user command permission overrides via bot token alone.
    .setDefaultMemberPermissions(0)
    .addSubcommand((subcommand) =>
      subcommand
        .setName('chat')
        .setDescription('Set the chat model')
        .addStringOption((option) =>
          option
            .setName('model')
            .setDescription('Model name (e.g., qwen3:14b)')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('vision')
        .setDescription('Set the vision model')
        .addStringOption((option) =>
          option
            .setName('model')
            .setDescription('Model name (e.g., qwen3-vl:8b)')
            .setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('List available Ollama models')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('current')
        .setDescription('Show currently configured models')
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
      case 'chat':
        await handleSetChatModel(interaction);
        break;
      case 'vision':
        await handleSetVisionModel(interaction);
        break;
      case 'list':
        await handleListModels(interaction);
        break;
      case 'current':
        await handleCurrentModels(interaction);
        break;
    }
  },
};

async function handleSetChatModel(interaction: ChatInputCommandInteraction): Promise<void> {
  const modelName = interaction.options.getString('model', true);
  const config = getConfig();
  const oldModel = config.ollama.chatModel;

  // Verify model exists
  const availableModels = await listModels();
  if (availableModels.length > 0 && !availableModels.includes(modelName)) {
    await interaction.reply({
      content: `Model \`${modelName}\` not found. Available models:\n${availableModels.map(m => `• ${m}`).join('\n')}`,
      ephemeral: true,
    });
    return;
  }

  updateConfig('ollama', 'chatModel', modelName);
  logConfigChange('ollama.chatModel', oldModel, modelName, interaction.user.id);

  await interaction.reply({
    content: `Chat model updated: \`${oldModel}\` → \`${modelName}\``,
    ephemeral: true,
  });
}

async function handleSetVisionModel(interaction: ChatInputCommandInteraction): Promise<void> {
  const modelName = interaction.options.getString('model', true);
  const config = getConfig();
  const oldModel = config.ollama.visionModel;

  // Verify model exists
  const availableModels = await listModels();
  if (availableModels.length > 0 && !availableModels.includes(modelName)) {
    await interaction.reply({
      content: `Model \`${modelName}\` not found. Available models:\n${availableModels.map(m => `• ${m}`).join('\n')}`,
      ephemeral: true,
    });
    return;
  }

  updateConfig('ollama', 'visionModel', modelName);
  logConfigChange('ollama.visionModel', oldModel, modelName, interaction.user.id);

  await interaction.reply({
    content: `Vision model updated: \`${oldModel}\` → \`${modelName}\``,
    ephemeral: true,
  });
}

async function handleListModels(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const models = await listModels();

  if (models.length === 0) {
    await interaction.editReply({
      content: 'Could not retrieve models from Ollama. Make sure Ollama is running.',
    });
    return;
  }

  const modelList = models.map((m) => `• ${m}`).join('\n');

  await interaction.editReply({
    content: `**Available Ollama Models:**\n${modelList}`,
  });
}

async function handleCurrentModels(interaction: ChatInputCommandInteraction): Promise<void> {
  const config = getConfig();

  await interaction.reply({
    content: `**Current Model Configuration:**\n• Chat Model: \`${config.ollama.chatModel}\`\n• Vision Model: \`${config.ollama.visionModel}\`\n• Max Tokens: \`${config.ollama.maxTokens}\`\n• Temperature: \`${config.ollama.temperature}\``,
    ephemeral: true,
  });
}
