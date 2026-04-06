# 路由与多 Agent 设计 / Routing & Multi-Agent Design

> 本文档汇总消息路由、多 Agent 标识、等待队列、卡片交互的完整逻辑与设计细节。
>
> Complete reference for message routing, multi-agent identification, queues, and card interactions.

**相关 / Related:** [架构 / Architecture](architecture.md) · [飞书 API](api/feishu.md) · [QQ Bot API](api/qq-bot.md)

---

## 1. Agent 标识 / Agent Identification

每个 Agent 通过 `POST /review` 提交审核时携带 `agent_id`（建议使用项目目录名）。Server 自动分配一个 **符号**（从 📋🔍✨🎯📝💡🔖📌🧩🎲⚡🌟🔔📎🏷️🪄🎪🧪🔬🎨 中选取），组合为 `agentLabel`（如 `📋 my-project`）。

- 同一 `agent_id` 始终使用相同符号（符号映射持久化到 `.state.json`）
- 同一 Agent（`client_uuid` 匹配）重新提交 review 时替换已有 pending review
- 不同 Agent（`client_uuid` 不匹配）使用相同 `agent_id` 时，自动追加 `.N` 后缀（如 `my-project.2`）

### 窗口级 UUID / Window-Level UUID (Cursor)

Cursor 向 Agent 子进程注入 `VSCODE_PID` 环境变量。`review-client.mjs` 用此生成窗口级持久 UUID：

```
project/.cursor/.reviewbot-sessions/
    ├── 85606.uuid  → "a1b2c3d4-..."  (窗口 A / Window A)
    └── 91234.uuid  → "e5f6g7h8-..."  (窗口 B / Window B)
```

UUID 在同一 Cursor 窗口的多次对话间持久化。过期会话（PID 已终止）自动清理。非 Cursor 环境退化为项目级 UUID。

### 冲突解析 / Conflict Resolution

```javascript
resolveAgentId(rawId, clientUUID):
  - 无已有 pending review → 直接使用 rawId
  - 同 UUID → 替换（同一窗口重新提交）
  - 无 UUID → 替换（旧版兼容）
  - 不同 UUID → 分配后缀: rawId.2, rawId.3, ...
```

## 2. 消息路由 / Message Routing

### 2.1 飞书平台路由优先级 / Feishu Routing Priority

```
收到消息 (im.message.receive_v1)
    │
    ├─ 0. Bot 命令？ → 处理命令，结束
    │     （/status, /help, /queue, /new, /stop, 📊 状态, ❓ 帮助）
    │
    ├─ 0b. Vibe 指令？ → VIBE_COMMANDS 转换后继续路由
    │     （✅ 任务完成, ▶️ 继续执行, 📝 更新文档, 🧪 端到端测试, 📦 提交代码）
    │
    ├─ 有 pending review：
    │     │
    │     ├─ 1a. 引用了某 Agent 的卡片 + 该 Agent 有 pending review
    │     │       → 路由反馈到该 Agent
    │     │
    │     ├─ 1b. 引用了某 Agent 的卡片 + 该 Agent 无 pending review
    │     │       → 入该 Agent 的专属等待队列
    │     │
    │     ├─ 2. 文本以 #agent_id 开头 → 路由反馈到该 Agent
    │     │
    │     ├─ 3. 用户已通过卡片按钮选中某 Agent (replyTarget) → 路由反馈
    │     │
    │     ├─ 4. 仅 1 个 Agent pending → 自动路由
    │     │
    │     └─ 5. 多个 Agent pending → System 卡片提示选择
    │
    └─ 无 pending review → 入等待队列
```

### 2.2 QQ Bot 平台路由

QQ Bot 不支持引用路由和卡片按钮交互：

1. `#agent_id` 文本前缀 → 路由到指定 Agent
2. 仅 1 个 Agent pending → 自动路由
3. 多个 Agent pending → 文字提示选择
4. 无 pending review → 入通用队列

### 2.3 引用路由 / Quote-Based Routing (飞书)

飞书 `im.message.receive_v1` 事件的 `message.parent_id` 标识被引用的消息。Server 通过 **卡片消息注册表**（`cardMsgRegistry`）将 `parent_id` 映射到 Agent：

| 注册场景 | agentId | type |
|---------|---------|------|
| Review Request 卡片 | `review.agentId` | `review` |
| Notification 卡片（`/send` + `agent_id`） | 对应 agentId | `notification` |
| 超时提醒 | `review.agentId` | `reminder` |
| 系统卡片（状态/帮助/路由提示） | `null` | `system` |

注册表最多 200 条（FIFO 清理），随 `.state.json` 持久化。

### 2.4 卡片按钮路由 / Card Button Routing (飞书)

| 按钮 | 触发 | 效果 |
|------|------|------|
| 💬 回复反馈 | `card.action.trigger` | 设置 `replyTarget`，卡片变 Selected (橙色) |
| ✅ 任务完成 | `card.action.trigger` | 直接提交「任务完成」作为反馈 |
| ✔ 请反馈（再次点击） | `card.action.trigger` | 取消 `replyTarget`，恢复初始状态 |
| ✕ 取消（状态卡片） | `card.action.trigger` | 取消指定 Agent 的 pending review |

