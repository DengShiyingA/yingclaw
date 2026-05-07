const test = require('node:test');
const assert = require('node:assert/strict');

const { buildClaudeEnv } = require('../lib/config');
const { buildMenuStatusLines, buildStatusView } = require('../lib/panel');

test('status view shows main model, fast model, and active shell env without exposing key', () => {
  const config = {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: 'sk-secret-value',
    model: 'deepseek-v4-pro[1m]',
    fastModel: 'deepseek-v4-flash[1m]',
  };

  const view = buildStatusView(config, {
    apiStatus: true,
    claudeInstalled: true,
    env: buildClaudeEnv(config),
  });

  assert.equal(view.providerName, 'DeepSeek');
  assert.equal(view.mainModel, 'deepseek-v4-pro[1m]');
  assert.equal(view.fastModel, 'deepseek-v4-flash[1m]');
  assert.equal(view.envActive, true);
  assert.deepEqual(view.warnings, []);

  const renderedText = view.lines.map((line) => `${line.label} ${line.value}`).join('\n');
  assert.match(renderedText, /主模型\s+deepseek-v4-pro\[1m\]/);
  assert.match(renderedText, /快速模型\s+deepseek-v4-flash/);
  assert.match(renderedText, /API Key\s+已保存/);
  assert.match(renderedText, /当前终端\s+已生效/);
  assert.doesNotMatch(renderedText, /sk-secret-value|sk-secret|sk-/);
});

test('status view warns about legacy DeepSeek model and derives fast model', () => {
  const view = buildStatusView({
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: 'sk-secret-value',
    model: 'deepseek-v4-pro',
  }, {
    apiStatus: null,
    claudeInstalled: false,
    env: {},
  });

  assert.equal(view.fastModel, 'deepseek-v4-flash[1m]');
  assert.equal(view.envActive, false);
  assert.deepEqual(view.warnings, [
    '检测到旧 DeepSeek 模型名，建议运行 claw switch 更新到 [1m] 长上下文版本',
  ]);
});

test('status view warns when DeepSeek fastModel still uses legacy non-[1m] name', () => {
  const view = buildStatusView({
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: 'sk-secret-value',
    model: 'deepseek-v4-pro[1m]',
    fastModel: 'deepseek-v4-flash',
  }, { env: {} });

  assert.deepEqual(view.warnings, [
    '检测到旧 DeepSeek 模型名，建议运行 claw switch 更新到 [1m] 长上下文版本',
  ]);
});

test('status view uses custom provider display name', () => {
  const view = buildStatusView({
    provider: 'custom',
    providerName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/anthropic',
    apiKey: 'sk-secret-value',
    model: 'custom-main',
    fastModel: 'custom-fast',
  }, {
    env: {},
  });

  assert.equal(view.providerName, 'OpenRouter');
  assert.equal(view.mainModel, 'custom-main');
  assert.equal(view.fastModel, 'custom-fast');
});

test('menu status lines are short and explain env and legacy model states', () => {
  const lines = buildMenuStatusLines({
    providerName: 'DeepSeek',
    mainModel: 'deepseek-v4-pro',
    fastModel: 'deepseek-v4-flash[1m]',
    envActive: false,
    warnings: ['检测到旧 DeepSeek 模型名，建议运行 claw switch 更新到 deepseek-v4-pro[1m]'],
  }, {
    apiStatus: true,
    claudeInstalled: true,
  });

  assert.deepEqual(lines, [
    'Claude 已安装 · DeepSeek · API 正常',
    '环境变量未生效：运行 source ~/.zshrc 或重开终端',
    '主模型 deepseek-v4-pro · 快速模型 deepseek-v4-flash[1m]',
    '旧模型名：选择下方"切换厂商或模型"更新到 [1m]',
  ]);
  assert.ok(lines.every((line) => line.length <= 72));
});

test('menu status lines use Windows activation hint on win32', () => {
  const lines = buildMenuStatusLines({
    providerName: 'Kimi / Moonshot',
    mainModel: 'kimi-k2.5',
    fastModel: 'kimi-k2.5',
    envActive: false,
    warnings: [],
  }, {
    apiStatus: true,
    claudeInstalled: true,
    platform: 'win32',
  });

  assert.equal(lines[1], '环境变量未生效：重新打开 PowerShell / CMD');
});
