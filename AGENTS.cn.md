# ReviewBot Agent 指南

ReviewBot 是一个本地多平台 Bot 服务，桥接 AI Agent 与人类审核者。Agent 通过 HTTP 提交任务摘要，服务端推送到飞书（默认）或 QQ Bot（备用）收集反馈后返回。支持多 Agent 并发、交互卡片按钮、符号标识和消息路由。

## 项目结构

```text
reviewbot/
├── skills/reviewbot/          # Skill 包（安装到 ~/.cursor/skills/reviewbot/）
│   ├── reviewbot-server.mjs   # 主入口（编排层，247 行）
│   ├── review-client.mjs      # CLI 客户端：提交审核、阻塞等待
│   ├── lib/
│   │   ├── feishu/            # 飞书平台模块
│   │   │   ├── api.mjs        #   SDK 调用封装
│   │   │   ├── cards.mjs      #   卡片构建
│   │   │   └── ws.mjs         #   WebSocket + 事件处理
│   │   ├── qq/                # QQ Bot 平台模块
│   │   │   ├── api.mjs        #   API 调用封装
│   │   │   ├── builders.mjs   #   消息构建
│   │   │   └── ws.mjs         #   WebSocket + 事件处理
│   │   ├── core/              # 核心业务逻辑
│   │   │   ├── state.mjs      #   状态管理 + 持久化
│   │   │   ├── server.mjs     #   HTTP 路由
│   │   │   ├── commands.mjs   #   Bot 命令
│   │   │   ├── feedback.mjs   #   反馈聚合
│   │   │   └── routing.mjs    #   Agent 路由
│   │   └── util/              # 通用工具
│   │       ├── http.mjs, render.mjs, media.mjs, stall.mjs
│   ├── test/                  # 单元 + E2E 测试（115 个）
│   ├── SKILL.md / SKILL.cn.md # Agent 使用指南
│   ├── package.json
│   └── .env.example
├── rules/                     # Cursor 规则
├── docs/                      # 设计文档、API 参考、指南
├── install.sh                 # 安装脚本
├── README.md / AGENTS.md      # 项目文档
├── CONTRIBUTING.md / CHANGELOG.md
└── LICENSE                    # MIT License
```

## Agent 如何使用 ReviewBot

**→ 完整使用说明见 [`skills/reviewbot/SKILL.md`](skills/reviewbot/SKILL.md)**

简要流程：Agent 调用 `review-client.mjs --summary "..." --agent-id "项目名"` 提交审核，然后处理响应（replied / timeout_retry / error）。

协议规则（`rules/reviewbot-protocol.mdc`）会注入到每次对话中，定义何时发送通知和审核请求。

## 多 Agent 支持

多个 Agent 共享一个 ReviewBot Server。每个 Agent 获得唯一符号（📋🔍✨🎯…）绑定其 `agent_id`（项目目录名）。用户通过 `#agent_id` 前缀或消息快捷按钮路由回复。

冲突处理：若两个 Agent 使用相同目录名，Server 自动追加 `.N`（如 `my-project.2`）。

## 配置与安装

完整配置参考、平台搭建指南、安装与排障见 [README.md](README.md)。

快速安装：`bash install.sh`（开发模式：`bash install.sh --dev`）。

## 延伸阅读

- **[routing.md](docs/routing.md)** — **路由与多 Agent 设计**：Agent 标识、消息路由、队列、卡片交互、反馈流程（推荐首先阅读）
- [guide-feishu-console.md](docs/guide-feishu-console.md) — 飞书开发者后台设置指南
- [architecture.md](docs/architecture.md) — 架构、卡片、API、飞书/QQ 集成、状态持久化
- [api/feishu.md](docs/api/feishu.md) — 飞书机器人 API 参考
- [api/qq-bot.md](docs/api/qq-bot.md) — QQ Bot API v2 参考
- [roadmap.md](docs/roadmap.md) — 功能规划与能力调研
