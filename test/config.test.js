const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildWindowsClearEnvCommands,
  buildWindowsSetEnvCommands,
  buildClaudeEnv,
  buildEnvBlock,
  classifyValidationStatus,
  buildModelUrlCandidates,
  fetchModelsFromBaseUrl,
  normalizeModelIds,
  normalizeAnthropicBaseUrl,
  parseModelIdsResponse,
  clearClaudeCodeEnv,
  resetConfig,
  validateConfig,
  writeEnvToZshrc,
  PROVIDERS,
} = require('../lib/config');

test('DeepSeek fallback uses documented pro [1m] model and flash fast model', () => {
  assert.equal(PROVIDERS.deepseek.models[0].value, 'deepseek-v4-pro[1m]');
  assert.equal(PROVIDERS.deepseek.models[1].value, 'deepseek-v4-flash[1m]');
  assert.equal(PROVIDERS.deepseek.fastModel, 'deepseek-v4-flash[1m]');
});

test('Kimi provider uses Moonshot Anthropic endpoint and K2.5 defaults', () => {
  assert.equal(PROVIDERS.kimi.name, 'Kimi / Moonshot');
  assert.equal(PROVIDERS.kimi.baseUrl, 'https://api.moonshot.ai/anthropic');
  assert.equal(PROVIDERS.kimi.modelsUrl, 'https://api.moonshot.ai/v1/models');
  assert.equal(PROVIDERS.kimi.models[0].value, 'kimi-k2.5');
  assert.equal(PROVIDERS.kimi.fastModel, 'kimi-k2.5');
});

test('buildClaudeEnv uses Kimi K2.5 as both main and fast model', () => {
  const env = buildClaudeEnv({
    provider: 'kimi',
    baseUrl: 'https://api.moonshot.ai/anthropic',
    apiKey: 'sk-test',
    model: 'kimi-k2.5',
  });

  assert.equal(env.ANTHROPIC_MODEL, 'kimi-k2.5');
  assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'kimi-k2.5');
  assert.equal(env.CLAUDE_CODE_SUBAGENT_MODEL, 'kimi-k2.5');
});

test('buildClaudeEnv maps main and fast models to Claude Code variables', () => {
  const env = buildClaudeEnv({
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: 'sk-test',
    model: 'deepseek-v4-pro[1m]',
    fastModel: 'deepseek-v4-flash[1m]',
  });

  assert.equal(env.ANTHROPIC_BASE_URL, 'https://api.deepseek.com/anthropic');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'sk-test');
  assert.equal(env.ANTHROPIC_API_KEY, 'sk-test');
  assert.equal(env.ANTHROPIC_MODEL, 'deepseek-v4-pro[1m]');
  assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'deepseek-v4-pro[1m]');
  assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'deepseek-v4-pro[1m]');
  assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek-v4-flash[1m]');
  assert.equal(env.CLAUDE_CODE_SUBAGENT_MODEL, 'deepseek-v4-flash[1m]');
  assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL, 'max');
});

test('buildClaudeEnv derives fast model for legacy DeepSeek config without fastModel', () => {
  const env = buildClaudeEnv({
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: 'sk-test',
    model: 'deepseek-v4-pro[1m]',
  });

  assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'deepseek-v4-flash[1m]');
  assert.equal(env.CLAUDE_CODE_SUBAGENT_MODEL, 'deepseek-v4-flash[1m]');
});

test('classifyValidationStatus only treats 2xx as valid', () => {
  assert.equal(classifyValidationStatus(200), true);
  assert.equal(classifyValidationStatus(204), true);
  assert.equal(classifyValidationStatus(401), false);
  assert.equal(classifyValidationStatus(403), false);
  assert.equal(classifyValidationStatus(404), null);
  assert.equal(classifyValidationStatus(429), null);
  assert.equal(classifyValidationStatus(500), null);
});

test('normalizeModelIds maps DeepSeek online pro model to documented [1m] name', () => {
  assert.deepEqual(
    normalizeModelIds('deepseek', ['deepseek-v4-flash[1m]', 'deepseek-v4-pro']),
    ['deepseek-v4-pro[1m]', 'deepseek-v4-flash[1m]'],
  );
});

test('buildEnvBlock safely quotes shell values', () => {
  const block = buildEnvBlock('https://example.com/anthropic', 'sk-"$`\\test', 'deepseek-v4-pro[1m]', 'deepseek-v4-flash[1m]');

  assert.match(block, /export ANTHROPIC_AUTH_TOKEN='sk-"\$`\\test'/);
  assert.match(block, /export ANTHROPIC_API_KEY='sk-"\$`\\test'/);
  assert.match(block, /export ANTHROPIC_MODEL='deepseek-v4-pro\[1m\]'/);
  assert.match(block, /export ANTHROPIC_DEFAULT_HAIKU_MODEL='deepseek-v4-flash\[1m\]'/);
});

