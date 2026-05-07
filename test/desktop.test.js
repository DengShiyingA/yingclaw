const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildClaudeDesktopEnterpriseConfig,
  buildClaudeDesktopOpenCommands,
  clearClaudeDesktopConfig,
  getClaudeDesktopConfigPath,
  isDesktopConfigured,
  openClaudeDesktop,
  writeClaudeDesktopConfig,
} = require('../lib/desktop');

test('buildClaudeDesktopEnterpriseConfig configures gateway mode for current model', () => {
  const config = buildClaudeDesktopEnterpriseConfig({
    baseUrl: 'https://api.moonshot.ai/anthropic',
    apiKey: 'sk-test',
    model: 'kimi-k2.5',
    fastModel: 'kimi-k2.5',
  }, {
    uuid: '11111111-1111-4111-8111-111111111111',
  });

  assert.equal(config.inferenceProvider, 'gateway');
  assert.equal(config.inferenceGatewayBaseUrl, 'https://api.moonshot.ai/anthropic');
  assert.equal(config.inferenceGatewayApiKey, 'sk-test');
  assert.equal(config.inferenceGatewayAuthScheme, 'bearer');
  assert.equal(config.disableDeploymentModeChooser, 'true');
  assert.equal(config.deploymentOrganizationUuid, '11111111-1111-4111-8111-111111111111');
  assert.deepEqual(JSON.parse(config.inferenceModels), ['claude-kimi-k2.5']);
});

test('buildClaudeDesktopEnterpriseConfig uses provider model ids for legacy desktop config', () => {
  const config = buildClaudeDesktopEnterpriseConfig({
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: 'sk-test',
    model: 'deepseek-v4-pro[1m]',
    fastModel: 'deepseek-v4-flash[1m]',
    availableModels: ['deepseek-v4-pro[1m]', 'deepseek-v4-flash[1m]', 'deepseek-v4-coder'],
  }, { uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });

  assert.deepEqual(JSON.parse(config.inferenceModels), [
    'claude-deepseek-v4-pro[1m]',
    'claude-deepseek-v4-flash[1m]',
    'claude-deepseek-v4-coder',
  ]);
});

