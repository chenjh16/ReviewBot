# 飞书机器人 API 参考

> 飞书（Feishu/Lark）机器人的创建、配置、卡片交互和消息按钮能力参考，重点关注 ReviewBot 适配场景。

## 目录

- [飞书 vs QQ Bot 能力对比](#飞书-vs-qq-bot-能力对比)
- [准备工作](#准备工作)
- [创建应用](#创建应用)
- [添加机器人能力](#添加机器人能力)
- [申请权限](#申请权限)
- [事件与回调订阅](#事件与回调订阅)
- [长连接模式（WebSocket）](#长连接模式websocket)
- [发布应用](#发布应用)
- [消息类型](#消息类型)
- [交互卡片（消息按钮）](#交互卡片消息按钮)
- [卡片回调处理](#卡片回调处理)
- [Node.js SDK](#nodejs-sdk)
- [ReviewBot 飞书适配要点](#reviewbot-飞书适配要点)
- [机器人快捷指令菜单](#机器人快捷指令菜单)
- [消息编辑与卡片更新](#消息编辑与卡片更新)
- [参考链接](#参考链接)

> **相关文档：** [QQ Bot API 参考](qq-bot.md) · [路由设计](../routing.md) · [架构设计](../architecture.md)

---

## 飞书 vs QQ Bot 能力对比

| 维度 | QQ Bot | 飞书 Bot |
|------|--------|---------|
| 注册门槛 | 个人/企业实名认证 | 创建飞书团队（1 人即可） |
| 应用审核 | 官方审核上架 | 自建应用仅需企业管理员审核（个人团队即自己） |
| 按钮能力 | 需额外申请（模板制/内邀制） | 自建应用标配，无需额外申请 |
| 公网需求 | WebSocket（需连接官方网关） | WebSocket 长连接（无需公网 IP/域名） |
| 用户输入 | 指令按钮填入聊天框，用户编辑后发送 | 卡片内嵌输入框，直接在卡片中提交 |
| 路由机制 | 文本消息 `#agent_id` 前缀解析 | 按钮回调自带上下文（agent_id 嵌入 value） |
| 消息限制 | 严格频控（被动 60min/主动 4 条/月） | 相对宽松 |
| 卡片更新 | 不支持更新已发送消息 | 支持通过回调更新卡片内容 |
| 交互组件 | 按钮（最多 5×5） | 按钮、输入框、下拉选择、日期选择、表单容器等 |
| SDK | 无官方 SDK（直接调 REST API） | 官方 Node.js/Python/Go/Java SDK |

---

## 准备工作

### 创建飞书团队

飞书的「企业自建应用」不要求真正的企业。个人开发者流程：

1. 下载 [飞书客户端](https://www.feishu.cn/download)
2. 注册飞书账号（手机号即可）
3. 创建团队（1 人团队即可，无需营业执照）

> 创建团队后你自动成为管理员，拥有审核应用的权限。

### 开发环境

- Node.js 18+（ReviewBot 已有）
- 飞书 Node.js SDK：`@larksuiteoapi/node-sdk`

---

## 创建应用

1. 登录 [飞书开发者后台](https://open.feishu.cn/app)
2. 点击「创建应用」→ 选择「企业自建应用」
3. 填写应用名称（如 `CurBot`）、描述和图标
4. 创建后在「基础信息 → 凭证与基础信息」页面获取：
   - **App ID**（应用唯一标识，如 `cli_a9423592ec789cee`）
   - **App Secret**（应用密钥，保密）

---

## 添加机器人能力

1. 在开发者后台，进入应用详情页
2. 「应用能力 → 添加应用能力」页面，添加「机器人」能力
3. 配置机器人名称和描述

### 自定义菜单（可选）

在「机器人能力配置」页面可配置：

- **悬浮菜单**（当前使用）：菜单悬浮在输入框上方，不影响用户输入；支持父菜单展开子菜单弹窗
- **可切换菜单**：用户可在菜单和输入框之间切换

每个菜单项可配置：
- 名称（如「📊 状态」、`/status`）
- 响应动作：推送事件（触发 `application.bot.menu_v6` 事件）、发送文字消息、跳转链接
- 子菜单：主菜单可包含子菜单项（在开发者后台通过"新建子菜单"创建）

---

## 申请权限

在「开发配置 → 权限管理 → API 权限」页面开通：

| 权限 | 权限标识 | 说明 |
|------|---------|------|
| 读取单聊消息 | `im:message.p2p_msg:readonly` | 接收用户发给机器人的私聊消息 |
| 发送消息 | `im:message:send_as_bot` | 以机器人身份发送消息 |
| 群聊 @消息 | `im:message.group_at_msg:readonly` | 接收群聊中 @机器人的消息 |

> ReviewBot 主要使用单聊场景，前两项权限必需。

---

## 事件与回调订阅

在「开发配置 → 事件与回调」页面配置：

### 事件订阅

| 事件 | 事件标识 | 说明 |
|------|---------|------|
| 接收消息 | `im.message.receive_v1` | 用户发送消息时触发 |
| 用户进入会话 | `im.chat.access_event.bot_p2p_chat_entered_v1` | 用户首次打开与机器人的对话 |
| 机器人菜单 | `application.bot.menu_v6` | 用户点击自定义菜单时触发 |

### 回调订阅

| 回调 | 回调标识 | 说明 |
|------|---------|------|
| 卡片回传交互 | `card.action.trigger` | 用户点击卡片按钮/提交表单时触发 |

### 订阅方式

选择「使用长连接接收事件/回调」→ **无需配置公网 URL**。

---

## 长连接模式（WebSocket）

飞书的长连接模式是 ReviewBot 本地运行的核心能力：

### 工作原理

```text
飞书开放平台 ←→ WebSocket 长连接 ←→ 本地 ReviewBot Server
                                    （无需公网 IP）
```

### 优势

- **无需公网 IP/域名/内网穿透**：只需本地能访问公网即可
- **内置鉴权**：SDK 在建连时自动完成认证
- **本地开发友好**：直接在开发环境接收事件和回调
- **与 ReviewBot 架构天然兼容**：ReviewBot 本身就是本地服务

### 限制

- 仅支持企业自建应用（不支持商店应用）
- 每个应用最多 50 个并发连接
- 消息处理需在 **3 秒内** 完成
- 集群模式推送（多连接时随机一个收到消息）

---

## 发布应用

1. 在「应用发布 → 版本管理与发布」页面，点击「创建版本」
2. 填写版本号（如 `1.0.0`）和更新说明
3. 设置移动端/桌面端默认能力为「机器人」
4. 点击「保存」→「确认发布」
5. 个人团队应用免审核，提交后自动通过并在线上生效

> 自建应用发布免审核（成员 ≤ 5 人时），提交发布后即刻上线。

---

## 消息类型

飞书机器人支持的消息类型：

| msg_type | 名称 | 说明 |
|----------|------|------|
| `text` | 纯文本 | 普通文本消息 |
| `post` | 富文本 | 支持标题、@人、链接、图片混排 |
| `image` | 图片 | 单张图片消息 |
| `interactive` | 交互卡片 | 支持按钮、输入框等交互组件 |
| `share_chat` | 分享群名片 | 分享群组信息 |
| `share_user` | 分享个人名片 | 分享个人信息 |
| `audio` | 语音 | 语音消息 |
| `media` | 视频 | 视频消息 |
| `file` | 文件 | 文件消息 |

> ReviewBot 主要使用 `interactive`（交互卡片）类型。

---

## 交互卡片（消息按钮）

交互卡片是飞书的核心消息格式，支持丰富的布局和交互组件。

### 卡片结构

```json
{
  "msg_type": "interactive",
  "content": {
    "type": "template",
    "data": {
      "template_id": "卡片模板ID",
      "template_variable": {
        "title": "标题",
        "content": "内容"
      }
    }
  }
}
```

或使用原生 JSON 结构：

```json
{
  "msg_type": "interactive",
  "content": {
    "header": {
      "title": { "tag": "plain_text", "content": "📋 ReviewBot | yuanbaobot" },
      "template": "blue"
    },
    "elements": [
      {
        "tag": "markdown",
        "content": "**任务摘要：** 已完成功能开发\n\n请选择操作或直接回复："
      },
      {
        "tag": "action",
        "actions": [
          {
            "tag": "button",
            "text": { "tag": "plain_text", "content": "✅ 任务完成" },
            "type": "primary",
            "value": { "action": "approve", "agent_id": "yuanbaobot" }
          },
          {
            "tag": "button",
            "text": { "tag": "plain_text", "content": "🔄 回复反馈" },
            "type": "default",
            "value": { "action": "feedback", "agent_id": "yuanbaobot" }
          }
        ]
      },
      {
        "tag": "input",
        "name": "feedback_text",
        "placeholder": { "tag": "plain_text", "content": "输入反馈内容..." },
        "max_length": 2000
      }
    ]
  }
}
```

### 交互组件

| 组件 | tag | 说明 |
|------|-----|------|
| 按钮 | `button` | 点击触发回调或跳转链接 |
| 勾选器 | `checker` | 复选框，支持回调和删除线样式（需 7.9+，不支持自定义 `padding`） |
| 输入框 | `input` | 用户输入文本，支持单行/多行 |
| 下拉选择 | `select_static` | 静态选项下拉菜单 |
| 日期选择 | `date_picker` | 日期选择器 |
| 多选 | `multi_select_static` | 多选下拉框 |
| 表单容器 | `form` | 包裹多个交互组件，统一提交 |

### 卡片头部模板色

| template | 颜色 |
|----------|------|
| `blue` | 蓝色 |
| `wathet` | 浅蓝 |
| `turquoise` | 青色 |
| `green` | 绿色 |
| `yellow` | 黄色 |
| `orange` | 橙色 |
| `red` | 红色 |
| `carmine` | 绛红 |
| `violet` | 紫色 |
| `purple` | 深紫 |
| `indigo` | 靛蓝 |
| `grey` | 灰色 |

> ReviewBot 可用不同颜色区分不同 Agent 的审核卡片。

### 按钮属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `text` | object | 按钮文案 `{ tag: "plain_text", content: "文字" }` |
| `type` | string | 样式：`primary`（主色）、`default`（默认）、`danger`（危险） |
| `value` | object | 回调携带的自定义数据（JSON 对象） |
| `url` | string | 跳转链接（与 value 互斥） |
| `confirm` | object | 点击确认弹窗 |
| `disabled` | bool | 是否禁用 |

---

## 卡片回调处理

用户点击交互组件后，飞书通过长连接推送 `card.action.trigger` 事件。

### 回调数据结构

```json
{
  "schema": "2.0",
  "header": {
    "event_id": "事件ID",
    "event_type": "card.action.trigger",
    "app_id": "应用ID"
  },
  "event": {
    "operator": {
      "open_id": "用户ID",
      "user_id": "用户ID"
    },
    "token": "卡片token",
    "action": {
      "value": { "action": "approve", "agent_id": "yuanbaobot" },
      "tag": "button",
      "name": "组件标识"
    },
    "context": {
      "open_message_id": "消息ID",
      "open_chat_id": "会话ID"
    }
  }
}
```

### 回调中的表单数据

如果使用表单容器（`form`），回调通过 `form_value` 接收所有表单项：

```json
{
  "action": {
    "form_value": {
      "feedback_text": "用户输入的反馈内容"
    },
    "name": "submit_button"
  }
}
```

### 回调响应

服务端需在 **3 秒内** 返回响应，可选方式：

```javascript
// 1. 弹出 Toast 提示
return { toast: { type: "success", content: "已收到反馈" } };

// 2. 更新卡片内容
return { card: { /* 新的卡片 JSON */ } };

// 3. 不做任何更新
return {};
```

> **卡片更新能力** 是飞书的独特优势：提交反馈后可将卡片从「等待审核」更新为「已完成」状态，比 QQ Bot 的体验更好。

---

## Node.js SDK

### 安装

```bash
npm install @larksuiteoapi/node-sdk
```

### 初始化长连接客户端

```javascript
import * as lark from '@larksuiteoapi/node-sdk';

const client = new lark.Client({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
});

const eventDispatcher = new lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data) => {
    const message = data.event.message;
    const content = JSON.parse(message.content);
    console.log('收到消息:', content.text);
  },
  'card.action.trigger': async (data) => {
    const action = data.event.action;
    console.log('卡片交互:', action.value);
    return { toast: { type: 'success', content: '已收到' } };
  },
});

const wsClient = new lark.WSClient({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
});

wsClient.start({ eventDispatcher });
```

### 发送交互卡片

```javascript
await client.im.message.create({
  params: { receive_id_type: 'open_id' },
  data: {
    receive_id: userOpenId,
    msg_type: 'interactive',
    content: JSON.stringify({
      header: {
        title: { tag: 'plain_text', content: '📋 ReviewBot | yuanbaobot' },
        template: 'blue',
      },
      elements: [
        { tag: 'markdown', content: '**任务摘要：** 已完成功能开发' },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '✅ 任务完成' },
              type: 'primary',
              value: { action: 'approve', agent_id: 'yuanbaobot' },
            },
          ],
        },
      ],
    }),
  },
});
```

---

## ReviewBot 飞书适配要点

### 与 QQ Bot 方案的架构差异

| 方面 | QQ Bot 方案 | 飞书 Bot 方案 |
|------|------------|--------------|
| Agent 路由 | `#agent_id` 文本前缀 + 解析 | 按钮 `value` 直接携带 `agent_id` |
| 用户反馈输入 | 指令按钮填入聊天框，用户编辑 | 卡片内嵌输入框，直接提交 |
| 反馈传递 | 解析聊天消息 | 卡片回调 `form_value` |
| 状态展示 | 发送新消息 | 更新原卡片（等待中 → 已完成） |
| 多 Agent 区分 | 符号 + agent_id 文本前缀 | 卡片颜色 + 标题区分 |

### 审核卡片设计

```text
┌──────────────────────────────────┐
│ 📋 yuanbaobot | Review Request   │  ← 蓝色头部
├──────────────────────────────────┤
│ **任务摘要：**                    │
│ 已完成 XXXX 功能开发              │
│                                  │
│ ┌──────────────────────────────┐ │
│ │ 输入反馈内容...              │ │  ← 输入框组件
│ └──────────────────────────────┘ │
│                                  │
│ [✅ 任务完成]  [🔄 提交反馈]     │  ← 按钮组件
└──────────────────────────────────┘
```

### 反馈后卡片更新

```text
┌──────────────────────────────────┐
│ ✅ yuanbaobot | 审核完成          │  ← 绿色头部
├──────────────────────────────────┤
│ **任务摘要：** 已完成 XXXX 功能   │
│ **反馈：** 任务完成               │
│ **时间：** 2026-03-29 10:30      │
└──────────────────────────────────┘
```

### 实现思路

1. **长连接启动**：使用 `@larksuiteoapi/node-sdk` 的 `WSClient` 建立连接
2. **消息接收**：监听 `im.message.receive_v1` 接收用户文本消息（降级方案）
3. **卡片回调**：监听 `card.action.trigger` 接收按钮点击和表单提交
4. **Agent 路由**：从回调 `action.value.agent_id` 直接路由到对应 Agent
5. **卡片更新**：反馈后更新卡片状态，提供更好的视觉反馈

---

## 机器人快捷指令菜单

飞书机器人支持自定义菜单，在聊天输入框旁展示常用操作入口。

### 配置步骤

1. 进入开发者后台 → 应用 → **机器人** 页面
2. 找到 **机器人自定义菜单**，点击编辑按钮
3. 将菜单状态切换为 **开启**
4. 选择展示样式为**悬浮菜单**（常驻悬浮在输入框上方）
5. 添加菜单项，配置名称和响应动作；支持父菜单和子菜单
6. 创建新版本并发布

### ReviewBot 菜单配置

| 主菜单 | 响应动作 | 事件 Key | 说明 |
|--------|----------|----------|------|
| 📊 状态 | 推送事件 | `check_status` | 查看当前 Review 状态和队列信息 |
| ❓ 帮助 | 推送事件 | `show_help` | 显示使用帮助 |
| ⚡ 指令 | **父菜单** | — | 展开子菜单弹窗 |

| 子菜单 (⚡ 指令) | 响应动作 | 飞书发送 | Agent 收到（`VIBE_COMMANDS` 转换） |
|---|---|---|---|
| ✅ 任务完成 | 发送文字消息 | "✅ 任务完成" | "任务完成" |
| ▶️ 继续执行 | 发送文字消息 | "▶️ 继续执行" | 扩充的继续执行指令 |
| 📝 更新文档 | 发送文字消息 | "📝 更新文档" | 扩充的文档同步指令 |
| 🧪 端到端测试 | 发送文字消息 | "🧪 端到端测试" | 扩充的测试执行指令 |
| 📦 提交代码 | 发送文字消息 | "📦 提交代码" | 扩充的代码提交指令 |

> **v1.6.0 变更**：菜单响应动作从"发送文字消息"改为"推送事件"。
>
> **v1.7.0 变更**：「队列」和「状态」合并为同一张综合卡片。
>
> **v1.9.1 变更**：「📥 队列」菜单项已移除。
>
> **v2.0.1 (2026-04-02)**：子菜单文本经 `VIBE_COMMANDS` 服务端转换，Agent 收到扩充指令。
>
> **v2.0.0 (2026-04-02)**：「⚡ 指令」子菜单改为 Vibe Coding 快捷回复（替代原 /status、/new、/stop 命令菜单）。
>
> **v1.8.0 (2026-03-31)**：新增「⚡ 指令」父菜单及子菜单。

### 限制

- 仅支持单聊场景，不支持群聊
- 菜单名称最多 60 字符
- 悬浮菜单：最多 5 个主菜单 × 5 个子菜单
- 发布后约 5 分钟生效

## 主动发送消息

飞书机器人可以主动向用户发送消息，**无需用户先发消息**，限制比 QQ Bot 宽松得多。

### 前提条件

- 机器人已获得 `im:message:send_as_bot` 权限
- 目标用户至少与机器人**打开过一次聊天窗口**即可（不需要用户发送过消息）
  - 用户打开聊天窗口时，飞书推送 `im.chat.access_event.bot_p2p_chat_entered_v1` 事件，ReviewBot 从中获取用户的 `open_id` 和 `chat_id`
  - 之后机器人可**随时**向该用户发送消息，包括用户不在线时

### 与 QQ Bot 的关键差异

| 维度 | 飞书 | QQ Bot |
|------|------|--------|
| 用户需先发消息？ | **不需要**，打开聊天即可 | 需要用户先发消息 |
| 主动消息月度限制 | **无限制** | 4 条/月/用户 |
| 被动回复窗口 | 无窗口限制 | 群 5min / 单聊 60min |
| 频率控制 | 5 QPS/用户（极少触及） | 严格的被动/主动/召回分级 |

### 频率限制

| 维度 | 限制 |
|------|------|
| 单用户/单群 QPS | 5 条/秒 |
| 应用级 API 调用 | 1000 次/分钟 |
| 消息月度上限 | **无月度限制** |

### API 调用说明

飞书开放平台的 API 是机器人与飞书服务交互的 HTTP 接口。ReviewBot 主要使用以下 API：

| API | 用途 | 频率估算 |
|-----|------|---------|
| `im.message.create` | 发送消息/卡片给用户 | 每次 review/通知 1 次 |
| `im.message.patch` | 更新卡片状态（等待→完成） | 每次反馈 1 次 |
| `im.messageResource.get` | 下载用户发送的图片/文件附件 | 有附件时 1 次/附件 |

事件接收（如消息到达、卡片交互、菜单点击）走 WebSocket 长连接推送，**不计入 API 调用**。

ReviewBot 的日常使用远低于任何限额——即使高频使用，每天也仅产生几十次 API 调用。

### ReviewBot 中的主动发消息场景

| 场景 | 说明 |
|------|------|
| Review 请求推送 | Agent 提交 review 时，主动发送卡片给用户 |
| 超时提醒 | 等待反馈超时后，主动发送提醒消息 |
| `/send` 通知 | Agent 发送中间进度通知 |
| 队列变更 | 队列管理操作后更新卡片 |

所有场景均使用 `im.message.create` API，对频率限制无压力。

## 消息编辑与卡片更新

### 消息编辑

- 通过 `im.message.update` 编辑已发送的文本/富文本消息
- 一条消息最多编辑 20 次
- 仅可编辑自己发送的消息

### 卡片更新

ReviewBot 在以下场景自动更新卡片：

1. **按钮回调更新**：用户点击"任务完成"按钮时，回调返回更新后的卡片（绿色已完成状态）
2. **文本反馈后更新**：用户通过文字发送反馈后，通过 `im.message.patch` 更新原始卡片为已完成状态

卡片更新通过回调 token 进行，有效期 30 分钟，最多更新 2 次。

### 消息撤回

- 通过 `im.message.delete` 撤回消息
- 24 小时内可撤回自己发送的消息

## 参考链接

**开发教程：**
- [三分钟快速开发](https://open.feishu.cn/document/develop-an-echo-bot/introduction?lang=zh-CN)
- [开发卡片交互机器人](https://open.feishu.cn/document/develop-a-card-interactive-bot/introduction?lang=zh-CN)
- [应用配置说明](https://open.feishu.cn/document/develop-a-card-interactive-bot/faqs?lang=zh-CN)

**API 文档：**
- [发送消息](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/create)
- [编辑消息](https://open.feishu.cn/document/server-docs/im-v1/message/update)
- [撤回消息](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/delete)
- [接收消息事件](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/im-v1/message/events/receive)
- [卡片回传交互](https://open.feishu.cn/document/feishu-cards/card-callback-communication?lang=zh-CN)

**SDK：**
- [Node.js SDK (npm)](https://www.npmjs.com/package/@larksuiteoapi/node-sdk)
- [Node.js SDK (GitHub)](https://github.com/larksuite/node-sdk)
- [SDK 长连接处理回调](https://open.feishu.cn/document/server-side-sdk/nodejs-sdk/handling-callbacks)

**卡片组件：**
- [交互卡片概述](https://open.feishu.cn/document/feishu-cards/configuring-card-interactions)
- [按钮组件](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/interactive-components/button)
- [输入框组件](https://open.feishu.cn/document/uAjLw4CM/ukzMukzMukzM/feishu-cards/card-json-v2-components/interactive-components/input)
- [卡片搭建工具 (CardKit)](https://open.feishu.cn/cardkit)

**机器人菜单：**
- [机器人自定义菜单](https://open.feishu.cn/document/client-docs/bot-v3/bot-customized-menu)
- [机器人概述](https://open.feishu.cn/document/client-docs/bot-v3/bot-overview)

**管理端：**
- [飞书开发者后台](https://open.feishu.cn/app)

---

*本文档最后更新：2026 年 4 月 4 日（v2.1.0 菜单指令 + VIBE_COMMANDS 转换 + CONFIG 环境变量化）*
