const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const CONFIG_FILE = path.join(os.homedir(), '.clawai.json');
const WINDOWS_ENV_LABEL = 'Windows 用户环境变量';
const CLAUDE_ENV_KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_SUBAGENT_MODEL',
  'CLAUDE_CODE_EFFORT_LEVEL',
];

const PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    modelsUrl: 'https://api.deepseek.com/v1/models',
    fastModel: 'deepseek-v4-flash[1m]',
    models: [
      { name: 'DeepSeek V4 Pro（强力）',   value: 'deepseek-v4-pro[1m]' },
      { name: 'DeepSeek V4 Flash（快速）', value: 'deepseek-v4-flash[1m]' },
    ],
  },
  kimi: {
    name: 'Kimi / Moonshot',
    baseUrl: 'https://api.moonshot.ai/anthropic',
    modelsUrl: 'https://api.moonshot.ai/v1/models',
    fastModel: 'kimi-k2.5',
    models: [
      { name: 'Kimi K2.5（代码）', value: 'kimi-k2.5' },
    ],
  },
  qwen: {
    name: '阿里云百炼 (Qwen)',
    baseUrl: 'https://dashscope.aliyuncs.com/apps/anthropic',
    modelsUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
    fastModel: 'qwen3.5-plus',
    models: [
      { name: 'Qwen3 Max（强力）',   value: 'qwen3-max' },
      { name: 'Qwen3 Plus（均衡）',  value: 'qwen3-plus' },
      { name: 'Qwen3 Flash（快速）', value: 'qwen3.5-plus' },
    ],
  },
  minimax: {
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    modelsUrl: 'https://api.minimaxi.com/v1/models',
    models: [
      { name: 'MiniMax M2.7（旗舰）',       value: 'MiniMax-M2.7' },
      { name: 'MiniMax M2.7 Turbo（快速）', value: 'MiniMax-M2.7-Turbo' },
      { name: 'MiniMax M2.5（均衡）',       value: 'MiniMax-M2.5' },
    ],
  },
  glm: {
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    modelsUrl: 'https://open.bigmodel.cn/api/paas/v4/models',
    models: [
      { name: 'GLM-4.7（旗舰）',     value: 'GLM-4.7' },
      { name: 'GLM-5.1（强力）',     value: 'GLM-5.1' },
      { name: 'GLM-5 Turbo（快速）', value: 'GLM-5-Turbo' },
      { name: 'GLM-4.5 Air（轻量）', value: 'GLM-4.5-Air' },
    ],
  },
  mimo: {
    name: '小米 MiMo',
    baseUrl: 'https://api.xiaomimimo.com/anthropic',
    modelsUrl: 'https://api.xiaomimimo.com/v1/models',
    models: [
      { name: 'MiMo V2.5 Pro（旗舰）', value: 'mimo-v2.5-pro' },
    ],
  },
  custom: {
    name: '自定义 Anthropic 兼容接口',
    custom: true,
    models: [],
  },
};

function normalizeModelIds(providerKey, ids) {
  if (providerKey !== 'deepseek') return ids;

  const mapped = ids.map((id) => {
    if (id === 'deepseek-v4-pro') return 'deepseek-v4-pro[1m]';
    if (id === 'deepseek-v4-flash') return 'deepseek-v4-flash[1m]';
    return id;
  });
  const preferred = ['deepseek-v4-pro[1m]', 'deepseek-v4-flash[1m]'];
  return [
    ...preferred.filter((id) => mapped.includes(id)),
    ...mapped.filter((id) => !preferred.includes(id)),
  ];
}

function parseModelIdsResponse(providerKey, data) {
  const parsed = typeof data === 'string' ? JSON.parse(data) : data;
  const list = parsed.data || parsed.models || [];
  const ids = list.map(m => m.id || m.model || m.name).filter(Boolean);
  return normalizeModelIds(providerKey, ids);
}

function normalizeAnthropicBaseUrl(baseUrl) {
  let url;
  try { url = new URL(baseUrl); } catch { return baseUrl; }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.at(-1) === 'messages' && parts.at(-2) === 'v1') {
    parts.splice(-2, 2);
  } else if (parts.at(-1) === 'v1') {
    parts.pop();
  }

  url.pathname = parts.length > 0 ? `/${parts.join('/')}` : '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '');
}

function buildModelUrlCandidates(baseUrl) {
  let url;
  try { url = new URL(normalizeAnthropicBaseUrl(baseUrl)); } catch { return []; }

  const pathname = url.pathname.replace(/\/+$/, '');
  const candidates = [];
  const add = (pathPart) => {
    const normalized = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;
    candidates.push(`${url.origin}${normalized}`);
  };

  add(`${pathname}/v1/models`);

  if (pathname.endsWith('/anthropic')) {
    const withoutAnthropic = pathname.slice(0, -'/anthropic'.length);
    add(`${withoutAnthropic}/v1/models`);
  }

  add('/v1/models');

  return [...new Set(candidates)];
}

