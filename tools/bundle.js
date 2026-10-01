const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts', 'codex-presence.bundle.js');
fs.mkdirSync(path.dirname(output), { recursive: true });
const names = ['pricing', 'codex', 'claude', 'agents', 'discord', 'presence', 'main'];
const uiScript = fs.readFileSync(path.join(root, 'src', 'ui.ps1'), 'utf8');
const trayIcon = fs.readFileSync(path.join(root, 'src', 'codex.ico')).toString('base64');
const factories = names.map(name => {
  const source = fs.readFileSync(path.join(root, 'src', `${name}.js`), 'utf8');
  return `${JSON.stringify(`./${name}`)}: function(module, exports, require) {\n${source}\n}`;
}).join(',\n');
const bundle = `globalThis.__CODEX_UI_SCRIPT = ${JSON.stringify(uiScript)};\nglobalThis.__CODEX_TRAY_ICON = ${JSON.stringify(trayIcon)};\nconst nativeRequire = require;\nconst factories = {\n${factories}\n};\nconst cache = new Map();\nfunction localRequire(id) {\n  if (!Object.prototype.hasOwnProperty.call(factories, id)) return nativeRequire(id);\n  if (cache.has(id)) return cache.get(id).exports;\n  const module = { exports: {} };\n  cache.set(id, module);\n  factories[id](module, module.exports, localRequire);\n  return module.exports;\n}\nlocalRequire('./main');\n`;
fs.writeFileSync(output, bundle);
console.log(output);
