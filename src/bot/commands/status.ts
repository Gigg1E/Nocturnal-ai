import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import { Command } from './index';
import { checkOllamaConnection, listModels } from '../../ollama/client';
import { checkToolsApiConnection, checkIndividualTools } from '../../ollama/tools';

const OWNER_ID = process.env.OWNER_ID;

const OK   = '🟢';
const FAIL = '🔴';

export const statusCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Live status check for all tool endpoints (Owner only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  adminOnly: true,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (interaction.user.id !== OWNER_ID) {
      await interaction.reply({ content: 'Owner only.', ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    // Run all checks in parallel
    const [ollamaOk, toolsApiOk, models] = await Promise.all([
      checkOllamaConnection(),
      checkToolsApiConnection(),
      listModels(),
    ]);
    const chatModelOk = models.some((m) => m.startsWith('qwen3:4b'));

    let toolLines = '*(Tools API unreachable)*';
    if (toolsApiOk) {
      const toolStatus = await checkIndividualTools();
      toolLines = Object.entries(toolStatus)
        .map(([name, { ok, error }]) =>
          `${ok ? OK : FAIL} ${name}${!ok && error ? ` — ${error}` : ''}`
        )
        .join('\n');
    }

    const embed = new EmbedBuilder()
      .setTitle('NET.ai Tool Status')
      .setColor(ollamaOk && toolsApiOk ? 0x57f287 : 0xed4245)
      .addFields(
        {
          name: 'Core Services',
          value: [
            `${ollamaOk    ? OK : FAIL} Ollama`,
            `${chatModelOk ? OK : FAIL} qwen3:4b`,
            `${toolsApiOk  ? OK : FAIL} Tools API`,
          ].join('\n'),
          inline: false,
        },
        {
          name: 'Tool Endpoints',
          value: toolLines,
          inline: false,
        }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};
