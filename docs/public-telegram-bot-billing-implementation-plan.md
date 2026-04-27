# Public Telegram Bot And Billing Implementation Plan

This plan turns the existing Telegram bot from an operator-only control surface
into a public customer portal for `responses-proxy`.

The target product shape is:

- anyone can open the bot and start onboarding
- the bot has its own SQLite database for users, chats, workspaces, API keys,
  subscriptions, payments, and audit events
- the repo keeps owner/admin bootstrap configuration in environment variables
- customer access is managed in the bot database rather than in `.env`
- Responses API keys are managed per Telegram user or per Telegram chat
- keys can later be renewed through paid subscriptions without redesigning the
  identity or key model

The implementation should be delivered in small commits. Each phase below
should leave the app buildable and testable.

## Current State

Implemented today:

- a separate Telegram bot entrypoint at `src/telegram-bot/index.ts`
- polling mode through `grammy`
- allowlist/admin checks from environment variables
- SQLite-backed bot sessions and rate limits
- admin/operator commands for proxy status, providers, clients, OAuth accounts,
  quick apply, models, and test prompts
- an MVP `/apikey` command that can issue a key for a Telegram user and store it
  in the bot session database
- Docker Compose service `telegram-bot`

Limitations today:

- customer onboarding still depends on env-maintained allowlists
- customer API keys are stored in a simple bot table, not a first-class proxy key
  registry
- key status is not modeled as `active`, `suspended`, `revoked`, or `expired`
- subscription, payment, renewal, and entitlement state do not exist yet
- `/v1/responses` does not enforce billing entitlement by key
- group or chat workspace ownership is not modeled yet

## Target Behavior

### Public signup

When a Telegram user sends `/start`:

1. The bot upserts a `telegram_user`.
2. The bot upserts the current `telegram_chat`.
3. The bot links the user to the chat through a membership row.
4. If public signup is enabled, the bot creates a customer workspace.
5. Depending on policy, the workspace either receives:
   - a trial entitlement and an API key immediately, or
   - a `pending_approval` state that an admin must approve.

### Customer commands

Customers can use:

```text
/start
/help
/me
/apikey
/apikey rotate
/usage
/quota
/plan
/subscribe
/renew
/billing
/support
```

Full API keys must only be sent in private chats.

### Admin commands

Owners/admins can use:

```text
/admin
/users
/user <telegramUserId>
/approve <telegramUserId>
/block <telegramUserId>
/unblock <telegramUserId>
/keys <telegramUserId>
/key revoke <keyId>
/quota set <telegramUserId> <limit>
/route set <telegramUserId> <clientRoute>
/grant <telegramUserId> <planId> <days>
/suspend <telegramUserId>
/activate <telegramUserId>
/broadcast
```

### Subscription lifecycle

An API key is usable only when:

1. key status is `active`
2. workspace status is `active`
3. entitlement status is `active`
4. current time is inside `valid_from` and `valid_until`
5. quota is not exhausted

Expired subscriptions should suspend keys rather than delete them. Successful
renewal should reactivate the same key unless the user explicitly rotates it.

## Scope For V1

Included:

- public bot identity DB
- owner/admin bootstrap from env
- user/workspace registration through `/start`
- per-user API key records
- key status: `active`, `suspended`, `revoked`
- manual admin key issuance
- manual admin renewal by extending an entitlement or issuing a replacement key
- customer `/apikey`
- customer `/apikey rotate`
- customer `/me`
- customer `/usage`
- customer `/quota`
- audit log
- proxy-side key lookup and active/suspended enforcement

Deferred:

- real payment provider integration
- payment webhooks
- automatic renewals
- group workspace billing
- encrypted key reveal flow
- dashboard UI for billing
- customer self-service checkout

## Manual Commercial Ops V1

Included:

- plans
- subscriptions
- entitlements
- manual subscription grant by admin
- manual renewal by admin
- optional admin-issued replacement keys on renewal
- expiration worker
- key suspension/reactivation based on subscription status

Deferred:

- customer-triggered `/subscribe`
- customer-triggered `/renew` checkout
- pending payment rows
- Stripe/Lemon Squeezy/Paddle checkout
- webhook signature verification
- invoices and receipts
- refunds
- taxes
- coupons
- team seats

