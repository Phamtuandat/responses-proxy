# Auth Usage Flow Implementation Plan

This plan covers the runtime path after an account has already been connected
and stored in the account pool. Login and token capture are covered by
`docs/chatgpt-oauth-implementation-plan.md`.

## Goal

Make account-backed providers usable as normal upstream providers:

1. A local client sends a standard Responses request to the proxy.
2. Provider routing selects an account-backed provider.
3. The proxy selects an account from the pool.
4. The proxy refreshes the account token when needed.
5. The proxy forwards the request to the upstream provider with account auth.
6. Operators can observe and manage the pool from the UI.

The design should stay platform-neutral. The current concrete platform is
OpenAI/Codex, but the runtime shape should allow future platforms to provide
their own token resolver, headers, base URL, and account metadata.

## Product Decision: Client-Visible, Provider-Management Hidden

After an account is successfully added to an account pool, the corresponding
account-backed provider option should become available in client setup flows
automatically. Operators should be able to select it for clients such as Hermes
or Codex without manually creating a provider record.

This provider option does not have to appear in the Provider Management CRUD
tab. Treat it as a system-managed or virtual provider:

- visible in client provider selectors
- visible in runtime status where it helps explain routing
- managed from Accounts and Auth Management
- hidden from generic Provider Management CRUD by default
- not editable as a normal provider with provider API keys

Provider Management should stay focused on manually configured upstream
providers. Account-backed providers are derived from account pools and platform
configuration, so their lifecycle belongs to Auth Management.

## Representation Contract

Use a real runtime provider record with a system-managed marker, not a purely
frontend-only virtual option.

Suggested provider capability fields:

```ts
type RuntimeProviderCapabilities = {
  systemManaged?: boolean;
  accountPlatform?: "openai_codex";
  accountPoolRequired?: boolean;
};
```

The account-backed provider should be persisted because routing, Quick Apply,
session logs, fallback checks, and existing client routes need a stable provider
ID. The provider is hidden from generic Provider Management CRUD by default,
but it is still returned by APIs that build client provider selectors.

Visibility rules:

- `GET /api/providers` for Provider Management excludes `systemManaged`
  providers by default.
- Client setup APIs include both normal providers and system-managed
  account-backed provider options.
- Runtime status/debug views may include system-managed providers when useful
  for explaining routing.
- A future advanced/debug Provider Management view may opt into showing
  system-managed providers, but normal CRUD must not edit provider API keys for
  them.

Pool readiness must be represented separately from option existence:

- The provider option exists after the platform account feature is available or
  after the first successful account connection.
- The option remains visible even when the pool later becomes empty.
- Client selectors show readiness states such as `pool ready`, `pool empty`,
  `all accounts disabled`, or `accounts expiring soon`.
- Existing client routes must continue to render even if every account is later
  deleted or disabled.

Suggested stable provider IDs:

- `account-openai-codex` for the OpenAI/Codex account pool.
- Future providers should follow `account-<platform-slug>`.

## Current Runtime Flow

Current code path:

- `/v1/responses` resolves the client route and selected provider.
- `buildForwardTarget()` checks `provider.authMode`.
- For `chatgpt_oauth`, `resolveChatGptAccessToken()` selects an account.
- Selection uses provider-pinned account ID when present, otherwise the shared
  pool rotation mode.
- Access tokens are refreshed when `expiresAt` is within
  `CHATGPT_OAUTH_REFRESH_LEAD_DAYS`.
- Forwarding adds account auth headers and sends the normalized request to the
  provider base URL.

Current account selection modes:

- `round_robin`
- `random`
- `first_available`

Current OpenAI/Codex forwarding headers:

- `Authorization: Bearer <access_token>`
- `Originator: codex-tui`

## Gaps To Close

### 1. Platform-neutral auth abstraction

Current code has ChatGPT-specific naming in the runtime auth path. Introduce a
small abstraction layer so new account platforms do not require branching
throughout `server.ts`.

