#!/usr/bin/env node

const { Command } = require('commander');
const { select, input, confirm } = require('@inquirer/prompts');
const {
  loadConfig,
  saveConfig,
  writeEnvToZshrc,
  clearClaudeCodeEnv,
  fetchModels,
  fetchModelsFromBaseUrl,
  resetConfig,
  validateConfig,
  validateKey,
  normalizeAnthropicBaseUrl,
  resolveFastModel,
  buildClaudeEnv,
  PROVIDERS,
  CLAUDE_ENV_KEYS,
} = require('../lib/config');
const { execSync, spawn, spawnSync } = require('child_process');
const pkg = require('../package.json');
const { buildMenuStatusLines, buildStatusView } = require('../lib/panel');
const { buildClaudeInstallCommand } = require('../lib/install');
const { clearClaudeDesktopConfig, isDesktopConfigured, openClaudeDesktop, writeClaudeDesktopConfig } = require('../lib/desktop');
const { runDoctorChecks, summarize, STATUS_OK, STATUS_FAIL, STATUS_WARN, STATUS_INFO } = require('../lib/doctor');

const program = new Command();

async function getBanner() {
  const chalk = (await import('chalk')).default;
  const figlet = require('figlet');
  const boxen = (await import('boxen')).default;
  const title = figlet.textSync('yingclaw', { font: 'Small', horizontalLayout: 'fitted' });
  const subtitle = chalk.dim('Claude Code × 国产大模型 一键接入') + '   ' + chalk.cyan(`v${pkg.version}`);
  return boxen(
    chalk.cyan.bold(title) + '\n' + subtitle,
    { padding: { top: 0, bottom: 0, left: 2, right: 2 }, borderStyle: 'round', borderColor: 'cyan', margin: { top: 1, bottom: 0 } }
  );
}

function getConfigValidationMessage(config) {
  const validation = validateConfig(config);
  return validation.valid ? null : validation.message;
}

let _claudeInstalledCache;
function isClaudeInstalled() {
  if (_claudeInstalledCache !== undefined) return _claudeInstalledCache;
  try {
    execSync('claude --version', { stdio: 'pipe' });
    _claudeInstalledCache = true;
  } catch {
    _claudeInstalledCache = false;
  }
  return _claudeInstalledCache;
}

function invalidateClaudeInstalledCache() {
  _claudeInstalledCache = undefined;
}

function isValidUrl(value) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function getActivationHint(file) {
  if (file === 'Windows 用户环境变量') {
    return '重新打开 PowerShell / CMD 后生效';
  }
  return `运行 source ${file} 生效，或重新开一个终端`;
}

function getStorageHint(file) {
  if (file === 'Windows 用户环境变量') {
    return `⚠ API Key 以明文存储在 ${file} 和用户主目录下的 .clawai.json`;
  }
  return `⚠ API Key 以明文存储在 ${file} 和 ~/.clawai.json`;
}

function getDesktopOpenHint() {
  return '请打开 Claude 桌面应用；如配置未生效，请完全退出后重新打开';
}

function getSavedConfigHint() {
  return '⚠ API Key 以明文存储在 ~/.clawai.json';
}

async function offerDesktopSync(chalk, ora, config) {
  if (!isDesktopConfigured()) return;
  const syncDesktop = await confirm({ message: 'Claude 桌面应用已配置，是否同步新模型？', default: true });
  if (!syncDesktop) return;
  const spinner = ora('同步 Claude 桌面应用配置...').start();
  try {
    writeClaudeDesktopConfig(config);
    spinner.succeed(chalk.green('Claude 桌面应用配置已同步'));
  } catch (e) {
    spinner.fail(chalk.red(`桌面配置同步失败: ${e.message}`));
    return;
  }
  if (process.platform === 'darwin' || process.platform === 'win32') {
    const shouldOpen = await confirm({ message: '是否重启 Claude 桌面应用使新配置生效？', default: true });
    if (shouldOpen) {
      const openSpinner = ora('正在重启 Claude 桌面应用...').start();
      try {
        await openClaudeDesktop();
        openSpinner.succeed(chalk.green('Claude 桌面应用已重启'));
      } catch (e) {
        openSpinner.fail(chalk.red(`自动重启失败: ${e.message}`));
        if (process.platform === 'win32') {
          console.log(chalk.yellow('\n请手动操作（仅关闭窗口不够，进程还在系统托盘）：'));
          console.log(chalk.dim('  1. 任务栏右下角找 Claude 图标 → 右键 → 退出'));
          console.log(chalk.dim('  2. 或在任务管理器中结束所有 Claude.exe 进程'));
          console.log(chalk.dim('  3. 然后重新打开 Claude'));
        }
      }
    }
  }
}

async function promptModelFromChoices({ chalk, choices, message, backLabel = '↩  返回上一步', allowManual = true }) {
  const selected = await select({ loop: false,
    message: chalk.cyan(message),
    choices: [
      ...choices,
      ...(allowManual ? [{ name: '手动输入模型名', value: '__MANUAL__' }] : []),
      { name: chalk.dim(backLabel), value: '__BACK__' },
    ],
  });
  if (selected === '__BACK__') return '__BACK__';
  if (selected !== '__MANUAL__') return selected;

  return input({
    message: chalk.cyan('输入模型名'),
    validate: (v) => v.trim().length > 0 ? true : '模型名不能为空',
  }).then(v => v.trim());
}

async function promptManualModel(chalk, message, defaultValue) {
  return input({
    message: chalk.cyan(message),
    default: defaultValue,
    validate: (v) => v.trim().length > 0 ? true : '模型名不能为空',
  }).then(v => v.trim());
}

