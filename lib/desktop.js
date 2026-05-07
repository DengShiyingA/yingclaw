const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { normalizeAnthropicBaseUrl } = require('./config');

const CLAUDE_DESKTOP_LABEL = 'Claude 桌面应用配置';
const DESKTOP_GATEWAY_KEYS = [
  'inferenceProvider',
  'inferenceGatewayBaseUrl',
  'inferenceGatewayApiKey',
  'inferenceGatewayAuthScheme',
  'inferenceModels',
  'disableDeploymentModeChooser',
  'deploymentOrganizationUuid',
];

// Claude Desktop 主进程从 Claude-3p/ 目录读取 deploymentMode 和 enterpriseConfig
function getClaudeDesktopDataDir(options = {}) {
  const platform = options.platform || process.platform;
  const homeDir = options.homeDir || os.homedir();

  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'Claude-3p');
  }

  if (platform === 'win32') {
    const appData = options.appData || process.env.APPDATA || options.localAppData || path.join(homeDir, 'AppData', 'Roaming');
    return path.join(appData, 'Claude-3p');
  }

  return null;
}

function getClaudeDesktopConfigPath(options = {}) {
  const dataDir = options.dataDir || getClaudeDesktopDataDir(options);
  return dataDir ? path.join(dataDir, 'claude_desktop_config.json') : null;
}

