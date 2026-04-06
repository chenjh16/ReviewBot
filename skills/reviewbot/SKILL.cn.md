---
name: reviewbot
description: Use this skill to notify the user of your plan or progress, and to request user review when completing a task or needing a decision
---

# ReviewBot Skill

> `<SKILL_DIR>` 指本文件所在目录。安装后即 `~/.cursor/skills/reviewbot/`，开发时为 `reviewbot/skills/reviewbot/`。

## 快速参考

```bash
# 检查服务状态
PORT=$(cat <SKILL_DIR>/.port 2>/dev/null) && curl -s http://127.0.0.1:$PORT/status

# 发送通知（单向，始终携带 agent_id）
curl -s -X POST http://127.0.0.1:$PORT/send \
 -H 'Content-Type: application/json' \
 -d '{"message": "...", "format": "markdown", "agent_id": "'"$(basename $PWD)"'"}'

# 提交审核（阻塞等待）
node <SKILL_DIR>/review-client.mjs --summary "中文任务总结" --timeout 600
```

## 使用流程

### 1. 确保服务运行

```bash
PORT=$(cat <SKILL_DIR>/.port 2>/dev/null) && curl -s http://127.0.0.1:$PORT/status | grep connected
```

检查失败则启动服务：

```bash
nohup node <SKILL_DIR>/reviewbot-server.mjs > /tmp/reviewbot.log 2>&1 &
sleep 3 && PORT=$(cat <SKILL_DIR>/.port)
```

启动失败时检查：
- `<SKILL_DIR>` 下存在 `.env` 文件，包含至少一个平台的凭证
- 依赖已安装：`cd <SKILL_DIR> && npm install`
- 启动日志：`cat /tmp/reviewbot.log`

### 2. 发送通知（单向）

通知用户计划或中间进展（每轮任务 ≤3 次），不等回复。

```bash
PORT=$(cat <SKILL_DIR>/.port)
curl -s -X POST http://127.0.0.1:$PORT/send \
 -H 'Content-Type: application/json' \
 -d '{"message": "通知内容", "format": "markdown", "agent_id": "'"$(basename $PWD)"'"}'
```

`agent_id` 标识发送通知的 Agent。缺少时消息会作为匿名系统卡片发送，无法路由回任何 Agent。请始终携带。

可选字段：`"project_path"`（显示在通知卡片中）。

### 3. 提交 Review（阻塞等待反馈）

**必须在任务完成前发起 review request。** summary 必须使用中文。只有当用户明确回复"任务完成"时，才能真正结束任务。

```bash
node <SKILL_DIR>/review-client.mjs \
  --summary "中文任务总结" \
  --format markdown \
  --timeout 600
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--summary` | *（必填）* | 中文任务总结 |
| `--format` | `markdown` | `markdown` / `image` / `ark` / `text` |
| `--timeout` | `300` | 最长等待时间（秒） |
| `--agent-id` | 当前目录名 | Agent 标识（多 Agent 路由用） |

### 4. 处理返回

```json
{
  "status": "replied|timeout_retry|timeout|error",
  "reviewer_reply": "...",
  "session_dir": "<SKILL_DIR>/sessions/...",
  "attachments": [{"type": "image", "name": "1.png", "path": "/absolute/path"}]
}
```

| 状态 | 操作 |
|------|------|
| `replied` | 若用户回复"任务完成"则结束任务；否则根据反馈继续工作，完成后再次提交 review |
| `timeout_retry` | 再次调用 `review-client.mjs`（需带 `--summary`）继续等待 |
| `timeout` | 同上 — **绝不放弃** |
| `error` | 修复问题后重试 |

若 `attachments` 存在，使用 `Read` 工具通过绝对路径 `path` 查看图片文件。

**重要：绝不可在未成功收到用户反馈的情况下结束任务。失败或超时必须重试。**

## 格式选择

| 内容特征 | `--format` | 说明 |
|---------|-----------|------|
| 含 Markdown 语法（标题/列表/代码/链接） | `markdown` | **默认 — 除非有特殊原因，否则使用此格式** |
| 含表格/代码块/复杂排版 | `image` | Puppeteer 渲染（需 Chrome） |
| 结构化状态列表 | `ark` | Ark 卡片模板 |
| 3 行以内纯文字、无格式 | `text` | 禁止用于含 Markdown 语法的内容 |

QQ 平台：代码块**必须带语言标记**（如 `` ```text ``，不可用 `` ``` ``）。

## HTTP API 参考

端口号写入 `<SKILL_DIR>/.port`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/status` | 服务状态 |
| GET | `/history` | 最近完成的审核记录（`?limit=20`） |
| POST | `/review` | 提交审核请求 |
| POST | `/send` | 发送通知（飞书始终发卡片） |
| POST | `/send-html` | 渲染 markdown/html 为图片 |
| POST | `/wait-feedback` | 阻塞等待回复（review-client.mjs 内部使用） |

多窗口 UUID 自动处理，无需手动配置。详见 [routing.md](../../docs/routing.md)。

---

> **配置与安装** — 见 [ReviewBot AGENTS.md](../../AGENTS.md) 了解 `.env` 配置、依赖安装和安装命令。
