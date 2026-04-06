# ReviewBot Agent Guide

ReviewBot is a local multi-platform bot service that bridges AI agents and human reviewers. Agents submit task summaries via HTTP; the server pushes them to Feishu (default) or QQ Bot (fallback), collects feedback, and returns it to the waiting agent. Supports multiple concurrent agents with symbol-based identification, interactive card buttons, and message routing.

## Project Structure

```text
reviewbot/
├── skills/reviewbot/          # Skill package (installed to ~/.cursor/skills/reviewbot/)
│   ├── reviewbot-server.mjs   # Main entry (orchestrator, 247 lines)
│   ├── review-client.mjs      # CLI client: submit review, block until feedback
│   ├── lib/
│   │   ├── feishu/            # Feishu platform modules
│   │   │   ├── api.mjs        #   SDK call wrappers
│   │   │   ├── cards.mjs      #   Card builders
│   │   │   └── ws.mjs         #   WebSocket + event handling
│   │   ├── qq/                # QQ Bot platform modules
│   │   │   ├── api.mjs        #   API call wrappers
│   │   │   ├── builders.mjs   #   Message builders
│   │   │   └── ws.mjs         #   WebSocket + event handling
│   │   ├── core/              # Core business logic
│   │   │   ├── state.mjs      #   State management + persistence
│   │   │   ├── server.mjs     #   HTTP routes
│   │   │   ├── commands.mjs   #   Bot commands
│   │   │   ├── feedback.mjs   #   Feedback aggregation
│   │   │   └── routing.mjs    #   Agent routing
│   │   └── util/              # General utilities
│   │       ├── http.mjs, render.mjs, media.mjs, stall.mjs
│   ├── test/                  # Unit + E2E tests (115 tests)
│   ├── SKILL.md / SKILL.cn.md # Agent usage guide
│   ├── package.json
│   └── .env.example
├── rules/                     # Cursor rules
├── docs/                      # Design docs, API references, guides
├── install.sh                 # Install script
├── README.md / AGENTS.md      # Project docs
├── CONTRIBUTING.md / CHANGELOG.md
└── LICENSE                    # MIT License
```

## How Agents Use ReviewBot

**→ See [`skills/reviewbot/SKILL.md`](skills/reviewbot/SKILL.md) for complete usage instructions.**

Quick summary: agents call `review-client.mjs --summary "..." --agent-id "project"` to submit a review, then handle the response (replied / timeout_retry / error).

The protocol rule (`rules/reviewbot-protocol.mdc`) is injected into every conversation and defines when to trigger notifications and reviews.

## Multi-Agent Support

Multiple agents share one ReviewBot server. Each agent gets a unique symbol (📋🔍✨🎯…) bound to its `agent_id` (project directory name). Users route replies via `#agent_id` prefix or quick-reply buttons on each message.

Conflict handling: if two agents share the same directory name, the server appends `.N` (e.g. `my-project.2`).

## Configuration & Installation

See [README.md](README.md) for full configuration reference, platform setup guide, installation, and troubleshooting.

Quick install: `bash install.sh` (or `bash install.sh --dev` for development symlinks).

## Further Reading

- **[routing.md](docs/routing.md)** — **Routing & multi-agent design**: agent IDs, message routing, queues, card interactions, feedback flow (start here)
- [guide-feishu-console.md](docs/guide-feishu-console.md) — Feishu developer console setup walkthrough
- [architecture.md](docs/architecture.md) — Architecture, cards, API, Feishu/QQ integration, state persistence
- [api/feishu.md](docs/api/feishu.md) — Feishu Bot API reference
- [api/qq-bot.md](docs/api/qq-bot.md) — QQ Bot API v2 reference
- [roadmap.md](docs/roadmap.md) — Planned features and capability research
