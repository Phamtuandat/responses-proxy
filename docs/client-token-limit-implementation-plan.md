# Client Token Limit Implementation Plan

This plan describes a per-client token quota feature for `responses-proxy`.
The goal is to let the operator define token limits for each runtime client
route such as `default`, `codex`, `hermes`, or custom client routes created in
the dashboard.

The feature should be implemented in small, reviewable commits. Each commit
below is intended to leave the repo in a working state with tests passing.

## Target Behavior

For every client route:

1. The operator can enable or disable a token limit.
2. The operator can choose a window type such as daily, weekly, monthly, or
   fixed seconds.
3. The proxy tracks `input_tokens`, `output_tokens`, and `total_tokens`.
4. The proxy blocks requests with `429` when a hard limit is exceeded.
5. The dashboard shows `used / limit`, remaining quota, and current window.
6. The operator can reset the current usage window manually.

## Scope For V1

Included:

- limits by client route
- accounting by `total_tokens`
- current-window usage snapshots
- hard blocking with `429`
- admin API
- dashboard UI
- reset current window

Deferred:

- soft limits and warning thresholds
- email or webhook alerts
- per-model pricing or weighted token budgets
- reservation-based concurrency control
- historical charts beyond the current window

## Data Model

Use the existing SQLite app DB at `APP_DB_PATH`.

```sql
CREATE TABLE IF NOT EXISTS client_token_limits (
  client_route TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  token_limit INTEGER NOT NULL,
  window_type TEXT NOT NULL,
  window_size_seconds INTEGER,
  hard_block INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS client_token_usage (
  client_route TEXT NOT NULL,
  window_start TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (client_route, window_start)
);
```

Optional later:

```sql
CREATE TABLE IF NOT EXISTS client_token_limit_events (
  id TEXT PRIMARY KEY,
  client_route TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

## Backend Design

### Repository responsibilities

Extend `RuntimeProviderRepository` to store and query:

- token limit config per client route
- current usage for the resolved usage window
- reset operations for the current window

Suggested types:

```ts
type ClientTokenWindowType = "daily" | "weekly" | "monthly" | "fixed";

type ClientTokenLimitConfig = {
  clientRoute: string;
  enabled: boolean;
  tokenLimit: number;
  windowType: ClientTokenWindowType;
  windowSizeSeconds?: number;
  hardBlock: boolean;
  createdAt: string;
  updatedAt: string;
};

