# yingclaw

Claude Code × 国产大模型，一键接入。

支持 DeepSeek、Kimi、阿里云百炼（Qwen）、MiniMax、智谱 GLM、小米 MiMo，也支持自定义 Anthropic 兼容接口，无需梯子即可使用 Claude Code。

## 安装

```bash
npm install -g yingclaw
```

安装后会注册一个 `claw` 命令。

## 使用步骤

> 支持 macOS / Linux / Windows / WSL。macOS、Linux、WSL 会写入 zsh/bash 配置文件；Windows 会写入用户级环境变量，重新打开 PowerShell / CMD 后生效。

**第一步：安装 Claude Code**
```bash
claw install-claude
```
根据提示选择网络环境（有梯子走官方，没梯子走淘宝镜像）。

**第二步：配置 API 连接**
```bash
claw config
```
选择厂商 → 输入 API Key → 选择模型。这个步骤只保存 API 连接，不会修改终端环境变量，也不会修改 Claude 桌面应用配置。

**第三步：选择接入目标**

接入 Claude Code 终端：
```bash
claw code
```
写入 Claude Code 所需的环境变量。配置完成后不会自动启动 Claude Code，需要时可在主菜单选择“启动 Claude Code”或直接运行 `claude`。

接入 Claude 桌面应用：
```bash
claw desktop
```
将当前模型配置写入 Claude Desktop 的第三方推理（Cowork on 3P）本地配置。macOS 会自动重启并打开 Claude 桌面应用；Windows 需要手动重新打开。如果配置未生效，请完全退出 Claude Desktop 后重新打开。

恢复 Claude Code 终端默认配置：
```bash
claw code-reset
```
只清除 Claude Code 终端环境变量，不影响 API 连接和 Claude 桌面配置。

恢复 Claude 桌面应用默认配置：
```bash
claw desktop-reset
```
只清除 Claude Desktop 第三方推理配置，不影响终端里的 API Key 和模型配置。

兼容旧命令：
```bash
claw setup
```
等价于 `claw config` + `claw code`，用于一键配置 API 并接入 Claude Code 终端。

选择“自定义 Anthropic 兼容接口”时，需要输入：

- `ANTHROPIC_BASE_URL`
- API Key

工具会根据 Base URL 自动尝试获取模型列表；如果获取失败，则手动输入主模型和快速模型。

注意：模型列表能获取不代表一定可用于 Claude Code 或 Claude 桌面应用。自定义接口还必须支持 Anthropic `/v1/messages`，否则请求会被网关拒绝。Claude 桌面应用的 Gateway Base URL 还必须使用 HTTPS。

**以后直接用**
```bash
claude
```

## 支持的厂商

| 厂商 | 模型 |
|------|------|
| DeepSeek | V4 Flash、V4 Pro |
| Kimi / Moonshot | Kimi K2.5 |
| 阿里云百炼 | Qwen3 Max、Plus、Flash |
| MiniMax | M2.7、M2.7 Turbo、M2.5 |
| 智谱 GLM | GLM-4.7、GLM-5.1、GLM-5 Turbo、GLM-4.5 Air |
| 小米 MiMo | MiMo V2.5 Pro |
| 自定义接口 | 自动获取或手动输入 |

## 其他命令

```bash
claw config        # 配置 API 连接，不修改终端或桌面
claw code          # 接入 Claude Code 终端
claw code-reset    # 恢复 Claude Code 终端默认配置
claw switch        # 快速切换模型（只更新 API 连接）
claw desktop       # 接入 Claude 桌面应用第三方推理
claw desktop-reset # 恢复 Claude 桌面应用默认配置
claw setup         # 兼容旧命令：config + code
claw status        # 查看当前配置，验证 Key 是否有效
claw reset         # 清除 API 连接、终端环境变量和桌面配置
```

## 卸载

```bash
npm uninstall -g yingclaw
```

## 原理

各厂商均原生支持 Anthropic API 格式。`claw config` 只保存 API 连接；`claw code` 才会写入 Claude Code 所需的环境变量。macOS / Linux / WSL 写入 shell 配置文件，Windows 写入用户级环境变量，包括：

- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_AUTH_TOKEN`
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`
- `ANTHROPIC_DEFAULT_OPUS_MODEL`
- `ANTHROPIC_DEFAULT_SONNET_MODEL`
- `ANTHROPIC_DEFAULT_HAIKU_MODEL`
- `CLAUDE_CODE_SUBAGENT_MODEL`
- `CLAUDE_CODE_EFFORT_LEVEL`

以 DeepSeek 为例，主模型默认使用 `deepseek-v4-pro[1m]`，Haiku/Subagent 快速模型使用 `deepseek-v4-flash`。如果在线模型列表获取失败，会回退到内置默认列表。

`claw desktop` 会额外写入 Claude Desktop 第三方推理配置：

- macOS：`~/Library/Application Support/Claude-3p/claude_desktop_config.json`
- Windows：`%APPDATA%\Claude-3p\claude_desktop_config.json`

写入的 `enterpriseConfig` 使用 `inferenceProvider=gateway`、`inferenceGatewayAuthScheme=bearer`，并按旧版方式把当前厂商模型写入 `inferenceModels`。如果本机存在新版 `configLibrary` 本地配置，`claw desktop` 会同步移除，避免 Claude 优先读取旧的错误配置。DeepSeek 的 Claude Code 终端模型仍使用 `deepseek-v4-pro[1m]`；Claude 桌面应用会写入 `deepseek-v4-pro` 和 `deepseek-v4-flash`。

## License

MIT
