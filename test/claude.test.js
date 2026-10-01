const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { ClaudeReader, recordClaudeEvent, installClaudeHooks } = require('../src/claude');
const { activityFor } = require('../src/presence');

test('Claude hooks detect tools, count unique messages, and stop the timer on completion', async t => {
  const folder = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'claude-presence-'));
  t.after(() => fs.promises.rm(folder, { recursive: true, force: true }));
  const transcript = path.join(folder, 'transcript.jsonl');
  const now = Date.now();
  const event = hook_event_name => ({ session_id: 'session', hook_event_name, transcript_path: transcript });
  recordClaudeEvent(folder, { ...event('SessionStart'), model: 'claude-sonnet-4-6' }, now);
  recordClaudeEvent(folder, event('UserPromptSubmit'), now + 1);
  recordClaudeEvent(folder, { ...event('PreToolUse'), tool_name: 'WebSearch' }, now + 2);
  const message = (id, output) => JSON.stringify({ type: 'assistant', message: { id, model: 'claude-sonnet-4-6',
    usage: { input_tokens: 100, output_tokens: output, cache_read_input_tokens: 50, cache_creation_input_tokens: 25 } } }) + '\n';
  await fs.promises.writeFile(transcript, message('one', 2) + message('one', 10));
  const reader = new ClaudeReader(folder, { now: () => now + 3 });
  let tasks = await reader.poll();
  assert.equal(tasks[0].provider, 'Claude Code');
  assert.equal(tasks[0].stage, 'Researching');
  assert.equal(tasks[0].totalTokens, 185);
  assert.equal(tasks[0].startedAt, now + 1);
  assert.equal(activityFor(tasks).details, 'Claude Sonnet 4.6 · Researching');
  assert.match(activityFor(tasks).state, /185 tok · <\$0.001 est./);
  await fs.promises.appendFile(transcript, message('two', 20));
  tasks = await reader.poll();
  assert.equal(tasks[0].totalTokens, 380);
  recordClaudeEvent(folder, event('Stop'), now + 4);
  assert.deepEqual(await reader.poll(), []);
  assert.equal(activityFor([]).timestamps.start, activityFor([]).timestamps.end);
  recordClaudeEvent(folder, event('UserPromptSubmit'), now - 11 * 60 * 1000);
  assert.deepEqual(await reader.poll(), []);
});

test('hook installation preserves existing settings, is repeatable, and removes only its hooks', async t => {
  const folder = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'claude-settings-'));
  t.after(() => fs.promises.rm(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'settings.json');
  const original = { model: 'sonnet', hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo existing' }] }] } };
  fs.writeFileSync(file, JSON.stringify(original));
  installClaudeHooks(folder, '"C:/app/presence.exe" --claude-hook', true);
  const first = fs.readFileSync(file, 'utf8');
  installClaudeHooks(folder, '"C:/app/presence.exe" --claude-hook', true);
  assert.equal(fs.readFileSync(file, 'utf8'), first);
  assert.equal(JSON.parse(first).hooks.Stop[0].hooks[0].command, 'echo existing');
  assert.ok(fs.existsSync(file + '.discord-presence-backup'));
  installClaudeHooks(folder, '', false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), original);
});
