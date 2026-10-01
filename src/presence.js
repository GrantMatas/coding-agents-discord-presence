const DEFAULT_ICON_URL = 'https://raw.githubusercontent.com/backnotprop/orchestrator/main/assets/providers/codex-icon-dark.png';
const { estimateCost, formatCost, modelLabel } = require('./pricing');
// A completed interval stays at zero; omitting timestamps lets Discord show app runtime.
const IDLE_TIMESTAMP = Math.floor(Date.now() / 1000);

function compact(value) {
  if (value < 1000) return String(value);
  if (value < 10000) return `${(value / 1000).toFixed(1)}K`;
  if (value < 1000000) return `${Math.round(value / 1000)}K`;
  return `${(value / 1000000).toFixed(1)}M`;
}

function limit(value, size = 128) {
  return value.length <= size ? value : `${value.slice(0, size - 1)}…`;
}

function activityFor(tasks, imageAsset = DEFAULT_ICON_URL, config = {}) {
  if (!tasks.length && config.visibilityMode === 'active') return null;
  const task = tasks[0];
  const provider = task?.provider || 'Codex';
  const model = modelLabel(task?.model || provider, task?.effort);
  const tokens = task?.totalTokensAvailable
    ? `${compact(task.totalTokens)} tok`
    : task?.tokensAvailable
      ? `${compact(task.inputTokens)} in · ${compact(task.outputTokens)} out`
      : task ? 'Tokens pending' : '0 tokens';
  const state = task
    ? `${tokens} · ${formatCost(estimateCost(task, config.pricing))}${tasks.length > 1 ? ` · ${tasks.length} tasks` : ''}`
    : '0 tok · $0.00 est. · 0m';
  return {
    name: task?.displayName || task?.provider || 'Coding Agents',
    type: 0,
    status_display_type: 1,
    details: task ? limit(`${model} · ${task.stage}`) : 'Idle',
    state: limit(state),
    timestamps: task?.startedAt ? { start: Math.floor(task.startedAt / 1000) }
      : task ? undefined : { start: IDLE_TIMESTAMP, end: IDLE_TIMESTAMP },
    assets: imageAsset ? {
      large_image: imageAsset,
      large_text: task?.usage ? limit(`${task.tokenLabel || 'Thread tokens'} · ${compact(task.usage.cachedInput || 0)} cached · Standard API cost estimate`) : provider
    } : undefined,
    instance: false
  };
}

module.exports = { activityFor, compact, DEFAULT_ICON_URL };
