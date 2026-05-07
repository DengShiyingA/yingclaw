# yingclaw

Claude Code × 国产大模型，一键接入。

支持 DeepSeek、Kimi、阿里云百炼（Qwen）、MiniMax、智谱 GLM、小米 MiMo，也支持自定义 Anthropic 兼容接口，无需梯子即可使用 Claude Code。

## 安装

```bash
npm install -g yingclaw
```

安装后注册 `claw` 命令。

## 快速开始

```bash
claw
```

直接运行 `claw` 进入交互菜单，按步骤操作：安装 Claude Code → 配置 API 连接 → 接入终端或桌面应用。

也可以直接运行子命令：

**第一步：安装 Claude Code**
```bash
claw install-claude
```
根据提示选择网络环境（有梯子走官方，没梯子走淘宝镜像）。

**第二步：配置 API 连接**
```bash
claw config
```
选择厂商 → 输入 API Key → 选择模型。只保存连接信息，不修改终端环境变量，也不修改 Claude 桌面配置。

**第三步：接入**

接入 Claude Code 终端：
```bash
claw code
```
写入 Claude Code 所需的环境变量，之后运行 `claude` 即可。

接入 Claude 桌面应用：
```bash
claw desktop
```
将配置写入 Claude Desktop 第三方推理本地配置。macOS 会自动重启 Claude Desktop；Windows 需手动重新打开。

## 支持的厂商

| 厂商 | 主模型 | 快速模型 |
|------|--------|---------|
| DeepSeek | deepseek-v4-pro[1m] | deepseek-v4-flash[1m] |
| Kimi / Moonshot | kimi-k2.5 | kimi-k2.5 |
| 阿里云百炼 | qwen3-max | qwen3.5-plus |
| MiniMax | MiniMax-M2.7 | MiniMax-M2.7-Turbo |
| 智谱 GLM | glm-4.7 | glm-5-turbo |
| 小米 MiMo | mimo-vl-v2.5-pro | mimo-vl-v2.5-pro |
| 自定义接口 | 自动获取或手动输入 | — |

DeepSeek 的 `[1m]` 后缀是真实 API 模型 ID，表示 100 万 token 上下文窗口（[官方说明](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code)）。

## 命令列表

```bash
claw                 # 交互菜单（无参数时自动进入）
claw config          # 配置 API 连接
claw code            # 接入 Claude Code 终端
claw desktop         # 接入 Claude 桌面应用
claw switch          # 快速切换厂商或模型
claw status          # 查看当前配置，验证 Key 是否有效
claw update          # 检查并升级到最新版本

claw code-reset      # 恢复 Claude Code 终端默认配置
claw desktop-reset   # 恢复 Claude 桌面应用默认配置
claw reset           # 清除所有 yingclaw 配置

claw install-claude  # 安装 Claude Code
claw setup           # 兼容旧命令：config + code
```

## 平台支持

| 平台 | 终端接入 | 桌面接入 |
|------|---------|---------|
| macOS | ✅ 写入 `~/.zshrc` | ✅ 自动重启 Claude Desktop |
| Linux / WSL | ✅ 写入 `~/.zshrc` / `~/.bashrc` | — |
| Windows | ✅ 写入用户级环境变量（需重开终端） | ✅ 写入 `%APPDATA%\Claude-3p\` |

## 原理

**终端接入**（`claw code`）写入 shell 配置文件或 Windows 用户环境变量：

```
ANTHROPIC_BASE_URL
ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY
ANTHROPIC_MODEL
ANTHROPIC_DEFAULT_OPUS_MODEL / SONNET_MODEL / HAIKU_MODEL
CLAUDE_CODE_SUBAGENT_MODEL
CLAUDE_CODE_EFFORT_LEVEL
```

**桌面接入**（`claw desktop`）写入 Claude Desktop 第三方推理配置：

- macOS：`~/Library/Application Support/Claude-3p/configLibrary/`
- Windows：`%APPDATA%\Claude-3p\configLibrary\`

使用 `inferenceProvider=gateway`、`inferenceGatewayAuthScheme=bearer`，将 Gateway Base URL 指向对应厂商的 Anthropic 兼容接口。桌面接入要求 Base URL 使用 HTTPS。

**自定义接口**需支持 Anthropic `/v1/messages` 格式；工具会根据 Base URL 自动尝试获取模型列表，失败则手动输入。

## 卸载

```bash
npm uninstall -g yingclaw
claw reset           # 可选：清除已写入的环境变量和桌面配置
```

## License

MIT
