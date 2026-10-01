const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { CodexReader } = require('../src/codex');
const { activityFor } = require('../src/presence');

test('reports phase, model, elapsed start, token counts, and stays visible when idle', async t => {
  const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-presence-'));
  t.after(() => fs.promises.rm(home, { recursive: true, force: true }));
  const now = Date.now();
  const date = new Date(now);
  const folder = path.join(home, 'sessions', String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0'));
  await fs.promises.mkdir(folder, { recursive: true });
  const file = path.join(folder, 'rollout-test.jsonl');
  const event = (type, payload) => JSON.stringify({ timestamp: new Date(now).toISOString(), type, payload }) + '\n';
  await fs.promises.writeFile(file,
    event('session_meta', { originator: 'Codex Desktop' }) +
    event('event_msg', { type: 'task_started', started_at: new Date(now - 30000).toISOString() }) +
    event('turn_context', { model: 'gpt-6-sol' }) +
    event('response_item', { type: 'custom_tool_call', name: 'functions.exec', input: 'await tools.web__run({})' }) +
    event('token_usage_record', { turn_token_usage: { input_tokens: 1200, output_tokens: 82 } }));
  const reader = new CodexReader(home, { now: () => now });
  const tasks = await reader.poll();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].stage, 'Researching');
  assert.equal(tasks[0].model, 'gpt-6-sol');
  assert.equal(tasks[0].inputTokens, 1200);
  assert.equal(tasks[0].outputTokens, 82);
  assert.equal(tasks[0].startedAt, now - 30000);
  const activity = activityFor(tasks);
  assert.equal(activity.status_display_type, 1);
  assert.equal(activity.details, 'Researching');
  assert.match(activity.state, /Codex · gpt-6-sol · 1.2K in · 82 out/);
  assert.equal(activity.timestamps.start, Math.floor((now - 30000) / 1000));
  assert.match(activity.assets.large_image, /codex-icon-dark\.png$/);

  await fs.promises.appendFile(file, event('event_msg', { type: 'task_complete' }));
  assert.deepEqual(await reader.poll(), []);
  assert.deepEqual(activityFor([]).timestamps, undefined);
  assert.equal(activityFor([]).details, 'Idle');
  assert.equal(activityFor([]).state, 'Idle · 0 tokens · 0m');
  assert.equal(activityFor([], undefined, { visibilityMode: 'active' }), null);
});

test('ignores stale unfinished sessions and counts simultaneous tasks', async t => {
  const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-presence-'));
  t.after(() => fs.promises.rm(home, { recursive: true, force: true }));
  const now = Date.now();
  const date = new Date(now);
  const folder = path.join(home, 'sessions', String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0'));
  await fs.promises.mkdir(folder, { recursive: true });
  for (const [name, age] of [['old', 11 * 60 * 1000], ['one', 0], ['two', 0]]) {
    const file = path.join(folder, `rollout-${name}.jsonl`);
    await fs.promises.writeFile(file, JSON.stringify({ timestamp: new Date(now - age).toISOString(), type: 'event_msg', payload: { type: 'task_started', started_at: new Date(now - age).toISOString() } }) + '\n');
    if (age) await fs.promises.utimes(file, new Date(now - age), new Date(now - age));
  }
  const tasks = await new CodexReader(home, { now: () => now }).poll();
  assert.equal(tasks.length, 2);
  assert.match(activityFor(tasks).state, /2 tasks/);
});

test('uses live Codex database turns and detects when a turn completes', async t => {
  const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'codex-presence-'));
  const now = Date.now();
  const state = new DatabaseSync(path.join(home, 'state_5.sqlite'));
  const history = new DatabaseSync(path.join(home, 'thread_history_1.sqlite'));
  t.after(async () => { state.close(); history.close(); await fs.promises.rm(home, { recursive: true, force: true }); });
  state.exec('CREATE TABLE threads (id TEXT, model TEXT, tokens_used INTEGER, updated_at_ms INTEGER, originator TEXT)');
  history.exec('CREATE TABLE thread_turns (thread_id TEXT, turn_id TEXT, status TEXT, started_at INTEGER)');
  history.exec('CREATE TABLE thread_items (thread_id TEXT, turn_id TEXT, item_id TEXT, item_type TEXT, item_json TEXT, started_at_ms INTEGER, created_at_ms INTEGER)');
  state.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?)').run('thread', 'gpt-6-sol', 23000, now, 'Codex Desktop');
  history.prepare('INSERT INTO thread_turns VALUES (?, ?, ?, ?)').run('thread', 'turn', 'inProgress', Math.floor((now - 45000) / 1000));
  history.prepare('INSERT INTO thread_items VALUES (?, ?, ?, ?, ?, ?, ?)').run('thread', 'turn', 'item', 'webSearch', '{}', now, now);
  const reader = new CodexReader(home, { now: () => now });
  const tasks = await reader.poll();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].stage, 'Researching');
  assert.equal(tasks[0].totalTokens, 23000);
  assert.match(activityFor(tasks).state, /23K thread tokens/);
  history.prepare('UPDATE thread_turns SET status = ? WHERE turn_id = ?').run('completed', 'turn');
  assert.deepEqual(await reader.poll(), []);
});