async function configureCustomProvider({ chalk, ora, existingConfig }) {
  const baseUrl = await input({
    message: chalk.cyan('Anthropic Base URL'),
    default: existingConfig?.provider === 'custom' ? existingConfig.baseUrl : undefined,
    validate: (v) => v.trim().length > 0 && isValidUrl(v.trim()) ? true : '请输入有效 URL',
  }).then(v => normalizeAnthropicBaseUrl(v.trim()));

  let apiKey = existingConfig?.provider === 'custom' ? existingConfig.apiKey : '';
  if (apiKey) {
    const keepKey = await confirm({ message: '沿用当前 API Key？', default: true });
    if (!keepKey) apiKey = '';
  }
  if (!apiKey) {
    apiKey = await input({
      message: chalk.cyan('API Key'),
      transformer: (v) => v ? chalk.dim('•'.repeat(v.length)) : '',
      validate: (v) => v.trim().length > 0 ? true : 'API Key 不能为空',
    }).then(v => v.trim());
  }

  let modelChoices = [];
  let modelsUrl;
  const fetchSpinner = ora('正在自动获取可用模型...').start();
  const onlineResult = await fetchModelsFromBaseUrl('custom', apiKey, baseUrl);
  if (onlineResult) {
    modelsUrl = onlineResult.modelsUrl;
    fetchSpinner.succeed(chalk.green(`已获取 ${onlineResult.models.length} 个可用模型`));
    modelChoices = onlineResult.models.map(id => ({ name: id, value: id }));
  } else {
    fetchSpinner.warn(chalk.yellow('无法自动获取模型列表，改为手动输入模型'));
  }

  let model;
  let fastModel;
  if (modelChoices.length > 0) {
    model = await promptModelFromChoices({ chalk, choices: modelChoices, message: '选择主模型' });
    if (model === '__BACK__') return null;
    fastModel = await promptModelFromChoices({ chalk, choices: modelChoices, message: '选择快速模型 / Subagent 模型' });
    if (fastModel === '__BACK__') return null;
  } else {
    model = await promptManualModel(chalk, '输入主模型名');
    fastModel = await promptManualModel(chalk, '输入快速模型 / Subagent 模型名', model);
  }

  return {
    provider: 'custom',
    providerName: '自定义接口',
    baseUrl,
    modelsUrl: modelsUrl || undefined,
    apiKey,
    model,
    fastModel,
    availableModels: onlineResult?.models || (model ? [model, fastModel].filter(Boolean) : []),
  };
}

async function showStatus() {
  const chalk = (await import('chalk')).default;
  const boxen = (await import('boxen')).default;
  const ora = (await import('ora')).default;
  const config = loadConfig();

  if (!config) {
    console.log(chalk.red('\n未配置，请先运行: claw config\n'));
    return;
  }
  const configProblem = getConfigValidationMessage(config);
  if (configProblem) {
    console.log(chalk.red(`\n配置无效：${configProblem}`));
    console.log(chalk.dim('请运行 claw config 重新配置。\n'));
    return;
  }

  const spinner = ora('验证 API Key...').start();
  const valid = await validateKey(config);

  if (valid === true) spinner.succeed('API Key 有效');
  else if (valid === false) spinner.fail('API Key 无效或已过期');
  else spinner.warn('网络异常，无法验证');

  const view = buildStatusView(config, {
    apiStatus: valid,
    claudeInstalled: isClaudeInstalled(),
    env: process.env,
  });

  const lines = view.lines.map(({ label, value }) => {
    const coloredValue = label === '厂商'
      ? chalk.white.bold(value)
      : label.includes('模型')
        ? chalk.yellow(value)
        : label === 'Base URL'
          ? chalk.cyan(value)
          : label === '当前终端' && value === '未生效'
            ? chalk.yellow(value)
            : value;
    return `${chalk.dim(label + ':')} ${coloredValue}`;
  });

  for (const warning of view.warnings) {
    if (warning.includes('建议运行')) {
      const [summary, action] = warning.split('，建议运行 ');
      lines.push(`${chalk.yellow('提示:')} ${chalk.yellow(summary)}`);
      lines.push(`${chalk.yellow('建议:')} ${chalk.yellow(`运行 ${action}`)}`);
    } else {
      lines.push(`${chalk.yellow('提示:')} ${chalk.yellow(warning)}`);
    }
  }

  console.log(boxen(lines.join('\n'), {
    title: chalk.bold('当前配置'),
    titleAlignment: 'left',
    padding: { top: 0, bottom: 0, left: 2, right: 2 },
    borderStyle: 'round',
    borderColor: valid === true ? 'green' : valid === false ? 'red' : 'yellow',
    margin: { top: 1, bottom: 1 },
  }));
}

