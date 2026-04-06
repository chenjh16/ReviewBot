# Architecture

ReviewBot is a multi-platform review service supporting Feishu (default) and QQ Bot. AI agents submit task summaries via HTTP; the server pushes them to messaging platforms, collects human feedback, and returns it to the waiting agent.

**Related:** [Routing & Multi-Agent Design](routing.md) · [Feishu API](api/feishu.md) · [QQ Bot API](api/qq-bot.md)

---

## System Overview

```
                                                          ┌──── WebSocket ────▶ Feishu ──▶ User
┌──────────────┐       HTTP API        ┌────────────────┐ │   (default)
│   Agent      │  ──── (localhost) ───▶│ reviewbot-     │─┤
│ (review-     │                       │ server.mjs     │ │
│  client.mjs) │  ◀──── JSON ────────│ (auto-port)    │ └──── WebSocket ────▶ QQ Bot ──▶ User
└──────────────┘                       └────────────────┘      (fallback)
```

### Components

| Component | Location | Role |
|-----------|----------|------|
| **Server** | `reviewbot-server.mjs` → `lib/` | Orchestrator (247 lines) + modular lib (see below) |
| **Client** | `review-client.mjs` | CLI tool: submit review, block until feedback |
| **Protocol** | `reviewbot-protocol.mdc` | Cursor Rule defining when agents should trigger reviews |
| **Skill** | `SKILL.md` | Agent usage guide |
| **Installer** | `install.sh` | Copies skill to `~/.cursor/skills/`, prompts for credentials |

#### Server Modules (`lib/`)

| Directory | Module | Role |
|-----------|--------|------|
| `feishu/` | `ws.mjs` | Feishu WebSocket connection + event handling |
| | `api.mjs` | Feishu SDK call wrappers (send, patch, react, follow-up) |
| | `cards.mjs` | Feishu card payload builders |
| `qq/` | `ws.mjs` | QQ Bot WebSocket + event handling |
| | `api.mjs` | QQ Bot API client (token, REST calls) |
| | `builders.mjs` | QQ message payload builders |
| `core/` | `state.mjs` | Shared state management + persistence |
| | `server.mjs` | HTTP route handlers |
| | `commands.mjs` | Bot commands + Vibe shortcuts |
| | `feedback.mjs` | Feedback aggregation logic |
| | `routing.mjs` | Agent ID resolution + symbol assignment |
| `util/` | `http.mjs` | HTTP request/response helpers |
| | `render.mjs` | Markdown → styled HTML, Chrome detection |
| | `media.mjs` | Puppeteer rendering + media upload |
| | `stall.mjs` | Timeout stall message generator |

## Platform Selection

```
Submit Review / Send Message
    │
    ├─ platform=qq explicitly set → QQ Bot
    ├─ Feishu connected + known users exist → Feishu (retry up to 3×)
    ├─ Feishu unavailable → QQ Bot fallback
    └─ All unavailable → buffer until user sends a message
```

Feishu is the default platform. When Feishu send fails, it retries up to 3 times (2s, 4s, 6s intervals) without automatic fallback to QQ Bot.

## Message Formats

| Format | QQ msg_type | Feishu msg_type | Implementation | Use Case |
|--------|------------|----------------|----------------|----------|
| `markdown` | 2 | `interactive` | QQ: native Markdown; Feishu: interactive card | Headings, lists, code, links |
| `image` | 7 | `interactive` | Puppeteer renders HTML → PNG → upload (QQ only) | Tables, code blocks, complex layout |
| `ark` | 3 | `interactive` | QQ: Ark card template; Feishu: interactive card | Structured notifications |
| `text` | 0 | `text` | Plain text | Short unformatted text |

### HTML Rendering Pipeline

```
Markdown → marked.parse() → HTML → markdownToStyledHtml() → Full HTML page
  → Puppeteer (headless Chrome, 390px viewport, 3× scale)
  → PNG buffer → uploadMedia() (QQ) → send
```

Rendering failures automatically fall back to Markdown.

## Feishu Card System

### Card State Transitions

```
┌─────────────────────────────┐
│  Review Request (blue)       │  ← Initial state
│  [✅ Complete] [💬 Feedback]  │
└─────────┬──────────┬────────┘
          │          │
    Click Complete  Click Feedback
          │          │
          ▼          ▼
┌─────────────────┐  ┌──────────────────────┐
│ Completed (green)│  │ Selected (orange)     │
│ Summary + Reply  │  │ [✅ disabled] [✔ sel] │
└──────────────────┘  └──────────┬───────────┘
                                 │
                           Click again → back to blue (deselect)
```

