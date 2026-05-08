const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  checkShellRcBlock,
  checkWindowsEnvVars,
  summarize,
  STATUS_OK,
  STATUS_FAIL,
  STATUS_WARN,
  STATUS_INFO,
} = require('../lib/doctor');

test('checkShellRcBlock finds clawai-start marker in any rc file', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yingclaw-doctor-'));
  const zshrc = path.join(tmpDir, '.zshrc');
  const bashrc = path.join(tmpDir, '.bashrc');

  // 都没有时
  assert.deepEqual(checkShellRcBlock({ rcFiles: [zshrc, bashrc] }), { found: false });

  // 写入空 rc
  fs.writeFileSync(zshrc, '# nothing yingclaw related\nexport PATH=$PATH:/usr/local/bin\n');
  assert.deepEqual(checkShellRcBlock({ rcFiles: [zshrc, bashrc] }), { found: false });

  // 写入 yingclaw 块
  fs.writeFileSync(bashrc, '# clawai-start\nexport ANTHROPIC_BASE_URL=foo\n# clawai-end\n');
  assert.deepEqual(checkShellRcBlock({ rcFiles: [zshrc, bashrc] }), { found: true, file: bashrc });
});

test('checkWindowsEnvVars reports each missing key', () => {
  const calls = [];
  const result = checkWindowsEnvVars({
    runner: (command, args) => {
      calls.push(args[args.length - 1]);
      // 模拟 ANTHROPIC_BASE_URL 已写但其它都没写
      return { status: args[args.length - 1] === 'ANTHROPIC_BASE_URL' ? 0 : 1 };
    },
  });
  assert.equal(result.allWritten, false);
  assert.ok(result.missing.includes('ANTHROPIC_AUTH_TOKEN'));
  assert.ok(!result.missing.includes('ANTHROPIC_BASE_URL'));
  assert.ok(calls.length > 5);
});

test('checkWindowsEnvVars allWritten=true when every reg query returns 0', () => {
  const result = checkWindowsEnvVars({ runner: () => ({ status: 0 }) });
  assert.equal(result.allWritten, true);
  assert.deepEqual(result.missing, []);
});

test('summarize counts each status bucket', () => {
  const counts = summarize([
    { status: STATUS_OK }, { status: STATUS_OK },
    { status: STATUS_WARN },
    { status: STATUS_FAIL }, { status: STATUS_FAIL },
    { status: STATUS_INFO },
  ]);
  assert.equal(counts.ok, 2);
  assert.equal(counts.warn, 1);
  assert.equal(counts.fail, 2);
  assert.equal(counts.info, 1);
});
