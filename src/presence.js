const DEFAULT_ICON_URL = 'https://raw.githubusercontent.com/backnotprop/orchestrator/main/assets/providers/codex-icon-dark.png';

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
  const model = task?.model || provider;
  const tokens = task?.totalTokensAvailable
    ? `${compact(task.totalTokens)} ${task.tokenLabel || 'thread tokens'}`
    : task?.tokensAvailable
      ? `${compact(task.inputTokens)} in · ${compact(task.outputTokens)} out`
      : task ? 'Tokens pending' : '0 tokens';
  const state = task
    ? `${provider} · ${model} · ${tokens}${tasks.length > 1 ? ` · ${tasks.length} tasks` : ''}`
    : 'Idle · 0 tokens · 0m';
  return {
    name: task?.provider || 'Coding Agents',
    type: 0,
    status_display_type: 1,
    details: task?.stage || 'Idle',
    state: limit(state),
    timestamps: task?.startedAt ? { start: Math.floor(task.startedAt / 1000) } : undefined,
    assets: imageAsset ? {
      large_image: imageAsset,
      large_text: task?.cachedInputTokens ? limit(`${model} · ${compact(task.cachedInputTokens)} cached input tokens`) : provider
    } : undefined,
    instance: false
  };
}

module.exports = { activityFor, compact, DEFAULT_ICON_URL };
