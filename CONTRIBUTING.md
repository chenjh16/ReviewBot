# Contributing to ReviewBot

Thanks for your interest in contributing! This guide covers the development setup and workflow.

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- At least one bot platform configured (Feishu or QQ Bot)
- Chrome/Chromium (optional, for HTML rendering features)

### Install for Development

```bash
git clone https://github.com/chenjh16/ReviewBot.git
cd reviewbot
bash install.sh --dev
```

The `--dev` flag creates symlinks instead of copies, so changes to `skills/reviewbot/` propagate instantly without re-installing.

### Configure Credentials

```bash
cp skills/reviewbot/.env.example skills/reviewbot/.env
# Edit .env with your bot credentials
```

### Run the Server

```bash
node skills/reviewbot/reviewbot-server.mjs
```

## Project Layout

| Directory | Purpose |
|-----------|---------|
| `skills/reviewbot/` | Core server and client (the installable skill package) |
| `skills/reviewbot/lib/` | Server modules: `feishu/`, `qq/`, `core/`, `util/` |
| `skills/reviewbot/test/` | Unit and E2E tests (`node --test`) |
| `rules/` | Cursor protocol rules (`.mdc` files) |
| `docs/` | Design documents, API references, guides |

## Making Changes

1. Fork the repository and create a feature branch
2. Make your changes in `skills/reviewbot/` (server/client) or `docs/` (documentation)
3. Run the tests: `npm test` (in `skills/reviewbot/`)
4. Test locally with a real bot connection (Feishu or QQ)
5. Submit a pull request with a clear description of the change

## Testing

```bash
cd skills/reviewbot
npm test          # all tests
npm run test:unit # unit tests only
npm run test:e2e  # E2E API tests only
```

Tests use the Node.js built-in test runner (`node:test`). No external test framework needed.

## Code Style

- ES Modules (`import`/`export`), no CommonJS
- Node.js built-in modules preferred over third-party when possible
- Minimal dependencies — the project intentionally keeps the dependency tree small
- Console logging with emoji prefixes for visual scanning (📩 incoming, ✅ success, ❌ error, ⚠ warning)

## Commit Messages

Use concise, descriptive messages. Prefix with a category when helpful:

- `feat: add message pinning support`
- `fix: handle disconnected WebSocket reconnection`
- `docs: update Feishu setup guide`
- `refactor: extract card builder functions`

## Reporting Issues

When filing a bug report, please include:

- Node.js version (`node -v`)
- Platform (Feishu, QQ, or both)
- Server console output (with errors)
- Steps to reproduce

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
