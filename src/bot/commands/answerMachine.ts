import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, ChatInputCommandInteraction, StringSelectMenuInteraction, ChannelSelectMenuInteraction, ModalSubmitInteraction } from 'discord.js';
import { Command } from './index';
import { loadGuildConfig, saveGuildConfig, resolveHeat, setCasualChattiness, addCasualChannel, removeCasualChannel } from '../../config/guildConfig';
import { parseSetting } from '../../config/validation';

export function answerPanel(guildId: string) {
  const c = loadGuildConfig(guildId), t = c.casualChat;
  const embed = new EmbedBuilder().setTitle('Answer Machine').setColor(0x2f3136)
    .setDescription('Server-wide controls. Heat decides whether to participate; timing decides when.\nHeat: 0 very selective · 50 useful contributions · 80 conversational · 100 frequent participation. Direct requests remain responsive. Casual unsolicited chat opens at 70.')
    .addFields({ name: 'Channels', value: t.channels.map(id => `<#${id}>`).join(', ') || 'None' },
      { name: 'Heat', value: String(resolveHeat(c)) },
      { name: 'Timing', value: `Group quiet pause: ${t.groupPauseMs / 1000}s\nMinimum group turn spacing: ${t.turnSpacingMs / 1000}s\nTyping protection: ${t.typingProtection ? 'on' : 'off'} (${t.typingGraceMs / 1000}s grace)\nMaximum quiet/typing wait: ${t.maxTurnWaitMs / 1000}s; minimum turn spacing still applies. Direct/invited turns yield at most 3s (or your shorter maximum).` },
      { name: 'Media and diagnostics', value: `GIFs/stickers: ${t.media ? 'on' : 'off'}\nDiagnostics collection: ${c.diagnostics.enabled ? 'on' : 'off'}\nLog channel: ${c.diagnostics.channelId ? `<#${c.diagnostics.channelId}>` : 'None'}` });
  const menu = new StringSelectMenuBuilder().setCustomId('am_action').setPlaceholder('Choose a setting').addOptions(
    { label: 'Enable in a channel', value: 'enable' }, { label: 'Disable in a channel', value: 'disable' },
    { label: 'Edit heat (0–100)', value: 'heat' }, { label: 'Edit turn timing', value: 'timing' },
    { label: 'Toggle typing protection', value: 'typing' }, { label: 'Toggle GIFs and stickers', value: 'media' },
    { label: 'Choose diagnostics channel', value: 'logs' }, { label: 'Stop diagnostics channel posts', value: 'logs_off' },
    { label: 'Toggle diagnostics collection', value: 'diagnostics' });
  return { content: '', embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] };
}
export const answerMachineCommand: Command = {
  data: new SlashCommandBuilder().setName('answer-machine').setDescription('Manage Answer Machine heat, channels, timing and logs').setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.Administrator), adminOnly: true,
  async execute(i: ChatInputCommandInteraction) { await i.reply({ ...answerPanel(i.guildId!), ephemeral: true }); }
};
export async function handleAnswerMachine(i: StringSelectMenuInteraction | ChannelSelectMenuInteraction | ModalSubmitInteraction) {
  if (!i.guildId || !i.memberPermissions?.has(PermissionFlagsBits.Administrator)) { await i.reply({ content: 'Administrator permission is required.', ephemeral: true }); return; }
  const c = loadGuildConfig(i.guildId);
  if (i.isStringSelectMenu()) {
    const choice = i.values[0];
    if (['enable', 'disable', 'logs'].includes(choice)) {
      await i.update({ content: 'Choose a channel. Log posts are visible to everyone with access to that channel.', embeds: [], components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(new ChannelSelectMenuBuilder().setCustomId(`am_pick:${choice}`).addChannelTypes(ChannelType.GuildText))] }); return;
    }
    if (choice === 'heat' || choice === 'timing') {
      const modal = new ModalBuilder().setCustomId(`am_modal:${choice}`).setTitle(choice === 'heat' ? 'Edit heat (0–100)' : 'Server-wide turn timing');
      const fields: [string,string,string][] = choice === 'heat' ? [['heat', 'Heat 0–100 (see panel for examples)', String(resolveHeat(c))]] : [
        ['groupPauseMs','Group quiet pause, seconds (0–60)',String(c.casualChat.groupPauseMs / 1000)],
        ['turnSpacingMs','Minimum group turn spacing, seconds (0–120)',String(c.casualChat.turnSpacingMs / 1000)],
        ['typingGraceMs','Typing grace, seconds (0–60)',String(c.casualChat.typingGraceMs / 1000)],
        ['maxTurnWaitMs','Maximum quiet/typing wait, seconds (1–120)',String(c.casualChat.maxTurnWaitMs / 1000)]];
      for (const [id,label,value] of fields) modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setValue(value).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(8)));
      await i.showModal(modal); return;
    }
    if (choice === 'typing') c.casualChat.typingProtection = !c.casualChat.typingProtection;
    else if (choice === 'media') c.casualChat.media = !c.casualChat.media;
    else if (choice === 'diagnostics') c.diagnostics.enabled = !c.diagnostics.enabled;
    else if (choice === 'logs_off') c.diagnostics.channelId = null;
    else { await i.reply({ content: 'Unknown setting.', ephemeral: true }); return; }
    saveGuildConfig(i.guildId, c); await i.update(answerPanel(i.guildId)); return;
  }
  if (i.isChannelSelectMenu()) {
    const op = i.customId.split(':')[1], id = i.values[0];
    if (op === 'logs') {
      const channel = await i.guild!.channels.fetch(id);
      const perms = channel?.permissionsFor(i.client.user!);
      if (!perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]) || c.casualChat.channels.includes(id)) { await i.reply({ content: 'Choose a log channel the bot can view and send to, outside Answer Machine channels.', ephemeral: true }); return; }
      c.diagnostics.channelId = id; c.diagnostics.enabled = true; saveGuildConfig(i.guildId, c);
    } else if (op === 'enable') {
      if (id === c.diagnostics.channelId) { await i.reply({ content: 'The diagnostics channel cannot also be an Answer Machine channel.', ephemeral: true }); return; }
      addCasualChannel(i.guildId, id);
    } else if (op === 'disable') removeCasualChannel(i.guildId, id);
    else { await i.reply({ content: 'Unknown setting.', ephemeral: true }); return; }
    await i.update(answerPanel(i.guildId)); return;
  }
  try {
    if (i.customId.endsWith(':heat')) {
      const raw = i.fields.getTextInputValue('heat').trim();
      if (!/^\d{1,3}$/.test(raw) || Number(raw) > 100) throw new Error('Heat must be a whole number from 0 to 100.');
      setCasualChattiness(i.guildId, 'custom', Number(raw));
    } else {
      const values: Record<string, number> = {};
      for (const key of ['groupPauseMs','turnSpacingMs','typingGraceMs','maxTurnWaitMs'] as const) {
        const raw = i.fields.getTextInputValue(key).trim();
        if (!/^\d+(\.\d{1,3})?$/.test(raw)) throw new Error('Enter nonnegative seconds, with up to three decimal places.');
        values[key] = parseSetting(`casualChat.${key}`, String(Math.round(Number(raw) * 1000))) as number;
      }
      Object.assign(c.casualChat, values); saveGuildConfig(i.guildId, c);
    }
    if (i.isFromMessage()) await i.update(answerPanel(i.guildId)); else await i.reply({ ...answerPanel(i.guildId), ephemeral: true });
  } catch (e) { await i.reply({ content: e instanceof Error ? e.message : 'Invalid setting.', ephemeral: true }); }
}
