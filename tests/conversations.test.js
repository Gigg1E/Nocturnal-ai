const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadGuildConfig, saveGuildConfig } = require('../dist/config/guildConfig');
const diagnostics = require('../dist/services/diagnostics');
const { turnDelay, humanCount } = require('../dist/services/turnTaking');
const ambient = require('../dist/services/casualChat');

const timing = { groupPauseMs: 4000, typingGraceMs: 8000, maxTurnWaitMs: 15000 };
test('group pacing yields for typing, spaces turns, and cannot wait indefinitely', () => {
  const window = { now: 1000, burstStartedAt: 0, lastHumanAt: 1000, lastBotAt: 0, people: 3, typingUntil: 0, direct: false };
  assert.deepEqual(turnDelay(window, timing), { delayMs: 4000, reason: 'quiet_window' });
  assert.deepEqual(turnDelay({ ...window, typingUntil: 9000 }, timing), { delayMs: 8000, reason: 'human_typing' });
  assert.deepEqual(turnDelay({ ...window, lastBotAt: 1000 }, timing), { delayMs: 8000, reason: 'turn_spacing' });
  assert.equal(turnDelay({ ...window, now: 15000, typingUntil: 90000 }, timing).delayMs, 0);
  assert.equal(turnDelay({ ...window, now: 0, lastHumanAt: 0, people: 1, direct: true }, timing).delayMs, 500);
  assert.equal(humanCount([{ author: 'Same', authorId: 'one', ts: 1000 }, { author: 'Same', authorId: 'two', ts: 1000 }], 1000), 2);
});

test('diagnostics persist only approved metadata, isolate guilds, and respect collection settings', () => {
  const secret = 'synthetic private prompt or result';
  const trace = diagnostics.startTrace('logs-a', '123456789012345678', 'answer_machine', '123456789012345679');
  diagnostics.recordDiagnostic(trace, { action: 'decision', reason: 'accepted', heat: 85, score: 9,
    threshold: 4.5, prompt: secret, content: secret, error: secret, tool: secret, emoji: secret, durationMs: NaN });
  const events = diagnostics.recentDiagnostics('logs-a');
  assert.equal(events.length, 1);
  assert.equal(events[0].heat, 85);
  assert.ok(!JSON.stringify(events).includes(secret));
  assert.equal(events[0].durationMs, undefined);
  assert.deepEqual(diagnostics.recentDiagnostics('logs-b'), []);
  const config = loadGuildConfig('logs-a'); config.diagnostics.enabled = false; saveGuildConfig('logs-a', config);
  diagnostics.recordDiagnostic(trace, { action: 'sent', success: true });
  assert.equal(diagnostics.recentDiagnostics('logs-a').length, 1);
  diagnostics.clearDiagnostics('logs-a');
  assert.deepEqual(diagnostics.recentDiagnostics('logs-a'), []);
});

test('diagnostics summarize failed tools without serializing arguments or service error bodies', async () => {
  const { runAgentLoop } = require('../dist/services/chat');
  const original = global.fetch;
  let calls = 0;
  const secret = 'synthetic hidden location';
  global.fetch = async url => String(url).endsWith('/api/chat') ? new Response(JSON.stringify({ message: ++calls === 1
    ? { content: '', tool_calls: [{ function: { name: 'get_weather', arguments: { location: secret } } }] }
    : { content: 'synthetic answer' } })) : new Response(JSON.stringify({ error: secret, success: false }));
  const trace = diagnostics.startTrace('tool-logs', '123456789012345678', 'chat');
  try {
    await runAgentLoop([{ role: 'user', content: secret }], true, undefined, undefined, trace);
    const events = diagnostics.recentDiagnostics('tool-logs');
    const tool = events.find(e => e.action === 'tool');
    assert.equal(tool.tool, 'get_weather'); assert.equal(tool.success, false);
    assert.ok(!JSON.stringify(events).includes(secret));
    assert.ok(diagnostics.formatDiagnostic({ ...tool, action: 'sent' }, events).includes('get_weather · failed'));
  } finally { global.fetch = original; }
});

