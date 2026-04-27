# Telegram Bot Design For Responses Proxy

## Goal

Build a Telegram bot that lets an operator inspect and control a running
`responses-proxy` app from Telegram. The bot should be a thin operational
companion, not a replacement for the dashboard or the OpenAI-compatible proxy
API.

The bot should support common daily tasks:

- Check whether the proxy is healthy.
- See the active provider, client routes, and available provider options.
- Apply a provider/model configuration to Hermes or Codex.
- Start and complete ChatGPT OAuth account setup.
- Refresh, enable, disable, or remove OAuth accounts.
- Send a test Responses request through the proxy.
- Receive concise error messages with enough context to fix routing or auth.

## Non-Goals

- Do not expose every dashboard feature in Telegram on the first version.
- Do not store upstream provider API keys in Telegram messages.
- Do not make Telegram the identity provider for `responses-proxy`.
- Do not bypass existing provider routing, request normalization, timeout, RTK,
  session logging, or error handling logic.
- Do not put Telegram-specific behavior into the `/v1/responses` proxy path.

## System Shape

The bot should run as a separate process next to `responses-proxy`.

```text
Telegram User
    |
    v
Telegram Bot API
    |
    v
responses-proxy-telegram-bot
    |
    +--> responses-proxy management API
    |       /health
    |       /api/providers
    |       /api/client-configs/status
    |       /api/client-configs/apply
    |       /api/chatgpt-oauth/*
    |       /api/account-auth/*
    |
    +--> responses-proxy OpenAI-compatible API
            /v1/responses
            /v1/models
```

The bot process owns Telegram polling/webhook handling, user authorization, chat
state, command parsing, and message formatting. The existing Fastify app remains
the source of truth for proxy state.

## Runtime Components

### Telegram Adapter

Responsible for:

- Receiving Telegram updates through long polling or webhook mode.
- Sending messages, inline keyboards, and callback query responses.
- Normalizing Telegram events into bot actions.
- Enforcing chat/user allowlists before any action is executed.

Recommended library: `grammy`.

Reasons:

- Small API surface.
- Good TypeScript support.
- Middleware model works well for auth checks and session state.
- Supports polling and webhook deployment.

### Bot Action Layer

Responsible for translating high-level bot actions into calls to
`responses-proxy`.

Examples:

- `getStatus()`
- `listProviders()`
- `showClientConfigStatus()`
- `applyClientConfig(client, providerId, model, routeApiKey)`
- `startChatGptOAuth()`
- `submitChatGptOAuthCallback(callbackUrl)`
- `refreshAccount(accountId)`
- `sendTestPrompt(input)`

This layer should not know Telegram concepts such as chat IDs or inline
keyboard callback payloads.

### Proxy API Client

A typed HTTP client for the local `responses-proxy` APIs.

Configuration:

- `RESPONSES_PROXY_BASE_URL`, default `http://127.0.0.1:8318`
- `RESPONSES_PROXY_CLIENT_API_KEY`, optional, used only for test prompt calls to
  `/v1/responses`
- `RESPONSES_PROXY_ADMIN_TOKEN`, optional future admin token if management APIs
  gain auth

The client should preserve proxy error envelopes and surface:

- HTTP status
- `error.code`
- `error.message`
- `error.request_id`
- `error.upstream_status`
- `error.retryable`

### Session Store

Use a small local store for pending conversational state.

Initial implementation can use in-memory session state because the bot actions
are short. If the bot is deployed with webhooks, multiple replicas, or frequent
restarts, move to SQLite.

Session examples:

- Waiting for a pasted OAuth callback URL.
- Waiting for a test prompt.
- Waiting for model text after provider selection.
- Remembering the selected client during Quick Apply.

## Authorization Model

Telegram is a control surface for local infrastructure, so authorization must be
explicit.

