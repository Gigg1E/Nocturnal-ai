import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
} from 'discord.js';
import { Command } from './index';
import { logger } from '../../utils/logger';

const OWNER_ID = process.env.OWNER_ID;
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

const TYPE_LABELS: Record<string, string> = {
  weather_daily: 'Weather Daily',
  weather_alert: 'Weather Alert',
  news_digest:   'News Digest',
  nasa_apod:     'NASA APOD',
};

export const webhookCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('webhook')
    .setDescription('Manage scheduled Discord notifications (Admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    // ─── add subcommand group ───────────────────────────────────────────
    .addSubcommandGroup((group) =>
      group
        .setName('add')
        .setDescription('Add a notification subscription')
        .addSubcommand((sub) =>
          sub
            .setName('weather-daily')
            .setDescription('Daily weather forecast for a location')
            .addChannelOption((opt) =>
              opt
                .setName('channel')
                .setDescription('Channel to post in')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
            )
            .addStringOption((opt) =>
              opt
                .setName('location')
                .setDescription('Location (e.g. "Chicago, IL" or "London, UK")')
                .setRequired(true)
            )
            .addStringOption((opt) =>
              opt
                .setName('time')
                .setDescription('Time to post each day, HH:MM 24-hour (default: 08:00)')
                .setRequired(false)
            )
            .addStringOption((opt) =>
              opt
                .setName('timezone')
                .setDescription('IANA timezone (e.g. America/New_York, UTC) — default: UTC')
                .setRequired(false)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('weather-alert')
            .setDescription('Alert when severe weather hits a location')
            .addChannelOption((opt) =>
              opt
                .setName('channel')
                .setDescription('Channel to post alerts in')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
            )
            .addStringOption((opt) =>
              opt
                .setName('location')
                .setDescription('Location to monitor')
                .setRequired(true)
            )
            .addIntegerOption((opt) =>
              opt
                .setName('interval')
                .setDescription('How often to check for alerts, in minutes (default: 60)')
                .setMinValue(15)
                .setMaxValue(1440)
                .setRequired(false)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('news-digest')
            .setDescription('Daily news digest on topics you choose')
            .addChannelOption((opt) =>
              opt
                .setName('channel')
                .setDescription('Channel to post in')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
            )
            .addStringOption((opt) =>
              opt
                .setName('topics')
                .setDescription('Comma-separated topics (e.g. "technology, gaming, science")')
                .setRequired(true)
            )
            .addStringOption((opt) =>
              opt
                .setName('time')
                .setDescription('Time to post each day, HH:MM 24-hour (default: 08:00)')
                .setRequired(false)
            )
            .addStringOption((opt) =>
              opt
                .setName('timezone')
                .setDescription('IANA timezone (e.g. America/Chicago, UTC) — default: UTC')
                .setRequired(false)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('nasa-apod')
            .setDescription("NASA Astronomy Picture of the Day")
            .addChannelOption((opt) =>
              opt
                .setName('channel')
                .setDescription('Channel to post in')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
            )
            .addStringOption((opt) =>
              opt
                .setName('time')
                .setDescription('Time to post each day, HH:MM 24-hour (default: 08:00)')
                .setRequired(false)
            )
            .addStringOption((opt) =>
              opt
                .setName('timezone')
                .setDescription('IANA timezone (e.g. America/Los_Angeles, UTC) — default: UTC')
                .setRequired(false)
            )
        )
    )
    // ─── flat subcommands ───────────────────────────────────────────────
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List all notification subscriptions in this server')
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a subscription by ID')
        .addIntegerOption((opt) =>
          opt.setName('id').setDescription('Subscription ID (from /webhook list)').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('toggle')
        .setDescription('Enable or disable a subscription')
        .addIntegerOption((opt) =>
          opt.setName('id').setDescription('Subscription ID (from /webhook list)').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('test')
        .setDescription('Fire a subscription immediately to test it')
        .addIntegerOption((opt) =>
          opt.setName('id').setDescription('Subscription ID (from /webhook list)').setRequired(true)
        )
    ),

  adminOnly: true,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (interaction.user.id !== OWNER_ID) {
      await interaction.reply({ content: 'This command is restricted to the bot owner.', ephemeral: true });
      return;
    }

    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();

    if (group === 'add') {
      await handleAdd(interaction, subcommand);
    } else {
      switch (subcommand) {
        case 'list':   await handleList(interaction);   break;
        case 'remove': await handleRemove(interaction); break;
        case 'toggle': await handleToggle(interaction); break;
        case 'test':   await handleTest(interaction);   break;
      }
    }
  },
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function validateTime(t: string | null): string {
  if (!t) return '08:00';
  if (/^\d{2}:\d{2}$/.test(t)) return t;
  throw new Error(`Invalid time format "${t}" — use HH:MM (e.g. 08:00)`);
}

// ─── add ──────────────────────────────────────────────────────────────────────

async function handleAdd(
  interaction: ChatInputCommandInteraction,
  subcommand: string
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const channel = interaction.options.getChannel('channel', true);
  const guildId = interaction.guildId!;
  let type: string;
  let config: Record<string, unknown>;

  try {
    switch (subcommand) {
      case 'weather-daily': {
        const location = interaction.options.getString('location', true);
        const time     = validateTime(interaction.options.getString('time'));
        const tz       = interaction.options.getString('timezone') || 'UTC';
        type   = 'weather_daily';
        config = { location, time, tz };
        break;
      }
      case 'weather-alert': {
        const location = interaction.options.getString('location', true);
        const interval = interaction.options.getInteger('interval') ?? 60;
        type   = 'weather_alert';
        config = { location, interval_minutes: interval };
        break;
      }
      case 'news-digest': {
        const rawTopics = interaction.options.getString('topics', true);
        const topics    = rawTopics.split(',').map(t => t.trim()).filter(Boolean);
        const time      = validateTime(interaction.options.getString('time'));
        const tz        = interaction.options.getString('timezone') || 'UTC';
        type   = 'news_digest';
        config = { topics, time, tz };
        break;
      }
      case 'nasa-apod': {
        const time = validateTime(interaction.options.getString('time'));
        const tz   = interaction.options.getString('timezone') || 'UTC';
        type   = 'nasa_apod';
        config = { time, tz };
        break;
      }
      default:
        await interaction.editReply({ content: 'Unknown notification type.' });
        return;
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ content: `Error: ${msg}` });
    return;
  }

  try {
    const result = await webhookApi('POST', '/api/subscriptions', {
      guild_id:   guildId,
      channel_id: channel.id,
      type,
      config,
    }) as { subscription: { id: number } };

    const sub = result.subscription;
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Notification Added')
          .setColor(0x57f287)
          .addFields(
            { name: 'ID',      value: String(sub.id),                   inline: true },
            { name: 'Type',    value: TYPE_LABELS[type] || type,        inline: true },
            { name: 'Channel', value: `<#${channel.id}>`,               inline: true },
            { name: 'Config',  value: `\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\`` },
          )
          .setFooter({ text: 'Use /webhook test <id> to fire it immediately' }),
      ],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Webhook add failed:', err);
    await interaction.editReply({ content: `Failed to add subscription: ${msg}` });
  }
}

// ─── list ─────────────────────────────────────────────────────────────────────

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const result = await webhookApi('GET', `/api/subscriptions?guild_id=${interaction.guildId}`) as { subscriptions: Array<Record<string, unknown>> };
    const subs = result.subscriptions;

    if (subs.length === 0) {
      await interaction.editReply({ content: 'No notification subscriptions configured for this server.' });
      return;
    }

    const lines = subs.map((s) => {
      const config = JSON.parse(s.config as string);
      const enabled = s.enabled ? '🟢' : '🔴';
      const label   = TYPE_LABELS[s.type as string] || s.type;
      const detail  = config.location || config.topics?.join(', ') || '';
      const schedule = config.time ? `@ ${config.time} ${config.tz || 'UTC'}` : (config.interval_minutes ? `every ${config.interval_minutes}m` : '');
      return `**#${s.id}** ${enabled} \`${label}\` → <#${s.channel_id}> ${detail ? `| ${detail}` : ''} ${schedule}`;
    });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Notification Subscriptions (${subs.length})`)
          .setColor(0x2f3136)
          .setDescription(lines.join('\n'))
          .setFooter({ text: 'Use /webhook remove <id> or /webhook toggle <id> to manage' }),
      ],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ content: `Failed to fetch subscriptions: ${msg}` });
  }
}

// ─── remove ───────────────────────────────────────────────────────────────────

async function handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const id = interaction.options.getInteger('id', true);

  try {
    await webhookApi('DELETE', `/api/subscriptions/${id}`);
    await interaction.editReply({ content: `Subscription #${id} removed.` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ content: `Failed to remove subscription: ${msg}` });
  }
}

// ─── toggle ───────────────────────────────────────────────────────────────────

async function handleToggle(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const id = interaction.options.getInteger('id', true);

  try {
    const result = await webhookApi('PATCH', `/api/subscriptions/${id}/toggle`) as { enabled: boolean };
    const status = result.enabled ? 'enabled' : 'disabled';
    await interaction.editReply({ content: `Subscription #${id} is now **${status}**.` });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ content: `Failed to toggle subscription: ${msg}` });
  }
}

// ─── test ─────────────────────────────────────────────────────────────────────

async function handleTest(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const id = interaction.options.getInteger('id', true);

  try {
    const result = await webhookApi('POST', `/api/subscriptions/${id}/test`);
    const sent = result.sent !== false;
    await interaction.editReply({
      content: sent
        ? `Test notification fired for subscription #${id}. Check the configured channel.`
        : `Ran fine, but nothing came back to send for subscription #${id} (e.g. no search results or no new alerts right now) — that's why nothing showed up in the channel.`,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply({ content: `Test failed: ${msg}` });
  }
}