test('buildClaudeDesktopEnterpriseConfig adds claude- prefix so Claude Desktop accepts the model', () => {
  for (const [provider, baseUrl, model, expected] of [
    ['mimo',    'https://api.xiaomimimo.com/anthropic',          'mimo-v2.5-pro',  'claude-mimo-v2.5-pro'],
    ['qwen',    'https://dashscope.aliyuncs.com/apps/anthropic', 'qwen3-max',      'claude-qwen3-max'],
    ['minimax', 'https://api.minimaxi.com/anthropic',            'MiniMax-M2.7',   'claude-MiniMax-M2.7'],
    ['glm',     'https://open.bigmodel.cn/api/anthropic',        'GLM-4.7',        'claude-GLM-4.7'],
  ]) {
    const config = buildClaudeDesktopEnterpriseConfig({
      provider, baseUrl, apiKey: 'sk-test', model, fastModel: model,
    }, { uuid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
    assert.equal(JSON.parse(config.inferenceModels)[0], expected, `${provider} model should have claude- prefix`);
  }
});

test('getClaudeDesktopConfigPath returns legacy Claude-3p config file on macOS and Windows', () => {
  assert.equal(
    getClaudeDesktopConfigPath({ platform: 'darwin', homeDir: '/Users/alice' }),
    '/Users/alice/Library/Application Support/Claude-3p/claude_desktop_config.json',
  );
  assert.equal(
    getClaudeDesktopConfigPath({ platform: 'win32', appData: 'C:\\Users\\Alice\\AppData\\Roaming' }),
    'C:\\Users\\Alice\\AppData\\Roaming\\Claude-3p\\claude_desktop_config.json',
  );
  assert.equal(getClaudeDesktopConfigPath({ platform: 'linux', homeDir: '/home/alice' }), null);
});

test('writeClaudeDesktopConfig writes configLibrary entry and sets deploymentMode', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yingclaw-desktop-'));
  const dataDir = path.join(tmpDir, 'Claude-3p');
  const configLibraryDir = path.join(dataDir, 'configLibrary');
  const oldUuid = '65845bbe-5f97-4217-8472-4cc12e1d2999';
  fs.mkdirSync(configLibraryDir, { recursive: true });
  fs.writeFileSync(path.join(configLibraryDir, '_meta.json'), JSON.stringify({
    appliedId: oldUuid,
    entries: [{ id: oldUuid, name: 'Default' }],
  }));
  fs.writeFileSync(path.join(configLibraryDir, `${oldUuid}.json`), JSON.stringify({
    inferenceProvider: 'gateway',
    inferenceGatewayBaseUrl: 'https://api.deepseek.com',
    inferenceGatewayApiKey: 'sk-old',
  }));

  const result = writeClaudeDesktopConfig({
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/anthropic/v1/messages',
    apiKey: 'sk-test',
    model: 'deepseek-v4-pro[1m]',
    fastModel: 'deepseek-v4-flash[1m]',
  }, { dataDir });

  assert.equal(result.result, 'updated');

  // 主配置只写 deploymentMode
  const mainConfig = JSON.parse(fs.readFileSync(path.join(dataDir, 'claude_desktop_config.json'), 'utf8'));
  assert.equal(mainConfig.deploymentMode, '3p');
  assert.equal(mainConfig.enterpriseConfig, undefined);

  // configLibrary 写入了正确的 entry（复用旧 uuid）
  const meta = JSON.parse(fs.readFileSync(path.join(configLibraryDir, '_meta.json'), 'utf8'));
  assert.equal(meta.appliedId, oldUuid);
  const entry = JSON.parse(fs.readFileSync(path.join(configLibraryDir, `${oldUuid}.json`), 'utf8'));
  assert.equal(entry.inferenceProvider, 'gateway');
  assert.equal(entry.inferenceGatewayBaseUrl, 'https://api.deepseek.com/anthropic');
  assert.equal(entry.inferenceGatewayApiKey, 'sk-test');
  assert.equal(entry.inferenceGatewayAuthScheme, 'bearer');
  assert.equal(entry.disableDeploymentModeChooser, true);
  assert.deepEqual(entry.inferenceModels, ['claude-deepseek-v4-pro[1m]', 'claude-deepseek-v4-flash[1m]']);
});

test('writeClaudeDesktopConfig rejects non-HTTPS gateway URLs', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yingclaw-desktop-'));

  assert.throws(() => writeClaudeDesktopConfig({
    baseUrl: 'http://127.0.0.1:8080/anthropic',
    apiKey: 'sk-test',
    model: 'local-model',
  }, {
    configFile: path.join(tmpDir, 'claude_desktop_config.json'),
  }), /Claude 桌面应用要求 Gateway Base URL 使用 HTTPS/);
});

test('clearClaudeDesktopConfig removes legacy enterpriseConfig and deploymentMode', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yingclaw-desktop-'));
  const file = path.join(tmpDir, 'claude_desktop_config.json');
  fs.writeFileSync(file, JSON.stringify({
    theme: 'dark',
    deploymentMode: '3p',
    enterpriseConfig: {
      inferenceProvider: 'gateway',
      inferenceGatewayBaseUrl: 'https://api.deepseek.com/anthropic',
      inferenceGatewayApiKey: 'sk-test',
      inferenceGatewayAuthScheme: 'bearer',
      inferenceModels: '["deepseek-v4-pro"]',
      disableDeploymentModeChooser: 'true',
      deploymentOrganizationUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
  }));

  const result = clearClaudeDesktopConfig({ configFile: file });

  assert.equal(result.result, 'updated');
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(after, { theme: 'dark' });
});

