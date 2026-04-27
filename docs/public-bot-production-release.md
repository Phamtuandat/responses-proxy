# Public Bot Production Release

Date: 2026-04-27

This runbook is for the first real public release of the manually operated paid Telegram bot.

## Recommended Production Env

Use public mode with manual operator control:

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_OWNER_USER_IDS=1283361952
TELEGRAM_ADMIN_USER_IDS=
TELEGRAM_ALLOWED_USER_IDS=
TELEGRAM_ALLOWED_CHAT_IDS=

BOT_PUBLIC_SIGNUP_ENABLED=true
BOT_REQUIRE_ADMIN_APPROVAL=false
BOT_DEFAULT_CUSTOMER_ROUTE=customers
BOT_PUBLIC_RESPONSES_BASE_URL=https://YOUR_PUBLIC_PROXY_HOST/v1

RESPONSES_PROXY_ADMIN_BASE_URL=http://responses-proxy:8318
RESPONSES_PROXY_CLIENT_API_KEY=
RESPONSES_PROXY_DEFAULT_MODEL=gpt-5.5

BOT_SESSION_DB_PATH=/app/logs/telegram-bot.sqlite
CUSTOMER_KEY_DB_PATH=/app/logs/telegram-bot.sqlite
APP_DB_PATH=/app/logs/app.sqlite

BOT_WORKER_INTERVAL_MS=60000
BOT_WORKER_ONCE=false
LOG_BODY=false
BOT_LOG_LEVEL=info
LOG_LEVEL=info
```

## Release Decision Defaults

- `BOT_PUBLIC_SIGNUP_ENABLED=true`
- `BOT_REQUIRE_ADMIN_APPROVAL=false` for the current manual commercial flow
- `TELEGRAM_ALLOWED_USER_IDS` stays empty unless you need emergency lockdown
- owner/admin bootstrap stays in env
- customer access lives in the bot database

## Pre-Release Checklist

1. Fill real values into your deployment `.env`.
2. Confirm `BOT_PUBLIC_RESPONSES_BASE_URL` points at the public URL customers will use.
3. Confirm `UPSTREAM_API_KEY` and `UPSTREAM_BASE_URL` are valid.
4. Confirm `TELEGRAM_OWNER_USER_IDS` contains your Telegram user id.
5. Confirm `./logs` is mounted to persistent storage.
6. Confirm `LOG_BODY=false`.
7. Confirm the bot token is for the production bot, not a test bot.

## Go-Live Steps

1. Build and boot:
   ```bash
   docker compose up -d --build responses-proxy telegram-bot telegram-bot-worker
   ```
2. Confirm health:
   ```bash
   docker compose ps
   docker compose logs --tail=100 responses-proxy
   docker compose logs --tail=100 telegram-bot
   docker compose logs --tail=100 telegram-bot-worker
   curl http://127.0.0.1:8318/health
   ```
3. Confirm bot boot:
   - `telegram-bot` shows polling started
   - `telegram-bot-worker` shows a completed worker cycle
4. Confirm public path:
   - your Telegram account can send `/start`
   - your Telegram account can run `/help`
   - your Telegram account can run `/grant ...`

## First Smoke Test

1. New Telegram user sends `/start`.
2. Customer runs `/me`.
3. Admin runs `/grant <telegramUserId> basic 30`.
4. Customer runs `/apikey`.
5. Customer runs `/usage`.
6. Customer runs `/quota`.
7. Customer runs `/renew`.
8. Admin runs `/renew list`.
9. Admin runs `/renew approve <requestId> basic 30`.

## Safety Checks

- customer cannot run `/providers`, `/grant`, `/renewuser`, or admin `/renew approve`
- no full API key appears in:
  - Docker logs
  - audit log rows
  - bot responses outside intended private chats
- suspended customer key returns:
  - `403 API_KEY_SUSPENDED`

## Emergency Lockdown

If you need to temporarily stop public access:

1. set `TELEGRAM_ALLOWED_USER_IDS` to your owner/admin ids only
2. redeploy:
   ```bash
   docker compose up -d --build telegram-bot telegram-bot-worker
   ```

This keeps operator access while blocking unknown public users.

## Rollback

If release behavior is not acceptable:

1. lock down the bot with `TELEGRAM_ALLOWED_USER_IDS`
2. stop the worker if needed:
   ```bash
   docker compose stop telegram-bot-worker
   ```
3. inspect logs:
   ```bash
   docker compose logs --tail=200 responses-proxy telegram-bot telegram-bot-worker
   ```
4. restore previous `.env` and redeploy

## Day-1 Operations

- Use `/grant` for first paid activation.
- Use `/renewuser` for direct admin renewals.
- Use `/renew list`, `/renew approve`, and `/renew close` for manual renewal queue handling.
- Let the worker suspend expired access automatically.
- Review audit log when a customer reports unexpected key behavior.
