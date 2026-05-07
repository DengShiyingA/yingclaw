const test = require('node:test');
const assert = require('node:assert/strict');

test('package entry can be required', () => {
  const entry = require('..');

  assert.ok(entry.PROVIDERS.deepseek);
  assert.equal(typeof entry.buildClaudeEnv, 'function');
  assert.equal(typeof entry.clearClaudeCodeEnv, 'function');
  assert.equal(typeof entry.writeClaudeDesktopConfig, 'function');
});

test('package publishes only runtime files', () => {
  const pkg = require('../package.json');

  assert.deepEqual(pkg.files, ['bin', 'lib', 'index.js', 'README.md']);
});
