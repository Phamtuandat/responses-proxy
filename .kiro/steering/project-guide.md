# Project Guide — responses-proxy

## Overview

`responses-proxy` is a multi-provider AI routing proxy with a React dashboard, Telegram bot, and Codex/Hermes client-config management. It routes LLM requests across multiple upstream providers (OpenAI, Anthropic, Kiro/CodeWhisperer, DeepSeek, Groq, etc.) with account pooling, token rotation, rate limiting, and usage tracking.

## Goals

- Keep proxy, dashboard, Telegram bot, and Codex setup running correctly.
- Prioritize small, testable changes that don't touch secrets.
- Maintain parity between dev (Mac local) and prod (OMV Docker).

## Architecture

- **Backend**: Fastify + TypeScript, compiled with tsc → `dist/server.js`
- **Frontend**: React + TypeScript, built with Vite → `dist/client/`
- **Database**: SQLite via better-sqlite3 (runtime state, accounts, sessions)
- **Deployment**: npm global package `responses-proxy` (port 8318). No Docker/CI-CD.
- **Clients**: Codex, Hermes, Telegram bot — all route through the proxy

## Source of Truth

- `README.md` — project docs and setup
- `cli/package.json` — npm package definition (`responses-proxy`)
- `env/dev.mac.env` — dev environment variables
- `env/prod.omv.env` — production environment variables
- `docs/*` — detailed guides

## Commands

| Command | Purpose |
|---------|---------|
| `npm run check` | TypeScript typecheck (backend only) |
| `npm test` | Run tests |
| `npm run build` | Build server + client |
| `npm run client:build` | Vite build (client only) |
| `npm run client:dev` | Vite dev server |
| `npm run app:dev:install` | Install dev services on Mac |
| `npm run app:dev:status` | Check dev service status |
| `npm run app:prod:install` | Install prod services on OMV |
| `npm run app:prod:status` | Check prod service status |

## Environments

- **dev**: Mac local only. Proxy at `http://127.0.0.1:8318`.
- **prod**: OMV host. Public at `https://proxy.taskhub.io.vn`. Internal at `http://192.168.0.201:8318`.
- **Distribution**: published to npm as `responses-proxy`; install/upgrade with `npm install -g responses-proxy`. No GitHub Actions / Docker pipeline.

## Working Rules

- Never modify secrets in env files.
- Never revert unrelated changes from other contributors.
- When changing logic, update tests in the same commit.
- When touching deployment, verify with `lsof -i :8318`, `responses-proxy` CLI status, and `curl /health`.
- Keep client-side code zero-`fetch()` in connection/account management — use the typed API client from `client/src/api/client.ts`.

## Key Flows

### Provider Connection Flow
- Entry: `AccountManagementModal.tsx` → `AccountConnectionFlow.tsx`
- Three auth paths: API Key, ChatGPT OAuth, Kiro (9router import)
- Post-connection validation via `validateConnection.ts` with 10s timeout
- Provider auto-creation with 409-recovery via `createOrRecoverProvider.ts`
- All API calls use typed client (`createProvider`, `updateProvider`, `importKiroAccounts`, `submitChatGptOAuthCallback`, `apiGet`)

### Codex Patch Flow
- `GET /api/customer/codex/setup.sh` delivers setup script
- Auth: `Authorization: Bearer <customer api key>`
- If modifying this flow, keep README and tests in sync

### Client Config (Quick Apply)
- `/api/client-configs/apply` writes Hermes/Codex config files on the host
- `/api/client-configs/status` shows current state
- Backups are mandatory before any config mutation

### Deployment (npm)
- Install globally: `npm install -g responses-proxy` (publishes from `cli/`).
- Runs `dist/server.js`; persistent data under `~/.responses-proxy/` (SQLite DBs, session files, `server.log`).
- Reads Kiro tokens from `~/.9router/db/data.sqlite` (read-only by default).
- Upgrade by bumping `cli/package.json` version, `cd cli && npm publish`, then `npm install -g responses-proxy@latest` on the host.
- Health gate: `curl http://127.0.0.1:8318/health` must return `ok: true`.

## Client Routing

- Clients (Codex, Hermes, custom) are identified by route API keys
- Each client route maps to a provider, model override, and RTK policy
- `client_route_api_keys` in DB state maps keys → routes
- Default route key: `default`

## Provider Types

| Tier | Examples | Auth |
|------|----------|------|
| Subscription | Claude Code, OpenAI Codex, Kiro IDE | OAuth, API Key |
| Cheap | DeepSeek, Groq, Mistral, OpenRouter | API Key |
| Free | Gemini Free, Cloudflare AI, NVIDIA NIM | API Key |
| Custom | User-defined endpoints | API Key |

## Testing Notes

- Backend typecheck: `npm run check` (tsc, covers `src/` only)
- Client is NOT type-checked in CI (Vite/esbuild transpiles only)
- Tests: `npm test` (Vitest)
- Pre-existing ~200 client-side type errors exist (StatusBadge prop mismatches etc.) — known tech debt
