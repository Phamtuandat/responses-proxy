# Public Bot Test Run Sheet

Date: 2026-04-27

Use this as the short live checklist during launch.

## 0. Prep

- admin Telegram account ready
- one customer test account ready
- `.env` filled
- Tailscale URL confirmed

## 1. Boot

```bash
docker compose up -d --build responses-proxy telegram-bot telegram-bot-worker
docker compose ps
docker compose logs --tail=50 responses-proxy
docker compose logs --tail=50 telegram-bot
docker compose logs --tail=50 telegram-bot-worker
curl http://127.0.0.1:8318/health
```

Pass:

- proxy healthy
- bot polling started
- worker completed a cycle

## 2. Public Signup

Customer:

```text
/start
/me
```

Pass:

- bot replies
- workspace exists

## 3. Customer Guardrail

Customer:

```text
/providers
```

Pass:

- admin-only rejection appears

## 4. Grant Access

Admin:

```text
/grant <telegramUserId> basic 30
```

Customer:

```text
/apikey
/usage
/quota
```

Pass:

- grant succeeds
- customer sees key preview
- usage/quota show active state

## 5. Real API Check

```bash
curl -sS https://YOUR_TAILSCALE_HOST/v1/responses \
  -H "Authorization: Bearer <customerKey>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.5","input":"Say hello in one sentence."}'
```

Customer:

```text
/usage
```

Pass:

- response succeeds
- usage increases

## 6. Renewal Queue

Customer:

```text
/renew
```

Admin:

```text
/renew list
/renew approve <requestId> basic 30
```

Pass:

- request appears
- approval succeeds

## 7. Replace Key

Admin:

```text
/renewuser <telegramUserId> basic 30 replace-key
```

Pass:

- old key fails
- new key works

## 8. Expiration Check

- force expiry or use short-lived test data
- wait for worker

Customer:

```text
/quota
```

API:

```bash
curl -i -sS https://YOUR_TAILSCALE_HOST/v1/responses \
  -H "Authorization: Bearer <suspendedKey>" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-5.5","input":"hello"}'
```

Pass:

- quota shows expired/suspended state
- API returns suspended or subscription-required error

## 9. Log Hygiene

```bash
docker compose logs --tail=200 responses-proxy telegram-bot telegram-bot-worker
```

Pass:

- no full customer key in logs

## 10. Lockdown Drill

Set in `.env`:

```env
TELEGRAM_ALLOWED_USER_IDS=<ownerId>,<adminId>
```

Then:

```bash
docker compose up -d --build telegram-bot telegram-bot-worker
```

Pass:

- owner/admin still works
- public customer blocked

## Done

Release is good if:

- signup works
- customer cannot use admin commands
- grant and renew work
- proxy accepts active customer key
- proxy rejects suspended/expired customer key
- logs do not leak full keys
