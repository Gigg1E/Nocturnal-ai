import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { Command } from './index';
import { logger } from '../../utils/logger';

const WEBHOOK_API_HOST = process.env.WEBHOOK_API_HOST || 'http://localhost:3200';

// Light fetch wrapper — avoids adding a new dependency
async function webhookApi(method: string, path: string, body?: unknown) {
  const fetch = (await import('node-fetch')).default;
  const url = `${WEBHOOK_API_HOST}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) || `HTTP ${res.status}`);
  return data;
}

interface Subscription {
  id: number;
  channel_id: string;
  type: string;
  config: string;
  enabled: boolean | number;
}

const TYPE_LABELS: Record<string, string> = {
  weather_daily: 'Weather Daily',
  weather_alert: 'Weather Alert',
  news_digest:   'News Digest',
  nasa_apod:     'NASA APOD',
};

const TYPE_DESCRIPTIONS: Record<string, string> = {
  weather_daily: 'Daily forecast for a location',
  weather_alert: 'Alert when severe weather hits a location',
  news_digest:   'Daily news on topics you choose',
  nasa_apod:     'NASA Astronomy Picture of the Day',
};

// Component interactions aren't covered by the command's
// setDefaultMemberPermissions gate, so re-check on every step.
function isAdmin(i: { memberPermissions: { has(p: bigint): boolean } | null }): boolean {
  return i.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

async function fetchGuildSubs(guildId: string): Promise<Subscription[]> {
  const result = await webhookApi('GET', `/api/subscriptions?guild_id=${guildId}`) as { subscriptions: Subscription[] };
  return result.subscriptions;
}

function parseConfig(s: Subscription): Record<string, any> {
  try {
    return JSON.parse(s.config);
  } catch {
    return {};
  }
}

function describeSub(s: Subscription): { detail: string; schedule: string } {
  const config = parseConfig(s);
  const detail = config.location || (Array.isArray(config.topics) ? config.topics.join(', ') : '') || '';
  const schedule = config.time
    ? `@ ${config.time} ${config.tz || 'UTC'}`
    : config.interval_minutes ? `every ${config.interval_minutes}m` : '';
  return { detail, schedule };
}

function buildOverview(subs: Subscription[]) {
  const lines = subs.map((s) => {
    const { detail, schedule } = describeSub(s);
    const enabled = s.enabled ? '🟢' : '🔴';
    const label = TYPE_LABELS[s.type] || s.type;
    return `**#${s.id}** ${enabled} \`${label}\` → <#${s.channel_id}>${detail ? ` | ${detail}` : ''} ${schedule}`;
  });

  let description = lines.length ? lines.join('\n') : '*No notifications set up for this server yet.*';
  if (description.length > 4000) description = description.slice(0, 3990) + '\n…';

  const embed = new EmbedBuilder()
    .setTitle(`Notifications${subs.length ? ` (${subs.length})` : ''}`)
    .setColor(0x2f3136)
    .setDescription(description)
    .setFooter({ text: '🟢 on  🔴 off — pick an action below' });

  const options = Object.keys(TYPE_LABELS).map((type) => ({
    label: `Add: ${TYPE_LABELS[type]}`,
    description: TYPE_DESCRIPTIONS[type],
    value: `add:${type}`,
  }));
  if (subs.length) {
    options.push(
      { label: 'Remove a notification', description: 'Delete one permanently', value: 'remove' },
      { label: 'Turn one on/off', description: 'Pause or resume without deleting', value: 'toggle' },
      { label: 'Test one now', description: 'Fire it immediately to check it works', value: 'test' },
    );
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId('webhook_action')
    .setPlaceholder('What do you want to do?')
    .addOptions(options);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  };
}

function validateTime(raw: string): string {
  const t = raw.trim();
  if (!t) return '08:00';
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    throw new Error(`Invalid time "${t}" — use 24-hour HH:MM (e.g. 08:00 or 17:30)`);
  }
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

// A bad timezone would otherwise silently fall back to UTC in the
// scheduler, firing at the wrong time with no error anywhere.
function validateTz(raw: string): string {
  const tz = raw.trim();
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    throw new Error(`Unknown timezone "${tz}" — use an IANA name like America/New_York or Europe/London`);
  }
}

