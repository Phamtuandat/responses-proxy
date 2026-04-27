# ChatGPT OAuth Provider Implementation Plan

This plan adapts the Codex OAuth design used by
`router-for-me/CLIProxyAPI` at commit `736ae61e4a405a3b31bcf4a77d3e09422ef5f5a4`.

The target behavior is not "Sign in with ChatGPT" for the dashboard. The target
behavior is a ChatGPT/Codex OAuth-backed upstream provider:

1. The operator logs in with an OpenAI/ChatGPT account.
2. The proxy stores the OAuth token bundle locally.
3. Runtime provider routing selects one shared ChatGPT OAuth provider.
4. The shared provider rotates across all connected, enabled OAuth accounts.
5. The proxy forwards Responses-compatible traffic to the Codex backend with the
   selected account's OAuth access token.

The OAuth endpoints used by CLIProxyAPI are practical integration details and
should remain behind a feature flag because they are not documented as a stable
public "Sign in with ChatGPT" identity-provider product.

## Reference Flow

Browser PKCE flow:

- Authorization URL: `https://auth.openai.com/oauth/authorize`
- Token URL: `https://auth.openai.com/oauth/token`
- Client ID: `app_EMoamEEZ73f0CkXaXp7hrann`
- Redirect URI: `http://localhost:1455/auth/callback`
- Scope: `openid email profile offline_access`
- Extra auth params:
  - `prompt=login`
  - `id_token_add_organizations=true`
  - `codex_cli_simplified_flow=true`

Practical CLIProxyAPI-style callback handling:

- The app starts the OAuth session and shows the auth URL.
- The user opens the auth URL and completes login.
- The browser redirects to the configured local callback URL.
- If the proxy is not listening on that exact callback address, the browser may
  show a connection error. That is expected for manual mode.
- The user copies the full callback URL from the browser address bar and pastes
  it back into the app.
- The app extracts `code` and `state`, validates the pending session, exchanges
  the code, stores tokens, and creates the runtime provider.

Device flow:

- User-code URL: `https://auth.openai.com/api/accounts/deviceauth/usercode`
- Token polling URL: `https://auth.openai.com/api/accounts/deviceauth/token`
- Verification URL: `https://auth.openai.com/codex/device`
- Token exchange redirect URI: `https://auth.openai.com/deviceauth/callback`

Runtime upstream:

- Base URL: `https://chatgpt.com/backend-api/codex`
- Auth header: `Authorization: Bearer <access_token>`
- Refresh with `grant_type=refresh_token` before the token becomes stale.

## Feature Flags And Config

Add the following environment variables in `src/config.ts`:

- `CHATGPT_OAUTH_ENABLED=false`
- `CHATGPT_OAUTH_CLIENT_ID=app_EMoamEEZ73f0CkXaXp7hrann`
- `CHATGPT_OAUTH_REDIRECT_URI=http://localhost:1455/auth/callback`
- `CHATGPT_OAUTH_CALLBACK_PORT=1455`
- `CHATGPT_OAUTH_AUTH_URL=https://auth.openai.com/oauth/authorize`
- `CHATGPT_OAUTH_TOKEN_URL=https://auth.openai.com/oauth/token`
- `CHATGPT_OAUTH_DEVICE_USER_CODE_URL=https://auth.openai.com/api/accounts/deviceauth/usercode`
- `CHATGPT_OAUTH_DEVICE_TOKEN_URL=https://auth.openai.com/api/accounts/deviceauth/token`
- `CHATGPT_OAUTH_DEVICE_VERIFICATION_URL=https://auth.openai.com/codex/device`
- `CHATGPT_CODEX_BASE_URL=https://chatgpt.com/backend-api/codex`
- `CHATGPT_OAUTH_REFRESH_LEAD_DAYS=5`

Default the feature off. The dashboard can render the UI disabled with a short
operator-facing note until the flag is enabled.

## Data Model

Use the existing SQLite application DB at `APP_DB_PATH`.