async function runConfigFlow({ writeCodeEnv = false } = {}) {
  const chalk = (await import('chalk')).default;
  const ora = (await import('ora')).default;
  const boxen = (await import('boxen')).default;

  console.log(await getBanner());

  const existing = loadConfig();
  if (existing) {
    const existingProvider = PROVIDERS[existing.provider];
    console.log(boxen(
      chalk.bold('当前 API 连接\n\n') +
      chalk.dim('厂商  ') + chalk.white(existingProvider?.name || existing.provider) + '\n' +
      chalk.dim('模型  ') + chalk.yellow(existing.model) + '\n' +
      chalk.dim('Key   ') + chalk.dim(existing.apiKey ? '已保存' : '缺失'),
      { padding: { top: 0, bottom: 0, left: 2, right: 2 }, borderStyle: 'round', borderColor: 'yellow', margin: { top: 1, bottom: 1 } }
    ));
    const overwrite = await confirm({ message: '覆盖现有 API 连接？', default: false });
    if (!overwrite) return;
  }

  let providerKey, provider, apiKey, model, customConfig, availableModels;
  let step = 'provider';

  while (true) {
    if (step === 'provider') {
      providerKey = await select({ loop: false,
        message: chalk.cyan('选择 AI 厂商'),
        choices: [
          ...Object.entries(PROVIDERS).map(([value, p]) => ({ name: p.name, value })),
          { name: chalk.dim('↩  返回主菜单'), value: '__BACK__' },
        ],
      });
      if (providerKey === '__BACK__') return;
      provider = PROVIDERS[providerKey];
      if (provider.custom) {
        customConfig = await configureCustomProvider({ chalk, ora });
        if (!customConfig) { step = 'provider'; continue; }
        break;
      }
      step = 'apikey';
    } else if (step === 'apikey') {
      const k = await input({
        message: chalk.cyan(`${provider.name} API Key（输入 b 返回上一步）`),
        default: apiKey || undefined,
        transformer: (v) => v && v !== 'b' ? chalk.dim('•'.repeat(v.length)) : v,
        validate: (v) => v.trim().length > 0 ? true : 'API Key 不能为空',
      });
      if (k.trim() === 'b') { step = 'provider'; continue; }
      apiKey = k.trim();
      step = 'model';
    } else if (step === 'model') {
      const fetchSpinner = ora('正在获取可用模型...').start();
      const onlineModels = await fetchModels(providerKey, apiKey);
      let modelChoices;
      if (onlineModels && onlineModels.length > 0) {
        fetchSpinner.succeed(chalk.green(`已获取 ${onlineModels.length} 个可用模型`));
        modelChoices = onlineModels.map(id => ({ name: id, value: id }));
        availableModels = onlineModels;
      } else {
        fetchSpinner.warn(chalk.yellow('无法获取在线列表，使用内置默认列表'));
        modelChoices = provider.models;
        availableModels = provider.models.map(m => m.value);
      }

      const m = await select({ loop: false,
        message: chalk.cyan('选择模型'),
        choices: [
          ...modelChoices,
          { name: chalk.dim('↩  返回上一步（重新输入 Key）'), value: '__BACK__' },
        ],
      });
      if (m === '__BACK__') { step = 'apikey'; continue; }
      model = m;
      break;
    }
  }

  const spinner = ora(writeCodeEnv ? '保存 API 连接并接入 Claude Code 终端...' : '保存 API 连接...').start();
  let file;
  let cfg;
  try {
    const fastModel = customConfig?.fastModel || resolveFastModel(provider, model);
    cfg = customConfig || { provider: providerKey, model, fastModel, apiKey, baseUrl: provider.baseUrl, availableModels };
    saveConfig(cfg);
    if (writeCodeEnv) {
      ({ file } = writeEnvToZshrc(cfg.baseUrl, cfg.apiKey, cfg.model, cfg.fastModel));
    }
    spinner.succeed(chalk.green(writeCodeEnv ? 'API 连接已保存，Claude Code 终端已接入' : 'API 连接已保存'));
  } catch (e) {
    spinner.fail(chalk.red(`写入失败: ${e.message}`));
    return;
  }

  console.log(chalk.dim(writeCodeEnv ? getStorageHint(file) : getSavedConfigHint()));

  const nextStep = writeCodeEnv
    ? chalk.white('需要启动时，在主菜单选择“启动 Claude Code”，或直接输入 ') + chalk.cyan.bold('claude') + '\n' + chalk.dim(getActivationHint(file))
    : chalk.white('下一步可选择“接入 Claude Code 终端”或“接入 Claude 桌面应用”。');

  console.log(boxen(
    chalk.bold(writeCodeEnv ? 'Claude Code 终端配置完成！\n\n' : 'API 连接配置完成！\n\n') +
    chalk.dim('Base URL  ') + chalk.cyan(cfg.baseUrl) + '\n' +
    chalk.dim('API Key   ') + chalk.cyan('已保存') + '\n' +
    chalk.dim('模型      ') + chalk.yellow(cfg.model) + '\n\n' +
    nextStep,
    { padding: { top: 0, bottom: 0, left: 2, right: 2 }, borderStyle: 'round', borderColor: 'green', margin: { top: 1, bottom: 1 } }
  ));

  await offerDesktopSync(chalk, ora, cfg);
}

program
  .name('claw')
  .description('Claude Code × 国产大模型一键接入')
  .version(pkg.version);

