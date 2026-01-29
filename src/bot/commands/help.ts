import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { Command } from './index';
import { getConfig } from '../../config';

export const helpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Get help with using NET.ai'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const config = getConfig();

    const embed = new EmbedBuilder()
      .setTitle('NET.ai Help')
      .setDescription('Your technical assistant for the Network community.')
      .setColor(0x5865F2)
      .addFields(
        {
          name: '💬 How to Chat',
          value: [
            '**Mention me** in any message to start a conversation:',
            '`@NET.ai What is a subnet mask?`',
            '',
            '**Reply to my messages** to continue the conversation:',
            'Just click reply on any of my messages.',
            '',
            '**Send images** with your message for analysis:',
            '`@NET.ai What does this error mean?` + image',
          ].join('\n'),
        },
        {
          name: '📚 Chat Management',
          value: [
            '`/chat list` - View your chat sessions',
            '`/chat create <name>` - Create a new chat',
            '`/chat switch` - Switch between chats',
            '`/chat delete` - Delete a chat',
            '`/chat clear` - Clear current chat history',
            '`/chat rename <name>` - Rename current chat',
            '',
            `*You can have up to ${config.bot.maxChatsPerUser} chats.*`,
          ].join('\n'),
        },
        {
          name: '🔧 What I Can Do',
          value: [
            '• Answer technical questions',
            '• Explain networking concepts',
            '• Help with programming',
            '• Analyze images and screenshots',
            '• Search the web for current information',
            '• Check weather and time zones',
            '• Perform DNS lookups and ping tests',
          ].join('\n'),
        },
        {
          name: '⚡ Tips',
          value: [
            '• Be specific in your questions for better answers',
            '• I remember our conversation within each chat session',
            '• Switch chats to keep different topics organized',
            '• I have a cooldown between messages to stay responsive',
          ].join('\n'),
        }
      )
      .setFooter({ text: 'NET.ai - Network Assistant' })
      .setTimestamp();

    await interaction.reply({
      embeds: [embed],
      ephemeral: true,
    });
  },
};
