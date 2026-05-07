const test = require('node:test');
const assert = require('node:assert/strict');

const { buildClaudeInstallCommand } = require('../lib/install');

test('buildClaudeInstallCommand uses npm argv for official registry', () => {
  assert.deepEqual(buildClaudeInstallCommand('vpn'), {
    command: 'npm',
    args: ['install', '-g', '@anthropic-ai/claude-code'],
  });
});

test('buildClaudeInstallCommand uses npm argv for China registry', () => {
  assert.deepEqual(buildClaudeInstallCommand('cn'), {
    command: 'npm',
    args: ['install', '-g', '@anthropic-ai/claude-code', '--registry=https://registry.npmmirror.com'],
  });
});