program
  .command('install-claude')
  .description('安装 Claude Code CLI')
  .action(async () => {
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;
    const boxen = (await import('boxen')).default;

    console.log(await getBanner());

    try {
      const ver = execSync('claude --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      console.log(chalk.green(`\n✔ Claude Code 已安装：${ver}\n`));
      const yes = await confirm({ message: '是否重新安装/更新？', default: false });
      if (!yes) return;
    } catch {}

    const network = await select({ loop: false,
      message: chalk.cyan('你的网络环境'),
      choices: [
        { name: '有梯子 / 海外网络（走官方）', value: 'vpn' },
        { name: '国内网络 / 没有梯子（走镜像）', value: 'cn' },
        { name: chalk.dim('↩  返回主菜单'), value: '__BACK__' },
      ],
    });
    if (network === '__BACK__') return;

    const installCommand = buildClaudeInstallCommand(network);

    console.log(chalk.dim('\n安装中，实时输出：\n'));

    // 实时输出安装日志（Windows 下 npm 是 npm.cmd，需要 shell: true 才能找到）
    const result = spawnSync(installCommand.command, installCommand.args, { stdio: 'inherit', shell: process.platform === 'win32' });

    if (result.status === 0) {
      console.log(chalk.green('\n✔ Claude Code 安装成功！'));
    } else {
      console.log(chalk.red('\n✘ 安装失败'));
      console.log(boxen(
        chalk.bold('手动安装：\n\n') +
        chalk.cyan('npm config set registry https://registry.npmmirror.com\n') +
        chalk.cyan('npm install -g @anthropic-ai/claude-code'),
        { padding: { top: 0, bottom: 0, left: 2, right: 2 }, borderStyle: 'round', borderColor: 'yellow', margin: { top: 1, bottom: 1 } }
      ));
      return;
    }

    try {
      const ver = execSync('claude --version', { encoding: 'utf8' }).trim();
      console.log(chalk.green(`✔ 验证成功：${ver}`));
    } catch {
      console.log(chalk.yellow('安装完成，请重开终端后运行 claude'));
    }

    console.log(boxen(
      chalk.bold('下一步\n\n') +
      chalk.cyan('  claw config') + chalk.dim('  配置 API 连接\n') +
      chalk.cyan('  claw code') + chalk.dim('    接入 Claude Code 终端'),
      { padding: { top: 0, bottom: 0, left: 2, right: 2 }, borderStyle: 'round', borderColor: 'cyan', margin: { top: 1, bottom: 1 } }
    ));
  });

program
  .command('config')
  .description('配置 API 连接（不修改终端或桌面）')
  .action(() => runConfigFlow({ writeCodeEnv: false }));

program
  .command('setup')
  .description('配置 API 并接入 Claude Code 终端（兼容旧命令）')
  .action(() => runConfigFlow({ writeCodeEnv: true }));

program
  .command('code')
  .description('接入 Claude Code 终端')
  .action(async () => {
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;
    const boxen = (await import('boxen')).default;

    console.log(await getBanner());

    const config = loadConfig();
    if (!config) {
      console.log(chalk.red('\n未配置 API 连接，请先运行: claw config\n'));
      return;
    }
    const configProblem = getConfigValidationMessage(config);
    if (configProblem) {
      console.log(chalk.red(`\n配置无效：${configProblem}`));
      console.log(chalk.dim('请运行 claw config 重新配置。\n'));
      return;
    }

    const spinner = ora('写入 Claude Code 终端环境变量...').start();
    let file;
    try {
      ({ file } = writeEnvToZshrc(config.baseUrl, config.apiKey, config.model, config.fastModel));
      spinner.succeed(chalk.green(`Claude Code 终端已接入 → ${file}`));
    } catch (e) {
      spinner.fail(chalk.red(`写入失败: ${e.message}`));
      return;
    }

    console.log(chalk.dim(getStorageHint(file)));
    console.log(boxen(
      chalk.bold('Claude Code 终端已接入\n\n') +
      chalk.dim('Base URL  ') + chalk.cyan(config.baseUrl) + '\n' +
      chalk.dim('模型      ') + chalk.yellow(config.model) + '\n\n' +
      chalk.white('需要启动时，在主菜单选择“启动 Claude Code”，或直接输入 ') + chalk.cyan.bold('claude') + '\n' +
      chalk.dim(getActivationHint(file)),
      { padding: { top: 0, bottom: 0, left: 2, right: 2 }, borderStyle: 'round', borderColor: 'green', margin: { top: 1, bottom: 1 } }
    ));
  });

program
  .command('code-reset')
  .description('恢复 Claude Code 终端默认配置')
  .action(async () => {
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;
    const boxen = (await import('boxen')).default;

    console.log(await getBanner());

    const yes = await confirm({
      message: chalk.red('确定要恢复 Claude Code 终端默认配置吗？API 连接和桌面配置不会被清除'),
      default: false,
    });
    if (!yes) {
      console.log(chalk.dim('已取消'));
      return;
    }

    const spinner = ora('正在恢复 Claude Code 终端默认配置...').start();
    const cleared = clearClaudeCodeEnv();

    if (cleared.length === 0) {
      spinner.warn(chalk.yellow('没有找到 Claude Code 终端环境变量，无需恢复'));
    } else {
      spinner.succeed(chalk.green('Claude Code 终端已恢复默认'));
      const isWin = cleared.includes('Windows 用户环境变量');
      const resetNote = isWin
        ? '注：当前终端的环境变量还在内存中，重新打开 PowerShell / CMD 后才彻底清除'
        : '注：当前终端的环境变量还在内存中，重开终端后生效，或在当前终端执行：';
      const unsetCmd = isWin ? null : `unset ${CLAUDE_ENV_KEYS.join(' ')}`;
      console.log(boxen(
        chalk.bold('已清除以下位置中的 Claude Code 终端环境变量：\n\n') +
        cleared.map(f => chalk.cyan('  • ' + f)).join('\n') +
        '\n\n' + chalk.dim(resetNote) +
        (unsetCmd ? '\n' + chalk.cyan(unsetCmd) : ''),
        { padding: { top: 0, bottom: 0, left: 2, right: 2 }, borderStyle: 'round', borderColor: 'green', margin: { top: 1, bottom: 1 } }
      ));
    }
  });

program
  .command('switch')
  .description('快速切换模型（只更新 API 连接）')
  .action(async () => {
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;

    console.log(await getBanner());

    const config = loadConfig();
    if (!config) {
      console.log(chalk.red('\n未配置，请先运行: claw config\n'));
      return;
    }
    const configProblem = getConfigValidationMessage(config);
    if (configProblem) {
      console.log(chalk.red(`\n配置无效：${configProblem}`));
      console.log(chalk.dim('请运行 claw config 重新配置。\n'));
      return;
    }

    const providerKey = await select({ loop: false,
      message: chalk.cyan('选择 AI 厂商'),
      choices: [
        ...Object.entries(PROVIDERS).map(([value, p]) => ({ name: p.name, value })),
        { name: chalk.dim('↩  返回主菜单'), value: '__BACK__' },
      ],
    });
    if (providerKey === '__BACK__') return;

    const provider = PROVIDERS[providerKey];
    if (provider.custom) {
      const customConfig = await configureCustomProvider({ chalk, ora, existingConfig: config });
      if (!customConfig) return;

      const spinner = ora('切换中...').start();
      saveConfig(customConfig);
      spinner.succeed(chalk.green(`API 连接已切换至 ${customConfig.providerName} · ${customConfig.model}`));
      console.log(chalk.dim('如需让外部 claude 命令使用新模型，请运行 claw code。'));
      await offerDesktopSync(chalk, ora, customConfig);
      return;
    }

    // 切换厂商时询问是否更换 Key
    let apiKey = config.apiKey;
    if (providerKey !== config.provider) {
      const changeKey = await confirm({ message: `切换了厂商，是否更新 API Key？`, default: true });
      if (changeKey) {
        apiKey = await input({
          message: chalk.cyan(`${provider.name} API Key`),
          transformer: (v) => v ? chalk.dim('•'.repeat(v.length)) : '',
          validate: (v) => v.trim().length > 0 ? true : 'API Key 不能为空',
        });
        apiKey = apiKey.trim();
      } else {
        console.log(chalk.yellow('⚠ 沿用旧 Key 通常无法访问新厂商，模型列表可能拉取失败'));
      }
    }

    // 联网拉模型
    const fetchSpinner = ora('正在获取可用模型...').start();
    const onlineModels = await fetchModels(providerKey, apiKey);
    let modelChoices;
    let availableModels;
    if (onlineModels && onlineModels.length > 0) {
      fetchSpinner.succeed(chalk.green(`已获取 ${onlineModels.length} 个可用模型`));
      modelChoices = onlineModels.map(id => ({ name: id, value: id }));
      availableModels = onlineModels;
    } else {
      fetchSpinner.warn(chalk.yellow('无法获取在线列表，使用内置默认列表'));
      modelChoices = provider.models;
      availableModels = provider.models.map(m => m.value);
    }

    const model = await select({ loop: false,
      message: chalk.cyan('选择模型'),
      choices: [
        ...modelChoices,
        { name: chalk.dim('↩  返回主菜单'), value: '__BACK__' },
      ],
    });
    if (model === '__BACK__') return;

    const spinner = ora('切换中...').start();
    const fastModel = resolveFastModel(provider, model);
    const newConfig = { ...config, provider: providerKey, model, fastModel, baseUrl: provider.baseUrl, apiKey, availableModels };
    saveConfig(newConfig);
    spinner.succeed(chalk.green(`API 连接已切换至 ${provider.name} · ${model}`));
    console.log(chalk.dim('如需让外部 claude 命令使用新模型，请运行 claw code。'));
    await offerDesktopSync(chalk, ora, newConfig);
  });

program
  .command('status')
  .description('查看当前配置和 Key 有效性')
  .action(showStatus);

program
  .command('desktop')
  .description('接入 Claude 桌面应用使用当前模型')
  .action(async () => {
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;
    const boxen = (await import('boxen')).default;

    console.log(await getBanner());

    const config = loadConfig();
    if (!config) {
      console.log(chalk.red('\n未配置 API 连接，请先运行: claw config\n'));
      return;
    }
    const configProblem = getConfigValidationMessage(config);
    if (configProblem) {
      console.log(chalk.red(`\n配置无效：${configProblem}`));
      console.log(chalk.dim('请运行 claw config 重新配置。\n'));
      return;
    }

    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      console.log(chalk.yellow('\nClaude 桌面应用 3P 配置目前仅支持 macOS / Windows。\n'));
      return;
    }

    const spinner = ora('写入 Claude 桌面应用配置...').start();
    let result;
    try {
      result = writeClaudeDesktopConfig(config);
      if (result.result === 'unsupported') {
        spinner.warn(chalk.yellow('当前系统暂不支持自动配置 Claude 桌面应用'));
        return;
      }
      spinner.succeed(chalk.green(`Claude 桌面应用配置已写入 → ${result.file}`));
    } catch (e) {
      spinner.fail(chalk.red(`写入失败: ${e.message}`));
      return;
    }

    console.log(boxen(
      chalk.bold('Claude 桌面应用已配置为 Gateway 模式\n\n') +
      chalk.dim('Base URL  ') + chalk.cyan(config.baseUrl) + '\n' +
      chalk.dim('模型      ') + chalk.yellow(config.model) + '\n' +
      chalk.dim('认证方式  ') + chalk.cyan('bearer') + '\n\n' +
      chalk.yellow(getDesktopOpenHint()) + '\n' +
      chalk.dim('要求：网关必须支持 Anthropic POST /v1/messages，且 Base URL 必须是 HTTPS。'),
      { padding: { top: 0, bottom: 0, left: 2, right: 2 }, borderStyle: 'round', borderColor: 'cyan', margin: { top: 1, bottom: 1 } }
    ));

    if (process.platform === 'darwin' || process.platform === 'win32') {
      const shouldOpen = await confirm({ message: '是否现在重启 Claude 桌面应用？', default: true });
      if (shouldOpen) {
        const openSpinner = ora('正在重启 Claude 桌面应用...').start();
        try {
          await openClaudeDesktop();
          openSpinner.succeed(chalk.green('Claude 桌面应用已重新打开（旧实例已退出，新配置生效）'));
        } catch (e) {
          openSpinner.fail(chalk.red(`自动重启失败: ${e.message}`));
          if (process.platform === 'win32') {
            console.log(chalk.yellow('\n请手动操作（仅关闭窗口不够，进程还在系统托盘）：'));
            console.log(chalk.dim('  1. 任务栏右下角找 Claude 图标 → 右键 → 退出'));
            console.log(chalk.dim('  2. 或在任务管理器中结束所有 Claude.exe 进程'));
            console.log(chalk.dim('  3. 然后重新打开 Claude'));
          } else {
            console.log(chalk.dim(getDesktopOpenHint()));
          }
        }
      }
    } else {
      console.log(chalk.dim(getDesktopOpenHint()));
    }
  });

