# 飞书机器人开发者平台 — 完整设置指南

> 本文档指导**人**和 **Agent（浏览器 MCP）** 完成飞书机器人的全部配置流程：创建应用、添加机器人能力、权限配置、事件订阅、悬浮菜单配置、发布上线。

## 前置条件

- 飞书账号（手机号注册即可）
- 已创建飞书团队（1 人团队即可，无需营业执照）
- Agent 操控时需要：Cursor IDE 浏览器 MCP（`cursor-ide-browser`）

### Agent 操控须知

- 飞书开发者后台需要登录，首次访问会跳转到扫码登录页
- Agent **无法代替用户扫码**，需截图发送给用户等待扫码
- 后续操作可全自动完成
- 操作完毕后务必 `browser_lock → action: "unlock"` 释放浏览器

---

## 第一部分：创建应用

### 目标

在飞书开发者后台创建一个「企业自建应用」，获取 App ID 和 App Secret。

### 关键 URL

| 页面 | URL |
|------|-----|
| 控制台首页 | `https://open.feishu.cn/app` |

### 人工操作步骤

1. 打开 [飞书开发者后台](https://open.feishu.cn/app)，登录（飞书 App 扫码）
2. 点击「创建应用」→ 选择「企业自建应用」
3. 填写应用名称（如 `CurBot`）、描述（如 `ReviewBot AI 代码审查助手`）
4. 上传应用图标（可选，建议使用 256×256 PNG）
5. 创建成功后，进入应用详情页
6. 在「基础信息 → 凭证与基础信息」页面获取：
   - **App ID**：应用唯一标识（如 `cli_a9423592ec789cee`）
   - **App Secret**：应用密钥（保密，不可泄露）
7. 配置 App ID 和 App Secret（二选一）：

   **方式一：写入 `.env` 文件**（推荐，优先级高于系统环境变量）
   ```
   # <SKILL_DIR>/.env
   FEISHU_APP_ID=cli_xxxxxxxxx
   FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxx
   ```

   **方式二：设置系统环境变量**
   ```bash
   export FEISHU_APP_ID=cli_xxxxxxxxx
   export FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxx
   ```

### Agent 浏览器操控步骤

```text
1. browser_navigate → https://open.feishu.cn/app
2. browser_snapshot → 检查页面状态
   - 如果在登录页（出现二维码）：
     a. browser_take_screenshot → 截取登录区域
     b. 通过 /send 将截图发送给用户，提示扫码
     c. 轮询 browser_snapshot 等待页面跳转（2-3s 间隔，最长 120s）
     d. 登录成功后继续
   - 如果已登录：继续
3. browser_snapshot → 确认到达控制台首页
4. 找到「创建应用」按钮并点击
5. browser_snapshot → 弹出创建应用对话框
6. 选择「企业自建应用」
7. browser_fill → 填写应用名称
8. 提交创建
9. browser_snapshot → 确认到达应用详情页
10. 在「基础信息」页面找到 App ID 和 App Secret
11. 记录并输出给用户
```

---

## 第二部分：添加机器人能力

### 目标

为应用添加「机器人」能力，使其可以在飞书中作为聊天机器人使用。

### 关键 URL

| 页面 | URL |
|------|-----|
| 应用能力 | `https://open.feishu.cn/app/{APP_ID}/ability` |
| 机器人配置 | `https://open.feishu.cn/app/{APP_ID}/bot` |

### 人工操作步骤

1. 进入应用详情页，点击左侧菜单「应用能力 → 添加应用能力」
2. 找到「机器人」能力卡片，点击「添加」
3. 添加成功后，左侧菜单出现「机器人」入口
4. 点击「机器人」进入配置页面
5. 填写机器人信息：
   - **机器人名称**：如 `CurBot`
   - **机器人描述**：如 `AI 代码审查助手`

### Agent 浏览器操控步骤

```text
1. browser_navigate → https://open.feishu.cn/app/{APP_ID}/ability
2. browser_snapshot → 查看应用能力页面
3. 找到「机器人」能力区域
   - 如果显示「已添加」：跳过，直接进入配置
   - 如果显示「添加」按钮：点击添加
4. browser_navigate → https://open.feishu.cn/app/{APP_ID}/bot
5. browser_snapshot → 确认到达机器人配置页面
```

---

## 第三部分：权限配置

### 目标

为机器人申请必要的 API 权限，使其能够接收和发送消息。

### 关键 URL

| 页面 | URL |
|------|-----|
| 权限管理 | `https://open.feishu.cn/app/{APP_ID}/permission` |

### 必需权限

| 权限名称 | 权限标识 | 说明 |
|---------|---------|------|
| 获取与发送单聊、群组消息 | `im:message` | 接收用户私聊消息 + 发送消息 |
| 读取单聊消息 | `im:message.p2p_msg:readonly` | 接收用户发给机器人的私聊消息 |
| 以应用的身份发消息 | `im:message:send_as_bot` | 以机器人身份发送消息（必需） |
| 获取群组中所有消息 | `im:message.group_msg` | 接收群聊消息（如需群聊场景） |
| 获取用户发给机器人的单聊消息 | `im:message.p2p_msg` | 接收用户发给机器人的私聊消息（含图片/文件） |
| 接收群聊中 @机器人消息 | `im:message.group_at_msg:readonly` | 接收群聊中 @机器人的消息 |
| 获取与上传图片或文件资源 | `im:resource` | 下载用户发送的图片和文件附件 |

> **最低要求**：`im:message.p2p_msg:readonly` + `im:message:send_as_bot`。建议开通 `im:resource` 以支持附件下载。

### 推荐权限

以下权限可增强机器人的功能，建议按需开通：

| 权限名称 | 权限标识 | 说明 |
|---------|---------|------|
| 发送应用内加急消息 | `im:message.urgent` | 发送加急消息通知用户，适用于需要紧急关注的 Review 请求 |
| 获取单聊、群组消息 | `im:message:readonly` | 获取消息详情，用于引用回复等高级消息处理 |

### 人工操作步骤

1. 进入「开发配置 → 权限管理」页面
2. 在搜索框中搜索权限标识（如 `im:message`）
3. 找到对应权限，点击「开通」
4. 重复步骤 2-3 直到所有必需权限已开通
5. 部分权限可能需要「申请开通」并填写使用理由

### Agent 浏览器操控步骤

```text
1. browser_navigate → https://open.feishu.cn/app/{APP_ID}/permission
2. browser_snapshot → 查看权限管理页面
3. 对每个必需权限和推荐权限：
   a. 点击「批量开通」或「添加权限」按钮
   b. browser_snapshot → 弹出权限选择对话框
   c. 在搜索框中 browser_fill → 输入中文权限名称（如 "加急"）
   d. browser_press_key → "Enter" 触发搜索（SPA 可能不会自动搜索）
   e. browser_snapshot → 查看搜索结果
   f. 勾选目标权限（注意：复选框可能有 opacity:0，需使用 browser_mouse_click_xy）
      - 如果复选框显示为已选中/禁用：该权限已开通，跳过
   g. 点击「确认」完成添加
   h. 重复步骤 a-g 处理下一个权限
4. browser_snapshot → 确认所有权限已开通
```

---

## 第四部分：事件与回调订阅

### 目标

配置事件订阅，使机器人能够接收消息事件和卡片交互回调。

### 关键 URL

| 页面 | URL |
|------|-----|
| 事件与回调 | `https://open.feishu.cn/app/{APP_ID}/event` |

### 必需事件

| 事件名称 | 事件标识 | 说明 |
|---------|---------|------|
| 接收消息 | `im.message.receive_v1` | 用户发送消息时触发（核心事件） |
| 机器人自定义菜单 | `application.bot.menu_v6` | 用户点击悬浮菜单时触发 |

### 推荐事件

以下事件可增强机器人的交互能力，建议按需开通：

| 事件名称 | 事件标识 | 说明 |
|---------|---------|------|
| 用户进入与机器人的会话 | `im.chat.access_event.bot_p2p_chat_entered_v1` | 用户打开机器人聊天窗口时触发，可用于发送欢迎消息 |
| 消息已读 | `im.message.message_read_v1` | 消息被用户阅读时触发，可追踪消息阅读状态 |
| 消息表情回应 | `im.message.reaction.created_v1` | 用户对消息添加表情回应时触发 |
| 取消消息表情回应 | `im.message.reaction.deleted_v1` | 用户取消表情回应时触发 |
| 消息撤回 | `im.message.recalled_v1` | 用户撤回消息时触发，可用于清理关联状态 |

### 必需回调

| 回调名称 | 回调标识 | 说明 |
|---------|---------|------|
| 卡片回传交互 | `card.action.trigger` | 用户点击卡片按钮/提交表单时触发 |

### 订阅方式

选择「**长连接**」方式接收事件 — 无需配置公网 URL，本地即可运行。

### 人工操作步骤

1. 进入「开发配置 → 事件与回调」页面
2. 订阅方式选择「使用长连接接收事件」
3. 添加事件：
   a. 点击「添加事件」
   b. 搜索 `im.message.receive_v1`，勾选并添加
   c. 搜索 `application.bot.menu_v6`，勾选并添加
4. 添加回调：
   a. 找到「卡片回传交互」区域
   b. 确认 `card.action.trigger` 已启用

### Agent 浏览器操控步骤

```text
1. browser_navigate → https://open.feishu.cn/app/{APP_ID}/event
2. browser_snapshot → 查看事件订阅页面
3. 确认订阅方式为「长连接」
   - 如果不是：找到切换选项并切换
4. 检查已订阅的事件列表
5. 对每个必需事件和推荐事件：
   a. 如果未订阅：点击「添加事件」
   b. browser_snapshot → 弹出添加对话框
   c. 在搜索框中输入事件标识（如 "im.message.receive"）
   d. browser_press_key → "Enter" 触发搜索
   e. browser_snapshot → 查看搜索结果
   f. 勾选目标事件（注意：复选框可能有 opacity:0，需使用 browser_mouse_click_xy）
   g. 点击「确认添加」或「添加」按钮
6. 检查回调配置
   a. 找到卡片回传交互配置区域
   b. 确认 card.action.trigger 已启用
```

---

## 第五部分：悬浮菜单配置

### 目标

配置机器人的自定义悬浮菜单，包含主菜单和子菜单。

### 关键 URL

| 页面 | URL |
|------|-----|
| 机器人配置 | `https://open.feishu.cn/app/{APP_ID}/bot` |

### 菜单结构

ReviewBot 使用**悬浮菜单**样式（常驻悬浮在输入框上方，不影响用户输入）：

#### 主菜单

| 菜单名称 | 响应动作 | 事件 Key / 配置 |
|----------|----------|----------------|
| 📊 状态 | 推送事件 | `check_status` |
| ❓ 帮助 | 推送事件 | `show_help` |
| ⚡ 指令 | **父菜单** | 包含 5 个子菜单 |

#### 子菜单（⚡ 指令）

| 菜单名称 | 响应动作 | 发送文本 |
|----------|----------|----------|
| ✅ 任务完成 | 发送文字消息 | `✅ 任务完成` |
| ▶️ 继续执行 | 发送文字消息 | `▶️ 继续执行` |
| 📝 更新文档 | 发送文字消息 | `📝 更新文档` |
| 🧪 端到端测试 | 发送文字消息 | `🧪 端到端测试` |
| 📦 提交代码 | 发送文字消息 | `📦 提交代码` |

> 子菜单的「发送文字消息」会在聊天中发出用户消息，服务端通过 `VIBE_COMMANDS` 映射转换为详细的 Agent 指令。

#### 悬浮菜单 vs 可切换菜单

| 对比项 | 悬浮菜单（当前使用） | 可切换菜单 |
|--------|----------------------|------------|
| 展示方式 | 常驻悬浮在输入框上方 | 点击左侧按钮切换显示 |
| 样式 | 按钮风格 + 子菜单弹窗 | 斜杠命令风格 |
| 容量 | 5 主菜单 x 5 子菜单 | 3 主菜单 x 5 子菜单 |
| 优势 | 常驻可见、不影响输入 | 紧凑、斜杠命令直觉 |
| 两者互斥，不可同时启用 | | |

### 人工操作步骤

1. 进入「机器人」配置页面
2. 找到「机器人自定义菜单」区域
3. 如果菜单未开启，切换为「开启」状态
4. 选择展示样式为「**悬浮菜单**」
5. 添加主菜单项：

   **📊 状态：**
   - 点击「添加」
   - 菜单名称：`📊 状态`
   - 响应动作：选择「推送事件」
   - 事件 Key：`check_status`
   - 保存

   **❓ 帮助：**
   - 点击「添加」
   - 菜单名称：`❓ 帮助`
   - 响应动作：选择「推送事件」
   - 事件 Key：`show_help`
   - 保存

   **⚡ 指令（父菜单）：**
   - 点击「添加」
   - 菜单名称：`⚡ 指令`
   - 响应动作：选择「父菜单」（此时不需要事件 Key）
   - 保存

6. 为「⚡ 指令」添加子菜单：
   - 点击「⚡ 指令」菜单项
   - 点击「新建子菜单」
   - 逐个添加 5 个子菜单项：
     - 菜单名称：如 `✅ 任务完成`
     - 响应动作：选择「发送文字消息」
     - 发送内容自动为菜单名称
   - 重复直到 5 个子菜单全部添加

### Agent 浏览器操控步骤

```text
1. browser_navigate → https://open.feishu.cn/app/{APP_ID}/bot
2. browser_snapshot → 查看机器人配置页面
3. browser_scroll → 向下滚动找到「机器人自定义菜单」区域
   注意：页面可能有内层滚动容器，使用 scrollIntoView: true
4. browser_snapshot → 查看菜单配置区域

5. 检查菜单开关状态：
   - 如果未开启：点击开关开启
   - browser_snapshot → 确认展示样式

6. 选择样式为「悬浮菜单」：
   - 找到样式选择器
   - 如果不是「悬浮菜单」：点击切换

7. 添加主菜单项（逐个）：
   a. 点击「添加」按钮
   b. browser_snapshot → 弹出编辑区域
   c. browser_fill → 填写菜单名称（如 "📊 状态"）
   d. 选择响应动作
      - 推送事件：选择「推送事件」，填写事件 Key
      - 父菜单：选择「父菜单」
   e. 点击保存/确认
   f. browser_snapshot → 确认菜单项已添加

8. 为「⚡ 指令」添加子菜单：
   a. 找到「⚡ 指令」菜单项
   b. 点击进入编辑或展开子菜单区域
   c. 点击「新建子菜单」
   d. 逐个添加 5 个子菜单项：
      - browser_fill → 填写名称（如 "✅ 任务完成"）
      - 选择「发送文字消息」
      - 保存
   e. browser_snapshot → 确认子菜单已添加

9. 检查最终菜单结构是否与目标一致
```

### 修改已有菜单项

```text
1. 在菜单配置区域找到目标菜单项
2. 点击菜单项进入编辑状态（通常点击菜单名称或编辑图标）
3. browser_snapshot → 查看编辑表单
4. browser_fill → 修改名称或事件 Key
5. 保存修改
```

### 删除菜单项

```text
1. 在菜单配置区域找到目标菜单项
2. 点击删除按钮（通常是 ✕ 或垃圾桶图标）
3. 如果弹出确认对话框：点击确认
```

---

## 第六部分：发布应用

### 目标

创建新版本并发布，使配置变更在线上生效。

### 关键 URL

| 页面 | URL |
|------|-----|
| 版本管理 | `https://open.feishu.cn/app/{APP_ID}/publish` |

> **重要**：权限变更、事件订阅变更、菜单配置变更都需要发布新版本才能生效。

### 人工操作步骤

1. 进入「应用发布 → 版本管理与发布」页面
2. 点击「创建版本」
3. 填写版本信息：
   - **版本号**：递增（如 `1.0.0`、`1.1.0`）
   - **更新说明**：简述变更内容
   - **移动端/桌面端默认能力**：选择「机器人」
4. 点击「保存」
5. 点击「确认发布」
6. 个人团队应用免审核，提交后自动生效（约 5 分钟）

### Agent 浏览器操控步骤

```text
1. browser_navigate → https://open.feishu.cn/app/{APP_ID}/publish
2. browser_snapshot → 查看版本管理页面
3. 找到「创建版本」按钮并点击
4. browser_snapshot → 弹出版本创建表单
5. browser_fill → 填写版本号（查看已有版本号，递增）
6. browser_fill → 填写更新说明（如 "配置悬浮菜单"）
7. 选择默认能力为「机器人」：
   - 找到移动端/桌面端默认能力下拉框
   - 选择「机器人」
8. 点击「保存」
9. browser_snapshot → 确认版本已保存
10. 找到「确认发布」按钮并点击
11. 如果弹出确认对话框：
    - browser_snapshot → 查看对话框内容
    - 点击对话框中的「确认发布」按钮
12. browser_snapshot → 确认发布成功
```

---

## 第七部分：验证与调试

### 验证机器人可用

1. 打开飞书客户端（桌面或移动端）
2. 搜索机器人名称（如 `CurBot`）
3. 打开与机器人的聊天窗口
4. 发送一条消息（如「你好」）
5. 检查 ReviewBot Server 日志是否收到消息

### 启动 ReviewBot Server

```bash
# 确保 .env 已配置 App ID 和 App Secret
cat <SKILL_DIR>/.env | grep FEISHU

# 安装依赖
cd <SKILL_DIR> && npm install

# 启动服务
nohup node <SKILL_DIR>/reviewbot-server.mjs > /tmp/reviewbot.log 2>&1 &
sleep 3

# 检查服务状态
PORT=$(cat <SKILL_DIR>/.port 2>/dev/null) && curl -s http://127.0.0.1:$PORT/status
```

### 常见问题

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| 机器人搜索不到 | 未发布版本 | 创建并发布新版本 |
| 发消息无响应 | 事件未订阅 | 检查 `im.message.receive_v1` 是否已订阅 |
| 按钮点击无响应 | 回调未启用 | 检查 `card.action.trigger` 是否已启用 |
| 菜单未出现 | 菜单未开启或未发布 | 检查菜单开关 + 发布新版本 |
| 附件下载失败 | 缺少资源权限 | 开通 `im:resource` 权限 |
| 连接失败 | App ID/Secret 错误 | 核对 `.env` 中的凭证 |
| 权限复选框灰色/不可点击 | 权限已开通 | 该权限已存在，无需重复添加 |
| 搜索后列表未更新 | SPA 未触发搜索 | 输入后按 Enter 键触发搜索 |

---

## Agent 操控注意事项

### 登录处理

飞书开发者后台需要飞书 App 扫码登录。Agent 操控时：

1. `browser_snapshot` 检测是否在登录页面
2. 如果出现二维码，通过 `browser_take_screenshot` 截取
3. 通过 ReviewBot `/send` 发送截图给用户并提示扫码
4. 轮询 `browser_snapshot`（2-3s 间隔）等待登录完成
5. 登录成功后使用 `browser_lock → action: "lock"` 锁定标签

### 页面导航

- 飞书后台使用 SPA 架构，部分导航不会触发全页刷新
- 优先使用 `browser_navigate` 直接跳转到目标 URL
- 如果页面加载慢，使用 `browser_snapshot` 短间隔轮询（2-3s）
- 页面内滚动可能存在嵌套滚动容器，使用 `scrollIntoView: true`

### 元素定位

- 优先使用 `browser_snapshot` 获取元素 ref
- 部分元素（如复选框）可能设置了 `opacity: 0`，`browser_click` 无法点击，需使用 `browser_mouse_click_xy` 配合截图坐标
- 使用 `browser_search` 定位页面中的特定文本
- 如果元素被遮挡，使用 `browser_scroll` 配合 `scrollIntoView: true`

### 表单与搜索交互

- `browser_fill` 可能不触发 SPA 的搜索逻辑，填写后需 `browser_press_key → "Enter"` 显式触发搜索
- 搜索结果更新可能有延迟，填写后等待 1-2s 再 `browser_snapshot`
- DOM 中的 `value` 属性可能与视觉渲染不同步（SPA 状态问题），以 `browser_snapshot` 中的 `value` 字段为准
- 侧边栏可能处于收起（图标模式）状态，点击 `>>` 按钮展开后再导航

### 需要用户介入的操作

| 操作 | 处理方式 |
|------|---------|
| 扫码登录 | 截图发送给用户，轮询等待 |
| 手机验证码 | 截图发送给用户，等待输入 |
| 敏感权限确认 | 截图发送给用户，等待确认 |

### 完成操作后

```text
browser_lock → action: "unlock"
```

释放浏览器标签，允许其他操作使用浏览器。

---

## 当前 ReviewBot 配置参考

### App 信息

- App ID：从 `<SKILL_DIR>/.env` 中 `FEISHU_APP_ID` 读取
- 应用名称：CurBot（可自定义）

### 已配置权限

- `im:message.p2p_msg:readonly` — 读取单聊消息
- `im:message:send_as_bot` — 发送消息
- `im:message:readonly` — 获取单聊、群组消息
- `im:message.urgent` — 发送应用内加急消息
- `im:resource` — 下载/上传图片和文件资源

### 已订阅事件

- `im.message.receive_v1` — 接收消息
- `application.bot.menu_v6` — 机器人菜单
- `card.action.trigger` — 卡片交互回调
- `im.chat.access_event.bot_p2p_chat_entered_v1` — 用户进入与机器人的会话
- `im.message.message_read_v1` — 消息已读
- `im.message.reaction.created_v1` — 消息表情回应
- `im.message.reaction.deleted_v1` — 取消消息表情回应
- `im.message.recalled_v1` — 消息撤回

### 菜单配置

悬浮菜单样式，3 个主菜单 + 5 个子菜单（详见第五部分）。

---

## 版本历史

> v2.3.0：新增推荐事件订阅（消息已读、表情回应、消息撤回、用户进入会话）和推荐权限（加急消息、消息读取），更新 Agent 操控步骤中的 SPA 交互最佳实践。
> v2.2.0：扩展为完整设置指南（机器人创建、权限配置、事件订阅、悬浮菜单、发布流程）。
> v2.1.0：「▶️ 继续」改为「▶️ 继续执行」；展示样式改为悬浮菜单。
> v2.0.0：新增「⚡ 指令」父菜单及 Vibe Coding 快捷回复子菜单。

---

*v2.3.0 · 飞书机器人开发者平台完整设置指南*
