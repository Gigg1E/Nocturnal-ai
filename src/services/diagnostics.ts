import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { loadGuildConfig } from '../config/guildConfig';
import { logger } from '../utils/logger';

export type DiagnosticAction = 'decision' | 'wait' | 'model' | 'tool' | 'generated' | 'sent' | 'reacted' | 'skipped' | 'error';
export interface DiagnosticTrace { guildId: string; channelId: string; messageId?: string; mode: 'chat' | 'answer_machine'; requestId: string; startedAt: number }
export interface DiagnosticData {
  action: DiagnosticAction;
  reason?: string;
  durationMs?: number;
  responseMs?: number;
  heat?: number;
  preset?: string;
  intent?: string;
  score?: number;
  threshold?: number | null;
  interest?: number;
  bonus?: number;
  momentum?: number;
  penalty?: number;
  relevance?: number;
  momentumWeight?: number;
  bonusWeight?: number;
  imageWeight?: number;
  continuationWeight?: number;
  imageBoost?: number;
  jitter?: number;
  participants?: number;
  direct?: boolean;
  continuation?: boolean;
  success?: boolean;
  tool?: string;
  model?: string;
  emoji?: string;
  targetMessageId?: string;
}
export interface DiagnosticEvent extends DiagnosticData { requestId: string; mode: DiagnosticTrace['mode']; channelId: string; messageId?: string; timestamp: number }
const ACTIONS = new Set<DiagnosticAction>(['decision', 'wait', 'model', 'tool', 'generated', 'sent', 'reacted', 'skipped', 'error']);
const REASONS = new Set(['quiet_window', 'human_typing', 'turn_spacing', 'cooldown', 'fair_share', 'contribution_expired', 'relevant_change', 'unrelated_chatter', 'low_score', 'model_opt_out', 'chat_disabled', 'no_target', 'no_emoji', 'invalid_decision', 'stale_context', 'target_deleted', 'mode_disabled', 'empty_output', 'timeout', 'request_failed', 'tool_failed', 'invalid_arguments', 'tools_disabled', 'rate_limited', 'long_form', 'generation_complete', 'delivery_complete', 'reaction_complete', 'direct', 'accepted', 'budget', 'buffer_expired']);
const TOOLS = new Set(['search_web', 'get_weather', 'get_current_time', 'get_timezone', 'geocode_location', 'reverse_geocode', 'crypto_price']);
const RETENTION_MS = 7 * 24 * 60 * 60_000;
const MAX_EVENTS = 1000;
let publisher: ((guildId: string, channelId: string, content: string) => Promise<void>) | undefined;
export function setDiagnosticPublisher(fn: typeof publisher): void { publisher = fn; }
export function startTrace(guildId: string, channelId: string, mode: DiagnosticTrace['mode'], messageId?: string): DiagnosticTrace {
  return { guildId, channelId, mode, messageId, requestId: randomUUID(), startedAt: Date.now() };
}
export function errorReason(error: unknown): string {
  const name = (error as { name?: string })?.name;
  return name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'request_failed';
}
function filePath(guildId: string): string {
  if (!/^[\w-]{1,64}$/.test(guildId)) throw new Error('Invalid guild identifier');
  return path.join(process.cwd(), 'data', 'guilds', guildId, 'diagnostics.json');
}
export function recentDiagnostics(guildId: string, limit = 10, failuresOnly = false): DiagnosticEvent[] {
  try {
    const events = JSON.parse(fs.readFileSync(filePath(guildId), 'utf8')) as DiagnosticEvent[];
    return events.filter(e => e.timestamp > Date.now() - RETENTION_MS && (!failuresOnly || e.action === 'error' || e.success === false))
      .slice(-Math.max(1, Math.min(1000, limit))).reverse();
  } catch { return []; }
}
export function clearDiagnostics(guildId: string): void {
  try { fs.unlinkSync(filePath(guildId)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
}
// Only explicitly listed scalar fields reach storage or Discord. Never serialize
// prompts, model responses, arguments/results, URLs from tools, or error bodies.
export function recordDiagnostic(trace: DiagnosticTrace | undefined, data: DiagnosticData, publish = false): void {
  if (!trace || trace.guildId === 'dm' || !ACTIONS.has(data.action)) return;
  try {
    const config = loadGuildConfig(trace.guildId).diagnostics;
    if (!config.enabled) return;
    const event: DiagnosticEvent = { action: data.action, requestId: trace.requestId, mode: trace.mode, channelId: trace.channelId, messageId: trace.messageId, timestamp: Date.now() };
    for (const key of ['durationMs', 'responseMs', 'heat', 'score', 'interest', 'bonus', 'momentum', 'penalty', 'relevance', 'imageBoost', 'jitter', 'participants', 'momentumWeight', 'bonusWeight', 'imageWeight', 'continuationWeight'] as const) {
      if (typeof data[key] === 'number' && Number.isFinite(data[key])) event[key] = Math.round(data[key]! * 100) / 100;
    }
    if (data.threshold === null || (typeof data.threshold === 'number' && Number.isFinite(data.threshold))) event.threshold = data.threshold;
    for (const key of ['success', 'direct', 'continuation'] as const) if (typeof data[key] === 'boolean') event[key] = data[key];
    if (REASONS.has(data.reason ?? '')) event.reason = data.reason;
    if (TOOLS.has(data.tool ?? '')) event.tool = data.tool;
    if (['none', 'answer', 'correct', 'react', 'chat'].includes(data.intent ?? '')) event.intent = data.intent;
    if (['low', 'medium', 'high', 'talksalot', 'custom'].includes(data.preset ?? '')) event.preset = data.preset;
    if (data.model && /^[\w:./-]{1,100}$/.test(data.model)) event.model = data.model;
    if (data.targetMessageId && /^\d{17,20}$/.test(data.targetMessageId)) event.targetMessageId = data.targetMessageId;
    if (data.emoji && (/^<a?:\w{2,32}:\d{17,20}>$/.test(data.emoji) || /^[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f]{1,32}$/u.test(data.emoji))) event.emoji = data.emoji;
    const file = filePath(trace.guildId);
    const events = recentDiagnostics(trace.guildId, MAX_EVENTS).reverse();
    events.push(event);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(events.slice(-MAX_EVENTS)));
    fs.renameSync(temporary, file);
    if (publish && config.channelId && publisher) {
      const related = events.filter(e => e.requestId === trace.requestId);
      void publisher(trace.guildId, config.channelId, formatDiagnostic(event, related)).catch(() => logger.warn('Diagnostic channel delivery failed'));
    }
  } catch { logger.warn('Diagnostic event could not be recorded'); }
}
export function formatDiagnostic(event: DiagnosticEvent, related: DiagnosticEvent[] = []): string {
  const decision = [...related].reverse().find(e => e.action === 'decision') ?? event;
  const lines = [`**${event.mode === 'answer_machine' ? 'Answer Machine' : 'Chat'} · ${event.action}** · \`${event.requestId.slice(0, 8)}\``, `<#${event.channelId}> · ${event.reason ?? 'activity'}${event.success === false ? ' · failed' : ''}`];
  if (decision.heat !== undefined) lines.push(`Heat: ${decision.preset} (${decision.heat}) · intent: ${decision.intent ?? 'none'}`);
  if (decision.momentumWeight !== undefined) lines.push(`Weights: momentum ${decision.momentumWeight} · bonus ${decision.bonusWeight} · image ${decision.imageWeight} · continuation ${decision.continuationWeight}`);
  if (decision.score !== undefined) lines.push(`Score ${decision.score} / ${decision.threshold ?? 'n/a'} · interest ${decision.interest ?? 0} · bonus ${decision.bonus ?? 0} · momentum ${decision.momentum ?? 0} · penalty ${decision.penalty ?? 0} · relevance ${decision.relevance ?? 0} · image boost ${decision.imageBoost ?? 0} · jitter ${decision.jitter ?? 0}`);
  if (decision.participants !== undefined) lines.push(`Active people: ${decision.participants} · direct: ${decision.direct ?? false} · relevant follow-up: ${decision.continuation ?? false}`);
  if (event.durationMs !== undefined) lines.push(`${event.action === 'wait' ? 'Scheduled wait' : 'Processing'}: ${(event.durationMs / 1000).toFixed(2)}s`);
  if (event.responseMs !== undefined) lines.push(`Since target message: ${(event.responseMs / 1000).toFixed(2)}s`);
  if (event.emoji) lines.push(`Reaction: ${event.emoji}`);
  const target = event.targetMessageId ?? decision.targetMessageId ?? event.messageId;
  if (/^\d{17,20}$/.test(target ?? '')) lines.push(`Target message ID: \`${target}\``);
  const models = related.filter(e => e.action === 'model');
  if (models.length) lines.push(`Model: ${models[models.length - 1].model ?? 'configured'} · ${models.length} call(s) · ${(models.reduce((total, e) => total + (e.durationMs ?? 0), 0) / 1000).toFixed(2)}s · ${models.some(e => e.success === false) ? 'failure recorded' : 'ok'}`);
  const contextCheck = [...models].reverse().find(e => e.reason === 'relevant_change' || e.reason === 'unrelated_chatter');
  if (contextCheck) lines.push(`Context check: ${contextCheck.reason}`);
  const tools = related.filter(e => e.action === 'tool');
  for (const tool of tools.slice(-8)) lines.push(`Tool: ${tool.tool ?? 'unrecognized'} · ${tool.success ? 'ok' : 'failed'} · ${((tool.durationMs ?? 0) / 1000).toFixed(2)}s · ${tool.reason ?? 'accepted'}`);
  if (event.action === 'tool' && !tools.length) lines.push(`Tool: ${event.tool ?? 'unrecognized'} · ${event.success ? 'ok' : 'failed'}`);
  return lines.join('\n').slice(0, 1900);
}
