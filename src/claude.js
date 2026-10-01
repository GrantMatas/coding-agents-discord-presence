const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { stageForTool } = require('./codex');

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'StopFailure', 'SessionEnd'];
const STALE_MS = 10 * 60 * 1000;
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

function installClaudeHooks(claudeHome, command, enabled) {
  const file = path.join(claudeHome, 'settings.json');
  const settings = readJson(file);
  const before = JSON.stringify(settings);
  settings.hooks ||= {};
  for (const event of EVENTS) {
    const existing = settings.hooks[event] || [];
    const groups = existing.map(group => ({ ...group, hooks: (group.hooks || []).filter(hook =>
      !(hook.type === 'command' && /(?:^|\s)--claude-hook(?:\s|$)/.test(hook.command || '')))
    })).filter(group => group.hooks.length);
    if (enabled) groups.push({ hooks: [{ type: 'command', command, timeout: 5 }] });
    if (groups.length) settings.hooks[event] = groups;
    else delete settings.hooks[event];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  if (JSON.stringify(settings) === before) return;
  fs.mkdirSync(claudeHome, { recursive: true });
  if (fs.existsSync(file) && !fs.existsSync(file + '.discord-presence-backup'))
    fs.copyFileSync(file, file + '.discord-presence-backup');
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
}

function recordClaudeEvent(folder, event, now = Date.now()) {
  if (!event?.session_id || !EVENTS.includes(event.hook_event_name)) return;
  const id = crypto.createHash('sha256').update(String(event.session_id)).digest('hex');
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, id + '.json');
  const state = readJson(file);
  const name = event.hook_event_name;
  if (name === 'SessionStart') { state.active = false; state.model = event.model || 'Claude Code'; }
  if (name === 'UserPromptSubmit') { state.active = true; state.startedAt = now; state.stage = 'Thinking'; }
  if (name === 'PreToolUse') { state.active = true; state.startedAt ||= now; state.stage = stageForTool(event.tool_name || ''); }
  if (name === 'PostToolUse') state.stage = 'Thinking';
  if (name === 'Stop' || name === 'StopFailure' || name === 'SessionEnd') state.active = false;
  if (event.transcript_path) state.transcriptPath = event.transcript_path;
  state.updatedAt = now;
  const temporary = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(state));
  fs.renameSync(temporary, file);
}

class ClaudeReader {
  constructor(folder, options = {}) { this.folder = folder; this.now = options.now || Date.now; this.transcripts = new Map(); }

  async poll() {
    let names;
    try { names = await fs.promises.readdir(this.folder); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const tasks = [];
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      let state;
      try { state = readJson(path.join(this.folder, name)); } catch (error) { if (error instanceof SyntaxError) continue; throw error; }
      if (!state.active || this.now() - state.updatedAt > STALE_MS) continue;
      const usage = await this.readUsage(state.transcriptPath);
      tasks.push({ provider: 'Claude Code', stage: state.stage || 'Working', model: usage.model || state.model || 'Claude Code',
        startedAt: state.startedAt, updatedAt: state.updatedAt, totalTokens: usage.totalTokens,
        totalTokensAvailable: usage.available, tokenLabel: 'session tokens' });
    }
    return tasks.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async readUsage(file) {
    if (!file) return {};
    let stat;
    try { stat = await fs.promises.stat(file); } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
    let entry = this.transcripts.get(file);
    if (!entry || stat.size < entry.offset) {
      entry = { offset: 0, remainder: Buffer.alloc(0), messages: new Map(), model: '' };
      this.transcripts.set(file, entry);
    }
    if (stat.size > entry.offset) {
      const stream = fs.createReadStream(file, { start: entry.offset, end: stat.size - 1 });
      for await (const chunk of stream) {
        const data = Buffer.concat([entry.remainder, chunk]);
        let start = 0;
        for (let i = 0; i < data.length; i++) {
          if (data[i] !== 10) continue;
          try {
            const item = JSON.parse(data.subarray(start, i).toString('utf8'));
            const message = item.type === 'assistant' ? item.message : null;
            if (message?.model) entry.model = message.model;
            if (message?.id && message.usage) {
              const previous = entry.messages.get(message.id) || {};
              for (const key of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'])
                previous[key] = Math.max(previous[key] || 0, Number(message.usage[key]) || 0);
              entry.messages.set(message.id, previous);
            }
          } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
          start = i + 1;
        }
        entry.remainder = data.subarray(start);
      }
      entry.offset = stat.size;
    }
    return { model: entry.model, available: entry.messages.size > 0,
      totalTokens: [...entry.messages.values()].reduce((total, usage) => total + Object.values(usage).reduce((a, b) => a + b, 0), 0) };
  }
}

module.exports = { ClaudeReader, recordClaudeEvent, installClaudeHooks };