### Card Types

| Card | Header Color | When Used |
|------|-------------|-----------|
| **Review Request** | Blue | Agent submits review — shows summary, queue messages, deadline |
| **Selected** | Orange | User clicks "Feedback" — selecting this agent as reply target |
| **Completed** | Green | Feedback received — shows summary + feedback + completion time |
| **Timeout** | Orange | Auto-completed after max timeouts — shows timeout description |
| **Notification** | Turquoise | Agent sends notification via `/send` with `agent_id` |
| **System** | Various | Multi-agent routing prompts, attachment receipts, help |

### Multi-Agent Card Interactions

Selected state is globally exclusive — only one card can be Selected at a time. Clicking "Feedback" on Agent B automatically restores all other pending review cards to their initial state via `im.message.patch`.

Card interaction dedup: 2-second window prevents flickering from duplicate Feishu SDK events.

## Feishu Message Processing

### Received Message Types

| Type | Processing |
|------|-----------|
| `text` | Extract `JSON.parse(content).text` (note: Feishu strips style tags from text messages) |
| `post` (rich text) | Parse all 9 tag types: text (with style→markdown), a, at, img, media, code_block, emotion, hr, md |
| `image` | Extract `image_key` as attachment |
| `file` | Extract `file_key` as attachment |

### Feishu Markdown Adaptation

Feishu card markdown doesn't support standard `##` headings or `|` table syntax. `toFeishuMarkdown()` converts:
- `## Title` → `**Title**` (bold)
- `| Table |` → full-width `｜` separators (removes divider rows)

### Read Receipts & Reactions

- **`im.message.message_read_v1`** — Tracks when reviewers read Review cards; updates `review.readTs` for smart timeout handling
- **`im.message.reaction.created_v1`** — Emoji quick-feedback: 👍/👌/✅ = complete, 👀 = extend timeout, ❌ = prompt for details, 🔄 = continue
- **Follow-up bubbles** — After sending a Review card, the server pushes quick-action bubbles (complete, continue, update docs) via `im.message.pushFollowUp`

### Shortcut Menu

Floating menu configured in Feishu developer console:

| Menu | Response | Description |
|------|----------|-------------|
| 📊 Status | Push event (`check_status`) | Status card with review progress + queue management |
| ❓ Help | Push event (`show_help`) | Usage guide card |
| ⚡ Commands | **Parent menu** | Vibe Coding quick-reply shortcuts |

Vibe command sub-menus send text messages that are server-side expanded via `VIBE_COMMANDS` mapping into detailed agent instructions.

Text commands (`/status`, `/help`, `/new`, `/stop`) remain available for backward compatibility.

## QQ Bot Communication

### WebSocket Lifecycle

```
Connect → Hello(op:10) → Identify(op:2) → Ready(op:0) → Start heartbeat + listen events
```

Intent: `1 << 25` = `GROUP_AND_C2C_EVENT` (group @messages + direct messages).

Disconnection: 5s delay reconnect, Resume(op:6) with `session_id` + `seq`, or re-Identify on Invalid Session(op:9).

### Message Send Strategy (QQ-specific)

```
Priority 1: Passive Reply (within 5min group / 60min DM, up to 5 per msg_id)
    ↓ (no passive window)
Priority 2: Active Message (4/month/user for DM, 4/month/group)
    ↓ (quota exhausted)
Priority 3: Wakeup/Recall (4 times within 30 days after user interaction)
    ↓ (all unavailable)
Priority 4: Buffer until user sends a message
```

## Feedback Aggregation

Reviewers may send multiple messages (image first, text later):

- **Pure text** or **post rich text** (with inline images) → complete immediately
- **Standalone image/file** (no text) → buffer, start silence timer (`FEEDBACK_SILENCE_TIMEOUT`, default 300s)
- Each attachment receipt triggers a confirmation (Feishu: blue System card; QQ: text reply)
- On completion: download attachments → merge text + attachment summary → write to session → update card

## Timeout Handling

```
Agent calls /wait-feedback (timeout=300s)
    │
    ├─ Feedback within timeout → { status: "replied", feedback: "..." }
    │
    └─ Timeout → consecutiveTimeouts++
              ├─ < N times → reminder to reviewer, return "timeout_retry"
              └─ >= N times → auto-reply "任务完成", update card to Timeout
                             (N = MAX_CONSECUTIVE_TIMEOUTS, default 12)
```

Review deadlines (e.g., "截止 03:30") are computed from review creation time and persist across card resends and state changes.