async function fetchModelsFromBaseUrl(providerKey, apiKey, baseUrl, fetcher = fetchModels) {
  const effectiveProviderKey = providerKey === 'custom'
    ? providerKeyFromBaseUrl(baseUrl) || providerKey
    : providerKey;

  for (const modelsUrl of buildModelUrlCandidates(baseUrl)) {
    const models = await fetcher(effectiveProviderKey, apiKey, modelsUrl);
    if (models && models.length > 0) {
      return { modelsUrl, models: normalizeModelIds(effectiveProviderKey, models) };
    }
  }
  return null;
}

// 联网拉取厂商支持的模型列表，失败返回 null
async function fetchModels(providerKey, apiKey, modelsUrlOverride) {
  const provider = PROVIDERS[providerKey];
  const modelsUrl = modelsUrlOverride || provider?.modelsUrl;
  if (!modelsUrl) return null;

  try {
    new URL(modelsUrl);
  } catch {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const res = await fetch(modelsUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'api-key': apiKey, // MiMo 用这个 header
      },
    });
    if (!res.ok) return null;

    const ids = parseModelIdsResponse(providerKey, await res.text());
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function validateConfig(config) {
  if (!config || typeof config !== 'object') {
    return { valid: false, message: '未找到配置' };
  }
  for (const key of ['provider', 'baseUrl', 'apiKey', 'model']) {
    if (typeof config[key] !== 'string' || config[key].trim().length === 0) {
      return { valid: false, message: `配置缺少 ${key}` };
    }
  }
  if (!PROVIDERS[config.provider]) {
    return { valid: false, message: `未知厂商 ${config.provider}` };
  }
  return { valid: true };
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  try {
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch {}
}

function providerKeyFromBaseUrl(baseUrl) {
  return Object.entries(PROVIDERS).find(([, provider]) => provider.baseUrl === baseUrl)?.[0];
}

function resolveFastModel(provider, model) {
  if (/flash|turbo|haiku|air|lite/i.test(model)) return model;
  return provider?.fastModel || model;
}

function buildClaudeEnv({ provider, baseUrl, apiKey, model, fastModel }) {
  const resolvedFastModel = fastModel || resolveFastModel(PROVIDERS[provider], model);
  return {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: apiKey,
    ANTHROPIC_API_KEY: apiKey,
    ANTHROPIC_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: resolvedFastModel,
    CLAUDE_CODE_SUBAGENT_MODEL: resolvedFastModel,
    CLAUDE_CODE_EFFORT_LEVEL: 'max',
  };
}

function buildWindowsSetEnvCommands(env) {
  return CLAUDE_ENV_KEYS.map((key) => ({
    command: 'setx',
    args: [key, env[key]],
  }));
}

function buildWindowsClearEnvCommands() {
  return CLAUDE_ENV_KEYS.map((key) => ({
    command: 'reg',
    args: ['delete', 'HKCU\\Environment', '/V', key, '/F'],
  }));
}

function runWindowsEnvCommands(commands, runner = spawnSync, { ignoreErrors = false } = {}) {
  for (const { command, args } of commands) {
    const result = runner(command, args, { stdio: 'ignore', windowsHide: true });
    if (!ignoreErrors && result.status !== 0) {
      throw new Error(`${command} ${args[0]} 执行失败`);
    }
  }
}

function classifyValidationStatus(statusCode) {
  if (statusCode >= 200 && statusCode < 300) return true;
  if (statusCode === 401 || statusCode === 403) return false;
  return null;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// 构造完整的 clawai 环境变量块
function buildEnvBlock(baseUrl, apiKey, model, fastModel) {
  const provider = providerKeyFromBaseUrl(baseUrl);
  const env = buildClaudeEnv({ provider, baseUrl, apiKey, model, fastModel });
  return [
    '',
    '# clawai-start',
    `export ANTHROPIC_BASE_URL=${shellQuote(env.ANTHROPIC_BASE_URL)}`,
    `export ANTHROPIC_AUTH_TOKEN=${shellQuote(env.ANTHROPIC_AUTH_TOKEN)}`,
    `export ANTHROPIC_API_KEY=${shellQuote(env.ANTHROPIC_API_KEY)}`,
    `export ANTHROPIC_MODEL=${shellQuote(env.ANTHROPIC_MODEL)}`,
    `export ANTHROPIC_DEFAULT_OPUS_MODEL=${shellQuote(env.ANTHROPIC_DEFAULT_OPUS_MODEL)}`,
    `export ANTHROPIC_DEFAULT_SONNET_MODEL=${shellQuote(env.ANTHROPIC_DEFAULT_SONNET_MODEL)}`,
    `export ANTHROPIC_DEFAULT_HAIKU_MODEL=${shellQuote(env.ANTHROPIC_DEFAULT_HAIKU_MODEL)}`,
    `export CLAUDE_CODE_SUBAGENT_MODEL=${shellQuote(env.CLAUDE_CODE_SUBAGENT_MODEL)}`,
    `export CLAUDE_CODE_EFFORT_LEVEL=${shellQuote(env.CLAUDE_CODE_EFFORT_LEVEL)}`,
    '# clawai-end',
    '',
  ].join('\n');
}

// 写入或更新 shell 配置文件中的环境变量块
function writeEnvToZshrc(baseUrl, apiKey, model, fastModel, options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'win32') {
    const provider = providerKeyFromBaseUrl(baseUrl);
    const env = buildClaudeEnv({ provider, baseUrl, apiKey, model, fastModel });
    runWindowsEnvCommands(buildWindowsSetEnvCommands(env), options.runner || spawnSync);
    return { result: 'updated', file: WINDOWS_ENV_LABEL };
  }

  const shell = process.env.SHELL || '';
  let rcFile;
  if (shell.includes('bash')) {
    const bashProfile = path.join(os.homedir(), '.bash_profile');
    const bashrc = path.join(os.homedir(), '.bashrc');
    rcFile = (process.platform === 'darwin' && fs.existsSync(bashProfile)) ? bashProfile : bashrc;
  } else {
    rcFile = path.join(os.homedir(), '.zshrc');
  }

  const block = buildEnvBlock(baseUrl, apiKey, model, fastModel);
  const current = fs.existsSync(rcFile) ? fs.readFileSync(rcFile, 'utf8') : '';

  // 兼容旧版（# clawai 单行块）和新版（# clawai-start...# clawai-end 多行块）
  const cleaned = current
    .replace(/\n?# clawai-start[\s\S]*?# clawai-end\n?/g, '')
    .replace(/\n?# clawai\nexport ANTHROPIC_BASE_URL=[^\n]*\nexport ANTHROPIC_API_KEY=[^\n]*\n?/g, '');

  fs.writeFileSync(rcFile, cleaned + block);
  return { result: cleaned !== current ? 'updated' : 'added', file: rcFile };
}

function clearClaudeCodeEnv(options = {}) {
  const cleared = [];
  const platform = options.platform || process.platform;

  if (platform === 'win32') {
    runWindowsEnvCommands(buildWindowsClearEnvCommands(), options.runner || spawnSync, { ignoreErrors: true });
    cleared.push(WINDOWS_ENV_LABEL);
    return cleared;
  }

  // 清理所有可能的 rc 文件中的 clawai 块
  const rcFiles = options.rcFiles || [
    path.join(os.homedir(), '.zshrc'),
    path.join(os.homedir(), '.bashrc'),
    path.join(os.homedir(), '.bash_profile'),
  ];
  for (const f of rcFiles) {
    if (!fs.existsSync(f)) continue;
    const content = fs.readFileSync(f, 'utf8');
    if (!content.includes('# clawai')) continue;
    const cleaned = content
      .replace(/\n?# clawai-start[\s\S]*?# clawai-end\n?/g, '')
      .replace(/\n?# clawai\nexport ANTHROPIC_BASE_URL=[^\n]*\nexport ANTHROPIC_API_KEY=[^\n]*\n?/g, '');
    if (cleaned === content) continue;
    fs.writeFileSync(f, cleaned);
    cleared.push(f);
  }

  return cleared;
}

// 清除所有 clawai 配置（配置文件 + shell 环境变量块）
function resetConfig(options = {}) {
  const cleared = [];
  const configFile = options.configFile || CONFIG_FILE;

  // 删配置文件
  if (fs.existsSync(configFile)) {
    fs.unlinkSync(configFile);
    cleared.push(configFile);
  }

  return [...cleared, ...clearClaudeCodeEnv(options)];
}

module.exports = {
  loadConfig,
  saveConfig,
  writeEnvToZshrc,
  buildWindowsSetEnvCommands,
  buildWindowsClearEnvCommands,
  clearClaudeCodeEnv,
  fetchModels,
  resetConfig,
  validateConfig,
  normalizeModelIds,
  normalizeAnthropicBaseUrl,
  parseModelIdsResponse,
  buildModelUrlCandidates,
  fetchModelsFromBaseUrl,
  resolveFastModel,
  providerKeyFromBaseUrl,
  buildClaudeEnv,
  buildEnvBlock,
  classifyValidationStatus,
  PROVIDERS,
  CONFIG_FILE,
};