```sql
CREATE TABLE IF NOT EXISTS chatgpt_oauth_accounts (
  id TEXT PRIMARY KEY,
  email TEXT,
  account_id TEXT,
  id_token TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_refresh_at TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chatgpt_oauth_accounts_account_id
  ON chatgpt_oauth_accounts(account_id)
  WHERE account_id IS NOT NULL AND account_id != '';

CREATE TABLE IF NOT EXISTS chatgpt_oauth_sessions (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
```

Token encryption can be added later with a local key, but all logs and UI
payloads must redact token fields from the first implementation.

## New Modules

Add `src/chatgpt-oauth.ts`:

- `generatePkceCodes()`
- `generateOauthState()`
- `buildChatGptAuthUrl(config, state, pkce)`
- `exchangeChatGptCodeForTokens(config, code, redirectUri, codeVerifier)`
- `refreshChatGptTokens(config, refreshToken)`
- `parseJwtClaims(idToken)`
- `normalizeChatGptTokenBundle(response, now)`

Add `src/chatgpt-oauth-store.ts`:

- `ChatGptOAuthStore.create(dbFile)`
- `createSession(input)`
- `consumeSession(state)`
- `markSessionError(state, message)`
- `upsertAccount(tokenBundle)`
- `listAccountsForUi()`
- `getAccount(id)`
- `updateTokens(id, tokenBundle)`
- `disableAccount(id)`
- `deleteAccount(id)`

Add `src/chatgpt-provider-auth.ts`:

- `resolveChatGptAccessToken(provider, store, config)`
- refresh lock keyed by account ID
- refresh when `expires_at - now <= refreshLead`
- return a redacted auth status for UI

## Runtime Provider Integration

Extend the runtime provider shape with an auth mode:

- `api_key`: current behavior
- `chatgpt_oauth`: token is resolved from `chatgpt_oauth_accounts`

Suggested provider fields:

```ts
type RuntimeProviderAuthMode = "api_key" | "chatgpt_oauth";

type RuntimeProviderInput = {
  authMode?: RuntimeProviderAuthMode;
  chatgptAccountId?: string;
};
```

For the shared `chatgpt_oauth` provider:

- `baseUrl` defaults to `CHATGPT_CODEX_BASE_URL`
- `apiKeys` must not be required
- `chatgptAccountId` is optional; when omitted, the provider uses the shared
  account pool and rotates across all enabled accounts
- UI must not display OAuth tokens
- `/v1/responses` and `/v1/models` must call
  `resolveChatGptAccessToken()` before forwarding

The existing routing API-key logic should stay unchanged. Client route keys
still authenticate local clients to the proxy; ChatGPT OAuth only authenticates
the proxy to the upstream Codex backend.

## HTTP API Contract

Add management endpoints under `/api/chatgpt-oauth`.

`GET /api/chatgpt-oauth/status`

```json
{
  "ok": true,
  "enabled": true,
  "accounts": [
    {
      "id": "chatgpt-oauth:acct_...",
      "email": "user@example.com",
      "accountId": "acct_...",
      "expiresAt": "2026-05-01T00:00:00.000Z",
      "lastRefreshAt": "2026-04-27T00:00:00.000Z",
      "disabled": false
    }
  ]
}
```

`POST /api/chatgpt-oauth/start`

Returns an auth URL and creates a pending session.

```json
{
  "ok": true,
  "state": "...",
  "authUrl": "https://auth.openai.com/oauth/authorize?..."
}
```

`GET /auth/chatgpt/callback`

- Validates `state`
- Exchanges `code`
- Stores or updates the account
- Creates a runtime provider if one does not exist
- Returns a small success HTML page

`POST /api/chatgpt-oauth/callback`

Manual paste endpoint for CLIProxyAPI-style UX. Accept either the full callback
URL or direct fields.

```json
{
  "redirectUrl": "http://localhost:1455/auth/callback?code=...&state=..."
}
```

Alternative body:

```json
{
  "code": "...",
  "state": "..."
}
```

Returns the redacted account, created provider, account list, and provider list.

`POST /api/chatgpt-oauth/device/start`

Starts device-code login and returns `userCode`, `verificationUrl`, and polling
metadata.

