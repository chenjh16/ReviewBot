# QQ Bot API v2 参考

> QQ Bot API v2 消息类型、富媒体、交互按钮、快捷指令的技术参考，以及 ReviewBot 多 Agent 实现方案。

## 目录

- [消息类型总览](#消息类型总览)
- [发送消息 API](#发送消息-api)
- [Markdown 消息](#markdown-消息)
- [富媒体消息（Media）](#富媒体消息media)
- [ARK 消息（卡片模板）](#ark-消息卡片模板)
- [三种交互入口](#三种交互入口)
- [消息按钮（InlineKeyboard）](#消息按钮inlinekeyboard)
- [指令面板](#指令面板)
- [单聊快捷菜单](#单聊快捷菜单)
- [参考链接](#参考链接)

> **相关文档：** [路由设计](../routing.md) · [架构设计](../architecture.md) · [飞书 API](feishu.md)

---

## 消息类型总览

QQ Bot API v2 支持以下消息类型（`msg_type` 字段）：

| msg_type | 名称 | 说明 | 单聊 | 群聊 | 频道 |
|----------|------|------|:----:|:----:|:----:|
| 0 | 文本 | 纯文本消息 | ✅ | ✅ | ✅ |
| 2 | Markdown | 富文本，支持标题/加粗/图片/列表等，可配合 keyboard 按钮 | ✅ | ✅ | ✅ |
| 3 | ARK | 卡片模板消息，有默认模板（23/24/37）和自定义模板 | ✅ | ✅ | ✅ |
| 4 | Embed | 嵌入式消息（仅频道） | ❌ | ❌ | ✅ |
| 7 | Media | 富媒体（图片/视频/语音/文件），需先上传获取 file_info | ✅ | ✅ | ❌ |

---

## 发送消息 API

### 单聊

```text
POST /v2/users/{openid}/messages
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| msg_type | int | ✅ | 消息类型：0 文本、2 markdown、3 ark、4 embed、7 media |
| content | string | - | 文本消息内容 |
| markdown | object | - | Markdown 消息对象 |
| keyboard | object | - | 按钮组件（配合 Markdown 使用） |
| ark | object | - | ARK 卡片对象 |
| media | object | - | 富媒体 file_info（先上传后发送） |
| msg_id | string | - | 被动回复的消息 ID |
| msg_seq | int | - | 回复序号（同一 msg_id 下递增，避免重复） |
| event_id | string | - | 事件 ID（被动消息） |
| is_wakeup | bool | - | 互动召回消息（与 msg_id/event_id 互斥） |

### 群聊

```text
POST /v2/groups/{group_openid}/messages
```

请求字段与单聊基本一致（无 `is_wakeup`）。

### 频率限制

| 场景 | 被动回复 | 主动消息 | 互动召回 |
|------|---------|---------|---------|
| **单聊** | 60 分钟内回复，每条消息最多 5 次 | 每月 4 条/用户 | 用户主动对话后 30 天内，分 4 个周期各 1 条 |
| **群聊** | 5 分钟内回复，每条消息最多 5 次 | 每月 4 条/群 | 不支持 |

> 2025 年 4 月 21 日起，主动推送能力不再提供。需通过被动回复或互动召回发送消息。

#### 互动召回消息详解

互动召回（`is_wakeup=true`）是单聊场景下用户主动对话后的延时推送能力。当用户发消息给机器人后，机器人获得以下 4 个周期的推送窗口，**每个周期可发 1 条**：

| 周期 | 时间范围 | 说明 |
|------|---------|------|
| 周期 1 | **当天** | 用户发消息的当日内 |
| 周期 2 | **1 ~ 3 天** | 用户发消息后第 1 至第 3 天 |
| 周期 3 | **3 ~ 7 天** | 用户发消息后第 3 至第 7 天 |
| 周期 4 | **7 ~ 30 天** | 用户发消息后第 7 至第 30 天 |

**周期重置规则：** 用户隔天再次发消息给机器人后，所有周期按天维度往后重新计算。

**使用方式：** 发送消息时设置 `is_wakeup: true`，与 `msg_id` / `event_id` **互斥**（不能同时使用）。

```json
{
  "msg_type": 2,
  "markdown": { "content": "消息内容" },
  "is_wakeup": true
}
```

**ReviewBot 应用：** 当被动回复窗口过期且主动消息额度用尽时，ReviewBot 会尝试互动召回作为最后手段，确保审核消息能送达用户。

---

## Markdown 消息

Markdown 消息是 ReviewBot 的主要消息格式。

| 能力 | 状态 | 说明 |
|------|------|------|
| 自定义 Markdown | 内邀开通 | 沙箱环境可直接使用；生产环境需内邀或申请 |
| 模板 Markdown | [申请开通](https://wj.qq.com/s2/12257706/6310) | 提交模板审核后使用，支持变量填充 |

### 支持格式

| 格式 | 语法 |
|------|------|
| 标题 | `# 一号标题`、`## 二号标题` |
| 加粗 | `**加粗**` |
| 下划线加粗 | `__下划线加粗__` |
| 斜体 | `_斜体_` 或 `*斜体*` |
| 加粗斜体 | `***加粗斜体***` |
| 删除线 | `~~删除线~~` |
| 链接 | `[文字](URL)` 或 `<URL>` |
| 有序/无序列表 | `1.` / `-` |
| 块引用 | `> 引用内容` |
| 分割线 | `***` |
| 图片 | `![text #宽度px #高度px](图片URL)` |

### 图片插入

Markdown 消息中可以直接嵌入图片，平台会自动下载转存：

```text
![描述文字 #宽度px #高度px](https://example.com/image.png)
```

**注意事项：**
- 图片 URL 必须是公网可访问的
- 需指定 `#宽度px #高度px`（如 `#208px #320px`），否则图片尺寸可能异常
- URL 需在管理端「消息 URL 配置」中预先配置域名白名单
- 平台会下载转存图片，不直接引用原始 URL

**通过模板使用图片：**

```json
{
  "markdown": {
    "custom_template_id": "模板ID",
    "params": [
      { "key": "image", "values": ["https://example.com/image.png"] }
    ]
  }
}
```

模板中的图片占位符格式：`![img#宽度px #高度px]({{.image}})`

### Markdown 发送方式

**自定义 Markdown（内邀）：**

```json
{
  "msg_type": 2,
  "markdown": {
    "content": "# 标题\n\n正文内容\n\n![图片 #300px #200px](https://example.com/img.png)"
  }
}
```

**模板 Markdown：**

```json
{
  "msg_type": 2,
  "markdown": {
    "custom_template_id": "模板ID",
    "params": [
      { "key": "title", "values": ["标题"] },
      { "key": "content", "values": ["正文"] }
    ]
  }
}
```

---

## 富媒体消息（Media）

用于单聊和群聊发送图片、视频、语音、文件。ReviewBot 使用此接口发送 HTML 渲染截图。

### 上传接口

```text
POST /v2/users/{openid}/files      # 单聊
POST /v2/groups/{group_openid}/files  # 群聊
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|:----:|------|
| file_type | int | ✅ | 1=图片(png/jpg)、2=视频(mp4)、3=语音(silk/wav/mp3/flac)、4=文件 |
| url | string | 二选一 | 公网可访问的资源 URL |
| file_data | string | 二选一 | Base64 编码的二进制数据 |
| srv_send_msg | bool | ✅ | `true` 直接发送（占主动消息频次），`false` 返回 file_info 供后续使用 |

**返回：**

| 字段 | 说明 |
|------|------|
| file_uuid | 文件 ID |
| file_info | 用于发消息接口 `media` 字段 |
| ttl | 有效期（秒），0 表示长期 |

### 发送流程

推荐两步发送（`srv_send_msg=false`）：

```javascript
// 1. 上传图片，获取 file_info
const upload = await apiCall('POST', `/v2/users/${openid}/files`, {
  file_type: 1,
  file_data: imageBase64,
  srv_send_msg: false,
});

// 2. 用 file_info 发送消息
await apiCall('POST', `/v2/users/${openid}/messages`, {
  msg_type: 7,
  media: { file_info: upload.file_info },
  msg_id: replyMsgId,  // 被动回复
});
```

> **注意：** 单聊上传的 file_info 只能发到单聊，群聊上传的只能发到群聊。但同一 file_info 可复用到多个目标。

---

## ARK 消息（卡片模板）

ARK 消息通过预设模板发送结构化卡片，默认主动消息可用。

### 默认模板

**模板 23：链接 + 文本列表**

```json
{
  "msg_type": 3,
  "ark": {
    "template_id": 23,
    "kv": [
      { "key": "#DESC#", "value": "描述" },
      { "key": "#PROMPT#", "value": "通知提示" },
      { "key": "#TITLE#", "value": "标题" },
      { "key": "#META_URL#", "value": "https://example.com" },
      { "key": "#META_LIST#", "obj": [
        { "obj_kv": [{ "key": "name", "value": "项目1" }] },
        { "obj_kv": [{ "key": "name", "value": "项目2" }] }
      ]}
    ]
  }
}
```

**模板 24：文本 + 缩略图**

| 字段 | 说明 |
|------|------|
| `#DESC#` | 描述 |
| `#PROMPT#` | 提示文本 |
| `#TITLE#` | 标题 |
| `#METADESC#` | 详情描述 |
| `#IMG#` | 缩略图链接 |
| `#LINK#` | 跳转链接 |
| `#SUBTITLE#` | 来源/子标题 |

**模板 37：大图卡片**

| 字段 | 说明 |
|------|------|
| `#PROMPT#` | 提示消息 |
| `#METATITLE#` | 标题 |
| `#METASUBTITLE#` | 子标题 |
| `#METACOVER#` | 大图 URL（推荐 975×540） |
| `#METAURL#` | 跳转链接 |

---

## 三种交互入口

QQ 机器人提供三种快捷交互方式：

| 入口 | 触发方式 | 配置方式 | 场景 |
|------|---------|---------|------|
| **消息按钮** | 点击消息底部按钮 | API 发送时指定 `keyboard` 字段 | 所有场景 |
| **指令面板** | 输入 `/` 或 `@机器人` | 管理端配置 | 频道/群聊 |
| **快捷菜单** | 长按机器人头像 / 聊天面板 | 管理端配置 | 单聊 |

---

## 消息按钮（InlineKeyboard）

消息按钮挂载在 Markdown 消息底部，用户点击按钮可触发跳转、回调或指令发送。

**限制：**
- 最多 5 行，每行最多 5 个按钮
- 必须与 Markdown 消息一起发送，不支持单独发送按钮
- 需要申请按钮模板或内邀开通自定义按钮能力

### 数据结构

```json
{
  "markdown": {
    "content": "# 审核结果\n请选择操作："
  },
  "keyboard": {
    "content": {
      "rows": [
        {
          "buttons": [
            {
              "id": "btn_approve",
              "render_data": {
                "label": "✅ 通过",
                "visited_label": "已通过",
                "style": 1
              },
              "action": {
                "type": 2,
                "permission": { "type": 2 },
                "data": "任务完成",
                "enter": true,
                "unsupport_tips": "请手动输入"任务完成""
              }
            },
            {
              "id": "btn_reject",
              "render_data": {
                "label": "❌ 需修改",
                "visited_label": "已反馈",
                "style": 0
              },
              "action": {
                "type": 2,
                "permission": { "type": 2 },
                "data": "请继续修改",
                "enter": false,
                "unsupport_tips": "请手动回复"
              }
            }
          ]
        }
      ]
    }
  },
  "msg_type": 2
}
```

### Action 类型详解

| type | 名称 | 行为 | 适用场景 |
|------|------|------|---------|
| **0** | 跳转按钮 | 打开 `data` 中的 URL 或小程序 | 外部链接、文档跳转 |
| **1** | 回调按钮 | 触发 `INTERACTION_CREATE` 事件，`data` 传给后台 | 后台处理逻辑、状态变更 |
| **2** | 指令按钮 | 在输入框自动填入 `@bot data`，配合 `enter` 可自动发送 | 快捷指令、一键回复 |

### 关键属性

| 属性 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `action.enter` | bool | false | **指令按钮专用**。`true` 时点击按钮直接自动发送 `data`，无需用户手动确认。需 QQ 版本 8983+ |
| `action.reply` | bool | false | **指令按钮专用**。`true` 时指令带引用回复当前消息。需 QQ 版本 8983+ |
| `action.anchor` | int | - | 设为 `1` 时唤起手机选图器（仅单聊场景、手机端 8983+） |
| `action.click_limit` | int | 不限 | 已弃用，按钮可点击次数 |
| `render_data.style` | int | - | `0` = 灰色线框，`1` = 蓝色线框 |
| `action.unsupport_tips` | string | 必填 | 客户端不支持时显示的提示文案 |

### 按钮能力开通

消息按钮需要额外申请才能使用，有两种方式：

| 方式 | 状态 | 说明 |
|------|------|------|
| **按钮模板** | 申请开通 | 提交申请表获取模板 ID，使用固定模板 |
| **自定义按钮** | 内邀开通 | 可自由定义按钮结构，需官方邀请或主动联系开通 |

> **未开通按钮能力时**，发送含 `keyboard` 字段的消息会返回错误 `code=304057 msg=not allowd custom keyborad`。消息本身（Markdown 部分）仍可正常发送，仅按钮不显示。

#### 申请按钮模板

**申请入口：** [QQ 机器人 Markdown 消息模板申请](https://wj.qq.com/s2/12257706/6310)（腾讯问卷）

> 此表单同时用于申请 **Markdown 模板** 和 **按钮模板** 能力。

**申请条件：**

| 机器人类型 | 条件 |
|-----------|------|
| 私域机器人 | 已审核上架 + 使用场景及目的合理 |
| 公域机器人 | 已审核上架 + 过去 7 天平均使用频道数 ≥ 3 |
| 群机器人 | 已审核上架 + 过去 7 天平均使用群数 ≥ 3 |

**审核周期：** 每月 15-20 日统一审核，结果通过邮件通知。

**申请步骤：**
1. 确保机器人已在 [QQ 机器人管理端](https://q.qq.com/bot/) 完成审核并上架
2. 打开 [申请表链接](https://wj.qq.com/s2/12257706/6310)，填写 AppID、使用场景等信息
3. 等待每月审核窗口（15-20 日），审核通过后邮件通知
4. 获得模板 ID 后，在发送消息时使用 `keyboard.id` 字段

> **来源：** [QQ 机器人常见问题 Q30](https://q.qq.com/wiki/FAQ/robot/)

#### 申请自定义按钮

自定义按钮目前为 **内邀开通** 制度，无公开申请表。获取方式：

1. **加入官方开发者社区**：手机 QQ 搜索「QQ 频道开发者社区」加入官方频道
2. **在 #需求 子频道反馈**：说明按钮使用场景和需求
3. **等待官方邀请**：平台会根据机器人数据表现和需求综合评估

> ReviewBot 当前使用的是自定义按钮方式（`keyboard.content`），因此需要自定义按钮能力。如果只能申请到按钮模板，则需要将按钮结构改为使用模板 ID。

### 按钮发送方式

**方式一：按钮模板（申请开通）**

先申请模板获得模板 ID，发送时只需传 ID：

```json
{
  "keyboard": { "id": "模板ID" }
}
```

> ⚠️ 按钮模板暂不支持使用变量填充，即模板内容是固定的。

**方式二：自定义按钮（内邀开通）**

在 `keyboard.content` 中定义完整的按钮结构：

```json
{
  "keyboard": {
    "content": {
      "rows": [{ "buttons": [/* ... */] }]
    }
  }
}
```

**发送接口：**

| 场景 | API 路径 |
|------|---------|
| 单聊 | `POST /v2/users/{openid}/messages` |
| 群聊 | `POST /v2/groups/{group_openid}/messages` |
| 频道 | `POST /channels/{channel_id}/messages` |
| 频道私信 | `POST /dms/{guild_id}/messages` |

### 回调事件处理

当用户点击 **回调按钮**（`action.type = 1`）时：

**1. 订阅事件**

WebSocket 需订阅 `INTERACTION` intent（`1 << 26`）。

**2. 接收 INTERACTION_CREATE 事件**

```json
{
  "chat_type": 2,
  "data": {
    "resolved": {
      "button_data": "回调按钮的data值",
      "button_id": "btn_id",
      "user_id": "操作用户ID"
    },
    "type": 11
  },
  "id": "interaction_id",
  "type": 11,
  "scene": "c2c",
  "user_openid": "用户openid"
}
```

**事件 type 字段：**
- `11`：消息按钮点击
- `12`：单聊快捷菜单点击

**3. 必须回应事件**

收到事件后必须调用回应接口，否则客户端按钮会一直 loading：

```text
PUT /interactions/{interaction_id}
Body: { "code": 0 }
```

| code | 含义 |
|------|------|
| 0 | 成功 |
| 1 | 操作失败 |
| 2 | 操作频繁 |
| 3 | 重复操作 |
| 4 | 没有权限 |
| 5 | 仅管理员操作 |

---

## 指令面板

用户在聊天输入框输入 `/` 或 `@机器人` 时，QQ 客户端会弹出指令面板，展示预配置的指令列表。

**配置方式：** 在 [QQ 机器人管理端](https://q.qq.com/bot/) 的「指令」页面配置。

**配置字段：**
- **指令名**：最多 6 字符，管理端自动添加 `/` 前缀
- **指令描述**：最多 15 字符，仅中文
- **权限**：管理员 / 所有人

**注意事项：**
- 需手机 QQ 8868+ 版本
- 已提审过的指令需删除后重新添加才能带 `/` 前缀
- 仅通过管理端 UI 配置，不支持 API 动态管理

---

## 单聊快捷菜单

在单聊场景下，用户可通过机器人聊天面板看到快捷菜单按钮。

**配置方式：** 在 [QQ 机器人管理端](https://q.qq.com/bot/) 的自定义设置中配置按钮内容和动作。

**回调事件：** 快捷菜单按钮点击同样触发 `INTERACTION_CREATE` 事件，`type` 为 `12`（区别于消息按钮的 `11`）。事件中包含 `feature_id` 字段标识被点击的菜单项。

---

> **ReviewBot 多 Agent 实现方案** — 详见 [routing.md](../routing.md)，包含 Agent 标识、按钮路由、消息路由解析、Server 实现要点和用户体验流程。

---

## 参考链接

**消息类型：**
- [Markdown 消息](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/type/markdown.html)
- [ARK 消息](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/type/ark.html)
- [Embed 消息](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/type/embed.html)
- [模板 23（链接+文本列表）](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/type/template/template_23.html)
- [模板 24（文本+缩略图）](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/type/template/template_24.html)
- [模板 37（大图卡片）](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/type/template/template_37.html)

**消息收发：**
- [发送消息（单聊/群聊/频道）](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/send.html)
- [富媒体消息（图片/视频/语音上传）](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/rich-media.html)
- [消息事件](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/event.html)
- [消息对象模型](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/template/model.html)

**交互组件：**
- [消息按钮协议（InlineKeyboard）](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/msg-btn.html)
- [消息按钮组件 SDK](https://bot.q.qq.com/wiki/develop/nodesdk/model/inline_keyboard.html)
- [基础消息对话](https://bot.q.qq.com/wiki/develop/api-v2/client-func/intro/baseinfo.html)

**管理端：**
- [QQ 机器人管理端](https://q.qq.com/bot/)（指令面板、快捷菜单、URL 白名单等配置）

---

*本文档最后更新：2026 年 3 月 28 日*
