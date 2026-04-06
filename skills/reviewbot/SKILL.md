---
name: reviewbot
description: Use this skill to notify the user of your plan or progress, and to request user review when completing a task or needing a decision
---

# ReviewBot Skill

> `<SKILL_DIR>` refers to the directory containing this file. After installation: `~/.cursor/skills/reviewbot/`; during development: `reviewbot/skills/reviewbot/`.

## Quick Reference

```bash
# Check service status
PORT=$(cat <SKILL_DIR>/.port 2>/dev/null) && curl -s http://127.0.0.1:$PORT/status

# Send notification (one-way, always include agent_id)
curl -s -X POST http://127.0.0.1:$PORT/send \
 -H 'Content-Type: application/json' \
 -d '{"message": "...", "format": "markdown", "agent_id": "'"$(basename $PWD)"'"}'

# Submit review (blocks until feedback)
node <SKILL_DIR>/review-client.mjs --summary "中文任务总结" --timeout 600
```

## Usage Flow

### 1. Ensure the Service Is Running

```bash
PORT=$(cat <SKILL_DIR>/.port 2>/dev/null) && curl -s http://127.0.0.1:$PORT/status | grep connected
```

If the check fails, start the server:

```bash
nohup node <SKILL_DIR>/reviewbot-server.mjs > /tmp/reviewbot.log 2>&1 &
sleep 3 && PORT=$(cat <SKILL_DIR>/.port)
```

If the server fails to start, check:
- `.env` file exists in `<SKILL_DIR>` with at least one platform's credentials
- Dependencies installed: `cd <SKILL_DIR> && npm install`
- Startup log: `cat /tmp/reviewbot.log`

### 2. Send Notifications (One-Way)

Notify the user of your plan or intermediate progress (up to 3 times per task round). No reply expected.

```bash
PORT=$(cat <SKILL_DIR>/.port)
curl -s -X POST http://127.0.0.1:$PORT/send \
 -H 'Content-Type: application/json' \
 -d '{"message": "Notification content", "format": "markdown", "agent_id": "'"$(basename $PWD)"'"}'
```

The `agent_id` field identifies which agent sent the notification. Without it, the message appears as an anonymous system card that cannot be routed back to any agent. Always include it.

Optional field: `"project_path"` (shown in notification card).

### 3. Submit a Review (Blocks Until Feedback)

**You MUST submit a review before completing any task.** The summary must be in Chinese. You may only end a task when the user explicitly replies "任务完成".

```bash
node <SKILL_DIR>/review-client.mjs \
  --summary "中文任务总结" \
  --format markdown \
  --timeout 600
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--summary` | *(required)* | Task summary in Chinese |
| `--format` | `markdown` | `markdown` / `image` / `ark` / `text` |
| `--timeout` | `300` | Max wait time in seconds |
| `--agent-id` | cwd basename | Agent identifier for multi-agent routing |

### 4. Handle the Response

```json
{
  "status": "replied|timeout_retry|timeout|error",
  "reviewer_reply": "...",
  "session_dir": "<SKILL_DIR>/sessions/...",
  "attachments": [{"type": "image", "name": "1.png", "path": "/absolute/path"}]
}
```

| Status | Action |
|--------|--------|
| `replied` | If user says "任务完成", end task. Otherwise continue working and submit another review |
| `timeout_retry` | Call `review-client.mjs` again with `--summary` to keep waiting |
| `timeout` | Same as above — **never give up** |
| `error` | Fix the issue, then retry |

When `attachments` is present, use the `Read` tool to view images at the absolute `path`.

**CRITICAL: Never end a task without successfully receiving user feedback. Always retry on failure/timeout.**

## Format Selection

| Content Type | `--format` | Notes |
|---------|-----------|------|
| Markdown syntax (headings/lists/code/links) | `markdown` | **Default — use this unless you have a specific reason not to** |
| Tables/code blocks/complex layout | `image` | Rendered via Puppeteer (requires Chrome) |
| Structured status lists | `ark` | Ark card template |
| Plain text ≤3 lines, no formatting | `text` | Never use for content with Markdown syntax |

For QQ platform: code blocks **must include a language tag** (e.g. `` ```text `` not `` ``` ``).

## HTTP API Reference

Port number is in `<SKILL_DIR>/.port`.

| Method | Path | Description |
|------|------|------|
| GET | `/status` | Service status |
| GET | `/history` | Recent completed reviews (`?limit=20`) |
| POST | `/review` | Submit review request |
| POST | `/send` | Send notification (card on Feishu) |
| POST | `/send-html` | Render markdown/html as image |
| POST | `/wait-feedback` | Block until reply (used by review-client.mjs internally) |

Multi-window UUID handling is automatic — no manual configuration needed. See [routing.md](../../docs/routing.md) for details.

---

> **Configuration & Installation** — See the [ReviewBot AGENTS.md](../../AGENTS.md) for `.env` setup, dependencies, and installation commands.