program
  .command('desktop-reset')
  .description('恢复 Claude 桌面应用默认配置')
  .action(async () => {
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;
    const boxen = (await import('boxen')).default;

    console.log(await getBanner());

    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      console.log(chalk.yellow('\nClaude 桌面应用 3P 配置目前仅支持 macOS / Windows。\n'));
      return;
    }

    const yes = await confirm({
      message: chalk.red('确定要恢复 Claude 桌面应用默认配置吗？终端配置不会被清除'),
      default: false,
    });
    if (!yes) {
      console.log(chalk.dim('已取消'));
      return;
    }

    const spinner = ora('正在恢复 Claude 桌面应用默认配置...').start();
    const result = clearClaudeDesktopConfig();

    if (result.result === 'updated') {
      spinner.succeed(chalk.green('Claude 桌面应用已恢复默认'));
      const cleared = [
        result.dataDir ? require('path').join(result.dataDir, 'configLibrary/') : null,
        result.file,
      ].filter(Boolean);
      console.log(boxen(
        chalk.bold('已清除 Claude 桌面应用第三方推理配置：\n\n') +
        cleared.map(f => chalk.cyan('  • ' + f)).join('\n'),
        { padding: { top: 0, bottom: 0, left: 2, right: 2 }, borderStyle: 'round', borderColor: 'green', margin: { top: 1, bottom: 1 } }
      ));

      if (process.platform === 'darwin' || process.platform === 'win32') {
        const shouldReopen = await confirm({ message: '是否现在重启 Claude 桌面应用使默认配置生效？', default: true });
        if (shouldReopen) {
          const openSpinner = ora('正在重启 Claude 桌面应用...').start();
          try {
            await openClaudeDesktop();
            openSpinner.succeed(chalk.green('Claude 桌面应用已重启（已恢复 1P 模式）'));
          } catch (e) {
            openSpinner.fail(chalk.red(`自动重启失败: ${e.message}`));
            if (process.platform === 'win32') {
              console.log(chalk.yellow('\n请手动操作（仅关闭窗口不够，进程还在系统托盘）：'));
              console.log(chalk.dim('  1. 任务栏右下角找 Claude 图标 → 右键 → 退出'));
              console.log(chalk.dim('  2. 或在任务管理器中结束所有 Claude.exe 进程'));
              console.log(chalk.dim('  3. 然后重新打开 Claude'));
            } else {
              console.log(chalk.dim('请手动完全退出 Claude 后重新打开。'));
            }
          }
        }
      } else {
        console.log(chalk.dim('请手动完全退出 Claude 后重新打开。'));
      }
    } else {
      spinner.warn(chalk.yellow('没有找到 Claude 桌面应用第三方推理配置，无需恢复'));
    }
  });

