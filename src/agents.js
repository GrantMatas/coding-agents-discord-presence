const os = require('node:os');
const path = require('node:path');
const { CodexReader } = require('./codex');
const { ClaudeReader } = require('./claude');

class AgentReader {
  constructor(config, configDir) {
    this.config = config;
    this.codex = new CodexReader(config.codexHome || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
    this.claude = new ClaudeReader(path.join(configDir, 'claude-sessions'));
  }
  async poll() {
    const sources = await Promise.all([
      this.config.enableCodex === false ? [] : this.codex.poll(),
      this.config.enableClaude === false ? [] : this.claude.poll()
    ]);
    return [...sources[0].map(task => ({ ...task, provider: 'Codex', updatedAt: task.updatedAt || task.startedAt })), ...sources[1]]
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

module.exports = { AgentReader };
