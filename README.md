# WeFlow-AI-Reply

WeFlow-AI-Reply 是基于 [WeFlow](https://github.com/hicccc77/WeFlow) 的二次开发版本。它保留原 WeFlow 的本地微信聊天记录读取、分析、导出、朋友圈解密、HTTP API 等能力，并新增 AI 自动回复与聊天记录蒸馏为 skill 的实验功能。

> 本项目仍然坚持本地优先：聊天记录读取、分析和导出逻辑沿用 WeFlow 的本地链路。AI 自动回复会在用户启用后尝试真实发送微信消息，请先使用白名单、测试联系人和手动/低风险发送器完成验证。

<p align="center">
  <img src="app.jpg" alt="WeFlow 应用预览" width="90%">
</p>

<p align="center">
  <a href="https://github.com/SilentForever/WeFlow-AI-Reply/actions/workflows/windows-portable.yml"><img src="https://img.shields.io/github/actions/workflow/status/SilentForever/WeFlow-AI-Reply/windows-portable.yml?branch=main&label=Windows%20Portable&labelColor=1F2937&color=2563EB" alt="Windows Portable Build"></a>
  <a href="https://github.com/SilentForever/WeFlow-AI-Reply/releases"><img src="https://img.shields.io/github/downloads/SilentForever/WeFlow-AI-Reply/total?style=flat&label=Downloads&labelColor=1F2937&color=059669" alt="Downloads"></a>
  <a href="https://github.com/SilentForever/WeFlow-AI-Reply/issues"><img src="https://img.shields.io/github/issues/SilentForever/WeFlow-AI-Reply?style=flat&label=Issues&labelColor=1F2937&color=D97706" alt="Issues"></a>
  <a href="https://github.com/SilentForever/WeFlow-AI-Reply/stargazers"><img src="https://img.shields.io/github/stars/SilentForever/WeFlow-AI-Reply?style=flat&label=Stars&labelColor=1F2937&color=7C3AED" alt="Stars"></a>
</p>

## 快速下载

Windows 用户推荐下载免安装版本：

- 最新 Windows x64 免安装 exe：[Windows Portable Latest](https://github.com/SilentForever/WeFlow-AI-Reply/releases/tag/windows-portable-latest)
- 也可以在 [Actions - Windows Portable EXE](https://github.com/SilentForever/WeFlow-AI-Reply/actions/workflows/windows-portable.yml) 中下载最近一次构建产物。

下载 `.exe` 后双击运行即可，无需安装。当前构建产物仅面向 Windows x64，且未做代码签名，首次运行时 Windows SmartScreen 可能出现安全提示。

> WeFlow 原功能要求微信 **4.0 及以上**版本，请确保本机 Windows 微信已登录。

## 主要功能

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 本地聊天记录查看 | 可用 | 实时读取微信聊天记录，无需生成解密中间数据库 |
| 图片/视频/实况解密 | 可用 | 支持聊天与朋友圈媒体预览、解密和导出 |
| 统计分析 | 可用 | 私聊分析、群聊画像、年度报告、双人报告 |
| 消息导出 | 可用 | 支持 JSON、HTML、TXT、Excel、CSV、PGSQL、ChatLab 等格式 |
| HTTP API | 可用 | 提供本地 API 与消息推送，便于自动化集成 |
| AI 自动回复 | 实验可用 | 支持触发规则、联系人规则、skill 上下文和多发送器 |
| 聊天记录蒸馏 skill | 实验功能 | 目标是把聊天记录沉淀为可复用的回复风格/知识 skill |

## AI 自动回复使用流程

1. 启动并登录 Windows 微信，确认 WeFlow 可以正常读取聊天记录。
2. 在 WeFlow 设置中启用 HTTP API、消息推送和访问 token。
3. 进入 AI 自动回复页面，配置模型 API、默认 skill、触发规则和联系人规则。
4. 选择发送器。默认建议先用 `manual` 或 `ui-automation` 对测试联系人验证。
5. 确认回复内容、触发范围和发送日志都符合预期后，再逐步扩大白名单。

如果使用 OpenAI、DeepSeek、通义千问等云端模型，触发回复所需的聊天上下文会发送到对应模型服务。请先确认 API 服务商、网络环境和数据范围符合你的隐私预期。

### 发送器能力

| 发送器 | 是否自动发送 | 是否无感 | 说明 |
| --- | --- | --- | --- |
| `manual` | 否 | 是 | 只生成回复并记录日志，不触碰微信，适合调试 |
| `ui-automation` | 是 | 否 | 默认 Windows UI 自动化路线，会激活微信窗口并粘贴发送 |
| `weclaw-http` | 是 | 是 | 调用外部 WeClaw HTTP 服务，适合后续无感发送方案 |
| `wechatferry` | 是 | 是 | 预留实验入口，高风险 Hook 路线，默认不内置启用 |

详细说明见：

- [AI 自动回复发送器配置说明](docs/ai-reply-senders.md)
- [AI 自动回复无感发送能力开发计划书](docs/ai-reply-sender-development-plan.md)
- [HTTP API 文档](docs/HTTP-API.md)

## 聊天记录蒸馏 skill

蒸馏 skill 的目标是从历史聊天记录中提取表达风格、常用语气、回复策略和边界约束，供 AI 自动回复生成更贴近目标对象的回复。使用前建议先用少量聊天记录测试生成质量，再决定是否扩大样本。

注意事项：

- 蒸馏过程会消耗模型 token，长聊天记录可能带来明显成本。
- 如果使用云端模型，聊天记录片段会发送到模型服务商。
- 生成结果不保证完全准确，需要人工检查并调整 skill 后再用于自动发送。
- 改进路线见 [蒸馏功能改进开发文档](docs/distill-improvement-plan.md)。

## GitHub 自动构建

推送到 `main` 后会自动触发 [Windows Portable EXE](https://github.com/SilentForever/WeFlow-AI-Reply/actions/workflows/windows-portable.yml)：

```text
npm ci
-> runtime binary check
-> npm run typecheck
-> npx vite build
-> electron-builder --win portable --x64
-> upload Actions artifact
-> update windows-portable-latest prerelease
```

该流水线只构建 Windows x64 免安装 exe，避免正式多平台 release 中 macOS、Linux 或 arm64 的非关键问题影响 Windows 交付。

## 本地开发

```bash
git clone https://github.com/SilentForever/WeFlow-AI-Reply.git
cd WeFlow-AI-Reply
npm install
npm run dev
```

常用检查：

```bash
npm run typecheck
npm run build
```

`npm run build` 会在 Windows 本地生成 `release/WeFlow-<version>-Portable.exe`。

## 安全与使用边界

- 请只在你有权访问的微信账号和聊天记录范围内使用本工具。
- 自动回复会真实发送消息，请优先使用联系人白名单、手动模式和测试联系人。
- 云端模型会接收用于生成回复或蒸馏 skill 的上下文，请谨慎选择数据范围。
- UI 自动化发送会短暂接管微信窗口，发送期间请避免操作键盘鼠标。
- WeClaw/WeChatFerry 等无感发送路线依赖外部项目或微信版本兼容性，默认不保证稳定。
- 本项目不提供微信官方个人号发送 API，也不鼓励绕过平台安全机制。

## 致谢

- [WeFlow](https://github.com/hicccc77/WeFlow)：本项目的上游基础。
- [密语 CipherTalk](https://github.com/ILoveBingLu/miyu)：为 WeFlow 提供基础框架。
- [WeChat-Channels-Video-File-Decryption](https://github.com/Evil0ctal/WeChat-Channels-Video-File-Decryption)：提供视频解密技术参考。
- [wx-automatic-reply](https://github.com/hdjshebhdhvfb/wx-automatic-reply)：自动回复链路参考。
- [yourself-skill](https://github.com/notdog1998/yourself-skill)：聊天记录蒸馏 skill 思路参考。

---

请负责任地使用本工具，遵守相关法律法规。
