import { Client } from 'discord.js';
import { loadGuildConfig } from '../config/guildConfig';
import { setDiagnosticPublisher } from './diagnostics';

// Keep log delivery bounded and independent of conversational responses.
export function initializeDiagnosticChannels(client: Client): void {
  const queues = new Map<string, { channelId: string; pending: string[]; busy: boolean }>();
  setDiagnosticPublisher(async (guildId, channelId, content) => {
    let queue = queues.get(guildId);
    if (!queue) { queue = { channelId, pending: [], busy: false }; queues.set(guildId, queue); }
    if (queue.channelId !== channelId) { queue.channelId = channelId; queue.pending = []; }
    if (queue.pending.length < 50) queue.pending.push(content);
    if (queue.busy) return;
    queue.busy = true;
    try {
      while (queue.pending.length) {
        const current = loadGuildConfig(guildId).diagnostics;
        if (!current.enabled || current.channelId !== queue.channelId) { queue.pending = []; break; }
        const guild = client.guilds.cache.get(guildId);
        const channel = await guild?.channels.fetch(queue.channelId);
        if (!channel?.isTextBased() || !('send' in channel)) { queue.pending = []; break; }
        const next = queue.pending.shift()!;
        await channel.send({ content: next, allowedMentions: { parse: [], repliedUser: false } });
      }
    } finally { queue.busy = false; queues.delete(guildId); }
  });
}