test('buildEnvBlock derives DeepSeek fast model when called without explicit fastModel', () => {
  const block = buildEnvBlock('https://api.deepseek.com/anthropic', 'sk-test', 'deepseek-v4-pro[1m]');

  assert.match(block, /export ANTHROPIC_DEFAULT_HAIKU_MODEL='deepseek-v4-flash\[1m\]'/);
  assert.match(block, /export CLAUDE_CODE_SUBAGENT_MODEL='deepseek-v4-flash\[1m\]'/);
});

test('validateConfig rejects incomplete or unknown saved config', () => {
  assert.equal(validateConfig(null).valid, false);
  assert.equal(validateConfig({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-v4-pro[1m]' }).valid, false);
  assert.equal(validateConfig({ provider: 'unknown', baseUrl: 'https://example.com', apiKey: 'sk-test', model: 'x' }).valid, false);
  assert.equal(validateConfig({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/anthropic', apiKey: 'sk-test', model: 'deepseek-v4-pro[1m]' }).valid, true);
});

test('custom provider validates with user supplied endpoint and model', () => {
  assert.equal(PROVIDERS.custom.custom, true);
  assert.equal(validateConfig({
    provider: 'custom',
    providerName: '自定义接口',
    baseUrl: 'https://example.com/anthropic',
    modelsUrl: 'https://example.com/v1/models',
    apiKey: 'sk-test',
    model: 'custom-main',
    fastModel: 'custom-fast',
  }).valid, true);
});

test('parseModelIdsResponse reads OpenAI compatible model lists for custom provider', () => {
  assert.deepEqual(
    parseModelIdsResponse('custom', JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] })),
    ['model-a', 'model-b'],
  );
});

test('buildModelUrlCandidates derives common model endpoints from custom base URL', () => {
  assert.deepEqual(
    buildModelUrlCandidates('https://api.deepseek.com/anthropic'),
    [
      'https://api.deepseek.com/anthropic/v1/models',
      'https://api.deepseek.com/v1/models',
    ],
  );
  assert.deepEqual(
    buildModelUrlCandidates('https://example.com/api/anthropic/'),
    [
      'https://example.com/api/anthropic/v1/models',
      'https://example.com/api/v1/models',
      'https://example.com/v1/models',
    ],
  );
});

test('normalizeAnthropicBaseUrl removes copied request paths', () => {
  assert.equal(
    normalizeAnthropicBaseUrl('https://example.com/anthropic/v1/messages/'),
    'https://example.com/anthropic',
  );
  assert.equal(
    normalizeAnthropicBaseUrl('http://127.0.0.1:8080/v1'),
    'http://127.0.0.1:8080',
  );
  assert.equal(
    normalizeAnthropicBaseUrl('https://example.com/api/anthropic/'),
    'https://example.com/api/anthropic',
  );
});

test('fetchModelsFromBaseUrl tries derived model endpoints until one works', async () => {
  const calls = [];
  const fetcher = async (providerKey, apiKey, modelsUrl) => {
    calls.push({ providerKey, apiKey, modelsUrl });
    if (modelsUrl === 'https://api.deepseek.com/v1/models') return ['deepseek-v4-pro[1m]', 'deepseek-v4-flash[1m]'];
    return null;
  };

  const result = await fetchModelsFromBaseUrl('custom', 'sk-test', 'https://api.deepseek.com/anthropic', fetcher);

  assert.deepEqual(result, {
    modelsUrl: 'https://api.deepseek.com/v1/models',
    models: ['deepseek-v4-pro[1m]', 'deepseek-v4-flash[1m]'],
  });
  assert.deepEqual(calls.map(call => call.modelsUrl), [
    'https://api.deepseek.com/anthropic/v1/models',
    'https://api.deepseek.com/v1/models',
  ]);
});

test('fetchModelsFromBaseUrl normalizes models when custom base URL matches known provider', async () => {
  const fetcher = async () => ['deepseek-v4-flash[1m]', 'deepseek-v4-pro'];

  const result = await fetchModelsFromBaseUrl('custom', 'sk-test', 'https://api.deepseek.com/anthropic', fetcher);

  assert.deepEqual(result.models, ['deepseek-v4-pro[1m]', 'deepseek-v4-flash[1m]']);
});

test('fetchModels supports http custom model endpoints', async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.headers.authorization, 'Bearer sk-test');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'gpt-5.4-mini' }] }));
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const models = await require('../lib/config').fetchModels('custom', 'sk-test', `http://127.0.0.1:${port}/v1/models`);
    assert.deepEqual(models, ['gpt-5.4-mini']);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('Windows env writer persists Claude Code variables with setx', () => {
  const calls = [];
  const result = writeEnvToZshrc(
    'https://api.moonshot.ai/anthropic',
    'sk-test',
    'kimi-k2.5',
    'kimi-k2.5',
    {
      platform: 'win32',
      runner: (command, args) => {
        calls.push({ command, args });
        return { status: 0 };
      },
    },
  );

  assert.equal(result.file, 'Windows 用户环境变量');
  assert.equal(result.result, 'updated');
  assert.ok(calls.some(call => call.command === 'setx' && call.args[0] === 'ANTHROPIC_BASE_URL' && call.args[1] === 'https://api.moonshot.ai/anthropic'));
  assert.ok(calls.some(call => call.command === 'setx' && call.args[0] === 'ANTHROPIC_MODEL' && call.args[1] === 'kimi-k2.5'));
  assert.ok(calls.some(call => call.command === 'setx' && call.args[0] === 'CLAUDE_CODE_SUBAGENT_MODEL' && call.args[1] === 'kimi-k2.5'));
});