// Bare command, no subcommands — shows this server's notifications plus a
// dropdown for what to do next, matching /channel, /memory, /personality.
export const webhookCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('webhook')
    .setDescription('Manage scheduled notifications for this server (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  adminOnly: true,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });
    try {
      const subs = await fetchGuildSubs(interaction.guildId!);
      await interaction.editReply(buildOverview(subs));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await interaction.editReply({ content: `Couldn't reach the notification service: ${msg}` });
    }
  },
};

// ─── component handlers (routed from events/interactionCreate.ts) ──────────

export async function handleWebhookActionSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: 'This requires Administrator permission in this server.', ephemeral: true });
    return;
  }
  const choice = interaction.values[0];

  if (choice.startsWith('add:')) {
    const type = choice.slice('add:'.length);
    if (!TYPE_LABELS[type]) {
      await interaction.reply({ content: 'Unknown notification type.', ephemeral: true });
      return;
    }
    const picker = new ChannelSelectMenuBuilder()
      .setCustomId(`webhook_add_channel:${type}`)
      .setPlaceholder('Pick the channel to post in')
      .addChannelTypes(ChannelType.GuildText);
    await interaction.update({
      content: `**${TYPE_LABELS[type]}** — which channel should it post in?`,
      embeds: [],
      components: [new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(picker)],
    });
    return;
  }

  if (!['remove', 'toggle', 'test'].includes(choice)) {
    await interaction.reply({ content: 'Action not available.', ephemeral: true });
    return;
  }

  await interaction.deferUpdate();
  try {
    const subs = await fetchGuildSubs(interaction.guildId!);
    if (!subs.length) {
      await interaction.editReply({ content: 'No notifications in this server yet.', embeds: [], components: [] });
      return;
    }
    const prompt = { remove: 'Which one should be removed?', toggle: 'Which one should be turned on/off?', test: 'Which one should fire now?' }[choice];
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`webhook_pick:${choice}`)
      .setPlaceholder(prompt!)
      .addOptions(subs.slice(0, 25).map((s) => {
        const { detail, schedule } = describeSub(s);
        return {
          label: `#${s.id} ${TYPE_LABELS[s.type] || s.type} ${s.enabled ? '(on)' : '(off)'}`.slice(0, 100),
          description: [detail, schedule].filter(Boolean).join(' ').slice(0, 100) || 'No details',
          value: String(s.id),
        };
      }));
    await interaction.editReply({
      content: prompt!,
      embeds: [],
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ content: `Couldn't reach the notification service: ${msg}`, embeds: [], components: [] });
  }
}

export async function handleWebhookPickSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: 'This requires Administrator permission in this server.', ephemeral: true });
    return;
  }
  const op = interaction.customId.split(':')[1];
  const id = parseInt(interaction.values[0], 10);

  await interaction.deferUpdate();
  try {
    // The notification service's remove/toggle/test endpoints don't check
    // which server a subscription belongs to, so confirm it's this one's
    // before acting — otherwise one server's admins could hit another's.
    const subs = await fetchGuildSubs(interaction.guildId!);
    if (!subs.some((s) => s.id === id)) {
      await interaction.editReply({ content: "That notification doesn't belong to this server.", embeds: [], components: [] });
      return;
    }

    let content: string;
    if (op === 'remove') {
      await webhookApi('DELETE', `/api/subscriptions/${id}`);
      content = `Notification #${id} removed.`;
    } else if (op === 'toggle') {
      const result = await webhookApi('PATCH', `/api/subscriptions/${id}/toggle`) as { enabled: boolean };
      content = `Notification #${id} is now **${result.enabled ? 'on' : 'off'}**.`;
    } else if (op === 'test') {
      const result = await webhookApi('POST', `/api/subscriptions/${id}/test`);
      content = result.sent !== false
        ? `Fired notification #${id}. Check its channel.`
        : `Ran fine, but nothing came back to send for #${id} (e.g. no search results or no active alerts right now) — that's why nothing showed up.`;
    } else {
      content = 'Action not available.';
    }
    await interaction.editReply({ content, embeds: [], components: [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Webhook ${op} #${id} failed:`, err);
    await interaction.editReply({ content: `Failed: ${msg}`, embeds: [], components: [] });
  }
}

export async function handleWebhookChannelSelect(interaction: ChannelSelectMenuInteraction): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: 'This requires Administrator permission in this server.', ephemeral: true });
    return;
  }
  const type = interaction.customId.split(':')[1];
  const channelId = interaction.values[0];
  if (!TYPE_LABELS[type]) {
    await interaction.reply({ content: 'Unknown notification type.', ephemeral: true });
    return;
  }

  const input = (id: string, label: string, placeholder: string, required: boolean) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(placeholder)
        .setRequired(required)
    );
  const timeInput = input('time', 'Time to post (24-hour HH:MM)', 'Blank = 08:00', false);
  const tzInput = input('timezone', 'Timezone', 'Blank = UTC — e.g. America/New_York', false);

  const rows: ActionRowBuilder<TextInputBuilder>[] = [];
  if (type === 'weather_daily') {
    rows.push(input('location', 'Location', 'e.g. Chicago, IL or London, UK', true), timeInput, tzInput);
  } else if (type === 'weather_alert') {
    rows.push(
      input('location', 'Location to monitor', 'e.g. Miami, FL', true),
      input('interval', 'Check every N minutes (15-1440)', 'Blank = 60', false),
    );
  } else if (type === 'news_digest') {
    rows.push(input('topics', 'Topics (comma-separated)', 'e.g. technology, gaming, science', true), timeInput, tzInput);
  } else {
    rows.push(timeInput, tzInput);
  }

  const modal = new ModalBuilder()
    .setCustomId(`webhook_add_modal:${type}:${channelId}`)
    .setTitle(`Add ${TYPE_LABELS[type]}`)
    .addComponents(...rows);
  await interaction.showModal(modal);
}

