# ReviewBot

[English](#english) | 中文

<p align="center">
  <img src="docs/screenshots.png" alt="ReviewBot on Feishu" width="800">
</p>

AI 编程 Agent 的人工审核服务。

ReviewBot 连接 AI Agent（如 [Cursor](https://cursor.com)）与人类审核者。Agent 完成任务或需要决策时，通过 HTTP 提交审核请求；ReviewBot 将其推送到飞书或 QQ Bot 聊天中，收集反馈后返回给等待中的 Agent。

```
┌──────────────┐       HTTP (localhost)      ┌──────────────────┐       WebSocket       ┌────────────────┐
│  AI Agent    │  ───── 审核请求 ────────────▶│ reviewbot-server │ ─────────────────────▶│  飞书 / QQ     │
│  (Cursor)    │  ◀──── 反馈 ───────────────  │   (Node.js)      │ ◀── 用户反馈 ────────  │  (即时通讯)    │
└──────────────┘                              └──────────────────┘                       └────────────────┘
```

## 特性

- **多平台** — 飞书为主，QQ Bot 为备，可同时运行
- **多 Agent** — 多个 Agent 共享一个服务，每个自动分配唯一符号（📋🔍✨🎯…），自动路由
- **交互卡片** — 飞书富交互卡片：审核/反馈按钮、状态流转、队列管理
- **引用路由** — 引用回复任意卡片消息即可路由反馈到对应 Agent
- **多种格式** — Markdown、HTML 截图（Puppeteer 渲染）、Ark 卡片、纯文本
- **反馈聚合** — 收集多条回复（文字 + 图片）后统一提交给 Agent
- **无需公网 IP** — 完全本地运行，通过出站 WebSocket 连接平台
- **Cursor 技能** — 以 Cursor Agent Skill 形式分发，含协议规则自动集成工作流

## 快速开始

### 1. 安装

```bash
git clone https://github.com/chenjh16/ReviewBot.git
cd ReviewBot
bash install.sh
```

安装脚本将技能包复制到 `~/.cursor/skills/reviewbot/`，安装依赖，并引导你配置凭证。

开发模式（符号链接，修改即时生效）：

```bash
bash install.sh --dev
```

### 2. 配置平台 Bot

> **重要：** ReviewBot 需要至少一个即时通讯平台的 Bot 应用。必须先完成平台侧配置，服务端才能连接。

#### 飞书（推荐）

飞书需要在开发者后台创建并配置 Bot 应用（一次性设置）：

1. 在 [feishu.cn](https://www.feishu.cn/) 创建飞书团队（免费，1 人即可）
2. 在 [飞书开放平台](https://open.feishu.cn/) → 开发者后台 → 创建自建应用
3. 添加应用能力 → **机器人**
4. 配置**权限**（必需）：
   - `im:message:send_as_bot` — 发送消息
   - `im:message.p2p_msg:readonly` — 接收单聊消息
   - `im:resource` — 下载图片/文件附件
5. **订阅事件**（WebSocket 模式，无需公网 IP）：
   - `im.message.receive_v1` — 接收用户消息
   - `application.bot.menu_v6` — 悬浮菜单点击
   - `card.action.trigger` — 卡片按钮交互
6. 配置**悬浮菜单**（可选但推荐）— 状态、帮助、Vibe Coding 快捷回复
7. **创建版本并发布** — 个人团队可自审自批
8. 在飞书中**打开与 Bot 的聊天**即可开始接收消息

详细图文指南见 [guide-feishu-console.md](docs/guide-feishu-console.md)。

#### QQ Bot（备选）

1. 在 [QQ 开放平台](https://q.qq.com/) 创建 Bot
2. 获取 AppID 和 AppSecret
3. 可选申请自定义按钮能力（内邀开通）

详见 [QQ Bot API 参考](docs/api/qq-bot.md)。

### 3. 配置凭证

在技能目录创建 `.env`（安装脚本会提示，或从 `.env.example` 复制）：

```bash
# 至少配置一个平台
FEISHU_APP_ID=your_app_id
FEISHU_APP_SECRET=your_app_secret

# 可选：QQ Bot 作为备用平台
QQBOT_APP_ID=your_app_id
QQBOT_APP_SECRET=your_app_secret
```

完整配置项见 [`.env.example`](skills/reviewbot/.env.example)。

### 4. 启动服务

```bash
node ~/.cursor/skills/reviewbot/reviewbot-server.mjs
```

后台运行：

```bash
nohup node ~/.cursor/skills/reviewbot/reviewbot-server.mjs > /tmp/reviewbot.log 2>&1 &
```

### 5. 提交审核（Agent 端）

```bash
node ~/.cursor/skills/reviewbot/review-client.mjs \
  --summary "已完成用户认证功能" \
  --timeout 300
```

命令会阻塞直到审核者通过飞书/QQ 回复反馈。

## 配置

所有设置通过环境变量（`.env` 文件）管理：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | — | 飞书 Bot 凭证 |
| `QQBOT_APP_ID` / `QQBOT_APP_SECRET` | — | QQ Bot 凭证 |
| `REVIEWBOT_PORT` | `0`（自动） | HTTP 服务端口 |
| `REVIEW_DEFAULT_TIMEOUT` | `300` | Review 超时（秒） |
| `MAX_CONSECUTIVE_TIMEOUTS` | `12` | 最大连续超时次数 |
| `REVIEW_MAX_TTL_HOURS` | `24` | Review 最大存活时间（小时） |
| `QUEUE_MAX_PER_AGENT` | `50` | 每 Agent 队列上限 |
| `FEEDBACK_SILENCE_TIMEOUT` | `300` | 反馈聚合静默超时（秒） |
| `LOG_LEVEL` | `info` | 日志级别（`debug` / `info` / `warn` / `error`） |
| `ALLOWED_REVIEWERS` | *（所有）* | 允许的审核者 ID（逗号分隔） |
| `CHROME_PATH` | *（自动）* | Chrome 路径（Puppeteer 渲染用） |

## 系统要求

- **Node.js** >= 18.0.0
- **Chrome/Chromium**（可选，用于 HTML 转图片渲染）
- 至少配置一个 Bot 平台（飞书或 QQ）

## 文档

| 文档 | 说明 |
|------|------|
| **[routing.md](docs/routing.md)** | 路由与多 Agent 设计：Agent 标识、消息路由、队列、卡片交互 |
| [guide-feishu-console.md](docs/guide-feishu-console.md) | 飞书开发者后台配置图文指南 |
| [architecture.md](docs/architecture.md) | 架构设计、卡片系统、API、状态持久化 |

## 项目结构

```text
reviewbot/
├── skills/reviewbot/          # 技能包（安装到 ~/.cursor/skills/reviewbot/）
│   ├── reviewbot-server.mjs   # 主入口（编排层）
│   ├── review-client.mjs      # CLI 客户端
│   ├── lib/
│   │   ├── feishu/            # 飞书平台：API、卡片、WebSocket
│   │   ├── qq/                # QQ Bot 平台：API、消息构建、WebSocket
│   │   ├── core/              # 核心逻辑：状态、命令、反馈、路由、HTTP 服务
│   │   └── util/              # 工具函数：HTTP、渲染、媒体、消息生成
│   ├── test/                  # 单元 + E2E 测试
│   ├── SKILL.md               # Agent 使用指南
│   ├── package.json
│   └── .env.example
├── rules/                     # Cursor 规则
├── docs/                      # 设计文档、API 参考、指南
├── install.sh                 # 安装脚本
├── CONTRIBUTING.md            # 贡献指南
├── CHANGELOG.md               # 版本历史
└── LICENSE                    # MIT License
```

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[MIT](LICENSE)

---

<a id="english"></a>

# ReviewBot

[中文](#reviewbot) | English

**Human-in-the-loop review service for AI coding agents.**

ReviewBot bridges AI agents (such as [Cursor](https://cursor.com)) and human reviewers via messaging platforms. When an agent completes a task or needs a decision, it submits a review request over HTTP; ReviewBot pushes it to your Feishu (Lark) or QQ Bot chat, collects your feedback, and returns it to the waiting agent.

```
┌──────────────┐       HTTP (localhost)      ┌──────────────────┐       WebSocket       ┌────────────────┐
│  AI Agent    │  ───── review request ─────▶│ reviewbot-server │ ─────────────────────▶│  Feishu / QQ   │
│  (Cursor)    │  ◀──── feedback ───────────  │   (Node.js)      │ ◀── user feedback ──  │  (Messenger)   │
└──────────────┘                              └──────────────────┘                       └────────────────┘
```

## Features

- **Multi-platform** — Feishu (Lark) as primary, QQ Bot as fallback, running simultaneously
- **Multi-agent** — Multiple agents share one server; each gets a unique symbol (📋🔍✨🎯…) with automatic routing
- **Interactive cards** — Rich Feishu card UI with approve/feedback buttons, status transitions, and queue management
- **Quote-based routing** — Reply to any card message to route feedback to the correct agent
- **Flexible formats** — Markdown, rendered HTML screenshots (via Puppeteer), Ark cards, or plain text
- **Feedback aggregation** — Collects multi-message replies (text + images) before delivering to the agent
- **Zero public IP** — Runs entirely on localhost; platforms connect via outbound WebSocket
- **Cursor Skill** — Ships as a Cursor Agent Skill with protocol rules for automated workflow integration

## Quick Start

### 1. Install

```bash
git clone https://github.com/chenjh16/ReviewBot.git
cd ReviewBot
bash install.sh
```

The installer copies the skill to `~/.cursor/skills/reviewbot/`, installs dependencies, and guides you through credential setup. For development (symlinks): `bash install.sh --dev`

### 2. Set Up a Bot Platform

> **Important:** ReviewBot requires a bot application on at least one messaging platform. You must complete the platform-side configuration before the server can connect.

#### Feishu (Lark) — Recommended

One-time setup in the Feishu developer console:

1. **Create a Feishu team** at [feishu.cn](https://www.feishu.cn/) (free, 1 person is enough)
2. **Create an app** at [Feishu Open Platform](https://open.feishu.cn/) → Developer Console → Create Custom App
3. **Enable Bot capability** — Add Features → Bot
4. **Configure permissions** (required):
   - `im:message:send_as_bot` — Send messages
   - `im:message.p2p_msg:readonly` — Receive DM messages
   - `im:resource` — Download image/file attachments
5. **Subscribe to events** (WebSocket mode, no public IP needed):
   - `im.message.receive_v1` — Receive user messages
   - `application.bot.menu_v6` — Floating menu clicks
   - `card.action.trigger` — Card button interactions
6. **Configure floating menu** (optional but recommended)
7. **Publish a version** — self-approve in personal teams
8. **Open a chat** with the bot in Feishu

See [guide-feishu-console.md](docs/guide-feishu-console.md) for a detailed walkthrough.

#### QQ Bot — Alternative

1. Create a bot at [QQ Bot Platform](https://q.qq.com/)
2. Obtain AppID and AppSecret
3. Optionally apply for custom button capability (内邀开通)

See [QQ Bot API reference](docs/api/qq-bot.md) for details.

### 3. Configure Credentials

Create `.env` in the skill directory (the installer will prompt you, or copy from `.env.example`):

```bash
# At least one platform required
FEISHU_APP_ID=your_app_id
FEISHU_APP_SECRET=your_app_secret
```

See [`.env.example`](skills/reviewbot/.env.example) for all options.

### 4. Start the Server

```bash
node ~/.cursor/skills/reviewbot/reviewbot-server.mjs
```

### 5. Submit a Review (from an Agent)

```bash
node ~/.cursor/skills/reviewbot/review-client.mjs \
  --summary "Implemented user authentication" \
  --timeout 300
```

The command blocks until a reviewer responds via Feishu/QQ.

## Configuration

All settings via environment variables (`.env` file):

| Variable | Default | Description |
|----------|---------|-------------|
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | — | Feishu bot credentials |
| `QQBOT_APP_ID` / `QQBOT_APP_SECRET` | — | QQ bot credentials |
| `REVIEWBOT_PORT` | `0` (auto) | HTTP server port |
| `REVIEW_DEFAULT_TIMEOUT` | `300` | Review timeout in seconds |
| `MAX_CONSECUTIVE_TIMEOUTS` | `12` | Max retries before auto-reply |
| `REVIEW_MAX_TTL_HOURS` | `24` | Review max TTL (hours) |
| `QUEUE_MAX_PER_AGENT` | `50` | Max queued messages per agent |
| `FEEDBACK_SILENCE_TIMEOUT` | `300` | Feedback aggregation silence timeout (seconds) |
| `LOG_LEVEL` | `info` | Log level (`debug` / `info` / `warn` / `error`) |
| `ALLOWED_REVIEWERS` | *(all)* | Comma-separated reviewer user IDs |
| `CHROME_PATH` | *(auto)* | Chrome path for Puppeteer rendering |

## Requirements

- **Node.js** >= 18.0.0
- **Chrome/Chromium** (optional, for HTML-to-image rendering)
- At least one bot platform configured (Feishu or QQ)

## Documentation

| Document | Description |
|----------|-------------|
| **[routing.md](docs/routing.md)** | Routing & multi-agent design: agent IDs, routing, queues, card interactions |
| [guide-feishu-console.md](docs/guide-feishu-console.md) | Feishu developer console setup walkthrough |
| [architecture.md](docs/architecture.md) | Architecture, cards, API, state persistence |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)
