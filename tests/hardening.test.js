const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = process.cwd();
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nocturnal-tests-'));
fs.copyFileSync(path.join(root, 'config.json'), path.join(scratch, 'config.json'));
process.chdir(scratch);
const guild = require('../dist/config/guildConfig');
const { parseSetting } = require('../dist/config/validation');
const { boundedFetch } = require('../dist/utils/http');
const memory = require('../dist/services/memory');
const { maybeExtractMemory } = require('../dist/services/memoryExtractor');
after(() => {
  require('../dist/database/schema').closeDatabase();
  process.chdir(root);
  fs.rmSync(scratch, { recursive: true, force: true });
});

test('blacklist, channel arrays, and partial saved configs stay isolated between guilds', () => {
  guild.addToBlacklist('synthetic-a', 'synthetic-user');
  guild.addAllowedChannel('synthetic-a', 'synthetic-channel');
  assert.equal(guild.isUserBlacklisted('synthetic-b', 'synthetic-user'), false);
  assert.deepEqual(guild.loadGuildConfig('synthetic-b').channels.allowed, []);
  const folder = path.join(scratch, 'data/guilds/synthetic-partial');
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'config.json'), JSON.stringify({ tools: { enabled: false } }));
  guild.addToBlacklist('synthetic-partial', 'another-user');
  assert.deepEqual(guild.DEFAULT_GUILD_CONFIG.users.blacklist, []);
  assert.equal(guild.loadGuildConfig('synthetic-partial').tools.enabled, false);
});

test('config rejects invalid numbers, malformed booleans, and unsupported settings', () => {
  for (const value of ['0', '-1', 'Infinity', '1.5', '2garbage', '']) assert.throws(() => parseSetting('bot.maxChatsPerUser', value));
  assert.equal(parseSetting('bot.maxChatsPerUser', '2'), 2);
  assert.throws(() => parseSetting('tools.enabled', 'yes'));
  assert.equal(parseSetting('tools.enabled', ' FALSE '), false);
  assert.throws(() => parseSetting('bot.maxResponseLength', '2001'));
  assert.throws(() => parseSetting('logging.level', 'anything'));
});

test('deadline remains active while a response body is read and preserves caller cancellation', async () => {
  const original = global.fetch;
  const keepAlive = setInterval(() => {}, 1000);
  global.fetch = async (url, init) => ({ json: () => new Promise((resolve, reject) => {
    if (init.signal.aborted) return reject(init.signal.reason);
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  }) });
  try {
    const response = await boundedFetch('http://synthetic.test', {}, 20);
    await assert.rejects(response.json());
    const controller = new AbortController();
    const cancelled = await boundedFetch('http://synthetic.test', { signal: controller.signal }, 1000);
    controller.abort();
    await assert.rejects(cancelled.json());
  } finally { clearInterval(keepAlive); global.fetch = original; }
});

test('pending extraction cannot restore cleared memory or overwrite a moved slot', async (t) => {
  const schema = require('../dist/database/schema');
  const originalDatabase = schema.getDatabase;
  let fallback;
  try { schema.getDatabase(); } catch (error) {
    if (!error.message.includes('bindings file')) throw error;
    // Still exercise the real memory SQL when the environment's native addon
    // cannot load. Native better-sqlite3 integration remains a deployment check.
    const { DatabaseSync } = require('node:sqlite');
    fallback = new DatabaseSync(':memory:');
    fallback.exec('CREATE TABLE user_memory (user_id TEXT, slot INTEGER, fact TEXT, updated_at TEXT, PRIMARY KEY(user_id, slot))');
    schema.getDatabase = () => ({
      prepare: sql => fallback.prepare(sql),
      transaction: fn => () => {
        fallback.exec('BEGIN');
        try { fn(); fallback.exec('COMMIT'); } catch (error) { fallback.exec('ROLLBACK'); throw error; }
      },
    });
    t.diagnostic('Using Node in-memory SQLite because the native addon is unavailable; native deployment integration remains unverified.');
  }
  const originalFetch = global.fetch;
  let release;
  global.fetch = () => new Promise(resolve => { release = line => resolve(new Response(JSON.stringify({ response: line }))); });
  try {
    const pending = maybeExtractMemory('synthetic-memory', 'My dog is called Rex');
    memory.clearUserMemory('synthetic-memory');
    release('NEW: Has a dog named Rex');
    await pending;
    assert.deepEqual(memory.getUserMemoryFacts('synthetic-memory'), []);
    memory.recordMemoryFact('synthetic-memory', 'Has a dog named Rex');
    const update = maybeExtractMemory('synthetic-memory', 'My dog is called Max now');
    memory.recordMemoryFact('synthetic-memory', 'Likes hiking');
    release('UPDATE 1: Has a dog named Max');
    await update;
    assert.deepEqual(memory.getUserMemoryFacts('synthetic-memory').map(f => f.fact), ['Likes hiking', 'Has a dog named Rex']);
  } finally { global.fetch = originalFetch; schema.getDatabase = originalDatabase; fallback?.close(); }
});