export async function handleWebhookAddModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: 'This requires Administrator permission in this server.', ephemeral: true });
    return;
  }
  const [, type, channelId] = interaction.customId.split(':');
  if (!TYPE_LABELS[type] || !interaction.guild?.channels.cache.has(channelId)) {
    await interaction.reply({ content: 'That channel or type is no longer valid — run /webhook again.', ephemeral: true });
    return;
  }

  const field = (id: string) => interaction.fields.getTextInputValue(id);
  let config: Record<string, unknown>;
  try {
    if (type === 'weather_daily') {
      config = { location: field('location').trim(), time: validateTime(field('time')), tz: validateTz(field('timezone')) };
    } else if (type === 'weather_alert') {
      const raw = field('interval').trim();
      const interval = raw ? parseInt(raw, 10) : 60;
      if (!Number.isInteger(interval) || interval < 15 || interval > 1440) {
        throw new Error('Interval must be a whole number of minutes between 15 and 1440.');
      }
      config = { location: field('location').trim(), interval_minutes: interval };
    } else if (type === 'news_digest') {
      const topics = field('topics').split(',').map((t) => t.trim()).filter(Boolean);
      if (!topics.length) throw new Error('Give at least one topic.');
      config = { topics, time: validateTime(field('time')), tz: validateTz(field('timezone')) };
    } else {
      config = { time: validateTime(field('time')), tz: validateTz(field('timezone')) };
    }
  } catch (err: unknown) {
    // Leave the channel picker in place so they can pick again and retry.
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.reply({ content: msg, ephemeral: true });
    return;
  }

  if (interaction.isFromMessage()) await interaction.deferUpdate();
  else await interaction.deferReply({ ephemeral: true });

  try {
    const result = await webhookApi('POST', '/api/subscriptions', {
      guild_id: interaction.guildId,
      channel_id: channelId,
      type,
      config,
    }) as { subscription: { id: number } };

    await interaction.editReply({
      content: '',
      components: [],
      embeds: [
        new EmbedBuilder()
          .setTitle('Notification Added')
          .setColor(0x57f287)
          .addFields(
            { name: 'ID', value: String(result.subscription.id), inline: true },
            { name: 'Type', value: TYPE_LABELS[type], inline: true },
            { name: 'Channel', value: `<#${channelId}>`, inline: true },
            { name: 'Config', value: `\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\`` },
          )
          .setFooter({ text: 'Run /webhook → Test one now to fire it immediately' }),
      ],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Webhook add failed:', err);
    await interaction.editReply({ content: `Failed to add notification: ${msg}`, embeds: [], components: [] });
  }
}
