# Public Bot Launch Verification

Date: 2026-04-27

This checklist captures the final pre-launch verification for the manually operated paid Telegram bot flow.

## Automated Verification

- `npm run check`
- `npm test`
- `npm run build`
- `docker compose config`
- `docker compose build responses-proxy telegram-bot telegram-bot-worker`

## What This Verifies

- TypeScript compiles cleanly
- automated tests cover customer signup, key lifecycle, billing, renewal queue, expiration worker, and audit log
- Docker images build for the proxy, bot, and worker services
- Docker Compose resolves the expected runtime topology

## Manual Smoke Checklist

1. Start stack:
   - `docker compose up -d --build responses-proxy telegram-bot telegram-bot-worker`
2. Confirm services:
   - `docker compose ps`
   - `docker compose logs --tail=100 responses-proxy`
   - `docker compose logs --tail=100 telegram-bot`
   - `docker compose logs --tail=100 telegram-bot-worker`
3. Customer flow:
   - new Telegram user sends `/start`
   - customer confirms `/me`
4. Admin paid ops:
   - admin runs `/grant <telegramUserId> basic 30`
   - customer runs `/apikey`
   - customer runs `/usage`
   - customer runs `/quota`
5. Renewal flow:
   - customer runs `/renew`
   - admin runs `/renew list`
   - admin runs `/renew approve <requestId> basic 30`
6. Expiration flow:
   - force expiry or wait for worker cycle
   - verify customer key is suspended
   - verify proxy returns suspended or subscription-required error

## Launch Notes

- Keep `TELEGRAM_ALLOWED_USER_IDS` empty in normal public mode.
- Keep owner and admin bootstrap in env.
- Customer access is managed in the bot database, not in env.
- Manual billing remains outside the bot; bot commands are the operational control plane.
- Audit log should never store full API keys; only previews and redacted metadata should appear.

## Exit Criteria

- proxy, bot, and worker stay up under Docker Compose
- no full keys appear in logs or audit storage
- customer cannot run admin commands
- admin can grant, renew, approve, and close requests manually
- expired customer keys are blocked by the proxy
