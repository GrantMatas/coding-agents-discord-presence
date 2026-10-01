const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { AgentReader } = require('./agents');
const { recordClaudeEvent, installClaudeHooks } = require('./claude');
const { DiscordRpc } = require('./discord');
const { activityFor, DEFAULT_ICON_URL } = require('./presence');

const configDir = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'CodexDiscordPresence');
const configPath = path.join(configDir, 'config.json');
const statusPath = path.join(configDir, 'status.json');
const uiPath = path.join(configDir, 'ui.ps1');
const iconPath = path.join(configDir, 'codex.ico');
const controlPort = 49326;
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}; throw error; }
}

function ensureUiScript() {
  const content = globalThis.__CODEX_UI_SCRIPT || fs.readFileSync(path.join(__dirname, 'ui.ps1'), 'utf8');
  const icon = globalThis.__CODEX_TRAY_ICON
    ? Buffer.from(globalThis.__CODEX_TRAY_ICON, 'base64')
    : fs.readFileSync(path.join(__dirname, 'codex.ico'));
  fs.mkdirSync(configDir, { recursive: true });
  if (!fs.existsSync(uiPath) || fs.readFileSync(uiPath, 'utf8') !== content) fs.writeFileSync(uiPath, content);
  if (!fs.existsSync(iconPath) || !fs.readFileSync(iconPath).equals(icon)) fs.writeFileSync(iconPath, icon);
}

function uiArgs(mode, extra = []) {
  const windowOptions = mode === 'tray' ? ['-WindowStyle', 'Hidden'] : [];
  return ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', ...windowOptions, '-File', uiPath,
    '-Mode', mode, '-ConfigPath', configPath, '-ExePath', process.execPath, ...extra];
}

function showSetup() {
  ensureUiScript();
  const result = spawnSync(powershell, uiArgs('setup'), { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function openSettings() {
  ensureUiScript();
  const child = spawn(powershell, uiArgs('setup'), { stdio: 'ignore' });
  child.unref();
}

function startTray() {
  ensureUiScript();
  const child = spawn(powershell, uiArgs('tray', ['-ParentPid', String(process.pid), '-Port', String(controlPort)]),
    { windowsHide: true, stdio: 'ignore' });
  child.unref();
}

function writeStatus(message) {
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(statusPath, JSON.stringify({ message, updatedUtc: new Date().toISOString() }));
}

if (process.argv.includes('--claude-hook')) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { if (input.length < 8 * 1024 * 1024) input += chunk; });
  process.stdin.on('end', () => {
    try { recordClaudeEvent(path.join(configDir, 'claude-sessions'), JSON.parse(input)); } catch { }
  });
} else if (process.argv.includes('--status')) {
  const config = loadConfig();
  new AgentReader(config, configDir).poll().then(tasks => {
    console.log(tasks.length ? JSON.stringify(tasks, null, 2) : 'No active coding agent tasks.');
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
} else {
  const lock = net.createServer();
  let stop = () => process.exit();
  lock.on('connection', socket => socket.once('data', data => {
    const command = data.toString('utf8').trim();
    if (command === 'quit') stop();
    else if (command === 'settings') openSettings();
    socket.end();
  }));
  lock.on('error', error => {
    if (error.code === 'EADDRINUSE') {
      const socket = net.createConnection({ host: '127.0.0.1', port: controlPort }, () => { socket.end('settings'); });
      socket.on('error', () => process.exit(1));
      socket.on('close', () => process.exit());
    } else {
      try { writeStatus('Could not start: ' + error.message); } catch { }
      process.exit(1);
    }
  });
  lock.listen(controlPort, '127.0.0.1', () => {
    try {
      let config = loadConfig();
      if (!/^\d{17,20}$/.test(String(config.discordApplicationId || ''))) {
        if (!showSetup()) { lock.close(); return; }
        config = loadConfig();
        if (!/^\d{17,20}$/.test(String(config.discordApplicationId || ''))) { lock.close(); return; }
      }
      stop = run(lock, config);
    } catch (error) {
      try { writeStatus('Could not start: ' + error.message); } catch { }
      lock.close();
    }
  });
}

function run(lock, initialConfig) {
  let config = initialConfig;
  let reader = new AgentReader(config, configDir);
  let sourceKey = null;
  let claudeSetupError = '';
  let discord = new DiscordRpc(String(config.discordApplicationId));
  let lastKey = null;
  let lastError = '';
  let busy = false;
  let closing = false;
  writeStatus('Waiting for coding agent task');
  startTray();

  async function tick() {
    if (busy || closing) return;
    busy = true;
    try {
      const nextConfig = loadConfig();
      if (!/^\d{17,20}$/.test(String(nextConfig.discordApplicationId || ''))) throw new Error('Open Settings to set a Discord Application ID');
      const nextSourceKey = JSON.stringify([nextConfig.codexHome, nextConfig.claudeHome, nextConfig.enableCodex, nextConfig.enableClaude]);
      if (nextSourceKey !== sourceKey) {
        reader = new AgentReader(nextConfig, configDir);
        const claudeHome = nextConfig.claudeHome || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
        const hookCommand = globalThis.__CODEX_UI_SCRIPT
          ? `"${process.execPath.replaceAll('\\', '/')}" --claude-hook`
          : `"${process.execPath.replaceAll('\\', '/')}" "${path.join(__dirname, 'main.js').replaceAll('\\', '/')}" --claude-hook`;
        try { installClaudeHooks(claudeHome, hookCommand, nextConfig.enableClaude !== false); claudeSetupError = ''; }
        catch (error) { claudeSetupError = 'Claude hook setup: ' + error.message; }
        sourceKey = nextSourceKey;
      }
      if (nextConfig.discordApplicationId !== config.discordApplicationId) {
        if (lastKey !== null && discord.connected) await discord.setActivity(null);
        discord.close();
        discord = new DiscordRpc(String(nextConfig.discordApplicationId));
        lastKey = null;
      }
      config = nextConfig;
      const tasks = await reader.poll();
      const imageAsset = config.imageAsset === undefined || config.imageAsset === 'codex'
        ? DEFAULT_ICON_URL : config.imageAsset;
      const activityImage = tasks[0]?.provider === 'Claude Code' ? config.claudeImageAsset || '' : imageAsset;
      const activity = activityFor(tasks, activityImage, config);
      const key = JSON.stringify(activity);
      if (activity ? key !== lastKey || !discord.connected : lastKey !== null) {
        if (activity || discord.connected) await discord.setActivity(activity);
        lastKey = activity ? key : null;
      }
      const task = tasks[0];
      const preview = activity || activityFor([], activityImage);
      const message = (task ? task.displayName || task.provider : 'Idle') + ' · ' + preview.details + ' · ' + preview.state;
      writeStatus(claudeSetupError ? message + ' · ' + claudeSetupError : message);
      lastError = '';
    } catch (error) {
      if (error.message !== lastError) {
        try { writeStatus(error.message); } catch { }
        lastError = error.message;
      }
    } finally { busy = false; }
  }

  const interval = setInterval(tick, 2500);
  void tick();
  async function stop() {
    if (closing) return;
    closing = true;
    clearInterval(interval);
    try { if (lastKey !== null && discord.connected) await discord.setActivity(null); } catch { }
    discord.close();
    lock.close();
    process.exit();
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return stop;
}