function getClaudeDesktopConfigLibraryDir(options = {}) {
  const dataDir = options.dataDir || getClaudeDesktopDataDir(options);
  return dataDir ? path.join(dataDir, 'configLibrary') : null;
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function toDesktopModelId(model) {
  return model.startsWith('claude-') ? model : `claude-${model}`;
}

function collectModels(config) {
  const list = Array.isArray(config.availableModels) && config.availableModels.length > 0
    ? [config.model, config.fastModel, ...config.availableModels]
    : [config.model, config.fastModel];
  return [...new Set(list.filter(Boolean).map(toDesktopModelId))];
}

// 按官方 schema：所有值必须是字符串（包括布尔、数组都序列化）
function buildClaudeDesktopEnterpriseConfig(config, options = {}) {
  const models = collectModels(config);
  const baseUrl = normalizeAnthropicBaseUrl(config.baseUrl);
  if (!baseUrl.startsWith('https://')) {
    throw new Error('Claude 桌面应用要求 Gateway Base URL 使用 HTTPS');
  }
  return {
    inferenceProvider: 'gateway',
    inferenceGatewayBaseUrl: baseUrl,
    inferenceGatewayApiKey: config.apiKey,
    inferenceGatewayAuthScheme: options.authScheme || 'bearer',
    inferenceModels: JSON.stringify(models),
    disableDeploymentModeChooser: 'true',
    deploymentOrganizationUuid: options.uuid || crypto.randomUUID(),
  };
}

function clearClaudeDesktopConfigLibrary(options = {}) {
  const dir = options.configLibraryDir || getClaudeDesktopConfigLibraryDir(options);
  if (!dir || !fs.existsSync(dir)) {
    return { result: 'missing', dir };
  }

  const metaFile = path.join(dir, '_meta.json');
  const meta = readJsonFile(metaFile);
  const ids = new Set();
  if (typeof meta.appliedId === 'string' && meta.appliedId) {
    ids.add(meta.appliedId);
  }
  if (Array.isArray(meta.entries)) {
    for (const entry of meta.entries) {
      if (entry && typeof entry.id === 'string' && entry.id) {
        ids.add(entry.id);
      }
    }
  }

  for (const id of ids) {
    const file = path.join(dir, `${id}.json`);
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
  if (fs.existsSync(metaFile)) {
    fs.unlinkSync(metaFile);
  }

  return { result: 'updated', dir };
}

// 写入 Claude-3p/configLibrary/ 下的 enterprise config 条目（主进程从此处读取）
function writeClaudeDesktopConfig(config, options = {}) {
  const dataDir = options.dataDir || getClaudeDesktopDataDir(options);
  if (!dataDir) {
    return { result: 'unsupported', file: null };
  }

  const configLibraryDir = path.join(dataDir, 'configLibrary');
  const existingMetaFile = path.join(configLibraryDir, '_meta.json');
  const existingMeta = readJsonFile(existingMetaFile);
  const uuid = existingMeta.appliedId || options.uuid || crypto.randomUUID();

  const models = collectModels(config);
  const baseUrl = normalizeAnthropicBaseUrl(config.baseUrl);
  if (!baseUrl.startsWith('https://')) {
    throw new Error('Claude 桌面应用要求 Gateway Base URL 使用 HTTPS');
  }

  const entry = {
    inferenceProvider: 'gateway',
    inferenceGatewayBaseUrl: baseUrl,
    inferenceGatewayApiKey: config.apiKey,
    inferenceGatewayAuthScheme: options.authScheme || 'bearer',
    inferenceModels: models,
    disableDeploymentModeChooser: true,
    deploymentOrganizationUuid: uuid,
  };

  const meta = {
    appliedId: uuid,
    entries: [{ id: uuid, name: 'yingclaw' }],
    isManaged: false,
    platform: process.platform,
  };

  fs.mkdirSync(configLibraryDir, { recursive: true });

  const entryFile = path.join(configLibraryDir, `${uuid}.json`);
  const beforeEntry = fs.existsSync(entryFile) ? fs.readFileSync(entryFile, 'utf8') : '';
  const entryBody = JSON.stringify(entry, null, 2) + '\n';
  fs.writeFileSync(entryFile, entryBody);
  fs.writeFileSync(existingMetaFile, JSON.stringify(meta, null, 2) + '\n');

  const file = options.configFile || path.join(dataDir, 'claude_desktop_config.json');
  const current = readJsonFile(file);
  const next = { ...current, deploymentMode: '3p' };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');

  return { result: beforeEntry === entryBody ? 'unchanged' : 'updated', file };
}

function clearClaudeDesktopConfig(options = {}) {
  // Derive dataDir only when configFile is not explicitly overridden (to avoid touching real system dirs in tests)
  const dataDir = options.dataDir || (options.configFile ? null : getClaudeDesktopDataDir(options));
  const file = options.configFile || (dataDir ? path.join(dataDir, 'claude_desktop_config.json') : null);

  // Clear configLibrary regardless of whether the main config file exists
  const libResult = clearClaudeDesktopConfigLibrary({ ...options, dataDir });

  if (!file || !fs.existsSync(file)) {
    return { result: libResult.result === 'updated' ? 'updated' : 'missing', file, dataDir };
  }

  const current = readJsonFile(file);
  const next = { ...current };

  // Remove legacy enterpriseConfig gateway keys
  if (next.enterpriseConfig && typeof next.enterpriseConfig === 'object') {
    const enterpriseConfig = { ...next.enterpriseConfig };
    for (const key of DESKTOP_GATEWAY_KEYS) {
      delete enterpriseConfig[key];
    }
    if (Object.keys(enterpriseConfig).length > 0) {
      next.enterpriseConfig = enterpriseConfig;
    } else {
      delete next.enterpriseConfig;
    }
  }

  // Always remove deploymentMode when clearing 3P config
  delete next.deploymentMode;

  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');

  return { result: 'updated', file, dataDir };
}

function isDesktopConfigured(options = {}) {
  const dir = options.dataDir || getClaudeDesktopDataDir(options);
  if (!dir) return false;
  const meta = readJsonFile(path.join(dir, 'configLibrary', '_meta.json'));
  return typeof meta.appliedId === 'string' && meta.appliedId.length > 0;
}

function buildClaudeDesktopOpenCommands(platform = process.platform) {
  if (platform !== 'darwin') return null;
  // 必须先完全退出 Claude，新配置只在启动时读取一次
  return [
    { command: 'osascript', args: ['-e', 'tell application "Claude" to quit'], optional: true, waitAfter: 800 },
    { command: 'pkill', args: ['-TERM', '-x', 'Claude'], optional: true, waitAfter: 500 },
    { command: 'pkill', args: ['-KILL', '-x', 'Claude'], optional: true, waitAfter: 800 },
    { command: 'open', args: ['-a', 'Claude'], waitAfter: 600 },
    { command: 'osascript', args: ['-e', 'tell application "Claude" to activate'], optional: true },
  ];
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function openClaudeDesktop(options = {}) {
  const platform = options.platform || process.platform;
  const commands = buildClaudeDesktopOpenCommands(platform);
  if (!commands) return { result: 'unsupported' };

  const runner = options.runner || spawnSync;
  const isMocked = options.runner !== undefined;
  const timeoutMs = options.timeoutMs || 5000;

  const trace = [];
  for (const { command, args, optional, waitAfter } of commands) {
    const result = runner(command, args, { stdio: 'pipe', encoding: 'utf8', windowsHide: true, timeout: timeoutMs });
    const stderr = (result.stderr || '').toString().trim();
    trace.push({ command, args, status: result.status, stderr });

    if (result.status !== 0 && !optional) {
      const detail = stderr ? `: ${stderr}` : '';
      const trail = trace.map(t => `${t.command} ${t.args.join(' ')} → ${t.status}${t.stderr ? ' (' + t.stderr + ')' : ''}`).join('\n  ');
      throw new Error(`Claude 桌面应用打开失败${detail}\n  ${trail}`);
    }
    if (waitAfter && !isMocked) {
      await sleep(waitAfter);
    }
  }

  return { result: 'reopened', trace };
}

module.exports = {
  buildClaudeDesktopEnterpriseConfig,
  buildClaudeDesktopOpenCommands,
  clearClaudeDesktopConfig,
  getClaudeDesktopConfigPath,
  getClaudeDesktopDataDir,
  isDesktopConfigured,
  openClaudeDesktop,
  writeClaudeDesktopConfig,
  CLAUDE_DESKTOP_LABEL,
};
