import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import { Command } from './index';
import { getConfig } from '../../config';
import { checkOllamaConnection, listModels } from '../../ollama/client';
import { checkToolsApiConnection, checkIndividualTools } from '../../ollama/tools';

const EXTRACTOR_MODEL = 'qwen2.5:1.5b'; // must match src/ollama/extractor.ts

const OK   = '🟢';
const FAIL = '🔴';

export const statusCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Live status check for all tool endpoints (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  adminOnly: true,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Gated by setDefaultMemberPermissions(Administrator) — read-only host
    // health check, fine for any guild's admins to view.
    await interaction.deferReply({ ephemeral: true });

    // Run all checks in parallel
    const [ollamaOk, toolsApiOk, models] = await Promise.all([
      checkOllamaConnection(),
      checkToolsApiConnection(),
      listModels(),
    ]);
    // Check against whatever's actually configured, not a hardcoded model
    // name — the old version always checked for "qwen3:4b" regardless of
    // what chatModel/visionModel were actually set to, so it could report a
    // false failure (model changed, still shows red) or a false pass
    // (qwen3:4b happens to still be installed but isn't what's in use).
    const { chatModel, visionModel } = getConfig().ollama;
    const chatModelOk = models.some((m) => m.startsWith(chatModel));
    const visionModelOk = models.some((m) => m.startsWith(visionModel));
    const extractorOk = models.some((m) => m.startsWith(EXTRACTOR_MODEL));

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
            `${ollamaOk      ? OK : FAIL} Ollama`,
            `${chatModelOk   ? OK : FAIL} Chat: ${chatModel}`,
            `${visionModelOk ? OK : FAIL} Vision: ${visionModel}`,
            `${extractorOk   ? OK : FAIL} Extractor: ${EXTRACTOR_MODEL}`,
            `${toolsApiOk    ? OK : FAIL} Tools API`,
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