Suggested shape:

```ts
type AccountAuthPlatform = "openai_codex";

type AccountAuthTarget = {
  providerId: string;
  platform: AccountAuthPlatform;
  baseUrl: string;
  headers: Record<string, string>;
};

type AccountTokenResolver = {
  platform: AccountAuthPlatform;
  resolveForwardHeaders(provider: RuntimeProviderPreset): Promise<Record<string, string>>;
};
```

Keep the existing `chatgpt_oauth` auth mode as a compatibility alias at first.
Add a future-facing `account_pool` auth mode only after the resolver interface
is stable.

Resolver boundary for this phase:

- token/account selection
- token refresh
- forward headers
- upstream base URL defaults
- account display metadata

Out of scope for the first resolver abstraction:

- login/callback implementation for all platforms
- generic token storage schema
- provider-specific request body transforms
- model-listing behavior beyond the existing provider model flow

Those can be generalized after a second account platform is implemented.

### 2. Provider routing and client setup

The account-backed provider should be easy to select from clients:

- Ensure the shared account-backed provider exists after the first account is
  connected.
- Add the shared account-backed provider as an option in client setup flows as
  soon as its pool has at least one connected account.
- Keep the shared account-backed provider option visible after the pool becomes
  empty so existing routes remain understandable and recoverable.
- Allow the account-backed provider option to be hidden from Provider
  Management CRUD while remaining selectable by clients.
- Expose whether the provider has usable accounts in provider UI/status.
- Make Quick Apply able to select the account-backed provider for Hermes/Codex.
- Return a clear error when a client routes to an account-backed provider but
  the pool is empty.

Client selector source of truth:

- Add a selector-oriented provider payload, for example
  `GET /api/client-configs/status` including `providerOptions`, or a dedicated
  `GET /api/client-provider-options`.
- That payload must include normal providers plus system-managed account-backed
  providers.
- Provider Management should keep using its CRUD-oriented provider list, which
  hides system-managed providers by default.

Desired error:

```json
{
  "error": {
    "type": "authentication_error",
    "code": "ACCOUNT_POOL_UNAVAILABLE",
    "message": "No connected accounts are available for this provider."
  }
}
```

### 3. Account pool policy

Move pool-level policy into Auth Management and keep platform accordions focused
on connected sessions.

Pool-level settings:

- rotation mode
- disabled account handling
- refresh lead time display
- optional per-provider account pinning later

Per-account actions:

- refresh now
- disable/enable
- delete
- inspect expiry and last refresh timestamps

Required account management API additions:

- `POST /api/account-auth/accounts/:accountId/refresh`
- `POST /api/account-auth/accounts/:accountId/disable`
- `POST /api/account-auth/accounts/:accountId/enable`
- `DELETE /api/account-auth/accounts/:accountId`

Existing ChatGPT-specific endpoints may remain as compatibility wrappers during
the transition, but Auth Management should call platform-neutral endpoints when
they exist.

### 4. Token refresh resilience

Current refresh lock prevents duplicate refreshes per account. Add better
failure handling:

- If refresh fails for one account, mark the account unhealthy for the current
  request and try another available account when rotation mode allows it.
- Distinguish "account refresh failed" from "pool unavailable".
- Add session log events for selected account, refresh attempted, refresh
  succeeded, and refresh failed. Logs must not contain tokens.

Suggested events:

- `account_pool_selected`
- `account_token_refresh_started`
- `account_token_refresh_succeeded`
- `account_token_refresh_failed`
- `account_pool_exhausted`

### 5. Fallback behavior

Today token resolution happens before the existing upstream fallback path. That
means an account-pool auth failure may not fall back the same way as an upstream
HTTP failure.

Define fallback policy explicitly:

- Empty pool should not silently fall back unless the client route explicitly
  allows auth fallback.