Required environment variables:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_IDS`, comma-separated Telegram user IDs

Optional environment variables:

- `TELEGRAM_ALLOWED_CHAT_IDS`, comma-separated chat IDs
- `TELEGRAM_ADMIN_USER_IDS`, comma-separated user IDs for destructive account
  actions

Rules:

- Reject all users not listed in `TELEGRAM_ALLOWED_USER_IDS`.
- If `TELEGRAM_ALLOWED_CHAT_IDS` is set, reject messages outside those chats.
- Require admin authorization for account deletion and any future provider
  deletion.
- Never echo provider API keys, OAuth access tokens, OAuth refresh tokens, or
  full auth files.
- Mask route/client API keys except for the first and last four characters.

## Command Design

### Core Commands

```text
/start
/help
/status
/providers
/clients
/apply
/oauth
/accounts
/test
/models
```

### `/status`

Calls:

- `GET /health`
- `GET /api/stats/usage`
- `GET /api/debug/prompt-cache/latest`

Response should show:

- Service health.
- Active provider ID.
- Upstream base URL.
- Fallback provider, if configured.
- Recent prompt cache status, if available.
- Usage summary, if available.

### `/providers`

Calls:

- `GET /api/providers`

Response should show:

- Active provider.
- Provider options available for client setup.
- Client routes.
- Whether a provider is system-managed or account-backed.

Inline actions:

- View provider details.
- Show client routes for this provider.
- Use provider in `/apply` flow.

### `/clients`

Calls:

- `GET /api/client-configs/status`

Response should show:

- Runtime mode: native or container.
- Proxy base URL.
- Hermes config status.
- Codex config status.
- Available provider options.

Inline actions:

- Apply to Hermes.
- Apply to Codex.

### `/apply`

Interactive Quick Apply flow for Hermes or Codex.

Flow:

1. User chooses `Hermes` or `Codex`.
2. Bot fetches `GET /api/client-configs/status`.
3. User chooses a provider option.
4. Bot fetches provider models when needed through `GET /api/provider-models`.
5. User chooses or enters a model.
6. Bot chooses an existing route API key for the selected client, or asks the
   proxy to generate one through the apply endpoint.
7. Bot calls `POST /api/client-configs/apply`.
8. Bot returns the changed client, provider, model, base URL, and masked route
   key.

Call:

```http
POST /api/client-configs/apply
Content-Type: application/json

{
  "client": "codex",
  "baseUrl": "http://127.0.0.1:8318/v1",
  "routeApiKey": "sk-route-...",
  "model": "gpt-5.5"
}
```

Failure handling:

- `QUICK_APPLY_HOST_PATH_UNAVAILABLE`: explain that the proxy cannot patch the
  host config path from this runtime.
- `MODEL_REQUIRED`: ask the user to select or type a model.
- `CLIENT_API_KEY_NOT_FOUND`: refresh client status and restart the flow.

### `/oauth`

Starts or completes ChatGPT OAuth setup.

Calls:

- `GET /api/chatgpt-oauth/status`
- `POST /api/chatgpt-oauth/start`
- `POST /api/chatgpt-oauth/callback`

Flow:

1. User runs `/oauth`.
2. Bot shows OAuth enabled status and connected accounts.
3. User taps `Add Account`.
4. Bot calls `POST /api/chatgpt-oauth/start`.
5. Bot sends the returned auth URL.
6. Bot enters `waiting_for_oauth_callback` state.
7. User pastes the full callback URL.
8. Bot calls `POST /api/chatgpt-oauth/callback`.
9. Bot confirms the account was added and shows account-backed provider status.

The bot should warn the user that the callback URL may contain short-lived
authorization material and should only be pasted into this authorized bot chat.

### `/accounts`

Account pool management.

Calls:

- `GET /api/chatgpt-oauth/status`
- `POST /api/account-auth/accounts/:accountId/refresh`
- `POST /api/account-auth/accounts/:accountId/disable`
- `POST /api/account-auth/accounts/:accountId/enable`
- `DELETE /api/account-auth/accounts/:accountId`

Response should show:

- Account display name or email when available.
- Enabled/disabled status.
- Token freshness.
- Last refresh result.
- Rotation mode.

Inline actions:

- Refresh.
- Disable.
- Enable.
- Delete, admin-only and with confirmation.

### `/test`

Sends a small Responses API request through the proxy.

Calls:

- `POST /v1/responses`

Flow:

1. User runs `/test`.
2. Bot asks for a short prompt or accepts `/test your prompt`.
3. Bot sends a request with the configured client API key.
4. Bot returns a compact answer and diagnostic headers when available.

Example request:

```json
{
  "model": "gpt-5.5",
  "input": "Reply with one sentence: proxy is working."
}
```

The bot should support provider hints for advanced users:

```text
/test --provider-id account-openai-codex Say hello
```

That maps to `metadata.provider_id` in the Responses request.

### `/models`

Calls:

- `GET /v1/models`
- `GET /api/provider-models?providerId=...`

Use `/v1/models` to see the client-facing provider model list through normal
proxy behavior. Use `/api/provider-models` during setup flows where the user is
choosing a provider before sending traffic.

## Message Formatting

Messages should be short and operational.

Good status format:

```text
responses-proxy: healthy
active provider: account-openai-codex
upstream: https://chatgpt.com/backend-api/codex
fallback: cliproxy
```

Good error format:

```text
Apply failed
code: QUICK_APPLY_HOST_PATH_UNAVAILABLE
message: Codex config path is not writable from this runtime.
```

Formatting rules:

- Use Telegram MarkdownV2 or HTML consistently.
- Escape all user-controlled and upstream-controlled text.
- Keep detailed JSON behind a `Details` button or a follow-up message.
- Avoid sending long upstream bodies unless the user explicitly asks for
  diagnostics.

## Callback Payloads

Inline keyboard callback data should be compact and versioned.

Examples:

```text
v1:apply:client:codex
v1:apply:provider:account-openai-codex
v1:acct:refresh:<accountId>
v1:acct:disable:<accountId>
v1:acct:delete-confirm:<accountId>
```

Because Telegram callback data has a small size limit, store larger state in the
bot session store and put only stable IDs in callback data.

## Error Handling

The bot should classify failures into:

- Telegram delivery errors.
- Bot authorization errors.
- Proxy unavailable errors.
- Proxy validation/configuration errors.
- Upstream provider errors returned through the proxy envelope.

Proxy error envelopes should be preserved. The user-facing message should lead
with `error.code` and `error.message`, then include request ID and retryability
when available.

Retry behavior:

- Retry idempotent `GET` requests once after a short delay.
- Do not automatically retry config writes.
- Do not automatically retry OAuth callback submission.
- For `/v1/responses`, rely on proxy retry/fallback behavior and show the final
  proxy result.

## Security Notes

- Store `TELEGRAM_BOT_TOKEN` outside git, ideally in the same deployment secret
  mechanism used for the proxy.
- Treat Telegram chat history as less private than local disk. Do not send
  secrets unless unavoidable.
- OAuth callback URLs should be processed immediately and not persisted.
- Account IDs are safe to display, but emails should be shown only to allowed
  users.
- Destructive actions require a confirmation button and admin authorization.
- Add rate limiting per Telegram user to avoid accidental command loops.

## Deployment Modes

### Local Polling Mode

Best for a personal workstation or Mac app install.

```text
responses-proxy on 127.0.0.1:8318
telegram bot process on same host
bot uses Telegram long polling
```

Pros:

- No public webhook URL required.
- Works naturally with a local-only proxy.
- Simple to run under LaunchAgent, Docker Compose, or npm scripts.

Cons:

- Only one bot process should poll a token at a time.

### Webhook Mode

Best for a server or always-on tailnet deployment.

```text
Telegram -> public HTTPS webhook -> bot -> responses-proxy
```

Pros:

- Lower latency.
- Better for server deployments.

Cons:

- Requires public HTTPS.
- Requires stronger webhook secret validation.
- Session storage should be durable.

## Configuration

Suggested bot environment:

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALLOWED_USER_IDS=
TELEGRAM_ALLOWED_CHAT_IDS=
TELEGRAM_ADMIN_USER_IDS=
TELEGRAM_BOT_MODE=polling
TELEGRAM_WEBHOOK_URL=
TELEGRAM_WEBHOOK_SECRET=
RESPONSES_PROXY_BASE_URL=http://127.0.0.1:8318
RESPONSES_PROXY_CLIENT_API_KEY=
RESPONSES_PROXY_DEFAULT_MODEL=gpt-5.5
BOT_SESSION_DB_PATH=
BOT_LOG_LEVEL=info
```