let fixtureId = 0;
async function conversationFixture(body) {
  const id = ++fixtureId;
  const guildId = `conversation-${id}`, channelId = `1234567890123456${String(id).padStart(2, '0')}`;
  const original = { fetch: global.fetch, now: Date.now, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  let now = 2_000_000, timerId = 0, messageId = 0;
  const timers = new Map(), sent = [], typings = [], messages = new Map(), calls = [];
  const config = loadGuildConfig(guildId);
  config.casualChat.channels = [channelId]; config.casualChat.chattiness = 'talksalot';
  Object.assign(config.casualChat, timing); saveGuildConfig(guildId, config);
  Date.now = () => now;
  global.setTimeout = (callback, delay) => { const timer = ++timerId; timers.set(timer, { callback, at: now + delay }); return timer; };
  global.clearTimeout = id => timers.delete(id);
  const channel = {
    id: channelId, sendTyping: async () => { typings.push(now); },
    send: async content => { const message = { id: String(900000000000000000n + BigInt(sent.length)), content }; sent.push({ at: now, content }); return message; },
    messages: { fetch: async id => { const target = messages.get(id); if (!target) throw new Error('deleted'); return { reply: channel.send, react: async emoji => sent.push({ at: now, emoji }) }; } },
  };
  let decide = () => ({ intent: 'chat', interest: 9, relevance: 9, continuation: true, target: 1 });
  let generate = async () => 'synthetic reply';
  global.fetch = async (url, init) => {
    const request = JSON.parse(init.body); calls.push({ url, request });
    return String(url).endsWith('/api/generate')
      ? new Response(JSON.stringify({ response: JSON.stringify(request.prompt.includes('Classify whether new Discord messages') ? { changesAnswer: request.prompt.includes('human answer arrived') || request.prompt.includes('correction arrived') } : decide(request)) }))
      : new Response(JSON.stringify({ message: { content: await generate(request) } }));
  };
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
  const advance = async ms => {
    now += ms;
    for (let i = 0; i < 30; i++) {
      const due = [...timers].filter(([, timer]) => timer.at <= now);
      if (!due.length) break;
      for (const [id, timer] of due) { timers.delete(id); timer.callback(); }
      await flush();
    }
    await flush();
  };
  const add = (authorId, content, force = false) => {
    const entry = { author: `Person ${authorId}`, authorId, content, ts: now, messageId: String(800000000000000000n + BigInt(++messageId)) };
    messages.set(entry.messageId, entry);
    ambient.recordAmbientMessage(channelId, entry);
    if (force) void ambient.evaluateNow(channelId, guildId, channel, 'Nocturnal', { userId: authorId, messageId: entry.messageId });
    else ambient.scheduleEngagementCheck(channelId, guildId, channel, 'Nocturnal');
    return entry;
  };
  try { await body({ add, advance, flush, sent, typings, calls, channelId, guildId,
    typing: user => ambient.recordHumanTyping(channelId, user),
    setDecision: fn => { decide = fn; }, setGeneration: fn => { generate = fn; },
    events: () => diagnostics.recentDiagnostics(guildId, 1000), now: () => now }); }
  finally {
    ambient.cancelPendingEngagement(channelId);
    global.fetch = original.fetch; Date.now = original.now; global.setTimeout = original.setTimeout; global.clearTimeout = original.clearTimeout;
  }
}

test('multiple human messages share a turn, typing postpones generation, and bot typing waits until delivery', async () => {
  await conversationFixture(async f => {
    f.add('alice', 'first question'); f.add('bob', 'related point');
    await f.advance(100); assert.equal(f.calls.length, 0); assert.equal(f.typings.length, 0);
    f.typing('carol'); await f.advance(4000);
    assert.equal(f.calls.length, 0); assert.equal(f.typings.length, 0);
    f.add('carol', 'relevant newcomer'); await f.advance(4000);
    assert.equal(f.sent.length, 1); assert.equal(f.typings.length, 1);
    assert.ok(f.events().some(e => e.reason === 'human_typing'));
  });
});

test('relevant newcomer bypasses partner-only fairness while post-turn spacing still applies', async () => {
  await conversationFixture(async f => {
    f.add('alice', 'opening'); f.add('bob', 'another point'); await f.advance(4000);
    assert.equal(f.sent.length, 1);
    f.add('carol', 'same discussion from a newcomer'); await f.advance(4000);
    assert.equal(f.sent.length, 1);
    await f.advance(4000); assert.equal(f.sent.length, 2);
    const decision = f.events().find(e => e.action === 'decision');
    assert.equal(decision.continuation, true); assert.equal(decision.participants, 3);
    assert.ok(f.calls.filter(c => c.url.endsWith('/api/chat')).every(c => c.request.messages[0].content.includes('Respond specifically to NEW line')));
  });
});

test('two directly addressed requests survive batching and receive distinct spaced turns', async () => {
  await conversationFixture(async f => {
    const one = f.add('alice', 'direct request one', true);
    const two = f.add('bob', 'direct request two', true);
    await f.advance(4000); assert.equal(f.sent.length, 1);
    await f.advance(8000); assert.equal(f.sent.length, 2);
    const targets = f.events().filter(e => e.action === 'sent').map(e => e.targetMessageId);
    assert.ok(targets.includes(one.messageId)); assert.ok(targets.includes(two.messageId));
  });
});

test('new messages during generation discard the draft and re-evaluate the combined conversation', async () => {
  await conversationFixture(async f => {
    let release;
    f.setGeneration(() => new Promise(resolve => { release = resolve; }));
    f.add('alice', 'question'); f.add('bob', 'discussion'); await f.advance(4000);
    assert.ok(release); assert.equal(f.typings.length, 0);
    f.add('carol', 'human answer arrived'); release('obsolete draft'); await f.flush();
    assert.equal(f.sent.length, 0); assert.ok(f.events().some(e => e.reason === 'stale_context'));
    f.setGeneration(async () => 'fresh combined reply'); await f.advance(4000);
    assert.equal(f.sent.length, 1); assert.equal(f.sent[0].content, 'fresh combined reply');
  });
});

test('typing after generation starts also postpones posting and preserves the request', async () => {
  await conversationFixture(async f => {
    let release;
    f.setGeneration(() => new Promise(resolve => { release = resolve; }));
    f.add('alice', 'question', true); f.add('bob', 'context'); await f.advance(500);
    f.typing('carol'); release('draft'); await f.flush();
    assert.equal(f.sent.length, 0); assert.equal(f.typings.length, 0);
    f.setGeneration(async () => 'reply after typing grace'); await f.advance(8000);
    assert.equal(f.sent.length, 1);
  });
});

test('disabling Answer Machine while a draft is generated prevents delivery', async () => {
  await conversationFixture(async f => {
    let release; f.setGeneration(() => new Promise(resolve => { release = resolve; }));
    f.add('alice', 'question', true); await f.advance(500);
    const config = loadGuildConfig(f.guildId); config.casualChat.channels = []; saveGuildConfig(f.guildId, config);
    release('draft'); await f.flush(); assert.equal(f.sent.length, 0);
    assert.ok(f.events().some(e => e.reason === 'mode_disabled'));
  });
});

test('continuous typing expires an optional turn at its bounded window', async () => {
  await conversationFixture(async f => {
    f.add('alice', 'question'); f.add('bob', 'context');
    for (let i = 0; i < 14; i++) { f.typing('carol'); await f.advance(1000); }
    assert.equal(f.sent.length, 0);
    f.typing('carol'); await f.advance(1000); assert.equal(f.sent.length, 0);
    assert.ok(f.events().some(e => e.reason === 'contribution_expired'));
  });
});

test('typing gateway handler ignores bots while accepting human typing', async () => {
  const { createClient } = require('../dist/bot/client');
  const { Events } = require('discord.js');
  const client = createClient();
  try {
    await conversationFixture(async f => {
      f.add('alice', 'question'); f.add('bob', 'context');
      client.emit(Events.TypingStart, { user: { id: 'synthetic-bot', bot: true }, channel: { id: f.channelId } });
      await f.advance(4000); assert.equal(f.sent.length, 1);
      f.add('alice', 'follow-up');
      client.emit(Events.TypingStart, { user: { id: 'carol', bot: false }, channel: { id: f.channelId } });
      await f.advance(4000); assert.equal(f.sent.length, 1);
      await f.advance(4000); assert.equal(f.sent.length, 2);
    });
  } finally { await client.destroy(); }
});

test('reaction diagnostics show the emoji and target without message content', async () => {
  await conversationFixture(async f => {
    f.setDecision(() => ({ intent: 'react', interest: 10, relevance: 8, continuation: true, emoji: '😂', target: 1 }));
    const target = f.add('alice', 'private synthetic funny message'); f.add('bob', 'context');
    await f.advance(4000);
    const reaction = f.events().find(e => e.action === 'reacted');
    assert.equal(reaction.emoji, '😂'); assert.equal(reaction.targetMessageId, target.messageId);
    assert.ok(!JSON.stringify(f.events()).includes('private synthetic funny message'));
  });
});

test('diagnostic controls require Administrator and every recent response stays ephemeral', async () => {
  const { diagnosticsCommand } = require('../dist/bot/commands/diagnostics');
  const { PermissionFlagsBits } = require('discord.js');
  let denied;
  await diagnosticsCommand.execute({ guildId: 'admin-logs', memberPermissions: { has: () => false }, reply: async options => { denied = options; } });
  assert.equal(denied.ephemeral, true);
  const trace = diagnostics.startTrace('admin-logs', '123456789012345678', 'chat');
  diagnostics.recordDiagnostic(trace, { action: 'sent', success: true });
  diagnostics.recordDiagnostic(trace, { action: 'skipped', reason: 'low_score' });
  let deferred;
  const followups = [];
  await diagnosticsCommand.execute({ guildId: 'admin-logs', memberPermissions: { has: flag => flag === PermissionFlagsBits.Administrator },
    options: { getSubcommand: () => 'recent', getBoolean: () => false },
    deferReply: async options => { deferred = options; }, editReply: async () => {}, followUp: async options => { followups.push(options); } });
  assert.equal(deferred.ephemeral, true);
  assert.equal(followups.length, 1); assert.ok(followups.every(options => options.ephemeral === true));
});

test('opt-in diagnostic delivery fetches channels through the correct guild and disables pings', async () => {
  const { initializeDiagnosticChannels } = require('../dist/services/diagnosticChannels');
  const sent = [];
  initializeDiagnosticChannels({ guilds: { cache: new Map([
    ['delivery-a', { channels: { fetch: async id => ({ isTextBased: () => true, send: async payload => sent.push({ guild: 'delivery-a', channel: id, payload }) }) } }],
    ['delivery-b', { channels: { fetch: async id => ({ isTextBased: () => true, send: async payload => sent.push({ guild: 'delivery-b', channel: id, payload }) }) } }],
  ]) } });
  try {
    const config = loadGuildConfig('delivery-a'); config.diagnostics.channelId = '123456789012345678'; saveGuildConfig('delivery-a', config);
    diagnostics.recordDiagnostic(diagnostics.startTrace('delivery-a', '123456789012345679', 'chat'), { action: 'sent', success: true }, true);
    diagnostics.recordDiagnostic(diagnostics.startTrace('delivery-b', '123456789012345680', 'chat'), { action: 'sent', success: true }, true);
    for (let i = 0; i < 3; i++) await new Promise(setImmediate);
    assert.equal(sent.length, 1); assert.equal(sent[0].guild, 'delivery-a');
    assert.deepEqual(sent[0].payload.allowedMentions.parse, []);
  } finally { diagnostics.setDiagnosticPublisher(undefined); }
});

test('mention and reply chat paths record model and generation metadata without transcript text', async () => {
  const queries = require('../dist/database/queries');
  const personality = require('../dist/services/personality');
  const { processMessage, processReply } = require('../dist/services/chat');
  const saved = { fetch: global.fetch, check: queries.checkRateLimit, update: queries.updateRateLimit, usage: queries.trackUsage, prompt: personality.getEffectiveSystemPrompt };
  queries.checkRateLimit = () => ({ allowed: true }); queries.updateRateLimit = () => {}; queries.trackUsage = () => {};
  personality.getEffectiveSystemPrompt = () => 'synthetic system prompt';
  global.fetch = async () => new Response(JSON.stringify({ message: { content: 'private synthetic response' } }));
  const message = { guildId: 'chat-diagnostics', author: { id: 'alice' }, id: '123456789012345679',
    channel: { id: '123456789012345678' }, attachments: { filter: () => ({ size: 0 }) } };
  try {
    const mention = await processMessage(message, 'private synthetic request');
    const reply = await processReply(message, { content: 'private original text', author: { bot: false, username: 'bob' } }, 'private synthetic followup');
    assert.equal(mention.success, true); assert.equal(reply.success, true);
    const events = diagnostics.recentDiagnostics('chat-diagnostics', 100);
    assert.equal(events.filter(e => e.action === 'model').length, 2);
    assert.equal(events.filter(e => e.action === 'generated').length, 2);
    assert.ok(events.every(e => e.mode === 'chat'));
    assert.ok(!JSON.stringify(events).includes('private synthetic'));
    assert.ok(!JSON.stringify(events).includes('private original'));
  } finally {
    global.fetch = saved.fetch; queries.checkRateLimit = saved.check; queries.updateRateLimit = saved.update;
    queries.trackUsage = saved.usage; personality.getEffectiveSystemPrompt = saved.prompt;
  }
});

test('server timing can disable typing and keep independent spacing beyond the wait cap', () => {
  const w = { now: 10000, burstStartedAt: 0, lastHumanAt: 0, lastBotAt: 1000, people: 2, typingUntil: 99000, direct: false };
  assert.equal(turnDelay(w, { ...timing, typingProtection: false, groupPauseMs: 0, turnSpacingMs: 0 }).delayMs, 0);
  assert.deepEqual(turnDelay(w, { ...timing, typingProtection: false, turnSpacingMs: 30000 }), { delayMs: 21000, reason: 'turn_spacing' });
  const { parseSetting } = require('../dist/config/validation');
  assert.equal(parseSetting('casualChat.typingProtection','false'), false);
  assert.equal(parseSetting('casualChat.turnSpacingMs','30000'), 30000);
  assert.throws(() => parseSetting('casualChat.typingProtection','maybe'));
});

test('heat varies contextual scoring without converting model opt-outs to responses', () => {
  const { shouldEngage, levelParams } = require('../dist/services/conversationHeat');
  const p = levelParams(100);
  const low = shouldEngage('chat', 3, p, 1, 3, 0, 0, false, 1, 0);
  const high = shouldEngage('chat', 3, p, 1, 3, 0, 0, false, 1, 100);
  assert.ok(high.score > low.score);
  assert.equal(shouldEngage('none',0,p,1,10,0,0,false,1,100).engage, false);
});

test('Answer Machine panel validates numeric settings atomically and enforces admin permissions', async () => {
  const { handleAnswerMachine, answerPanel, answerMachineCommand } = require('../dist/bot/commands/answerMachine');
  assert.equal(answerMachineCommand.data.toJSON().name, 'answer-machine');
  answerPanel('panel-test').components[0].toJSON();
  let reply, updated;
  const base = { guildId:'panel-test', memberPermissions:{has:()=>true}, isStringSelectMenu:()=>false, isChannelSelectMenu:()=>false, isFromMessage:()=>true, customId:'am_modal:timing', reply:async p=>{reply=p}, update:async p=>{updated=p} };
  await handleAnswerMachine({...base,memberPermissions:{has:()=>false}});
  assert.match(reply.content,/Administrator/);
  const before = loadGuildConfig('panel-test').casualChat.groupPauseMs;
  await handleAnswerMachine({...base,fields:{getTextInputValue:k=>k==='maxTurnWaitMs'?'invalid':'12'}});
  assert.equal(loadGuildConfig('panel-test').casualChat.groupPauseMs,before);
  await handleAnswerMachine({...base,fields:{getTextInputValue:k=>({groupPauseMs:'2.5',turnSpacingMs:'20',typingGraceMs:'5',maxTurnWaitMs:'30'})[k]}});
  assert.equal(loadGuildConfig('panel-test').casualChat.turnSpacingMs,20000);
  assert.ok(updated);
  await handleAnswerMachine({...base,customId:'am_modal:heat',fields:{getTextInputValue:()=> '81'}});
  assert.equal(require('../dist/config/guildConfig').resolveHeat(loadGuildConfig('panel-test')),81);
  await handleAnswerMachine({...base,customId:'am_modal:heat',fields:{getTextInputValue:()=> '101'}});
  assert.match(reply.content,/0 to 100/);
});

test('heat and timing menus serialize valid Discord modal payloads', async () => {
  const { handleAnswerMachine } = require('../dist/bot/commands/answerMachine');
  for (const value of ['heat','timing']) {
    let payload;
    await handleAnswerMachine({guildId:'modal-test',memberPermissions:{has:()=>true},isStringSelectMenu:()=>true,values:[value],showModal:async modal=>{payload=modal.toJSON()}});
    assert.equal(payload.components.length,value === 'heat' ? 1 : 4);
  }
  const { helpPanel } = require('../dist/bot/commands/help');
  helpPanel('answer').components[0].toJSON();
});

test('unrelated chatter during generation does not cancel a direct answer', async () => {
  await conversationFixture(async f => {
    let release; f.setGeneration(()=>new Promise(resolve=>{release=resolve}));
    const target=f.add('alice','direct question',true); f.add('bob','background'); await f.advance(500);
    f.add('carol','unrelated chatter'); release('answer to target'); await f.flush();
    assert.equal(f.sent.length,1);
    assert.equal(f.sent[0].content,'answer to target');
    assert.ok(f.events().some(e=>e.action==='sent' && e.targetMessageId===target.messageId));
    assert.ok(f.events().some(e=>e.reason==='unrelated_chatter'));
  });
});

test('continuous typing cannot starve a directly addressed request', async () => {
  await conversationFixture(async f => {
    f.add('alice','direct question',true); f.add('bob','background');
    for(let i=0;i<3;i++){ f.typing('carol'); await f.advance(1000); }
    assert.equal(f.sent.length,1);
  });
});

test('repeated relevant revisions keep a direct target pending beyond the old retry limit', async () => {
  await conversationFixture(async f => {
    let release; f.setGeneration(()=>new Promise(resolve=>{release=resolve}));
    f.add('alice','direct question',true); await f.advance(500);
    for(let i=0;i<3;i++) {
      assert.ok(release); f.add('alice',`correction arrived ${i}`); release('outdated'); await f.flush();
      assert.equal(f.sent.length,0); await f.advance(100);
    }
    release('corrected answer'); await f.flush();
    assert.equal(f.sent.length,1);
  });
});
