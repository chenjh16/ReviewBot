# Roadmap & Feature Research

Planned features based on Feishu platform capabilities research and implementation plans.

---

## Current Capabilities

### Permissions in Use

| Permission | Purpose |
|-----------|---------|
| `im:message.p2p_msg:readonly` | Receive DM messages |
| `im:message:send_as_bot` | Send messages |
| `im:resource` | Download image/file attachments |

### Event Subscriptions in Use

| Event | Purpose |
|-------|---------|
| `im.message.receive_v1` | Receive user messages (core) |
| `application.bot.menu_v6` | Floating menu clicks |
| `card.action.trigger` | Card button/form interactions |

---

## Implemented Features

### Message Read Receipts ✅

- **Event**: `im.message.message_read_v1`
- Tracks when reviewers read Review cards; updates `review.readTs`
- Timeout reminders include read status (已读/未读)

### Emoji Reaction Feedback ✅

- **Event**: `im.message.reaction.created_v1`
- Quick feedback without typing: 👍/👌/✅ = complete, 👀 = extend timeout, ❌ = prompt for details, 🔄 = continue
- Mapped via `REACTION_ACTIONS` in `lib/feishu/ws.mjs`

### Follow-up Bubbles ✅

- **API**: `POST /im/v1/messages/:message_id/push_follow_up`
- After sending a Review card, quick-action bubbles appear below it
- Actions: complete (任务完成), continue (继续执行), update docs (更新文档)

### Review History API ✅

- **Endpoint**: `GET /history?limit=20`
- Circular buffer (max 100 entries) of completed reviews
- Persisted in `.state.json`

---

## Planned Features

### Priority 1 — High Value, Low Effort

#### User Entered Chat Event

- **Event**: `im.chat.access_event.bot_p2p_chat_entered_v1`
- Auto-register `feishuKnownUsers` when user opens bot chat
- Code already handles this event — just needs backend event subscription

### Priority 2 — Medium Value

#### Message Urgent (Buzz)

- **API**: `PATCH /im/v1/messages/{message_id}/urgent_app`
- Escalation: 1st timeout → reminder; 2nd+ → urgent the original Review card
- Agent-triggered: `urgent: true` flag in review submission

#### Pin Messages

- **API**: `POST /im/v1/pins` / `DELETE /im/v1/pins/{message_id}`
- Auto-pin current Review, unpin on completion
- Keep active reviews always visible at chat top

#### Message Recall Awareness

- **Event**: `im.message.recalled_v1`
- Remove recalled messages from feedback buffer
- Warn if already-aggregated feedback may be incomplete

### Priority 3 — Low Priority

- **Bot Reaction API**: Add ✅ to user messages as silent acknowledgment
- **Message Forward**: Multi-reviewer notification, archive completed reviews
- **Message Edit API**: Update notification content in-place (already using `im.message.patch` for cards)
- **Group events**: Bot added/removed — ReviewBot primarily uses DM

---

## Implementation Notes

### Required Backend Configuration (for Planned Features)

**Events to subscribe:**
- `im.chat.access_event.bot_p2p_chat_entered_v1` — user entered chat auto-registration
- `im.message.recalled_v1` (optional) — message recall awareness

**Permissions** — current permissions already cover all planned features.

---

*Consolidated from research-feishu-capabilities.md and design-new-features.md*
