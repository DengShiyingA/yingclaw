const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const {
  loadConfig,
  validateConfig,
  validateKey,
  buildClaudeEnv,
  normalizeAnthropicBaseUrl,
  PROVIDERS,
  CLAUDE_ENV_KEYS,
} = require('./config');
const { isDesktopConfigured } = require('./desktop');

const STATUS_OK = 'ok';
const STATUS_FAIL = 'fail';
const STATUS_WARN = 'warn';
const STATUS_INFO = 'info';

async function runDoctorChecks(options = {}) {
  const checks = [];
  const platform = options.platform || process.platform;
  const env = options.env || process.env;

  // 1. Node 版本
  const nodeVersion = process.versions.node;
  const nodeMajor = parseInt(nodeVersion.split('.')[0], 10);
  checks.push({
    name: 'Node 版本',
    status: nodeMajor >= 18 ? STATUS_OK : STATUS_FAIL,
    message: `v${nodeVersion}${nodeMajor >= 18 ? '' : '（< 18）'}`,
    fix: nodeMajor < 18 ? '从 https://nodejs.org 下载 LTS 版本（≥18）' : null,
  });

  // 2. Claude Code
  let claudeVersion = null;
  try {
    claudeVersion = execSync('claude --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {}
  checks.push({
    name: 'Claude Code',
    status: claudeVersion ? STATUS_OK : STATUS_WARN,
    message: claudeVersion || '未安装',
    fix: claudeVersion ? null : '运行 claw install-claude',
  });

  // 3. 配置文件
  const config = loadConfig();
  if (!config) {
    checks.push({
      name: '配置文件',
      status: STATUS_FAIL,
      message: '~/.clawai.json 不存在',
      fix: '运行 claw config',
    });
    return checks;
  }
  const validation = validateConfig(config);
  if (!validation.valid) {
    checks.push({
      name: '配置文件',
      status: STATUS_FAIL,
      message: `~/.clawai.json 无效：${validation.message}`,
      fix: '运行 claw config 重新配置',
    });
    return checks;
  }
  const provider = PROVIDERS[config.provider];
  checks.push({
    name: '配置文件',
    status: STATUS_OK,
    message: `${provider?.name || config.provider} · ${config.model}`,
  });

  // 4. shell rc / Windows 环境变量已写入
  if (platform === 'win32') {
    const result = checkWindowsEnvVars(options);
    checks.push({
      name: 'Windows 用户环境变量',
      status: result.allWritten ? STATUS_OK : STATUS_WARN,
      message: result.allWritten ? '已写入' : `${result.missing.length} 个变量未写入`,
      fix: result.allWritten ? null : '运行 claw code',
    });
  } else {
    const rcCheck = checkShellRcBlock(options);
    checks.push({
      name: 'shell 配置文件',
      status: rcCheck.found ? STATUS_OK : STATUS_WARN,
      message: rcCheck.found ? `${rcCheck.file} 已写入 yingclaw 块` : '未找到 yingclaw 配置块',
      fix: rcCheck.found ? null : '运行 claw code',
    });
  }

  // 5. 当前终端环境变量是否生效
  const expected = buildClaudeEnv(config);
  const inactive = Object.entries(expected).filter(([k, v]) => env[k] !== v);
  checks.push({
    name: '当前终端环境变量',
    status: inactive.length === 0 ? STATUS_OK : STATUS_WARN,
    message: inactive.length === 0 ? '已生效' : `${inactive.length}/${Object.keys(expected).length} 未生效`,
    fix: inactive.length === 0
      ? null
      : (platform === 'win32' ? '重新打开 PowerShell / CMD' : '运行 source ~/.zshrc 或重开终端'),
  });

  // 6. API Key（顺便确认网络可达）
  const valid = await validateKey(config, { timeoutMs: 6000 });
  if (valid === true) {
    checks.push({ name: 'API Key', status: STATUS_OK, message: '校验通过' });
  } else if (valid === false) {
    checks.push({
      name: 'API Key',
      status: STATUS_FAIL,
      message: '无效或已过期（401/403）',
      fix: '运行 claw config 重新输入 Key',
    });
  } else {
    checks.push({
      name: 'API Key',
      status: STATUS_WARN,
      message: '无法连接（网络 / 服务异常）',
      fix: '检查网络 / VPN，或确认 Base URL 没拼错',
    });
  }

  // 7. Claude 桌面应用接入状态
  const desktopConfigured = isDesktopConfigured();
  checks.push({
    name: 'Claude 桌面应用',
    status: STATUS_INFO,
    message: desktopConfigured ? '已通过 yingclaw 接入' : '未接入（如需运行 claw desktop）',
  });

  // 8. DeepSeek 旧模型名提醒
  if (config.provider === 'deepseek' && (
    config.model === 'deepseek-v4-pro' ||
    config.model === 'deepseek-v4-flash' ||
    config.fastModel === 'deepseek-v4-flash'
  )) {
    checks.push({
      name: '模型名',
      status: STATUS_WARN,
      message: '使用旧 DeepSeek 模型名',
      fix: '运行 claw switch 升级到 [1m] 长上下文版本',
    });
  }

  return checks;
}

function checkShellRcBlock(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const rcFiles = options.rcFiles || [
    path.join(homeDir, '.zshrc'),
    path.join(homeDir, '.bashrc'),
    path.join(homeDir, '.bash_profile'),
  ];
  for (const file of rcFiles) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (content.includes('# clawai-start')) return { found: true, file };
  }
  return { found: false };
}

function checkWindowsEnvVars(options = {}) {
  const runner = options.runner || spawnSync;
  const missing = [];
  for (const key of CLAUDE_ENV_KEYS) {
    const result = runner('reg', ['query', 'HKCU\\Environment', '/V', key], { stdio: 'pipe', encoding: 'utf8' });
    if (result.status !== 0) missing.push(key);
  }
  return { allWritten: missing.length === 0, missing };
}

function summarize(checks) {
  const counts = { ok: 0, fail: 0, warn: 0, info: 0 };
  for (const c of checks) counts[c.status] = (counts[c.status] || 0) + 1;
  return counts;
}

module.exports = {
  runDoctorChecks,
  checkShellRcBlock,
  checkWindowsEnvVars,
  summarize,
  STATUS_OK,
  STATUS_FAIL,
  STATUS_WARN,
  STATUS_INFO,
};
