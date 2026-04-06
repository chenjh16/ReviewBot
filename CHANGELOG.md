# Changelog

All notable changes to ReviewBot are documented here.

## v3.0.0 (2026-04-06)

### Major Refactoring
- **Modular architecture**: Split `reviewbot-server.mjs` (3300→247 lines) into 15 modules under `lib/`
  - `lib/feishu/` — Feishu API, cards, WebSocket
  - `lib/qq/` — QQ Bot API, message builders, WebSocket
  - `lib/core/` — State, HTTP server, commands, feedback, routing
  - `lib/util/` — HTTP helpers, rendering, media, stall messages
- Context object pattern for shared state and dependency injection

### New Features
- **Review History API**: `GET /history` endpoint with circular buffer (100 entries)
- **Message read receipts**: Track reviewer read status via `im.message.message_read_v1`
- **Emoji reaction feedback**: Quick-respond with 👍/👀/❌/🔄 via `im.message.reaction.created_v1`
- **Follow-up bubbles**: Quick-action suggestions below Review cards
- **Graceful shutdown**: SIGINT/SIGTERM handling — save state, close connections, remove port file
- **Log levels**: `LOG_LEVEL` env var (`debug`/`info`/`warn`/`error`)

### Testing
- Comprehensive test suite: 115 tests across 34 suites (unit + E2E)
- Uses Node.js built-in `node:test` — no external test framework

## v2.3.0 (2026-04-05)

- Add recommended Feishu event subscriptions: message read receipts, emoji reactions, message recall, user entering chat
- Add recommended permissions: urgent messages, message read status
- Update Feishu console guide with SPA interaction best practices for agent browser automation
- Expand capability research docs with implementation plans for new features

## v2.1.0 (2026-04-04)

- Centralize all configuration into `CONFIG` object with environment variable backing
- All behavioral parameters now configurable via `.env` (timeouts, queue limits, TTL, etc.)
- Update documentation to reflect environment variable configuration

## v2.0.3 (2026-04-03)

- Add card interaction dedup mechanism — prevent flickering from duplicate Feishu SDK events
- Add Feishu Post rich text tag parsing support

## v2.0.2 (2026-04-03)

- Add Review lifecycle management: cancel button (✕) on pending reviews, 24h TTL auto-cleanup
- Feishu Markdown adaptation (`toFeishuMarkdown`) for platform compatibility

## v2.0.1 (2026-04-02)

- Vibe command text server-side expansion via `VIBE_COMMANDS` — agents receive enriched instructions

## v2.0.0 (2026-04-02)

- Replace command menus (/status, /new, /stop) with Vibe Coding quick-reply shortcuts
- Add floating menu with quick actions: status, help, and vibe coding commands
- Multi-platform support: Feishu as primary platform alongside QQ Bot

## v1.9.1 (2026-03-30)

- Quote-based routing: quoting a notification card routes to the correct agent's queue
- Fix `feishuKnownUsers` merge writes to preserve `replyTarget` state
- Remove standalone queue menu item (merged into status card)

## v1.9.0 (2026-03-29)

- State persistence: queues, agent registry, known users saved to `.state.json` on shutdown and restored on startup
- Notification cards register `agent_id` for quote-based routing
- Symbol assignments persist across restarts

## v1.8.0 (2026-03-28)

- Multi-queue: per-agent message queues (replacing single global queue)
- Quote-based agent routing via `parent_id` → card message registry
- Add command menu with parent/child structure

## v1.7.0 (2026-03-27)

- Merge queue management into status card (single comprehensive view)

## v1.6.0 (2026-03-26)

- Menu response actions changed from text messages to push events

## v1.0.0 (2026-03-20)

- Initial release
- QQ Bot integration with WebSocket API v2
- Multi-agent support with symbol-based identification
- HTTP API: `/review`, `/send`, `/send-html`, `/wait-feedback`, `/status`
- Review client CLI for blocking review submission
- Cursor Skill packaging with install script
