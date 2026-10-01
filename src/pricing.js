// USD per million tokens, standard rates verified 2026-10-01. See README sources.
const RATES = {
  'gpt-6.1-sol': [2, .1, 10, 2.5],
  'gpt-6-sol': [2, .2, 10, 2.5],
  'gpt-6-astra': [10, 1, 50, 12.5],
  'gpt-6-luna': [.1, .01, .5, .125],
  'gpt-5.6-sol': [4, .4, 20, 5],
  'gpt-5.6-terra': [2, .2, 12, 2.5],
  'gpt-5.6-luna': [.2, .02, 1.2, .25],
  'gpt-5.5': [5, .5, 30],
  'gpt-5.4': [2.5, .25, 15],
  'gpt-5.3-codex': [1.75, .175, 14]
};
for (const model of ['sonnet-4', 'sonnet-4-5', 'sonnet-4-6']) RATES['claude-' + model] = [3, .3, 15, 3.75, 6];
for (const model of ['sonnet-5', 'sonnet-5-5']) RATES['claude-' + model] = [2, .2, 10, 2.5, 4];
for (const model of ['opus-4-5', 'opus-4-6', 'opus-4-7', 'opus-4-8', 'opus-5']) RATES['claude-' + model] = [5, .5, 25, 6.25, 10];
for (const model of ['opus-4', 'opus-4-1']) RATES['claude-' + model] = [15, 1.5, 75, 18.75, 30];
RATES['claude-opus-5-5'] = [4, .2, 20, 5, 8];
RATES['claude-haiku-4-5'] = [1, .1, 5, 1.25, 2];
RATES['claude-haiku-3-5'] = [.8, .08, 4, 1, 1.6];

function count(value) { return Number.isFinite(value) && value >= 0 ? value : 0; }

function codexUsage(tokens) {
  if (!tokens || !Number.isFinite(tokens.input_tokens) || !Number.isFinite(tokens.output_tokens)) return null;
  const cachedInput = count(tokens.cached_input_tokens);
  const cacheWrite = count(tokens.cache_write_input_tokens);
  return { input: Math.max(0, tokens.input_tokens - cachedInput - cacheWrite), cachedInput,
    cacheWrite, output: count(tokens.output_tokens) }; // Reasoning tokens are already included in output.
}

function estimateCost(task, overrides = {}) {
  if (!task?.usage) return null;
  const model = task.model || '';
  const baseModel = model.replace(/-\d{4}-?\d{2}-?\d{2}$/, '');
  const builtin = RATES[baseModel];
  const rates = overrides[model] || overrides[baseModel] || (builtin && {
    input: builtin[0], cachedInput: builtin[1], output: builtin[2], cacheWrite: builtin[3], cacheWrite1h: builtin[4]
  });
  if (!rates) return null;
  let amount = 0;
  for (const [kind, tokens] of Object.entries(task.usage)) {
    if (!tokens) continue;
    if (!Number.isFinite(tokens) || tokens < 0 || !Number.isFinite(rates[kind]) || rates[kind] < 0) return null;
    amount += tokens * rates[kind] / 1e6;
  }
  return amount;
}

function formatCost(amount) {
  if (amount === null) return 'Cost unavailable';
  if (amount > 0 && amount < .001) return '<$0.001 est.';
  return `~$${amount.toFixed(amount > 0 && amount < .01 ? 3 : 2)} est.`;
}

function modelLabel(model, effort) {
  const label = model.startsWith('gpt-') ? 'GPT-' + model.slice(4).replace(/-/g, ' ')
    : model.startsWith('claude-') ? 'Claude ' + model.slice(7).replace(/-\d{8}$/, '').replace(/(\d)-(\d)/g, '$1.$2').replace(/-/g, ' ')
      : model;
  return label.replace(/\b(sol|terra|luna|astra|sonnet|opus|haiku|codex)\b/gi, word => word[0].toUpperCase() + word.slice(1))
    + (effort ? ` (${effort[0].toUpperCase() + effort.slice(1)})` : '');
}

module.exports = { codexUsage, estimateCost, formatCost, modelLabel };
