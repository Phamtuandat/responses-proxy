---
name: hermes-omv-production
description: Use when preparing or explaining how to deploy Responses Proxy and Hermes into production on OMV, including Docker Compose, required env vars, host mounts, and verification steps.
---

# Hermes OMV Production

Use this skill when the goal is to deploy Hermes through `responses-proxy` on an OMV host.

## Goal

Deploy the stack with Docker Compose so Hermes points to the proxy at `http://127.0.0.1:8318/v1` or the public proxy host in production.

## Source of truth

- `docker-compose.yml`
- `.env.example`
- `.env.production.checklist`
- `README.md`

## Required setup

- Use `docker compose up -d --build responses-proxy telegram-bot telegram-bot-worker` for production.
- Keep the app data under `./logs` so the proxy and bot SQLite files persist.
- Mount the host Hermes config at `${HOME}/.hermes/config.yaml`.
- Mount the host Codex directory at `${HOME}/.codex`.
- Ensure the host `HOME` points to the real user home on OMV before starting Compose.

## Required environment values

At minimum, fill these from the production checklist:

- `UPSTREAM_BASE_URL`
- `UPSTREAM_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_OWNER_USER_IDS`
- `BOT_PUBLIC_SIGNUP_ENABLED=true`
- `BOT_PUBLIC_RESPONSES_BASE_URL=https://YOUR_PUBLIC_PROXY_HOST/v1`
- `RESPONSES_PROXY_ADMIN_BASE_URL=http://responses-proxy:8318`
- `RESPONSES_PROXY_CLIENT_API_KEY`

Keep these defaults unless the deployment needs otherwise:

- `PORT=8318`
- `HOST=0.0.0.0`
- `REQUEST_TIMEOUT_MS=300000`
- `STREAM_IDLE_TIMEOUT_MS=330000`
- `LOG_LEVEL=info`
- `LOG_BODY=false`

## Hermes wiring

- Hermes should use the proxy base URL, not the upstream directly.
- Local test URL: `http://127.0.0.1:8318/v1`
- Production URL: the public proxy host ending in `/v1`
- Keep the provider wire format OpenAI/Responses-compatible.

## Verification

- Confirm the proxy is reachable on port `8318`.
- Confirm the container can read `~/.hermes/config.yaml` and `~/.codex` from the host.
- Confirm the bot database files land under `./logs`.
- Open the dashboard at `/` after the build if you need to inspect or patch client config.

## Safe guidance

- Do not edit secrets in-place unless the user asks.
- Prefer reading the checklist and mirroring values into the deployed `.env`.
- If deployment fails, inspect container logs before changing config.
