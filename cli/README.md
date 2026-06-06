# responses-proxy

AI routing proxy with multi-provider fallback, RTK token saver, and web dashboard.

## Quick Start

```bash
npm install -g responses-proxy
responses-proxy
```

Dashboard opens at `http://localhost:8318`

## Usage

```bash
responses-proxy                    # Start with defaults
responses-proxy --port 9000        # Custom port
responses-proxy --no-browser       # Don't open browser
responses-proxy --help             # Show options
```

## Features

- **Multi-provider routing** — Route through Kiro, OpenAI, Anthropic, DeepSeek, etc.
- **RTK Token Saver** — Compress tool outputs, save 20-40% tokens per request
- **Model Combos** — Named fallback chains (9Router-style)
- **Prompt Cache** — Maximize cache hit rates across sessions
- **CLI Tools** — Auto-configure Claude Code, Codex, Cursor, Cline
- **Web Dashboard** — Full management UI at localhost
- **Docker support** — Deploy anywhere with Docker Compose

## Configure CLI Tools

```
Claude Code / Codex / Cursor / Cline:
  Endpoint: http://localhost:8318/v1
  API Key: [copy from dashboard]
  Model: kr/claude-sonnet-4.5
```

## Docker

```bash
docker run -d --name responses-proxy -p 8318:8318 \
  -v "$HOME/.responses-proxy:/app/logs" \
  ghcr.io/phamtuandat/responses-proxy:latest
```

## Documentation

- GitHub: https://github.com/phamtuandat/responses-proxy

## License

MIT