- Expired or revoked account token can try another account in the same pool.
- Upstream 429/5xx can use the existing fallback provider path.
- Auth failures from all accounts should return a clear 401/409 style proxy
  error instead of a generic internal error.

Add a route/provider policy field before implementing auth fallback:

```ts
type ClientRoutePolicy = {
  allowAuthFallback?: boolean;
};
```

Default behavior:

- `allowAuthFallback=false`
- pool empty: return `ACCOUNT_POOL_UNAVAILABLE`
- all accounts fail refresh: return `ACCOUNT_POOL_AUTH_FAILED`
- upstream 429/5xx after account auth succeeds: existing fallback behavior may
  apply

### 6. Observability

Expose account-backed usage without leaking secrets:

- selected provider id
- selected account display label or stable redacted id
- token expiry bucket
- refresh status
- upstream target

Avoid exposing:

- access token
- refresh token
- id token
- full Authorization header

### 7. Tests

Add focused tests for the runtime path:

- pool selection respects `round_robin`
- pool selection respects `random` with deterministic test hooks
- pool selection respects `first_available`
- pinned provider account overrides pool rotation
- access token is reused when not near expiry
- access token refreshes when near expiry
- concurrent requests share one refresh lock
- empty pool returns a clear error
- disabled accounts are skipped
- account-backed provider forwards custom headers and no provider API key
- refresh failure can try another account when available

## Implementation Phases

### Phase 1: Runtime hardening

- Introduce account-pool error types.
- Convert missing/disabled account failures into structured proxy errors.
- Add session log events around account selection and refresh.
- Keep current `chatgpt_oauth` auth mode.
- Persist or mark the account-backed provider as `systemManaged`.
- Keep provider option existence separate from pool readiness.

### Phase 2: Auth Management UI

- Show connected accounts in Auth Management.
- Add refresh, disable/enable, delete actions.
- Show expiry and last refresh.
- Keep login/connect UI in Accounts only.
- Mark account-backed provider options as system-managed.
- Keep system-managed account providers out of Provider Management CRUD unless
  a future advanced/debug view explicitly opts into showing them.
- Add platform-neutral account management endpoints or wrappers before wiring
  the UI to enable/disable.

### Phase 3: Platform abstraction

- Add a resolver registry keyed by platform.
- Move OpenAI/Codex-specific header construction into its resolver.
- Keep existing DB tables until a second platform proves the generic schema.

### Phase 4: Pool retry behavior

- On refresh failure, try the next available account before failing the request.
- Add protection against retry loops.
- Emit structured events for exhausted pools.

### Phase 5: Client routing polish

- Make Quick Apply clearly support the account-backed provider.
- Populate client provider selectors from both normal providers and
  system-managed account-backed provider options.
- Label account-backed provider options clearly, for example
  `OpenAI / Codex Account Pool`, without exposing internal provider ids.
- Add provider status badges for "pool ready", "pool empty", and "accounts
  expiring soon".
- Ensure selected account-backed providers still render in client config UI
  when their pools become empty.
- Add docs for using account-backed providers from Hermes/Codex.

## Acceptance Criteria

- A client can route to the account-backed provider with only a local client API
  key.
- After the first account is connected, the account-backed provider is
  selectable in client setup without manual provider creation.
- The account-backed provider can be hidden from Provider Management CRUD while
  still being available to client setup flows.
- The account-backed provider remains visible in client setup after its pool
  becomes empty, with a clear `pool empty` status.
- Client selector APIs return system-managed account-backed providers, while
  Provider Management CRUD excludes them by default.
- Requests are forwarded with account auth and without exposing account tokens.
- Empty or unhealthy pools fail with clear, actionable errors.
- Auth Management can show and manage connected sessions.
- Auth Management can refresh, disable, enable, and delete accounts through
  documented endpoints.
- Adding another account platform requires a new resolver and UI accordion, not
  rewiring the forwarding path.