## Proposed File Layout

```text
src/telegram-bot/
  index.ts
  config.ts
  telegram-adapter.ts
  auth.ts
  sessions.ts
  proxy-client.ts
  actions.ts
  format.ts
  commands/
    status.ts
    providers.ts
    clients.ts
    apply.ts
    oauth.ts
    accounts.ts
    test.ts
```

The bot can initially live in the same repository and package as
`responses-proxy`, but it should have a separate entrypoint and separate npm
scripts:

```json
{
  "scripts": {
    "bot:dev": "tsx src/telegram-bot/index.ts",
    "bot:start": "node dist/telegram-bot/index.js"
  }
}
```

## Implementation Plan

### Phase 1: Read-Only Bot

- Add Telegram bot config parsing.
- Add allowlist middleware.
- Add proxy API client.
- Implement `/start`, `/help`, `/status`, `/providers`, and `/clients`.
- Use polling mode.

### Phase 2: Quick Apply

- Implement interactive `/apply`.
- Add provider/model selection.
- Call `POST /api/client-configs/apply`.
- Mask route keys in responses.

### Phase 3: OAuth And Accounts

- Implement `/oauth`.
- Support callback URL paste flow.
- Implement `/accounts` with refresh, enable, disable, and admin-only delete.

### Phase 4: Test Prompt

- Implement `/test`.
- Support default model and optional provider hints.
- Show compact response plus request diagnostics.

### Phase 5: Production Hardening

- Add SQLite session store.
- Add webhook mode.
- Add per-user rate limits.
- Add structured bot logs.
- Add tests for command parsing, authorization, callback payloads, and proxy
  client error mapping.

## Open Decisions

- Whether management APIs should gain their own admin token before the bot is
  enabled outside localhost.
- Whether the bot should support group chats or only direct messages.
- Whether account email addresses should be visible by default.
- Whether `/test` should require a dedicated client API key or reuse a selected
  client route key.
- Whether the bot should expose provider creation/editing after the basic
  operational flows are stable.