test('formatter honors per-server length without splitting forever on bad legacy limits', () => {
  const { buildOutgoingMessages } = require('../dist/ollama/formatter');
  const parts = buildOutgoingMessages([{ text: 'word '.repeat(120) }], 150);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => part.content.length <= 150));
  assert.ok(buildOutgoingMessages([{ text: 'hello' }], 0).length > 0);
});

test('renderer escapes generated HTML, blocks network, and uses sandboxed local Mermaid', async () => {
  const { chromium } = require('playwright');
  const originalLaunch = chromium.launch;
  let html, routeHandler, launches = 0;
  const png = Buffer.from('synthetic-png');
  const page = {
    route: async (pattern, handler) => { assert.equal(pattern, '**/*'); routeHandler = handler; },
    setViewportSize: async () => {},
    setContent: async content => { html = content; },
    addScriptTag: async options => assert.ok(fs.existsSync(options.path)),
    evaluate: async (fn, options) => { if (options) assert.equal(options.securityLevel, 'strict'); },
    waitForSelector: async () => {}, waitForTimeout: async () => {},
    $: async () => ({ screenshot: async () => png }), close: async () => {},
  };
  chromium.launch = async options => {
    launches++;
    assert.equal(options.chromiumSandbox, true);
    return { newPage: async () => page, close: async () => {} };
  };
  const renderer = require('../dist/services/mermaid');
  try {
    assert.deepEqual(await renderer.renderMermaidToImage('graph TD; A["<img src=http://127.0.0.1/example>"]'), png);
    assert.ok(html.includes('&lt;img src=http://127.0.0.1/example&gt;'));
    assert.ok(!html.includes('<img'));
    let blocked = false;
    await routeHandler({ abort: () => { blocked = true; } });
    assert.equal(blocked, true);
    await renderer.renderTableToImage('| Name |\n| --- |\n| <img src=http://127.0.0.1/example> |');
    assert.ok(!html.includes('<img'));
    assert.equal(launches, 1);
  } finally { await renderer.closeBrowser(); chromium.launch = originalLaunch; }
});

test('malformed tool JSON consumes failure budget and yields a usable fallback', async () => {
  const { runAgentLoop } = require('../dist/services/chat');
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => new Response(JSON.stringify({ message: ++calls <= 3
    ? { content: '', tool_calls: [{ function: { name: 'search_web', arguments: '{broken' } }] }
    : { content: 'Fallback answer' } }));
  try {
    assert.equal(await runAgentLoop([{ role: 'user', content: 'Synthetic request' }], true), 'Fallback answer');
    assert.equal(calls, 4);
  } finally { global.fetch = originalFetch; }
});

test('model-proposed tools never call external endpoints when disabled', async () => {
  const { runAgentLoop } = require('../dist/services/chat');
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async url => {
    assert.ok(String(url).endsWith('/api/chat'));
    return new Response(JSON.stringify({ message: ++calls <= 3
      ? { content: '', tool_calls: [{ function: { name: 'search_web', arguments: { query: 'synthetic' } } }] }
      : { content: 'Offline answer' } }));
  };
  try { assert.equal(await runAgentLoop([{ role: 'user', content: 'Synthetic request' }], false), 'Offline answer'); }
  finally { global.fetch = originalFetch; }
});

test('logging settings change active transports and level', () => {
  const { configureLogging, logger } = require('../dist/utils/logger');
  configureLogging({ level: 'warn', logToFile: false, logDirectory: path.join(scratch, 'should-not-exist') });
  assert.equal(logger.level, 'warn');
  assert.equal(logger.transports.length, 1);
  assert.equal(fs.existsSync(path.join(scratch, 'should-not-exist')), false);
});

test('public guard rejects staged private files and credentials without echoing values', async () => {
  const run = require('node:util').promisify(require('node:child_process').execFile);
  const repo = path.join(scratch, 'guard-fixture');
  fs.mkdirSync(repo);
  const git = (...args) => run('git', args, { cwd: repo });
  await git('init', '-q');
  const guard = path.join(root, 'scripts/check-public.js');
  fs.writeFileSync(path.join(repo, 'safe.txt'), 'synthetic public text');
  await git('add', 'safe.txt');
  await run(process.execPath, [guard], { cwd: repo });
  fs.writeFileSync(path.join(repo, '.env.production'), 'placeholder');
  await git('add', '-f', '.env.production');
  await assert.rejects(run(process.execPath, [guard], { cwd: repo }), error => error.code === 1);
  await git('rm', '--cached', '.env.production');
  const credential = 'ghp_' + 'A'.repeat(36);
  fs.writeFileSync(path.join(repo, 'config.txt'), credential);
  await git('add', 'config.txt');
  await assert.rejects(run(process.execPath, [guard], { cwd: repo }), error => {
    assert.equal(error.code, 1);
    assert.ok(!error.stderr.includes(credential));
    return true;
  });
});