test('Windows reset removes persisted Claude Code variables', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yingclaw-test-'));
  const configFile = path.join(tmpDir, '.clawai.json');
  fs.writeFileSync(configFile, '{}');
  const calls = [];

  const cleared = resetConfig({
    platform: 'win32',
    configFile,
    rcFiles: [],
    runner: (command, args) => {
      calls.push({ command, args });
      return { status: 0 };
    },
  });

  assert.deepEqual(cleared, [configFile, 'Windows 用户环境变量']);
  assert.ok(calls.some(call => call.command === 'reg' && call.args.includes('ANTHROPIC_BASE_URL')));
  assert.ok(calls.some(call => call.command === 'reg' && call.args.includes('CLAUDE_CODE_SUBAGENT_MODEL')));
});

test('Windows env command builders cover all Claude Code variables', () => {
  const env = buildClaudeEnv({
    provider: 'kimi',
    baseUrl: 'https://api.moonshot.ai/anthropic',
    apiKey: 'sk-test',
    model: 'kimi-k2.5',
  });
  const setCommands = buildWindowsSetEnvCommands(env);
  const clearCommands = buildWindowsClearEnvCommands();

  assert.equal(setCommands.length, Object.keys(env).length);
  assert.deepEqual(setCommands[0], { command: 'setx', args: ['ANTHROPIC_BASE_URL', 'https://api.moonshot.ai/anthropic'] });
  assert.ok(clearCommands.some(command => command.args.includes('ANTHROPIC_AUTH_TOKEN')));
  assert.ok(clearCommands.every(command => command.command === 'reg'));
});

test('clearClaudeCodeEnv removes shell env blocks without deleting saved API config', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yingclaw-test-'));
  const rcFile = path.join(tmpDir, '.zshrc');
  const configFile = path.join(tmpDir, '.clawai.json');

  fs.writeFileSync(configFile, JSON.stringify({
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/anthropic',
    apiKey: 'sk-test',
    model: 'deepseek-v4-pro[1m]',
    fastModel: 'deepseek-v4-flash[1m]',
  }));
  fs.writeFileSync(rcFile, [
    'export KEEP_ME=1',
    '# clawai-start',
    "export ANTHROPIC_BASE_URL='https://api.deepseek.com/anthropic'",
    "export ANTHROPIC_API_KEY='sk-test'",
    '# clawai-end',
    '',
  ].join('\n'));

  const cleared = clearClaudeCodeEnv({ rcFiles: [rcFile] });

  assert.deepEqual(cleared, [rcFile]);
  assert.equal(fs.existsSync(configFile), true);
  assert.equal(fs.readFileSync(rcFile, 'utf8'), 'export KEEP_ME=1');
});

test('clearClaudeCodeEnv clears Windows user env without deleting saved API config', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yingclaw-test-'));
  const configFile = path.join(tmpDir, '.clawai.json');
  fs.writeFileSync(configFile, '{}');
  const calls = [];

  const cleared = clearClaudeCodeEnv({
    platform: 'win32',
    runner: (command, args) => {
      calls.push({ command, args });
      return { status: 0 };
    },
  });

  assert.deepEqual(cleared, ['Windows 用户环境变量']);
  assert.equal(fs.existsSync(configFile), true);
  assert.ok(calls.some(call => call.command === 'reg' && call.args.includes('ANTHROPIC_BASE_URL')));
  assert.ok(calls.some(call => call.command === 'reg' && call.args.includes('CLAUDE_CODE_SUBAGENT_MODEL')));
});
