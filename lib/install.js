function buildClaudeInstallCommand(network) {
  const args = ['install', '-g', '@anthropic-ai/claude-code'];
  if (network === 'cn') {
    args.push('--registry=https://registry.npmmirror.com');
  }
  return { command: 'npm', args };
}

module.exports = { buildClaudeInstallCommand };