`POST /api/chatgpt-oauth/device/poll`

Polls the device token endpoint until complete or timeout. Once complete, it
exchanges the returned authorization code with PKCE and stores the account.

`POST /api/chatgpt-oauth/accounts/:id/refresh`

Refreshes an account manually.

`DELETE /api/chatgpt-oauth/accounts/:id`

Deletes or disables the stored account and detaches providers using it.

## Forwarding Changes

In `src/server.ts`, keep the current provider-resolution flow. After selecting
the provider, add:

1. If provider auth mode is `api_key`, use the current provider API-key logic.
2. If auth mode is `chatgpt_oauth`, resolve a fresh access token.
3. Build upstream headers with `Authorization: Bearer <access_token>`.
4. Forward to the provider base URL.

Header defaults for Codex-compatible upstream requests should include:

- `Content-Type: application/json`
- `Accept: text/event-stream` for streaming requests
- `Originator: codex-tui` when needed by the Codex backend
- pass through `X-Codex-Beta-Features`, `Version`, `X-Codex-Turn-Metadata`,
  and `X-Client-Request-Id` if present

Do not add those headers to non-ChatGPT providers.

## Dashboard UX

Add a "ChatGPT OAuth" section on the provider screen:

- feature enabled/disabled pill
- login button
- device login button
- account table
- token expiry status
- refresh button
- delete/logout button

The first successful account connection creates or reuses one shared provider:

- id: `chatgpt-oauth`
- name: `ChatGPT OAuth`
- base URL: `https://chatgpt.com/backend-api/codex`
- auth mode: `chatgpt_oauth`

## Test Plan

Unit tests:

- PKCE verifier length and challenge format
- auth URL contains required params
- state validation rejects missing, expired, or reused sessions
- token exchange parses `id_token`, `access_token`, `refresh_token`, expiry,
  account ID, and email
- refresh updates access token, refresh token, expiry, and last refresh time
- UI account serialization redacts token fields

Integration tests:

- disabled feature returns `404` or `409` for start endpoints
- callback with bad state returns `400`
- callback with provider error marks session failed
- successful callback stores account and provider
- forwarding through `chatgpt_oauth` injects Bearer access token
- expired token triggers refresh before forwarding
- concurrent requests refresh the same account only once

Manual smoke:

1. Set `CHATGPT_OAUTH_ENABLED=true`.
2. Start the app locally.
3. Open dashboard and login with ChatGPT OAuth.
4. Confirm the account appears without token values.
5. Create a provider from the account.
6. Route a client key to that provider.
7. Send a `/v1/responses` request.
8. Confirm streaming and non-streaming paths work.

## Implementation Phases

Phase 1: Core OAuth library

- Add config fields.
- Add PKCE/state/token helper module.
- Add token parsing tests.

Phase 2: Persistence

- Add SQLite store and migrations.
- Add account redaction.
- Add session TTL cleanup.

Phase 3: Management API

- Add start/callback/status/delete/refresh endpoints.
- Add manual callback paste endpoint for CLIProxyAPI-style UX.
- Add device-flow endpoints.
- Add error responses consistent with existing `/api/*` routes.

Phase 4: Runtime provider integration

- Extend provider schema with `authMode`.
- Add OAuth token resolver.
- Wire resolver into `/v1/responses` and `/v1/models`.
- Add Codex-specific headers only for this auth mode.

Phase 5: Dashboard

- Add OAuth account panel.
- Add provider creation from account.
- Add account refresh/delete actions.

Phase 6: Hardening

- Redact all token fields in logs and UI.
- Add refresh locking.
- Add clear feature-flag messaging.
- Add README usage notes.

## Risks

- The OpenAI/ChatGPT OAuth endpoints used by CLIProxyAPI may change.
- The Codex backend URL may change.
- The flow may be account-tier dependent.
- Public exposure through Tailscale Funnel should require dashboard auth before
  this feature is enabled.

Keep this feature isolated behind `CHATGPT_OAUTH_ENABLED` until the runtime path
and dashboard management path are both protected.