## HTTP API

All endpoints listen on `127.0.0.1` (auto-assigned port). Port number written to `.port` file.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/status` | Service status, all pending reviews, recent message count |
| GET | `/history` | Recent completed reviews (`?limit=20`, max 100) |
| POST | `/review` | Submit review (`agent_id`, `summary`, `format`, `timeout`, `client_uuid`) |
| POST | `/wait-feedback` | Block until feedback (`agent_id`, `timeout`) |
| POST | `/send` | Send notification (`message`, `format`, `agent_id`, `project_path`) |
| POST | `/send-html` | Send rendered HTML/Markdown screenshot (`html`/`markdown`, `width`) |

See [SKILL.md](../skills/reviewbot/SKILL.md) for complete API parameters.

## State Persistence

`.state.json` auto-saved on shutdown (SIGINT/SIGTERM) and every 60 seconds:

| Persisted | Not Persisted |
|-----------|---------------|
| `messageQueues` (message queues) | `pendingReviews` (contains timers/callbacks) |
| `cardMsgRegistry` (card → agent mapping) | `lastFeedbacks` (ephemeral completion state) |
| `feishuKnownUsers` (contact info) | `replyTarget` (runtime UI state) |
| `agentSymbols` + `nextSymbolIdx` | |
| `reviewHistory` (circular buffer, max 100) | |

Version check on startup: `STATE_VERSION` mismatch skips restoration.

### Review Lifecycle

- **Manual cancel**: ✕ button on status card per pending review
- **24h TTL**: Reviews exceeding `REVIEW_MAX_TTL_HOURS` auto-cleaned every 60s
- **`/stop`**: Batch-terminate all pending reviews

## Session Management

Each review creates a session directory:

```
sessions/
  20260324_193130/
    request.md       # Original review content
    response.md      # Aggregated feedback
    log.txt          # Timeline log
    images/          # Downloaded attachments
```

## Configuration

All settings via environment variables, loaded from `.env` file into `CONFIG` object at startup:

| Env Variable | CONFIG Property | Default | Description |
|-------------|----------------|---------|-------------|
| `FEISHU_APP_ID` | `feishu.appId` | — | Feishu App ID |
| `FEISHU_APP_SECRET` | `feishu.appSecret` | — | Feishu App Secret |
| `QQBOT_APP_ID` | `qq.appId` | — | QQ Bot AppID |
| `QQBOT_APP_SECRET` | `qq.appSecret` | — | QQ Bot AppSecret |
| `REVIEWBOT_PORT` | `port` | `0` | HTTP port (0=auto) |
| `REVIEW_DEFAULT_TIMEOUT` | `reviewDefaultTimeout` | `300` | Review timeout (seconds) |
| `MAX_CONSECUTIVE_TIMEOUTS` | `maxConsecutiveTimeouts` | `12` | Max consecutive timeouts |
| `REVIEW_MAX_TTL_HOURS` | `reviewMaxTtl` | `24` | Review max TTL (hours) |
| `QUEUE_MAX_PER_AGENT` | `queueMaxPerAgent` | `50` | Queue limit per agent |
| `FEEDBACK_SILENCE_TIMEOUT` | `feedbackSilenceTimeout` | `300` | Feedback aggregation silence (seconds) |
| `ALLOWED_REVIEWERS` | `allowedReviewers` | *(all)* | Comma-separated reviewer IDs |
| `LOG_LEVEL` | — | `info` | Log level (`debug`/`info`/`warn`/`error`) |
| `CHROME_PATH` | `chromePath` | *(auto)* | Chrome/Chromium path |

## Security

- HTTP API binds to `127.0.0.1` only — no external access
- Credentials via `.env` file — excluded from version control
- Attachment downloads confined to session directories
- Puppeteer runs with `--no-sandbox` (trusted local environment)

## Platform Comparison

| Feature | Feishu | QQ Bot |
|---------|--------|--------|
| Button interaction | Card callbacks, in-place card updates | Command buttons, fill chat input |
| Feedback confirmation | Card UI update (blue→green) | Always sends text confirmation |
| Message limits | No monthly limit, 5 QPS/user | Passive 5/60min, active 4/month |
| Rich text | Post message (9 tag types with styles) | Markdown (requires special access) |
| Message updates | `im.message.patch` in-place | Not supported |
| Quote routing | `parent_id` → card registry | Not supported |
| Proactive messages | User just needs to open chat | User must send first message |

---

*Architecture document — consolidated from design-architecture.md and design-feishu.md*