program
  .command('reset')
  .description('清除 API 连接、终端环境变量和桌面配置')
  .action(async () => {
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;
    const boxen = (await import('boxen')).default;

    console.log(await getBanner());

    const yes = await confirm({
      message: chalk.red('确定要清除所有 clawai 配置吗？此操作不可撤销'),
      default: false,
    });
    if (!yes) {
      console.log(chalk.dim('已取消'));
      return;
    }

    const spinner = ora('清除中...').start();
    const cleared = resetConfig();
    const desktopCleared = clearClaudeDesktopConfig();
    if (desktopCleared.result === 'updated') {
      if (desktopCleared.dataDir) cleared.push(require('path').join(desktopCleared.dataDir, 'configLibrary/'));
      if (desktopCleared.file) cleared.push(desktopCleared.file);
    }

    if (cleared.length === 0) {
      spinner.warn(chalk.yellow('没有找到任何配置，无需清除'));
    } else {
      spinner.succeed(chalk.green('已恢复默认'));
      const resetNote = cleared.includes('Windows 用户环境变量')
        ? '注：当前终端的环境变量还在内存中，重新打开 PowerShell / CMD 后才彻底清除'
        : '注：当前终端的环境变量还在内存中，重开终端或 unset 才彻底清除';
      console.log(boxen(
        chalk.bold('已清除以下文件中的 clawai 配置：\n\n') +
        cleared.map(f => chalk.cyan('  • ' + f)).join('\n') +
        '\n\n' + chalk.dim(resetNote),
        { padding: { top: 0, bottom: 0, left: 2, right: 2 }, borderStyle: 'round', borderColor: 'green', margin: { top: 1, bottom: 1 } }
      ));
    }
  });