Current release rule:

- Admin handles all payment collection outside the bot.
- Admin uses bot commands to create, renew, suspend, revoke, or replace customer
  keys.
- Customers use the bot only to view key status, rotate allowed keys, and check
  usage/quota.
- The data model still includes plans, subscriptions, and entitlements so paid
  automation can be added later without replacing key identity or proxy
  enforcement.

## Environment Configuration

Replace env-managed customer allowlists with owner and policy variables.

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_OWNER_USER_IDS=1283361952
TELEGRAM_ADMIN_USER_IDS=

BOT_PUBLIC_SIGNUP_ENABLED=true
BOT_REQUIRE_ADMIN_APPROVAL=false
BOT_DB_PATH=/app/logs/telegram-bot.sqlite
BOT_DEFAULT_CUSTOMER_ROUTE=customers
BOT_PUBLIC_RESPONSES_BASE_URL=http://127.0.0.1:8318/v1

BOT_TRIAL_ENABLED=true
BOT_TRIAL_DAYS=3
BOT_TRIAL_TOKEN_LIMIT=50000
BOT_DEFAULT_PLAN_ID=basic

BILLING_PROVIDER=manual
BILLING_WEBHOOK_SECRET=
BOT_KEY_ENCRYPTION_SECRET=
```

Compatibility note:

- Keep `TELEGRAM_ALLOWED_USER_IDS` temporarily during migration.
- New public mode should not require customers to be listed in `.env`.
- `TELEGRAM_OWNER_USER_IDS` should always bypass DB role checks.

## Bot Database

Use a dedicated bot database path. It may share the same physical SQLite file as
the existing bot session store at first, but the code should treat it as the bot
DB and avoid mixing tables with proxy runtime state.

### Telegram users

```sql
CREATE TABLE IF NOT EXISTS telegram_users (
  telegram_user_id TEXT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  language_code TEXT,
  role TEXT NOT NULL DEFAULT 'customer',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT
);
```

Roles:

- `owner`
- `admin`
- `support`
- `customer`

Statuses:

- `active`
- `pending_approval`
- `blocked`

### Telegram chats

```sql
CREATE TABLE IF NOT EXISTS telegram_chats (
  telegram_chat_id TEXT PRIMARY KEY,
  chat_type TEXT NOT NULL,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT
);
```

### Chat memberships

```sql
CREATE TABLE IF NOT EXISTS telegram_chat_memberships (
  telegram_user_id TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (telegram_user_id, telegram_chat_id)
);
```

### Workspaces

```sql
CREATE TABLE IF NOT EXISTS customer_workspaces (
  id TEXT PRIMARY KEY,
  owner_telegram_user_id TEXT NOT NULL,
  telegram_chat_id TEXT,
  name TEXT,
  default_client_route TEXT NOT NULL DEFAULT 'customers',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Workspace status:

- `active`
- `pending_approval`
- `suspended`
- `closed`

### API keys

```sql
CREATE TABLE IF NOT EXISTS customer_api_keys (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  telegram_user_id TEXT,
  telegram_chat_id TEXT,
  client_route TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,
  api_key_encrypted TEXT,
  api_key_preview TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  expires_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT
);
```

Key status:

- `active`
- `suspended`
- `revoked`
- `expired`

Security rule:

- Do not store plain text keys.
- For V1, store only `api_key_hash` and show the full key only at creation time.
- If `/apikey` must reveal an existing full key later, store
  `api_key_encrypted` using `BOT_KEY_ENCRYPTION_SECRET`.

### Plans

```sql
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  billing_interval TEXT NOT NULL,
  monthly_token_limit INTEGER NOT NULL,
  max_api_keys INTEGER NOT NULL DEFAULT 1,
  allowed_models_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Subscriptions

```sql
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_start TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  provider TEXT,
  provider_customer_id TEXT,
  provider_subscription_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Subscription status:

- `trialing`
- `active`
- `past_due`
- `canceled`
- `expired`

### Entitlements

```sql
CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  subscription_id TEXT,
  monthly_token_limit INTEGER NOT NULL,
  remaining_tokens INTEGER,
  allowed_models_json TEXT NOT NULL DEFAULT '[]',
  max_api_keys INTEGER NOT NULL DEFAULT 1,
  valid_from TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Payments

```sql
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  subscription_id TEXT,
  provider TEXT NOT NULL,
  provider_payment_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  checkout_url TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Payment status:

- `pending`
- `paid`
- `failed`
- `refunded`
- `expired`

### Audit log

```sql
CREATE TABLE IF NOT EXISTS bot_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_telegram_user_id TEXT,
  telegram_chat_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
```

## Backend Components

### BotIdentityRepository

Responsibilities:

- upsert Telegram users
- upsert Telegram chats
- record memberships
- resolve roles
- resolve owner/admin status
- block or unblock users
- list users for admin commands

Suggested file:

```text
src/telegram-bot/bot-identity-repository.ts
```

### CustomerWorkspaceRepository

Responsibilities:

- create a workspace for a user
- find a user's default workspace
- create or bind a workspace to a chat
- suspend or activate a workspace

Suggested file:

```text
src/telegram-bot/customer-workspace-repository.ts
```

### CustomerKeyRepository

Responsibilities:

- create customer API keys
- hash API keys
- optionally encrypt raw keys
- rotate keys
- suspend, activate, revoke keys
- find active key by workspace/user
- find key metadata by API key hash

Suggested file:

```text
src/customer-keys.ts
```

This should eventually move out of `src/telegram-bot/` because
`/v1/responses` must also enforce key status.

### BillingRepository

Responsibilities:

- CRUD plans
- create manual subscriptions
- create entitlements from subscriptions
- expire subscriptions
- suspend or reactivate keys
- record payments

Suggested file:

```text
src/billing.ts
```

### BillingProvider

Keep payment provider logic behind an interface.

```ts
export type BillingCheckout = {
  checkoutUrl: string;
  providerPaymentId: string;
};

export type BillingEvent =
  | { type: "payment.paid"; providerPaymentId: string; providerSubscriptionId?: string }
  | { type: "payment.failed"; providerPaymentId: string }
  | { type: "subscription.canceled"; providerSubscriptionId: string };

export interface BillingProvider {
  createCheckout(input: {
    workspaceId: string;
    planId: string;
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<BillingCheckout>;
  verifyWebhook(headers: Record<string, unknown>, body: unknown): Promise<BillingEvent>;
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
}
```

Initial provider:

```text
src/billing/manual-billing-provider.ts
```

Future providers:

- Stripe
- Lemon Squeezy
- Paddle
- bank transfer
- crypto

## Proxy Enforcement

The proxy must stop treating every configured route key as equally valid. It
should enforce customer key status before forwarding to upstream.

Request path:

1. read bearer API key
2. hash key
3. look up key registry
4. if key exists in registry:
   - require `status = active`
   - require workspace active
   - require entitlement active
   - require quota remaining
   - resolve key's `client_route`
5. if key does not exist in registry:
   - fall back to existing runtime provider repository behavior for internal
     operator keys
6. forward request
7. record usage against key, workspace, and subscription window

New error examples:

```json
{
  "error": {
    "type": "billing_error",
    "code": "SUBSCRIPTION_EXPIRED",
    "message": "Your subscription has expired. Renew in Telegram with /renew.",
    "retryable": false
  }
}
```

```json
{
  "error": {
    "type": "billing_error",
    "code": "API_KEY_SUSPENDED",
    "message": "This API key is suspended.",
    "retryable": false
  }
}
```

## Management APIs

Add internal management endpoints for bot/admin use.

### Customer keys

```http
POST /api/customer-keys
GET /api/customer-keys/:keyId
GET /api/customer-keys/by-telegram/:telegramUserId
POST /api/customer-keys/:keyId/rotate
POST /api/customer-keys/:keyId/suspend
POST /api/customer-keys/:keyId/activate
DELETE /api/customer-keys/:keyId
```

### Billing

```http
GET /api/billing/plans
POST /api/billing/plans
GET /api/billing/subscriptions/:workspaceId
POST /api/billing/grants
POST /api/billing/checkout
POST /api/billing/webhook
POST /api/billing/expire-now
```

### Users and workspaces

```http
GET /api/customers
GET /api/customers/:telegramUserId
POST /api/customers/:telegramUserId/block
POST /api/customers/:telegramUserId/unblock
POST /api/customers/:telegramUserId/approve
```

## Bot Commands

### `/start`

Public behavior:

- upsert user and chat
- show account status
- create trial key if policy permits
- explain `/apikey`, `/usage`, `/subscribe`, `/renew`

### `/me`

Shows:

- Telegram user ID
- role
- status
- workspace ID
- plan
- subscription status
- current period end

### `/apikey`

Private chat only.

Shows:

- public base URL
- key preview
- key status
- route
- creation date

If encrypted key reveal is enabled:

- allow full reveal in private chat
- audit `api_key.revealed`

### `/apikey rotate`

Creates a new key, revokes or expires the previous key, and returns the new key
once.

### `/subscribe`

Deferred until automated or semi-automated checkout is introduced.

For the current release, `/subscribe` should either be omitted or reply with a
support message telling the customer to contact the admin.

Future behavior:

Shows available plans.

For manual billing V1:

- creates a pending payment row
- asks user to contact admin or follow manual payment instructions

For provider billing:

- creates checkout
- sends checkout URL

### `/renew`

Deferred until customer-triggered renewals are introduced.

For the current release, renewal is admin-operated:

- admin collects payment outside the bot
- admin runs `/renewuser <telegramUserId> <planId> <days>` or
  `/grant <telegramUserId> <planId> <days>`
- bot extends the entitlement and reactivates or replaces the key

Future behavior:

If expired or near expiry:

- creates checkout or pending manual payment

If active:

- shows current expiration and allows early renewal.

### `/usage`

Shows current usage window:

- input tokens
- output tokens
- total tokens
- remaining tokens
- reset date

### `/admin`

Shows admin command index.

### `/grant`

Manual billing command.

```text
/grant <telegramUserId> <planId> <days>
```

Creates or updates:

- subscription
- entitlement
- key activation

### `/suspend` and `/activate`

Admin overrides user/workspace/key status.

## Worker Jobs

Add a lightweight worker process or interval in the bot service.

Jobs:

- expire subscriptions past `current_period_end`
- expire entitlements past `valid_until`
- suspend keys for expired entitlements
- reactivate keys for newly active entitlements
- reset monthly usage windows
- send renewal reminders
- expire pending payments

Suggested commands:

```json
{
  "bot:worker": "node dist/telegram-bot/worker.js",
  "bot:worker:dev": "tsx src/telegram-bot/worker.ts"
}
```

Docker Compose can run `telegram-bot-worker` as a second service later.

## Security Rules

- Full API keys are never posted in groups.
- Customer commands that reveal secrets require private chat.
- Owner/admin IDs from env always bypass DB role lookup.
- Admin actions require `owner` or `admin`.
- Support actions must be read-only unless explicitly allowed.
- Every key lifecycle event is written to `bot_audit_log`.
- Every billing lifecycle event is written to `bot_audit_log`.
- Payment webhooks must verify provider signatures.
- Do not log full API keys.
- Do not store payment card data.
- Prefer key hash only. Use encrypted storage only if key reveal is required.

## Migration Plan

### Phase 1: Public identity DB

Files:

- `src/telegram-bot/bot-identity-repository.ts`
- `src/telegram-bot/commands/me.ts`
- `src/telegram-bot/commands/admin.ts`
- `src/telegram-bot/auth.ts`
- `src/telegram-bot/config.ts`

Tasks:

- add `TELEGRAM_OWNER_USER_IDS`
- add `BOT_PUBLIC_SIGNUP_ENABLED`
- create user/chat/membership tables
- upsert identity on every update
- let public users run `/start`, `/help`, `/me`
- keep existing admin commands owner-only

Tests:

- public user can `/start`
- blocked user cannot use customer commands
- owner from env is admin without DB row
- customer cannot run admin commands

### Phase 2: Workspace and key registry

Files:

- `src/customer-keys.ts`
- `src/telegram-bot/customer-workspace-repository.ts`
- `src/telegram-bot/commands/apikey.ts`
- `src/server.ts`

Tasks:

- add workspace table
- add customer key table
- create default workspace on `/start`
- issue one-time visible key
- add `/apikey rotate`
- add key status enforcement in `/v1/responses`

Tests:

- new user receives workspace
- key hash lookup succeeds
- suspended key returns billing error
- revoked key returns billing error
- operator route keys still work

### Phase 3: Manual plans and grants

Files:

- `src/billing.ts`
- `src/telegram-bot/commands/plan.ts`
- `src/telegram-bot/commands/grant.ts`
- `src/telegram-bot/commands/usage.ts`

Tasks:

- add plan/subscription/entitlement tables
- seed default `basic` and `trial` plans
- implement `/plan`
- implement `/grant`
- implement entitlement checks before forwarding
- track usage by key/workspace/window

Tests:

- active entitlement allows request
- expired entitlement suspends request
- admin grant creates active subscription
- usage increments after successful response

### Phase 4: Expiration worker

Files:

- `src/telegram-bot/worker.ts`
- `src/billing-expiration.ts`
- `docker-compose.yml`

Tasks:

- expire old subscriptions
- suspend keys for expired entitlements
- send renewal reminders
- add optional worker service

Tests:

- worker expires past-due subscription
- worker suspends keys
- worker is idempotent

### Phase 5: Admin-operated renewals

Files:

- `src/telegram-bot/commands/renew-user.ts`
- `src/telegram-bot/commands/billing.ts`

Tasks:

- implement `/renewuser <telegramUserId> <planId> <days>`
- allow admin to choose whether renewal keeps the current key or issues a
  replacement key
- extend subscription period
- create a new entitlement window
- reactivate suspended keys when renewal is successful
- notify the customer in private chat when possible
- audit the renewal and key lifecycle event

Tests:

- `/renewuser` is admin-only
- renewal extends the current period
- renewal can reactivate an expired suspended key
- renewal can revoke old key and issue replacement key
- customer cannot trigger renewal directly

### Phase 6: Customer renewal request queue

Files:

- `src/telegram-bot/commands/renew.ts`
- `src/telegram-bot/commands/billing.ts`

Tasks:

- implement customer `/renew` as a request, not a checkout
- create `renewal_requests` table or reuse `payments` with `provider = manual`
- notify admins when a renewal request is created
- let admin approve or close a renewal request
- keep actual payment collection outside the bot

Tests:

- customer `/renew` creates a request
- admin receives enough context to process manually
- duplicate open renewal requests are deduped
- closing a request does not change entitlement

### Phase 7: Payment provider integration

Files:

- `src/billing/payment-provider.ts`
- `src/billing/stripe-provider.ts` or `src/billing/lemon-provider.ts`
- `src/server.ts`

Tasks:

- add provider interface
- add checkout endpoint
- add webhook endpoint
- verify webhook signature
- map payment events to subscriptions and entitlements
- notify Telegram user after payment success or failure

Tests:

- invalid webhook signature rejected
- paid event activates subscription
- failed event leaves payment failed
- duplicate webhook is idempotent

### Phase 8: Chat/workspace billing

Files:

- `src/telegram-bot/commands/workspace.ts`
- `src/telegram-bot/customer-workspace-repository.ts`

Tasks:

- add `/workspace init`
- bind workspace to group `chat_id`
- support group subscription
- send secrets only in private chat
- support workspace member roles

Tests:

- group workspace created once
- non-admin group user cannot initialize billing
- group key is not revealed in group chat

## Acceptance Criteria

The feature is ready for public beta when:

- anyone can `/start` the bot without being in env allowlists
- owner/admin commands remain protected
- a new customer can receive or request an API key
- customer key calls to `/v1/responses` are enforced by key status
- expired or suspended customers cannot call `/v1/responses`
- admin can manually grant time/quota
- admin can manually renew a customer
- admin can choose whether renewal keeps the current key or issues a replacement
  key
- customers can view key status and usage/quota, but cannot run admin/provider
  commands
- key creation, reveal, rotation, suspension, renewal, and replacement events are
  audited
- bot can run through Docker Compose
- tests cover identity, key lifecycle, entitlement checks, and admin/customer
  authorization

The feature is ready for manually operated paid launch when:

- admin can issue keys after collecting payment outside the bot
- admin can extend subscriptions after collecting renewal payment outside the
  bot
- expired subscriptions suspend keys automatically
- manual renewal reactivates or replaces suspended keys
- customers can request renewal through bot without automatic checkout
- usage and quota are visible to customers

The feature is ready for automated paid launch when:

- a payment provider is integrated
- webhook signatures are verified
- renewal reactivates suspended keys
- failed payments leave subscriptions `past_due` or `expired`
- usage and quota are visible to customers
- operational alerts exist for webhook failures and worker failures

## Detailed Commit Plan

This section breaks the manual commercial V1 into reviewable commits. Each
commit should compile and keep existing tests passing.

### Commit 1: Add public bot config flags

Goal:

- introduce public bot mode without changing runtime behavior yet

Files:

- `src/telegram-bot/config.ts`
- `.env.example`
- `docker-compose.yml`
- `docs/public-telegram-bot-billing-implementation-plan.md`

Changes:

- add `TELEGRAM_OWNER_USER_IDS`
- add `BOT_PUBLIC_SIGNUP_ENABLED`
- add `BOT_REQUIRE_ADMIN_APPROVAL`
- add `BOT_DEFAULT_CUSTOMER_ROUTE`
- add `BOT_PUBLIC_RESPONSES_BASE_URL`
- keep existing allowlist variables for compatibility

Tests:

- config parser accepts old env shape
- config parser accepts public bot env shape
- owner IDs are parsed into a set

Verification:

```bash
npm run check
npx tsx --test src/telegram-bot/*.test.ts src/telegram-bot/commands/*.test.ts
```

### Commit 2: Add bot identity repository

Goal:

- store Telegram users, chats, and memberships in the bot DB

Files:

- `src/telegram-bot/bot-identity-repository.ts`
- `src/telegram-bot/bot-identity-repository.test.ts`
- `src/telegram-bot/telegram-adapter.ts`

Changes:

- create `telegram_users`
- create `telegram_chats`
- create `telegram_chat_memberships`
- upsert user/chat on every update
- update `last_seen_at`
- expose role/status lookup helpers

Tests:

- creates user on first sight
- updates username/name/language on later update
- creates chat row
- creates membership row
- preserves blocked status when user profile updates

### Commit 3: Refactor authorization into owner/admin/customer roles

Goal:

- separate public customers from owner/admin operators

Files:

- `src/telegram-bot/auth.ts`
- `src/telegram-bot/auth.test.ts`
- `src/telegram-bot/telegram-adapter.ts`
- `src/telegram-bot/commands/help.ts`
- `src/telegram-bot/commands/start.ts`

Changes:

- owner IDs from env always have admin access
- DB `admin` role has admin access
- DB `customer` role has customer access
- blocked users are denied
- public users can run `/start`, `/help`, `/me`
- customers cannot run operator commands
- help output differs by role

Tests:

- owner can run admin command without DB row
- customer cannot run `/providers`
- blocked user receives restricted message
- public unknown user can run `/start` when public signup is enabled
- public unknown user is rejected when public signup is disabled

### Commit 4: Add `/me` command

Goal:

- let customers see their account identity and state

Files:

- `src/telegram-bot/commands/me.ts`
- `src/telegram-bot/commands/me.test.ts`
- `src/telegram-bot/telegram-adapter.ts`
- `src/telegram-bot/format.ts`

Changes:

- register `/me`
- show Telegram user ID
- show role/status
- show private/group chat context
- show workspace summary if one exists

Tests:

- `/me` formats customer identity
- `/me` formats owner identity
- `/me` does not expose API keys

### Commit 5: Add customer workspace repository

Goal:

- create one default workspace per customer user

Files:

- `src/telegram-bot/customer-workspace-repository.ts`
- `src/telegram-bot/customer-workspace-repository.test.ts`
- `src/telegram-bot/commands/start.ts`

Changes:

- create `customer_workspaces`
- create default workspace on `/start`
- support `pending_approval` workspace status
- support `active`, `suspended`, `closed`
- bind optional `telegram_chat_id`

Tests:

- `/start` creates a default workspace
- repeated `/start` is idempotent
- pending approval policy creates pending workspace
- suspended workspace is not reactivated by `/start`

### Commit 6: Introduce customer key registry

Goal:

- model customer API keys as first-class records

Files:

- `src/customer-keys.ts`
- `src/customer-keys.test.ts`
- `src/telegram-bot/commands/apikey.ts`

Changes:

- create `customer_api_keys`
- generate customer keys
- store `api_key_hash`
- store `api_key_preview`
- return raw key only from creation function
- support `active`, `suspended`, `revoked`, `expired`
- migrate current simple bot key table if needed

Tests:

- creates key and stores only hash/preview
- lookup by hash works
- raw key is not persisted in plain text
- revoke changes status
- suspend and activate are idempotent

### Commit 7: Implement customer `/apikey`

Goal:

- customers can view their key status and receive newly created keys safely

Files:

- `src/telegram-bot/commands/apikey.ts`
- `src/telegram-bot/commands/apikey.test.ts`
- `src/telegram-bot/format.ts`

Changes:

- `/apikey` works only in private chat for full key reveal
- if no key exists and auto-issue is enabled, create one
- if no key exists and approval is required, show pending status
- show base URL from `BOT_PUBLIC_RESPONSES_BASE_URL`
- show key preview/status/route
- audit key reveal or key creation

Tests:

- private `/apikey` shows key on creation
- group `/apikey` refuses to reveal secret
- existing key response uses preview unless encrypted reveal is enabled
- pending user does not receive a key

### Commit 8: Add proxy enforcement for customer keys

Goal:

- `/v1/responses` must honor customer key status

Files:

- `src/server.ts`
- `src/customer-keys.ts`
- `src/error-response.ts`
- `src/customer-keys.test.ts`
- `src/provider-routing.test.ts` or new `src/customer-key-routing.test.ts`

Changes:

- hash bearer token before normal provider routing
- if hash matches customer key, enforce key/workspace status
- resolve key's `client_route`
- route through existing provider route mapping for that client route
- fall back to existing operator key behavior for non-customer keys
- return `API_KEY_SUSPENDED`, `API_KEY_REVOKED`, or `CUSTOMER_WORKSPACE_SUSPENDED`

Tests:

- active customer key forwards
- suspended customer key returns billing/access error
- revoked customer key returns billing/access error
- unknown operator key behavior is unchanged
- provider hint rules still apply after customer route resolution

### Commit 9: Add manual plans, subscriptions, and entitlements

Goal:

- represent manual paid access without payment automation

Files:

- `src/billing.ts`
- `src/billing.test.ts`
- `src/server.ts`

Changes:

- create `plans`
- create `subscriptions`
- create `entitlements`
- seed `basic` and `trial` plans
- create manual grant helper
- check entitlement validity during customer key enforcement

Tests:

- active entitlement allows request
- expired entitlement blocks request
- no entitlement blocks request unless trial policy allows
- manual grant creates subscription and entitlement
- renewing grant extends period correctly

### Commit 10: Add admin `/grant`

Goal:

- admin can manually give a customer paid time/quota

Files:

- `src/telegram-bot/commands/grant.ts`
- `src/telegram-bot/commands/grant.test.ts`
- `src/telegram-bot/telegram-adapter.ts`
- `src/telegram-bot/format.ts`

Command:

```text
/grant <telegramUserId> <planId> <days>
```

Changes:

- admin-only command
- creates user/workspace if needed
- creates or extends subscription
- creates entitlement
- activates existing suspended key
- notifies customer if possible
- writes audit log

Tests:

- customer cannot use `/grant`
- owner can grant
- grant creates entitlement
- grant reactivates suspended key
- grant notification failure does not rollback grant

### Commit 11: Add admin `/renewuser`

Goal:

- admin can renew customer after collecting payment outside the bot

Files:

- `src/telegram-bot/commands/renew-user.ts`
- `src/telegram-bot/commands/renew-user.test.ts`
- `src/billing.ts`

Commands:

```text
/renewuser <telegramUserId> <planId> <days>
/renewuser <telegramUserId> <planId> <days> replace-key
```

Changes:

- extend subscription period
- create new entitlement window
- reactivate suspended key by default
- optionally revoke old key and issue replacement key
- send replacement key only in private chat when possible
- audit renewal and replacement

Tests:

- customer cannot renew self directly
- admin renew extends period
- expired key is reactivated
- `replace-key` revokes old key and creates new key
- replacement key is not posted in group chat

### Commit 12: Add customer `/usage` and `/quota`

Goal:

- customers can inspect remaining access without admin help

Files:

- `src/telegram-bot/commands/usage.ts`
- `src/telegram-bot/commands/quota.ts`
- `src/billing.ts`
- `src/provider-usage.ts` or new `src/customer-usage.ts`

Changes:

- record usage by key/workspace/window
- show current period usage
- show token limit and remaining tokens
- show expiration date
- show key status

Tests:

- usage command shows zero usage for new entitlement
- usage increments after request
- quota displays expired entitlement
- group chat does not reveal secrets

### Commit 13: Add expiration worker

Goal:

- automatically suspend expired customers

Files:

- `src/telegram-bot/worker.ts`
- `src/billing-expiration.ts`
- `src/billing-expiration.test.ts`
- `package.json`
- `docker-compose.yml`

Changes:

- add `bot:worker` and `bot:worker:dev`
- expire subscriptions past period end
- expire entitlements past valid until
- suspend keys with no active entitlement
- send renewal reminders if user can be messaged
- worker is safe to run repeatedly

Tests:

- expired subscription becomes expired
- expired entitlement becomes expired
- active key becomes suspended
- running worker twice is idempotent

### Commit 14: Add customer renewal request queue

Goal:

- customer can ask for renewal, but admin still processes payment manually

Files:

- `src/telegram-bot/commands/renew.ts`
- `src/billing.ts`
- `src/billing.test.ts`

Changes:

- add `renewal_requests` or manual `payments` rows
- customer `/renew` creates open request
- duplicate open requests are deduped
- admins can list/close/approve requests
- approving request can call the same renewal helper as `/renewuser`

Tests:

- `/renew` creates request
- duplicate `/renew` returns existing request
- admin close request does not alter entitlement
- approve request extends subscription

### Commit 15: Add audit log everywhere

Goal:

- make customer and key lifecycle traceable

Files:

- `src/audit-log.ts`
- `src/audit-log.test.ts`
- command files that mutate state
- `src/server.ts`

Events:

- `user.created`
- `workspace.created`
- `api_key.created`
- `api_key.revealed`
- `api_key.rotated`
- `api_key.revoked`
- `api_key.suspended`
- `api_key.activated`
- `subscription.granted`
- `subscription.renewed`
- `renewal.requested`

Tests:

- mutating commands write audit rows
- audit metadata does not include full API keys
- failed authorization does not write success audit events

### Commit 16: Remove env customer allowlist dependency

Goal:

- finish public bot migration

Files:

- `src/telegram-bot/config.ts`
- `src/telegram-bot/auth.ts`
- `.env.example`
- `README.md`
- `docs/public-telegram-bot-billing-implementation-plan.md`

Changes:

- mark `TELEGRAM_CUSTOMER_USER_IDS` deprecated
- keep `TELEGRAM_ALLOWED_USER_IDS` only as optional emergency lockdown
- document public signup mode
- document owner/admin bootstrap
- document manual paid operations

Implementation note:

- customers should be discovered and managed through the bot database
- owner/admin bootstrap remains env-driven
- `TELEGRAM_ALLOWED_USER_IDS` should stay empty in normal public mode and only be used to temporarily lock the bot down

Tests:

- public signup works without customer env allowlist
- emergency lockdown rejects unknown users
- owner still bypasses lockdown

### Commit 17: Manual launch verification

Goal:

- verify the manually operated paid launch path end to end

Checks:

```bash
npm run check
npm test
docker compose up -d --build responses-proxy telegram-bot
docker compose ps
docker compose logs --tail=100 telegram-bot
```

Manual smoke test:

1. New Telegram user sends `/start`.
2. Admin runs `/grant <telegramUserId> basic 30`.
3. Customer runs `/apikey` in private chat.
4. Customer uses returned key against `/v1/responses`.
5. Admin runs `/renewuser <telegramUserId> basic 30`.
6. Customer runs `/usage` and `/quota`.
7. Admin suspends or expires the subscription.
8. Customer key receives a clear suspended/expired error.

Done when:

- bot stays up under Docker Compose
- no full keys appear in logs
- customer cannot run admin commands
- admin can issue and renew keys manually
- proxy blocks expired/suspended customer keys