test('clearClaudeDesktopConfig clears configLibrary and deploymentMode (new format)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yingclaw-desktop-'));
  const dataDir = path.join(tmpDir, 'Claude-3p');
  const configLibraryDir = path.join(dataDir, 'configLibrary');
  const uuid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  fs.mkdirSync(configLibraryDir, { recursive: true });
  fs.writeFileSync(path.join(configLibraryDir, '_meta.json'), JSON.stringify({ appliedId: uuid, entries: [{ id: uuid }] }));
  fs.writeFileSync(path.join(configLibraryDir, `${uuid}.json`), JSON.stringify({ inferenceProvider: 'gateway' }));
  fs.writeFileSync(path.join(dataDir, 'claude_desktop_config.json'), JSON.stringify({ deploymentMode: '3p', preferences: { theme: 'dark' } }));

  const result = clearClaudeDesktopConfig({ dataDir });

  assert.equal(result.result, 'updated');
  // configLibrary files are gone
  assert.equal(fs.existsSync(path.join(configLibraryDir, '_meta.json')), false);
  assert.equal(fs.existsSync(path.join(configLibraryDir, `${uuid}.json`)), false);
  // deploymentMode removed, other prefs preserved
  const after = JSON.parse(fs.readFileSync(path.join(dataDir, 'claude_desktop_config.json'), 'utf8'));
  assert.deepEqual(after, { preferences: { theme: 'dark' } });
});

test('isDesktopConfigured returns true when configLibrary has appliedId', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yingclaw-desktop-'));
  const dataDir = path.join(tmpDir, 'Claude-3p');
  const uuid = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  fs.mkdirSync(path.join(dataDir, 'configLibrary'), { recursive: true });

  assert.equal(isDesktopConfigured({ dataDir }), false);

  fs.writeFileSync(path.join(dataDir, 'configLibrary', '_meta.json'), JSON.stringify({ appliedId: uuid }));
  assert.equal(isDesktopConfigured({ dataDir }), true);
});

test('buildClaudeDesktopOpenCommands quits, SIGTERM, SIGKILL, opens, then activates on macOS', () => {
  assert.deepEqual(buildClaudeDesktopOpenCommands('darwin'), [
    { command: 'osascript', args: ['-e', 'tell application "Claude" to quit'], optional: true, waitAfter: 800 },
    { command: 'pkill', args: ['-TERM', '-x', 'Claude'], optional: true, waitAfter: 500 },
    { command: 'pkill', args: ['-KILL', '-x', 'Claude'], optional: true, waitAfter: 800 },
    { command: 'open', args: ['-a', 'Claude'], waitAfter: 600 },
    { command: 'osascript', args: ['-e', 'tell application "Claude" to activate'], optional: true },
  ]);
  assert.equal(buildClaudeDesktopOpenCommands('win32'), null);
});

test('openClaudeDesktop walks the full quit→kill→open→activate chain', async () => {
  const calls = [];
  const result = await openClaudeDesktop({
    platform: 'darwin',
    runner: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
    timeoutMs: 1234,
  });

  assert.equal(result.result, 'reopened');
  assert.deepEqual(
    calls.map(c => `${c.command} ${c.args.join(' ')}`),
    [
      'osascript -e tell application "Claude" to quit',
      'pkill -TERM -x Claude',
      'pkill -KILL -x Claude',
      'open -a Claude',
      'osascript -e tell application "Claude" to activate',
    ],
  );
  assert.deepEqual(calls.map(c => c.options.timeout), [1234, 1234, 1234, 1234, 1234]);
});

test('openClaudeDesktop tolerates Claude not currently running', async () => {
  const result = await openClaudeDesktop({
    platform: 'darwin',
    runner: (command) => {
      // both quit attempts fail (app not running), open still succeeds
      return command === 'open' ? { status: 0 } : { status: 1 };
    },
  });

  assert.equal(result.result, 'reopened');
});