program
  .command('doctor')
  .description('诊断当前环境，列出所有问题和修复建议')
  .action(async () => {
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;
    const boxen = (await import('boxen')).default;

    console.log(await getBanner());

    const spinner = ora('运行诊断检查...').start();
    const checks = await runDoctorChecks();
    spinner.stop();

    const icons = {
      [STATUS_OK]:   chalk.green('✓'),
      [STATUS_FAIL]: chalk.red('✗'),
      [STATUS_WARN]: chalk.yellow('⚠'),
      [STATUS_INFO]: chalk.cyan('ℹ'),
    };

    console.log();
    for (const c of checks) {
      console.log(`  ${icons[c.status]} ${chalk.bold(c.name)}  ${chalk.dim(c.message)}`);
      if (c.fix) console.log(`    ${chalk.dim('→')} ${chalk.cyan(c.fix)}`);
    }

    const counts = summarize(checks);
    const summaryBits = [];
    if (counts.fail) summaryBits.push(chalk.red(`${counts.fail} 个错误`));
    if (counts.warn) summaryBits.push(chalk.yellow(`${counts.warn} 个警告`));
    if (counts.ok)   summaryBits.push(chalk.green(`${counts.ok} 个通过`));

    const allOk = counts.fail === 0 && counts.warn === 0;
    console.log(boxen(
      (allOk ? chalk.bold.green('✓ 一切正常') : chalk.bold('诊断完成')) +
      (summaryBits.length ? '\n\n' + summaryBits.join(' · ') : ''),
      {
        padding: { top: 0, bottom: 0, left: 2, right: 2 },
        borderStyle: 'round',
        borderColor: counts.fail ? 'red' : counts.warn ? 'yellow' : 'green',
        margin: { top: 1, bottom: 1 },
      }
    ));
  });

program
  .command('update')
  .description('检查并更新 yingclaw 到最新版本')
  .action(async () => {
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;
    const boxen = (await import('boxen')).default;

    console.log(await getBanner());

    const spinner = ora('检查最新版本...').start();
    const latest = await checkForUpdate();

    if (!latest) {
      spinner.warn(chalk.yellow('无法获取版本信息，请检查网络'));
      return;
    }

    const current = pkg.version;
    if (compareVersions(latest, current) <= 0) {
      spinner.succeed(chalk.green(`已是最新版本 v${current}`));
      return;
    }

    spinner.succeed(chalk.green(`发现新版本 v${latest}（当前 v${current}）`));

    const yes = await confirm({ message: `升级到 v${latest}？`, default: true });
    if (!yes) {
      console.log(chalk.dim('已取消'));
      return;
    }

    const network = await select({ loop: false,
      message: chalk.cyan('你的网络环境'),
      choices: [
        { name: '有梯子 / 海外网络（走官方）', value: 'vpn' },
        { name: '国内网络 / 没有梯子（走镜像）', value: 'cn' },
      ],
    });

    const upgradeArgs = ['install', '-g', 'yingclaw@latest'];
    if (network === 'cn') upgradeArgs.push('--registry=https://registry.npmmirror.com');
    const upgradeCmd = { command: 'npm', args: upgradeArgs };

    console.log(chalk.dim('\n升级中...\n'));
    const result = spawnSync(upgradeCmd.command, upgradeCmd.args, { stdio: 'inherit', shell: process.platform === 'win32' });

    if (result.status === 0) {
      console.log(boxen(
        chalk.bold(`yingclaw 已升级到 v${latest}\n\n`) +
        chalk.dim('运行 ') + chalk.cyan('claw') + chalk.dim(' 启动新版本'),
        { padding: { top: 0, bottom: 0, left: 2, right: 2 }, borderStyle: 'round', borderColor: 'green', margin: { top: 1, bottom: 1 } }
      ));
      process.exit(0);
    } else {
      console.log(chalk.red('\n升级失败，请手动运行：'));
      console.log(chalk.cyan('npm install -g yingclaw@latest'));
    }
  });

async function renderStatusBar(apiStatus) {
  const chalk = (await import('chalk')).default;
  const config = loadConfig();
  const claudeInstalled = isClaudeInstalled();

  const claudeIcon = claudeInstalled ? chalk.green('●') : chalk.red('●');
  const claudeText = chalk.dim('Claude');

  let cfgPart;
  if (config) {
    const view = buildStatusView(config, {
      apiStatus,
      claudeInstalled,
      env: process.env,
    });
    const statusLines = buildMenuStatusLines(view, { apiStatus, claudeInstalled, platform: process.platform });
    cfgPart = statusLines.map((line, index) => {
      if (index === 0) return line.replace('API 正常', chalk.green('API 正常')).replace('API Key 无效', chalk.red('API Key 无效')).replace('网络/服务异常', chalk.yellow('网络/服务异常'));
      if (line.startsWith('环境变量未生效')) return chalk.yellow(line);
      if (line.startsWith('旧模型名')) return chalk.yellow(line);
      if (line.startsWith('主模型')) return line.replace(view.mainModel, chalk.yellow(view.mainModel)).replace(view.fastModel, chalk.yellow(view.fastModel));
      return line;
    }).join('\n  ');
  } else {
    cfgPart = chalk.red('●') + ' ' + chalk.dim('未配置');
  }

  return config ? `  ${cfgPart}` : `  ${claudeIcon} ${claudeText}    ${cfgPart}`;
}

async function checkForUpdate() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://registry.npmjs.org/yingclaw/latest`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    return data.version || null;
  } catch {
    return null;
  }
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

// 缓存上次校验的 config 哈希和结果，避免每次回菜单都重检
let lastCheckedHash = null;
let lastCheckResult; // undefined / true / false / null

function configHash(cfg) {
  if (!cfg) return null;
  return JSON.stringify({ p: cfg.provider, b: cfg.baseUrl, k: cfg.apiKey, m: cfg.model });
}

async function maybeCheckApi(config, forceRecheck) {
  const hash = configHash(config);
  if (!forceRecheck && hash === lastCheckedHash && lastCheckResult !== undefined) {
    return lastCheckResult;
  }
  const result = await validateKey(config);
  lastCheckedHash = hash;
  lastCheckResult = result;
  return result;
}