选中状态全局互斥 — 切换 Agent 时自动恢复所有其他 pending review 卡片。

### 2.5 QQ Bot 按钮

QQ Bot 使用指令按钮（type=2）预填聊天输入框：

| 按钮 | enter | 行为 |
|------|-------|------|
| ✅ 任务完成 | true | 发送 `#agent_id 任务完成` |
| 🔄 回复反馈 | false | 预填 `#agent_id `，用户追加内容后发送 |

按钮需申请自定义按钮能力（内邀开通），不可用时降级为无按钮 Markdown + 文字提示。

## 3. 消息等待队列 / Message Queues

### 3.1 数据结构

```
messageQueues: Map<string, message[]>
  ├─ "my-project"  → [msg, msg, ...]   ← Agent 专属队列
  ├─ "my-app"      → [msg, msg, ...]   ← Agent 专属队列
  └─ "_general"    → [msg, msg, ...]   ← 通用队列
```

每个队列上限 `QUEUE_MAX_PER_AGENT` 条（默认 50，FIFO），超出移除最早的。随 `.state.json` 持久化。

### 3.2 入队规则

| 条件 | 目标队列 |
|------|---------|
| 引用了 Agent X 的卡片 | Agent X 的专属队列 |
| 文本含 `#agent_id` 前缀 | 该 Agent 的专属队列 |
| 无引用、无前缀 | 通用队列 `_general` |

### 3.3 出队逻辑（延迟消费）

```
Agent X 提交 Review
    ├─ 读取 X 队列 + _general → 快照，在 Review 卡片中展示
    └─ 不清空 — 用户可通过状态卡片编辑队列
        │
        ├─ 编辑队列 → Review 卡片实时刷新
        └─ 反馈完成 → 消费（清空）→ 合并到 Completed 卡片反馈段
```

### 3.4 队列管理 (飞书)

用户通过「📊 状态」菜单访问：按 Agent 分组展示，`checker` 勾选器选中后删除，支持「清空全部」。

## 4. 卡片类型 / Card Types

| 卡片 | 颜色 | 用途 |
|------|------|------|
| **Review Request** | 蓝色 | 初始状态 — 摘要 + 队列 + 截止时间 + 按钮 |
| **Selected** | 橙色 | 用户点击「回复反馈」选中该 Agent |
| **Completed** | 绿色 | 反馈完成 — 摘要 + 反馈 + 完成时间 |
| **Timeout** | 橙色 | 超时自动完成 — 超时描述 |
| **Notification** | 青色 | Agent 通知（`/send` + `agent_id`） |
| **System** | 可变 | 路由提示、附件确认、帮助 |

## 5. 反馈聚合 / Feedback Aggregation

- **纯文本** / **post 富文本**（含图文）→ 立即完成
- **独立图片/文件** → 加入 buffer，等待 `FEEDBACK_SILENCE_TIMEOUT`（默认 300s）后续文字或超时自动完成
- 每收到附件发送确认（飞书: System 卡片 / QQ: 文字）
- 聚合完成后：下载附件 → 合并文本 → 写入 session → 更新卡片

## 6. 超时处理 / Timeout Handling

```
Agent 调用 /wait-feedback (timeout=300s)
    ├─ 收到反馈 → { status: "replied", feedback: "..." }
    └─ 超时 → consecutiveTimeouts++
             ├─ < N → 发送提醒，返回 "timeout_retry"
             └─ >= N → 自动回复「任务完成」，卡片变 Timeout
                       (N = MAX_CONSECUTIVE_TIMEOUTS, 默认 12)
```

## 7. 状态持久化 / State Persistence

`.state.json` 在退出和每 60 秒自动保存：

| 持久化 | 不持久化 |
|--------|---------|
| messageQueues（消息队列） | pendingReviews（含回调/定时器） |
| cardMsgRegistry（卡片注册表） | lastFeedbacks（瞬态完成状态） |
| feishuKnownUsers（联系人信息） | replyTarget（运行时 UI 状态） |
| agentSymbols + nextSymbolIdx | |
| reviewHistory（审核历史，最多 100 条） | |

## 8. 完整交互时序 / Interaction Timeline

```
  ├─ Agent A 提交 review → Review Request 卡片（展示 A 队列 + 通用队列）
  ├─ Agent B 提交 review → Review Request 卡片
  ├─ 用户发送消息（无引用） → 多 Agent 提示卡片
  ├─ 用户点击 A「💬 回复反馈」→ A 卡片变 Selected（橙色）
  ├─ 用户发送反馈 → replyTarget=A → A 卡片变 Completed（绿色）
  ├─ 用户引用 B 卡片回复 → parent_id → B → B 卡片变 Completed
  ├─ Agent C 发通知 → Notification 卡片
  ├─ 用户引用 C 的通知回复（C 无 pending）→ 入 C 的队列
  └─ Agent C 提交 review → 展示 C 队列中的消息
```
