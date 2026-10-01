const test = require('node:test');
const assert = require('node:assert/strict');
const { codexUsage, estimateCost, formatCost } = require('../src/pricing');
const { stageForTool } = require('../src/codex');

test('Codex cost separates cached input and includes reasoning only once', () => {
  const usage = codexUsage({ input_tokens: 1e6, cached_input_tokens: 800000,
    cache_write_input_tokens: 100000, output_tokens: 100000, reasoning_output_tokens: 60000 });
  assert.equal(estimateCost({ model: 'gpt-6.1-sol', usage }), 1.53);
  assert.equal(formatCost(1.53), '~$1.53 est.');
  assert.equal(estimateCost({ model: 'unknown', usage }), null);
  assert.equal(estimateCost({ model: 'gpt-6.1-sol', totalTokens: 1e6 }), null);
  assert.equal(estimateCost({ model: 'custom', usage: { input: 1e6 } }, { custom: { input: 3 } }), 3);
});

test('Claude cache reads and both cache durations use distinct rates', () => {
  const cost = estimateCost({ model: 'claude-sonnet-4-6-20260217',
    usage: { input: 1e6, cachedInput: 1e6, output: 1e6, cacheWrite: 1e6, cacheWrite1h: 1e6 } });
  assert.equal(cost, 28.05);
  assert.equal(stageForTool('Agent'), 'Using agents');
  assert.equal(stageForTool('collaboration.spawn_agent'), 'Using agents');
  assert.equal(stageForTool('Bash'), 'Coding');
});