const ADVANCED_DISABLED_HINT = '需先配置 API 连接';

async function runAdvancedMenu(chalk, hasConfig) {
  const action = await select({ loop: false,
    message: chalk.cyan('高级选项'),
    choices: [
      { name: '🩺 诊断（一键自检并给出修复建议）', value: 'doctor' },
      { name: '🔁 重新检测 API', value: 'recheck', disabled: !hasConfig && ADVANCED_DISABLED_HINT },
      { name: '↩️  恢复 Claude Code 终端默认', value: 'code-reset' },
      { name: '↩️  恢复 Claude 桌面默认', value: 'desktop-reset' },
      { name: '🗑  清除所有 yingclaw 配置', value: 'reset' },
      { name: '⬆️  检查更新', value: 'update' },
      { name: chalk.dim('↩  返回主菜单'), value: '__BACK__' },
    ],
  });
  return action;
}

async function runMenu() {
  const chalk = (await import('chalk')).default;
  const ora = (await import('ora')).default;

  let forceRecheck = false;

  while (true) {
    console.clear();
    console.log(await getBanner());

    const config = loadConfig();
    const configProblem = config ? getConfigValidationMessage(config) : null;
    let apiStatus;

    if (config && !configProblem) {
      const hash = configHash(config);
      if (forceRecheck || hash !== lastCheckedHash || lastCheckResult === undefined) {
        const spinner = ora('正在检测 API...').start();
        apiStatus = await maybeCheckApi(config, true);
        if (apiStatus === true) spinner.succeed('API 连接正常');
        else if (apiStatus === false) spinner.fail('API Key 无效或已过期');
        else spinner.warn('网络异常，无法连接 API');
      } else {
        apiStatus = lastCheckResult;
      }
      forceRecheck = false;
    }

    if (configProblem) {
      console.log(chalk.red(`  ● 配置无效：${configProblem}`));
      console.log(chalk.dim('  请先选择"配置 API 连接"重新配置'));
    } else {
      console.log(await renderStatusBar(apiStatus));
    }
    console.log();

    const disabledHint = (!config || configProblem) && '需先配置 API 连接';

    const action = await select({ loop: false,
      message: chalk.cyan('选择操作'),
      choices: [
        { name: '🤖 启动 Claude Code', value: 'launch', disabled: disabledHint },
        { name: '📦 安装 Claude Code', value: 'install' },
        { name: config ? '🔑 重新配置 API 连接' : '🔑 配置 API 连接', value: 'config' },
        { name: '🔄 切换厂商或模型', value: 'switch', disabled: disabledHint },
        { name: '💻 接入 Claude Code 终端', value: 'code', disabled: disabledHint },
        { name: '🖥  接入 Claude 桌面应用', value: 'desktop', disabled: disabledHint },
        { name: '📊 查看当前配置', value: 'status', disabled: !config && '需先配置 API 连接' },
        { name: '🛠  高级 ›', value: 'advanced' },
        { name: '退出', value: 'exit' },
      ],
    });

    if (action === 'exit') return;

    let resolvedAction = action;
    if (action === 'advanced') {
      const adv = await runAdvancedMenu(chalk, !!config && !configProblem);
      if (adv === '__BACK__') continue;
      resolvedAction = adv;
    }

    if (resolvedAction === 'recheck') {
      lastCheckResult = undefined;
      forceRecheck = true;
      continue;
    }

    if (resolvedAction === 'launch') {
      const cfg = loadConfig();
      if (!cfg || getConfigValidationMessage(cfg)) continue;
      await new Promise((resolve) => {
        const child = spawn('claude', [], {
          stdio: 'inherit',
          env: { ...process.env, ...buildClaudeEnv(cfg) },
          shell: process.platform === 'win32',
        });
        child.on('error', () => {
          console.log(chalk.yellow('\nClaude Code 未找到，请先选择"安装 Claude Code"'));
          resolve();
        });
        child.on('exit', resolve);
      });
      continue;
    }

    const cmdMap = {
      install: 'install-claude',
      config: 'config',
      code: 'code',
      'code-reset': 'code-reset',
      switch: 'switch',
      desktop: 'desktop',
      'desktop-reset': 'desktop-reset',
      status: 'status',
      reset: 'reset',
      update: 'update',
      doctor: 'doctor',
    };

    // 执行子命令（用 spawn 隔离，避免 commander 对 program 的副作用）
    await new Promise((resolve) => {
      const child = spawn(process.execPath, [__filename, cmdMap[resolvedAction]], { stdio: 'inherit' });
      child.on('exit', resolve);
      child.on('error', resolve);
    });

    // 改 config 的命令需要刷新缓存
    if (['config', 'switch', 'reset', 'code-reset'].includes(resolvedAction)) {
      lastCheckResult = undefined;
      lastCheckedHash = null;
    }
    // 安装 Claude 后刷新检测缓存
    if (resolvedAction === 'install') {
      invalidateClaudeInstalledCache();
    }

    console.log();
    const next = await select({ loop: false,
      message: chalk.cyan('下一步'),
      choices: [
        { name: '↩  返回主菜单', value: 'menu' },
        { name: '退出', value: 'exit' },
      ],
    });
    if (next === 'exit') return;
  }
}

function handleCliError(e) {
  if (e?.name === 'ExitPromptError') return; // Ctrl+C
  console.error(e);
  process.exitCode = 1;
}

if (process.argv.length === 2) {
  runMenu().catch(handleCliError);
} else {
  program.parseAsync(process.argv).catch(handleCliError);
}
