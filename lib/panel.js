const { buildClaudeEnv, PROVIDERS } = require('./config');

function apiStatusText(apiStatus) {
  if (apiStatus === true) return 'API 正常';
  if (apiStatus === false) return 'API Key 无效';
  if (apiStatus === null) return '网络/服务异常';
  return '未检测';
}

function isEnvActive(config, env) {
  const expected = buildClaudeEnv(config);
  return Object.entries(expected).every(([key, value]) => env[key] === value);
}

function buildStatusView(config, options = {}) {
  const provider = PROVIDERS[config.provider];
  const providerName = config.providerName || provider?.name || config.provider;
  const claudeInstalled = options.claudeInstalled === true;
  const env = options.env || {};
  const expectedEnv = buildClaudeEnv(config);
  const mainModel = expectedEnv.ANTHROPIC_MODEL;
  const fastModel = expectedEnv.CLAUDE_CODE_SUBAGENT_MODEL;
  const envActive = isEnvActive(config, env);
  const warnings = [];

  if (config.provider === 'deepseek' && config.model === 'deepseek-v4-pro') {
    warnings.push('检测到旧 DeepSeek 模型名，建议运行 claw switch 更新到 deepseek-v4-pro[1m]');
  }

  return {
    providerName,
    mainModel,
    fastModel,
    envActive,
    warnings,
    lines: [
      { label: '厂商', value: providerName },
      { label: '主模型', value: mainModel },
      { label: '快速模型', value: fastModel },
      { label: 'API Key', value: '已保存' },
      { label: 'API 状态', value: apiStatusText(options.apiStatus) },
      { label: 'Claude Code', value: claudeInstalled ? '已安装' : '未检测到' },
      { label: '当前终端', value: envActive ? '已生效' : '未生效' },
      { label: 'Base URL', value: config.baseUrl },
    ],
  };
}

function buildMenuStatusLines(view, options = {}) {
  const claudeText = options.claudeInstalled ? 'Claude 已安装' : 'Claude 未安装';
  const lines = [
    `${claudeText} · ${view.providerName} · ${apiStatusText(options.apiStatus)}`,
  ];

  if (view.envActive) {
    lines.push('环境变量已生效');
  } else if (options.platform === 'win32') {
    lines.push('环境变量未生效：重新打开 PowerShell / CMD');
  } else {
    lines.push('环境变量未生效：运行 source ~/.zshrc 或重开终端');
  }

  lines.push(`主模型 ${view.mainModel} · 快速模型 ${view.fastModel}`);

  if (view.warnings.some((warning) => warning.includes('旧 DeepSeek 模型名'))) {
    lines.push('旧模型名：选择下方“切换厂商或模型”更新');
  }

  return lines;
}

module.exports = { buildMenuStatusLines, buildStatusView, apiStatusText, isEnvActive };