type ClientTokenUsageSnapshot = {
  clientRoute: string;
  windowStart: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  updatedAt: string;
};
```

### Enforcement responsibilities

Add a focused module:

- `src/client-token-limits.ts`

Suggested exported functions:

- `resolveClientTokenWindowStart(now, config)`
- `getClientTokenLimitStatus(config, usage)`
- `buildClientTokenLimitError(client, status)`
- `extractUsageTotals(usagePayload)`

### Request-path responsibilities

In `src/server.ts`:

- resolve `clientRoute`
- run a pre-check before upstream forwarding
- account usage after a successful upstream response
- ensure fallback and stream paths do not double-count

## Commit Checklist

### Commit 1: Add DB schema and repository types

Goal:

- create the persistence primitives without changing request behavior yet

Checklist:

- [ ] add `client_token_limits` table creation in `src/runtime-provider-repository.ts`
- [ ] add `client_token_usage` table creation in `src/runtime-provider-repository.ts`
- [ ] add TypeScript types for config and usage snapshots
- [ ] add helper to normalize supported window types
- [ ] add helper to compute `window_start`
- [ ] add read methods:
  - [ ] `getClientTokenLimit(client)`
  - [ ] `getClientTokenUsage(client, now?)`
  - [ ] `listClientTokenLimitsForUi(now?)`
- [ ] add tests for:
  - [ ] creating and reading a client limit
  - [ ] reading empty usage as zeros
  - [ ] daily/weekly/monthly/fixed window calculation

Files:

- `src/runtime-provider-repository.ts`
- `src/runtime-provider-repository.test.ts`

Acceptance:

- repo can persist and read limit config and usage snapshots
- no runtime request behavior changes yet

### Commit 2: Add repository write paths

Goal:

- support config changes and usage mutation

Checklist:

- [ ] add `setClientTokenLimit(client, config)`
- [ ] add `deleteClientTokenLimit(client)`
- [ ] add `incrementClientTokenUsage(client, usage, now?)`
- [ ] add `resetClientTokenUsage(client, now?)`
- [ ] wrap usage updates in SQL transaction logic
- [ ] clamp invalid negative inputs to safe values
- [ ] add tests for:
  - [ ] upsert config
  - [ ] disabling config
  - [ ] incrementing usage across one window
  - [ ] opening a new window leaves old totals isolated
  - [ ] reset clears only the current window

Files:

- `src/runtime-provider-repository.ts`
- `src/runtime-provider-repository.test.ts`

Acceptance:

- usage can be incremented and reset deterministically

### Commit 3: Add standalone enforcement helpers

Goal:

- isolate quota decision logic from Fastify wiring

Checklist:

- [ ] create `src/client-token-limits.ts`
- [ ] implement:
  - [ ] `resolveClientTokenWindowStart`
  - [ ] `getClientTokenLimitStatus`
  - [ ] `buildClientTokenLimitError`
  - [ ] `extractUsageTotals`
- [ ] define status shape:
  - [ ] `used`
  - [ ] `limit`
  - [ ] `remaining`
  - [ ] `blocked`
  - [ ] `windowStart`
- [ ] add unit tests for:
  - [ ] disabled config
  - [ ] under limit
  - [ ] exactly at limit
  - [ ] above limit
  - [ ] invalid usage payload without `total_tokens`

Files:

- `src/client-token-limits.ts`
- `src/client-token-limits.test.ts`

Acceptance:

- enforcement decisions are testable without hitting the server

### Commit 4: Add read-only admin API

Goal:

- expose current config and usage in a safe read-only form first

Checklist:

- [ ] add `GET /api/client-token-limits`
- [ ] add `GET /api/client-token-limits/:client`
- [ ] include:
  - [ ] client route
  - [ ] limit config
  - [ ] current usage snapshot
  - [ ] derived status
- [ ] return empty/default payload when a client has no limit configured
- [ ] validate unknown client route input cleanly
- [ ] add route tests if the repo has server-level coverage for this area

Files:

- `src/server.ts`

Acceptance:

- dashboard can fetch quota data before write controls exist

### Commit 5: Add write admin API

Goal:

- let operators create, update, and reset limits

Checklist:

- [ ] add `PUT /api/client-token-limits/:client`
- [ ] add `POST /api/client-token-limits/:client/reset`
- [ ] validate request body:
  - [ ] `enabled`
  - [ ] `tokenLimit > 0`
  - [ ] `windowType`
  - [ ] `windowSizeSeconds > 0` only for `fixed`
  - [ ] `hardBlock`
- [ ] return updated config + derived status
- [ ] keep unknown fields ignored or rejected consistently with existing API style
- [ ] add tests for:
  - [ ] create new limit
  - [ ] update existing limit
  - [ ] invalid payloads
  - [ ] reset current usage

Files:

- `src/server.ts`
- optionally `src/schema.ts` if endpoint body schemas are centralized there

Acceptance:

- operator can fully manage per-client limits over HTTP

### Commit 6: Enforce limit before upstream forwarding

Goal:

- block requests when a client already exceeded its quota

Checklist:

- [ ] call limit pre-check after client route resolution
- [ ] apply to JSON path
- [ ] apply to SSE path
- [ ] return `429` with stable proxy error payload
- [ ] use code `CLIENT_TOKEN_LIMIT_EXCEEDED`
- [ ] include useful metadata:
  - [ ] `client`
  - [ ] `used`
  - [ ] `limit`
  - [ ] `windowStart`
- [ ] ensure enforcement respects `FALLBACK_ENABLED` logic without changing route selection
- [ ] add tests for:
  - [ ] blocked JSON request
  - [ ] blocked SSE request
  - [ ] disabled limit does not block

Files:

- `src/server.ts`
- `src/client-token-limits.ts`

Acceptance:

- over-limit clients are rejected before an upstream call is made

### Commit 7: Account usage after successful responses

Goal:

- increase token usage only once per successful request

Checklist:

- [ ] locate final usage extraction point for JSON responses
- [ ] locate final usage extraction point for streaming responses
- [ ] increment usage only when upstream response contains usage totals
- [ ] avoid double counting across fallback paths
- [ ] avoid counting failed upstream attempts
- [ ] if request falls back and succeeds, count only the final successful response
- [ ] add tests for:
  - [ ] JSON success increments usage
  - [ ] stream success increments usage
  - [ ] failed response does not increment usage
  - [ ] fallback success increments once

Files:

- `src/server.ts`
- maybe `src/forward.ts` if response handling is easier to centralize there

Acceptance:

- current window usage matches real successful upstream token usage

### Commit 8: Add dashboard summary display

Goal:

- surface usage clearly before adding form editing

Checklist:

- [ ] fetch `GET /api/client-token-limits`
- [ ] show per-client:
  - [ ] used
  - [ ] limit
  - [ ] remaining
  - [ ] window type
  - [ ] blocked or active state
- [ ] add progress bar or compact visual meter
- [ ] display `Unlimited` when no config exists
- [ ] keep layout responsive in current client screen

Files:

- `public/index.html`
- `public/app.js`
- maybe `public/app.css`

Acceptance:

- operator can see quota posture at a glance

### Commit 9: Add dashboard edit controls

Goal:

- complete the operator flow in the UI

Checklist:

- [ ] add form controls:
  - [ ] enable toggle
  - [ ] token limit input
  - [ ] window type select
  - [ ] fixed-seconds input when needed
  - [ ] hard-block toggle
  - [ ] reset usage button
- [ ] load existing values into the form
- [ ] save via `PUT /api/client-token-limits/:client`
- [ ] reset via `POST /api/client-token-limits/:client/reset`
- [ ] refresh summary after save/reset
- [ ] show inline success and error state

Files:

- `public/index.html`
- `public/app.js`
- maybe `public/app.css`

Acceptance:

- operator can manage token limits entirely from the dashboard

### Commit 10: Polish, docs, and rollout notes

Goal:

- document behavior and edge cases before operators rely on it

Checklist:

- [ ] document the feature in `README.md`
- [ ] add example API payloads
- [ ] describe how stream accounting works
- [ ] describe current limitation around concurrent requests and slight overshoot
- [ ] confirm UI copy matches current product language
- [ ] run full test suite
- [ ] redeploy and verify with a live client

Files:

- `README.md`
- optionally add screenshots or notes to `docs/`

Acceptance:

- feature is understandable and safe to operate

## Suggested File-Level Task Map

### `src/runtime-provider-repository.ts`

- schema
- types
- read/write methods
- current-window usage queries

### `src/runtime-provider-repository.test.ts`

- storage behavior
- reset behavior
- window behavior

### `src/client-token-limits.ts`

- pure logic for windowing and block decisions

### `src/server.ts`

- admin API routes
- pre-check enforcement
- post-response accounting

### `public/index.html`

- usage summary region
- limit edit controls

### `public/app.js`

- fetch, render, save, reset flows

### `README.md`

- operator docs
- rollout notes

## Testing Notes

Minimum verification before merge:

- full test pass
- one manual JSON request under limit
- one manual request over limit returns `429`
- one stream request increments usage
- one fallback request increments usage once only
- one reset action returns client to allowed state

## Rollout Notes

Recommended rollout order:

1. ship storage and admin API
2. ship UI
3. enable enforcement only when a client route actually gets a limit

Recommended first production defaults:

- `enabled=false` unless explicitly configured
- `hardBlock=true`
- use `daily` or `monthly` windows first

## Open Questions

Decide before implementation starts:

1. Should V1 count only `total_tokens`, or display and optionally enforce
   separate input/output quotas later?
2. Should resets clear only the current window, or also delete prior windows if
   historical reporting is added?
3. Should blocked requests still be written to session logs as a special local
   event for audit visibility?
4. Should the UI show percentage-only when limits are large, or always show raw
   values plus percentage?
