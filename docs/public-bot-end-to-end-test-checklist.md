# Public Bot End-to-End Test Checklist

Date: 2026-04-27

This checklist is for full end-to-end verification of the public Telegram bot, customer key flow, manual billing flow, and proxy enforcement.

## Test Setup

- deployment `.env` is filled
- `BOT_PUBLIC_SIGNUP_ENABLED=true`
- `TELEGRAM_OWNER_USER_IDS` contains the real admin Telegram user id
- `TELEGRAM_ALLOWED_USER_IDS` is empty unless you are explicitly testing lockdown
- `telegram-bot.sqlite` and `app.sqlite` are on persistent storage
- Tailscale URL is reachable from the intended test environment

## Start Services

1. Boot services:
   ```bash
   docker compose up -d --build responses-proxy telegram-bot telegram-bot-worker
   ```
2. Confirm runtime:
   ```bash
   docker compose ps
   docker compose logs --tail=100 responses-proxy
   docker compose logs --tail=100 telegram-bot
   docker compose logs --tail=100 telegram-bot-worker
   curl http://127.0.0.1:8318/health
   ```
3. Pass criteria:
   - `responses-proxy` is healthy
   - `telegram-bot` is up and polling
   - `telegram-bot-worker` is up and completes a cycle

## E2E-01 Public Signup

1. Use a Telegram account that is not owner/admin.
2. Send `/start` to the bot.
3. Send `/me`.
4. Pass criteria:
   - bot replies successfully
   - workspace is created
   - no admin command is exposed by behavior

## E2E-02 Customer Guardrails

1. From the customer account, run:
   - `/providers`
   - `/grant 123 basic 30`
   - `/renewuser 123 basic 30`
2. Pass criteria:
   - bot rejects admin-only commands
   - customer still can run `/apikey`, `/usage`, `/quota`, `/renew`

## E2E-03 Manual Grant

1. From the admin account, collect the customer Telegram user id.
2. Run:
   ```text
   /grant <telegramUserId> basic 30
   ```
3. From the customer account, run:
   - `/apikey`
   - `/usage`
   - `/quota`
4. Pass criteria:
   - admin receives grant confirmation
   - customer receives active access
   - customer sees key preview, quota, and usage window

## E2E-04 Responses API Success Path

1. Use the customer API key against:
   ```bash
   curl -sS https://YOUR_PUBLIC_PROXY_HOST/v1/responses \
     -H "Authorization: Bearer <customerKey>" \
     -H "Content-Type: application/json" \
     -d '{"model":"gpt-5.5","input":"Say hello in one sentence."}'
   ```
2. Pass criteria:
   - request succeeds
   - response comes from proxy
   - customer `/usage` increases after the request

## E2E-05 Renewal Request Queue

1. From the customer account, run:
   ```text
   /renew
   ```
2. Run `/renew` again.
3. From admin account, run:
   - `/renew list`
4. Pass criteria:
   - first request creates an open renewal request
   - second request returns the existing request
   - admin can see the request id in `/renew list`

## E2E-06 Renewal Approval

1. From admin account, run:
   ```text
   /renew approve <requestId> basic 30
   ```
2. From customer account, run:
   - `/quota`
   - `/usage`
3. Pass criteria:
   - request becomes approved
   - subscription end date extends
   - customer still has working key

## E2E-07 Replace Key Flow

1. From admin account, run:
   ```text
   /renewuser <telegramUserId> basic 30 replace-key
   ```
2. Run the old key against `/v1/responses`.
3. Run the new key against `/v1/responses`.
4. Pass criteria:
   - old key is rejected
   - new key works
   - plaintext replacement key is only shown in intended private chat surfaces

## E2E-08 Expiration Worker

1. Force an expired entitlement in the database or use a short-lived test subscription.
2. Wait for worker cycle or restart worker.
3. From customer account, run:
   - `/quota`
4. Use the suspended key against `/v1/responses`.
5. Pass criteria:
   - workspace/key is suspended automatically
   - `/quota` shows expired or exhausted state
   - proxy rejects the key with a suspended or subscription-required error

## E2E-09 Emergency Lockdown

1. Set:
   ```env
   TELEGRAM_ALLOWED_USER_IDS=<ownerId>,<adminId>
   ```
2. Redeploy bot services.
3. Test with:
   - owner/admin account
   - normal customer account
4. Pass criteria:
   - owner/admin still gets access
   - public unknown users are blocked

## E2E-10 Audit and Log Hygiene

1. Perform:
   - one `/grant`
   - one `/renew`
   - one `/renew approve`
   - one `/renewuser ... replace-key`
2. Inspect:
   - Docker logs
   - audit log storage
3. Pass criteria:
   - no full API key is stored in audit metadata
   - no full API key appears in logs unexpectedly
   - lifecycle events exist for grant, renewal, key creation, key suspension, and renewal request

## E2E-11 Tailscale Reachability

1. Test from a client inside the tailnet:
   - open `https://YOUR_TAILSCALE_HOST/v1`
   - send a real `/v1/responses` request
2. If using Funnel, repeat from a client outside the tailnet.
3. Pass criteria:
   - inside-tailnet access works
   - outside-tailnet access works only if Funnel is intentionally enabled

## Exit Criteria

- public signup works
- customer cannot run admin commands
- admin can grant and renew access
- renewal request queue works
- usage and quota update correctly
- expiration worker suspends stale access
- proxy blocks suspended or expired customer keys
- audit and logs do not leak full keys
