# Talon 架构与设计概览

本文档旨在为 **Talon** 提供技术总结。Talon 是一个基于 Electron 开发的 **OpenClaw** AI 框架管理器和安装器。

## 1. 核心架构
Talon 遵循标准的 Electron 多进程架构：

### 主进程 (`src/main/index.ts`)
- **生命周期管理**：负责应用初始化、进程退出以及窗口创建（包括主窗口 `MainWindow`、安全验证窗口 `SecurityWindow` 和卸载窗口 `UninstallWindow`）。
- **IPC 网关**：作为渲染进程与操作系统、OpenClaw CLI 之间的通信桥梁。
- **环境管理**：
    - **PNPM 路径注入**：自动检测 `PNPM_HOME` 并动态注入到渲染进程环境变量的 `PATH` 中，确保全局安装的 `openclaw` 二进制文件可被调用。
    - **Node.js 环境强制执行**：要求 Node.js 版本 ≥ 22.16.0。如果系统版本较低，会自动通过 NVM 切换或提示升级。
- **进程生成 (Spawn)**：针对 Windows (`cmd.exe /c`) 和 macOS/Linux (`shell: true`) 进行了特殊处理，以确保与用户的终端环境保持一致。

### 渲染进程 (`src/renderer/src/views/`)
- **`SetupView.tsx`**：负责基础环境自检及安装向导（包括 git, node, pnpm 和 openclaw 的自动化安装）。
- **`OnboardingView.tsx`**：引导用户完成 AI 提供商的配置（支持 API Key 模式与 OAuth 模式）。
- **`MainView.tsx`**：控制台面板，用于监控 OpenClaw 网关状态、管理启动配置。

## 2. 关键业务流程

### 安装与初始化
1. **环境检查**：验证 git, node, pnpm 的可用性。
2. **PNPM 设置**：自动运行 `pnpm setup` 以确保全局 bin 目录包含在系统 PATH 中。
3. **OpenClaw 安装**：通过 `pnpm add -g openclaw` 进行安装。
4. **配置初始化**：在用户登录前，自动运行 `openclaw setup --non-interactive` 生成基础配置文件。

### AI 提供商授权 (OAuth)
OAuth 流程深度集成了 OpenClaw CLI 的原生能力：
- **通义千问 (Qwen)**：后台自动启用 `qwen-portal-auth` 插件 -> 运行 `models auth login --provider qwen-portal`。
- **OpenAI Codex**：直接映射到 OpenClaw 内置的 `models auth login-github-copilot` 指令。
- **Google Gemini**：后台自动启用 `google-gemini-cli-auth` 插件 -> 运行 `models auth login --provider google-gemini-cli`。
- **IPC 逻辑**：主进程解析 CLI 输出中的 URL 并自动调用系统浏览器打开，授权成功后将信号传回前端。

## 3. 配置管理
- **持久化**：所有配置均由 OpenClaw CLI 存储在 `~/.openclaw/openclaw.json` 中。
- **安全性**：Talon 在直接修改配置文件前会强制执行 `.bak` 备份逻辑，确保配置可回滚。

## 4. 视觉与交互设计
- **品牌名称**：应用名称正式定为 **Talon**。
- **视觉风格**：采用现代化的“极光”氛围感设计，结合 `framer-motion` 动画、玻璃拟态效果及标志性的核心红图标。
- **窗口管理**：自定义标题栏实现，利用 `WebkitAppRegion` 实现平滑的窗口拖拽体验。

## 5. 安全模型
- **验证窗口**：在执行卸载或敏感配置重置时弹出，防止误操作导致数据丢失。
- **数据解耦**：大部分敏感操作（如令牌生成、密钥加密）均下放到 `openclaw` CLI 层级处理，Talon 仅作为交互层，不直接持久化存储用户敏感密钥。
