const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 10 * 60 * 1000;

function dateFolder(date) {
  return [String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')];
}

function stageForTool(name) {
  if (/web|search|browser|fetch/i.test(name)) return 'Researching';
  if (/image|visual|render/i.test(name)) return 'Creating visuals';
  if (/exec|patch|file|git|command|terminal|bash|powershell|edit|write|read|glob|grep/i.test(name)) return 'Coding';
  return 'Using tools';
}

function safeNumber(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function applyEvent(state, event) {
  const payload = event?.payload;
  if (!payload || typeof payload !== 'object') return;
  const when = Date.parse(event.timestamp) || Date.now();
  if (event.type === 'session_meta') {
    state.originator = payload.originator || '';
    return;
  }
  if (event.type === 'turn_context') {
    if (typeof payload.model === 'string') state.model = payload.model;
    return;
  }
  if (event.type === 'event_msg') {
    if (payload.type === 'task_started') {
      state.active = true;
      state.startedAt = Date.parse(payload.started_at) || when;
      state.stage = 'Thinking';
      state.model = 'Codex';
      state.tokens = null;
    } else if (payload.type === 'task_complete') {
      state.active = false;
    }
  } else if (event.type === 'token_usage_record' && payload.turn_token_usage) {
    state.tokens = payload.turn_token_usage;
  } else if (event.type === 'response_item' && state.active) {
    if (payload.type === 'reasoning') state.stage = 'Thinking';
    else if (payload.type === 'custom_tool_call' || payload.type === 'function_call')
      state.stage = stageForTool(`${payload.name || ''} ${String(payload.input || '').slice(0, 2000)}`);
    else if (payload.type === 'message' && payload.role === 'assistant') state.stage = payload.phase === 'final_answer' ? 'Finishing' : 'Writing';
  }
  state.lastEventAt = when;
}

class CodexReader {
  constructor(home, options = {}) {
    this.home = home;
    this.now = options.now || (() => Date.now());
    this.files = new Map();
  }

  async poll() {
    const databaseTasks = this.pollDatabase();
    if (databaseTasks !== null) return databaseTasks;
    return this.pollRollouts();
  }

  pollDatabase() {
    const statePath = path.join(this.home, 'state_5.sqlite');
    const historyPath = path.join(this.home, 'thread_history_1.sqlite');
    if (!fs.existsSync(statePath) || !fs.existsSync(historyPath)) return null;
    let stateDb;
    let historyDb;
    try {
      stateDb = new DatabaseSync(statePath, { readOnly: true });
      historyDb = new DatabaseSync(historyPath, { readOnly: true });
      const turns = historyDb.prepare("SELECT thread_id, turn_id, started_at FROM thread_turns WHERE status = 'inProgress' ORDER BY started_at DESC LIMIT 16").all();
      const threadQuery = stateDb.prepare('SELECT model, tokens_used, updated_at_ms, originator FROM threads WHERE id = ?');
      const itemQuery = historyDb.prepare('SELECT item_id, item_type FROM thread_items WHERE thread_id = ? AND turn_id = ? ORDER BY COALESCE(started_at_ms, created_at_ms) DESC LIMIT 1');
      const jsonQuery = historyDb.prepare('SELECT item_json FROM thread_items WHERE item_id = ? LIMIT 1');
      const now = this.now();
      const tasks = [];
      for (const turn of turns) {
        const thread = threadQuery.get(turn.thread_id);
        if (!thread || now - Number(thread.updated_at_ms || 0) > STALE_MS) continue;
        const item = itemQuery.get(turn.thread_id, turn.turn_id);
        let stage = 'Working';
        switch (item?.item_type) {
          case 'reasoning': stage = 'Thinking'; break;
          case 'webSearch': stage = 'Researching'; break;
          case 'commandExecution':
          case 'fileChange': stage = 'Coding'; break;
          case 'imageGeneration': stage = 'Creating visuals'; break;
          case 'agentMessage': stage = 'Writing'; break;
          case 'mcpToolCall': {
            try {
              const tool = JSON.parse(jsonQuery.get(item.item_id)?.item_json || '{}');
              stage = stageForTool(`${tool.server || ''} ${tool.tool || ''}`);
            } catch { stage = 'Using tools'; }
            break;
          }
        }
        tasks.push({
          model: thread.model || 'Codex',
          stage,
          startedAt: Number(turn.started_at) * 1000,
          totalTokens: safeNumber(thread.tokens_used),
          totalTokensAvailable: thread.tokens_used !== null,
          tokensAvailable: false,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          originator: thread.originator || '',
          updatedAt: Number(thread.updated_at_ms)
        });
      }
      return tasks.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (error) {
      if (error.code === 'SQLITE_ERROR' || error.code === 'SQLITE_BUSY') return null;
      throw error;
    } finally {
      historyDb?.close();
      stateDb?.close();
    }
  }

  async pollRollouts() {
    const now = this.now();
    const candidates = [];
    for (let daysAgo = 0; daysAgo < 2; daysAgo++) {
      const folder = path.join(this.home, 'sessions', ...dateFolder(new Date(now - daysAgo * DAY_MS)));
      let names;
      try { names = await fs.promises.readdir(folder); } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      for (const name of names) if (name.startsWith('rollout-') && name.endsWith('.jsonl')) candidates.push(path.join(folder, name));
    }
    for (const file of candidates) {
      let stat;
      try { stat = await fs.promises.stat(file); } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      if (now - stat.mtimeMs > STALE_MS && !this.files.has(file)) continue;
      let entry = this.files.get(file);
      if (!entry || stat.size < entry.offset) {
        entry = { offset: 0, remainder: Buffer.alloc(0), state: { file, active: false, stage: 'Working', model: 'Codex', tokens: null, lastEventAt: 0, startedAt: 0 } };
        this.files.set(file, entry);
      }
      if (stat.size > entry.offset) await this.readNewBytes(file, entry, stat.size);
      entry.mtimeMs = stat.mtimeMs;
    }
    for (const [file, entry] of this.files) {
      if (now - (entry.mtimeMs || 0) > STALE_MS || !candidates.includes(file)) this.files.delete(file);
    }
    const active = [...this.files.values()].map(entry => entry.state)
      .filter(state => state.active && state.startedAt && now - state.lastEventAt <= STALE_MS)
      .sort((a, b) => b.lastEventAt - a.lastEventAt);
    return active.map(state => ({
      model: state.model,
      stage: state.stage,
      startedAt: state.startedAt,
      inputTokens: safeNumber(state.tokens?.input_tokens),
      cachedInputTokens: safeNumber(state.tokens?.cached_input_tokens),
      outputTokens: safeNumber(state.tokens?.output_tokens),
      tokensAvailable: Boolean(state.tokens),
      originator: state.originator
    }));
  }

  async readNewBytes(file, entry, size) {
    const stream = fs.createReadStream(file, { start: entry.offset, end: size - 1 });
    for await (const chunk of stream) {
      const data = Buffer.concat([entry.remainder, chunk]);
      let start = 0;
      for (let index = 0; index < data.length; index++) {
        if (data[index] !== 10) continue;
        const line = data.subarray(start, index).toString('utf8').trim();
        start = index + 1;
        if (!line) continue;
        try { applyEvent(entry.state, JSON.parse(line)); } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
        }
      }
      entry.remainder = data.subarray(start);
    }
    entry.offset = size;
  }
}

module.exports = { CodexReader, applyEvent, stageForTool };
