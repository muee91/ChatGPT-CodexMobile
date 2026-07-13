# ChatGPT CodexMobile

## 中文介绍

ChatGPT CodexMobile 是一个面向个人私有部署的跨设备 Codex 工作台。电脑始终是实际执行环境；手机、平板或备用浏览器则用于续聊、查看工具执行过程、处理确认请求和管理当前项目。

它不是托管聊天服务，也不是远程桌面。桥接服务运行在自己的电脑上，读取本地 Codex 工作区、会话、项目、技能、文件和 Git 状态。设备通过可信局域网或 Tailscale 等私有网络配对访问，执行能力和敏感数据始终留在主机上。

### 核心能力

- 在 Web/PWA 或 Android 应用中继续本地与桌面端 Codex 会话。
- 通过 WebSocket 实时同步回复、工具活动、审批、失败、上下文状态与完成状态。
- 新建、排队、追加、终止、归档、重命名和恢复会话。
- 浏览项目与文件，并为回合附加文件、图片和技能。
- 管理分支、worktree、状态、差异、提交、拉取、推送、同步和 PR 草稿。
- 配对与撤销可信设备；支持 HTTPS/PWA 通知和连接恢复。
- 使用公开 Codex app-server 协议，并提供兼容性探测脚本。
- 读取本地模型配置及可选 OpenAI 兼容模型目录；第三方路由仅是外部本地工具，不是项目依赖。

### 平台支持

- **Web/PWA：** iPhone、iPad、Android、平板、桌面浏览器，以及同一可信网络中的现代浏览器。
- **Android：** 基于 Capacitor 的原生壳，支持局域网发现与二维码配对。
- **主机：** 已安装 Node.js 与本地 Codex 的 macOS、Linux 或 Windows 设备。

### 架构

```text
浏览器 / PWA / Android 应用
            |
            | HTTPS 或可信私网 HTTP + WebSocket
            v
ChatGPT CodexMobile 本地桥接服务
  |- 设备配对与请求安全
  |- Codex app-server 与本地会话投影
  |- 对话运行态与同步状态
  |- 文件、上传、技能、Git、通知
  `- 可选本地集成：ASR、TTS、文档工具
            |
            v
本地 Codex、项目、工具与模型提供商
```

### 快速开始

环境要求：Node.js 20+、npm、可正常使用的本地 Codex，以及主机与移动设备之间的可信局域网或 Tailscale 网络。

```sh
git clone https://github.com/muee91/ChatGPT-CodexMobile.git
cd ChatGPT-CodexMobile
npm install
npm run up
```

在主机上打开 `http://127.0.0.1:3321`。为手机配对时运行：

```sh
npm run pair
```

命令会输出一次性配对链接和验证码。Android 应用也可以扫描二维码并发现局域网内的兼容服务。

### 开发与构建

```sh
npm run dev:server
npm run dev:client
npm run build
npm run smoke
npm run codex:compat
```

构建 Android 调试 APK：

```sh
npm run android:build
```

`npm run codex:compat` 会对本机 Codex 二进制执行只读 app-server 初始化与线程列表探测。更新 Codex Desktop 或 CLI 后，建议运行一次。

### 安全说明

- 配对面向私有网络，使用一次性验证码和可信设备 Cookie。
- 不要把桥接服务直接暴露到公网。
- 如需后台 PWA 通知，请使用 Tailscale Serve 或其他 HTTPS 反向代理。
- 危险权限模式由主机端安全策略控制。
- 本地文件、上传、生成媒体和请求来源均经过服务端校验。

### 兼容性说明

项目以公开的 Codex app-server 协议作为实时回合状态的主通道。Desktop IPC 是增强能力；由于它属于私有协议，可能随桌面端版本变化。

---

## English Overview

ChatGPT CodexMobile is a private, cross-device workspace for operating local Codex sessions. Your computer remains the execution environment; a phone, tablet, or secondary browser becomes a companion for continuing conversations, watching tool progress, handling approvals, and managing the active project.

It is not a hosted chat service or a remote desktop product. The bridge runs on your own machine and reads the local Codex workspace, sessions, projects, skills, files, and Git state. Pair devices over a trusted LAN or private network such as Tailscale, so execution capability and sensitive data remain on the host computer.

### Capabilities

- Continue local and desktop Codex threads from a responsive Web/PWA UI or Android app.
- Stream replies, tool activity, approvals, failures, context status, and completion state through WebSocket synchronization.
- Create, queue, steer, interrupt, archive, rename, and resume conversations.
- Browse projects and files; attach files, images, and skills to a turn.
- Manage branches, worktrees, status, diffs, commits, pull/push/sync actions, and PR drafts.
- Pair and revoke trusted devices, use HTTPS/PWA notifications when available, and recover from a lost connection.
- Use the public Codex app-server contract with a compatibility probe.
- Read local model configuration and optional OpenAI-compatible provider catalogs. Third-party routing remains an external local tool, not a project dependency.

### Platforms

- **Web/PWA:** iPhone, iPad, Android, tablets, desktop browsers, and modern browsers on the same trusted network.
- **Android:** Capacitor-based native shell with local-network discovery and QR pairing support.
- **Host:** macOS, Linux, or Windows with Node.js and a working local Codex installation.

### Architecture

```text
Browser / PWA / Android app
            |
            | HTTPS or trusted private-network HTTP + WebSocket
            v
ChatGPT CodexMobile bridge
  |- device pairing and request security
  |- Codex app-server and local session projection
  |- conversation runtime and sync state
  |- files, uploads, skills, Git, notifications
  `- optional local integrations: ASR, TTS, document tools
            |
            v
Local Codex, projects, tools, and model providers
```

### Quick Start

Requirements: Node.js 20+, npm, a working local Codex installation, and a trusted LAN or Tailscale connection between the host and device.

```sh
git clone https://github.com/muee91/ChatGPT-CodexMobile.git
cd ChatGPT-CodexMobile
npm install
npm run up
```

Open `http://127.0.0.1:3321` on the host. To pair a phone:

```sh
npm run pair
```

The command prints a one-time pairing link and code. The Android app can also scan the QR code and discover compatible servers on the local network.

### Development And Build

```sh
npm run dev:server
npm run dev:client
npm run build
npm run smoke
npm run codex:compat
```

Build the Android debug APK:

```sh
npm run android:build
```

`npm run codex:compat` performs a read-only app-server initialization and thread-list probe against the local Codex binary. Run it after updating Codex Desktop or the CLI.

### Security

- Pairing is intended for private networks and uses one-time codes plus trusted-device cookies.
- Do not expose the bridge directly to the public internet.
- Use Tailscale Serve or another HTTPS reverse proxy when background PWA notifications are required.
- Dangerous permission modes are controlled by the host-side security policy.
- Local files, uploads, generated media, and request origins are guarded by server-side checks.

### Compatibility

The project prioritizes the public Codex app-server protocol for live turn state. Desktop IPC remains a best-effort enhancement because its private contract may change between desktop releases.

## License

MIT. See [LICENSE](LICENSE).
