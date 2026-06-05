# Technical Design

## Overview

This design refactors the `handleCompleteConnection` function in `AccountManagementModal.tsx` to replace all raw `fetch()` calls with the typed API client from `client/src/api/client.ts`, adds post-connection validation using the existing `testProviderAccount` function, and introduces a create-with-409-recovery helper to handle race conditions during provider auto-creation.

The approach prioritizes minimal surface area: no new backend endpoints are needed. All changes are client-side, leveraging existing typed functions (`createProvider`, `updateProvider`, `importKiroAccounts`, `submitChatGptOAuthCallback`, `apiGet`) and the existing `testProviderAccount` from `accountApi.ts`.

## Architecture

### Component Changes

#### AccountManagementModal.tsx — handleCompleteConnection Refactor

**Current:** The function uses 5 separate raw `fetch()` calls with manual JSON parsing and error extraction:
- `fetch('/api/kiro/import', { method: 'POST' ... })` for Kiro import
- `fetch('/api/chatgpt-oauth/callback', { method: 'POST' ... })` for OAuth
- `fetch('/api/providers/${providerId}')` to check provider existence
- `fetch('/api/providers', { method: 'POST' ... })` to auto-create
- `fetch('/api/providers/${providerId}', { method: 'PUT' ... })` to update keys

**New:** Each branch maps directly to a typed API client function:

| Current raw fetch | Replacement function | Import from |
|---|---|---|
| `POST /api/kiro/import` | `importKiroAccounts(input?)` | `api/client.ts` |
| `POST /api/chatgpt-oauth/callback` | `submitChatGptOAuthCallback({ redirectUrl })` | `api/client.ts` |
| `GET /api/providers/${id}` | `apiGet<ProviderMutationResponse>(\`/api/providers/${id}\`)` | `api/client.ts` |
| `POST /api/providers` | `createProvider(input)` | `api/client.ts` |
| `PUT /api/providers/${id}` | `updateProvider(providerId, input)` | `api/client.ts` |

**Key mismatch to resolve:** `submitChatGptOAuthCallback` currently expects `{ redirectUrl: string }` but the modal sends `{ callbackUrl, state }`. The callback URL from the user IS the redirect URL — it's the URL the browser was redirected to after OAuth. The `state` parameter is embedded in the callback URL as a query param and is extracted server-side. So the fix is:

```typescript
// Before (raw fetch):
body: JSON.stringify({ callbackUrl: data.callbackUrl, state: data.state })

// After (typed client):
await submitChatGptOAuthCallback({ redirectUrl: data.callbackUrl });
```

The server already extracts `state` from the redirect URL query parameters. The explicit `state` field sent today is ignored by the backend.

**Error handling simplification:** The typed `apiSend` already throws an `Error` with the server's error message extracted from `payload.error.message`. No manual `response.ok` checks or `errBody` parsing needed — errors propagate naturally as thrown Error objects.

#### AccountConnectionFlow.tsx — Validation Step Enhancement

**Current:** The `renderCompleteStep()` shows a static "Connection Successful" message with a "Done" button.

**New:** The complete step becomes a validation state machine:

```
verifying → success | warning | timeout
```

States rendered in the complete step:
1. **verifying** — Spinner + "Verifying connection..." text
2. **success** — Green check + latency display (e.g., "Connected successfully (142ms)")
3. **warning** — Yellow alert + error message + suggested fix + "Done" button
4. **timeout** — Yellow alert + "Validation timed out. Test manually." + "Done" button

The validation result and loading state are passed down as props from the parent modal, which triggers validation after `handleCompleteConnection` succeeds.

#### New Helper: `createOrRecoverProvider`

Location: `client/src/components/accounts/createOrRecoverProvider.ts`

```typescript
import { apiGet, createProvider, updateProvider } from "../../api/client";
import { getProviderById } from "../../features/providers/providerCatalog";
import type { ProviderMutationInput } from "../../api/types";

interface CreateOrRecoverInput {
  providerId: string;
  apiKey: string;
}

/**
 * Creates a provider with the given API key. If a 409 "already exists" conflict
 * occurs, fetches the existing provider and appends the key if not already present.
 *
 * Throws on "already assigned to another provider" errors without recovery.
 * Attempts create-then-recover at most once (no retry loop).
 */
export async function createOrRecoverProvider({ providerId, apiKey }: CreateOrRecoverInput): Promise<void> {
  const catalogEntry = getProviderById(providerId);
  if (!catalogEntry) {
    throw new Error(`Provider ${providerId} not found in catalog.`);
  }

  const createPayload: ProviderMutationInput = {
    name: catalogEntry.name,
    baseUrl: catalogEntry.defaultBaseUrl || "https://api.example.com",
    authMode: "api_key",
    providerApiKeys: [apiKey],
    capabilities: { transportMode: "chat_completions" },
  };

  try {
    await createProvider(createPayload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // AC 3.6: Key already registered to a different provider — no recovery
    if (message.includes("already assigned to another provider")) {
      throw new Error(
        `This API key is already registered with a different provider. Remove it from that provider first.`
      );
    }

    // AC 3.1: 409 conflict — provider already exists
    if (message.includes("already exists")) {
      await recoverFromConflict(providerId, apiKey);
      return;
    }

    // Unknown creation error
    throw err;
  }
}

async function recoverFromConflict(providerId: string, apiKey: string): Promise<void> {
  // AC 3.1: Fetch existing provider
  const response = await apiGet<{ ok: boolean; provider: any }>(
    `/api/providers/${encodeURIComponent(providerId)}`
  );
  const existing = response.provider;

  if (!existing) {
    throw new Error(`Provider ${providerId} reported as existing but could not be fetched.`);
  }

  const existingKeys: string[] = Array.isArray(existing.providerApiKeys)
    ? existing.providerApiKeys
    : [];

  // AC 3.3: Key already present — treat as success
  if (existingKeys.includes(apiKey)) {
    return;
  }

  // AC 3.2: Append the new key
  try {
    await updateProvider(providerId, {
      name: existing.name,
      baseUrl: existing.baseUrl,
      authMode: existing.authMode,
      providerApiKeys: [...existingKeys, apiKey],
      capabilities: existing.capabilities,
    });
  } catch (recoveryErr) {
    // AC 3.4: Both create and recovery failed
    const reason = recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr);
    throw new Error(`Failed to add API key to existing provider: ${reason}`);
  }
}
```

### Data Flow

#### API Key Connection Flow (after refactor)

```
1. User enters API key → handleCompleteApiKey() in AccountConnectionFlow
2. onCompleteConnection({ apiKey, keyName }) called → handleCompleteConnection in modal
3. Check if provider exists:
     apiGet<{ok, provider}>(`/api/providers/${providerId}`)
     - If throws (404/network): providerExists = false
     - If returns with provider: providerExists = true
4a. Provider exists → append key via updateProvider(providerId, {..., providerApiKeys: [...existing, newKey]})
4b. Provider does not exist → createOrRecoverProvider({ providerId, apiKey })
5. On success → set validationResult state, trigger health check
6. Pass validationResult + validating to AccountConnectionFlow as props
7. AccountConnectionFlow renders complete step with validation status
```

#### OAuth Connection Flow (after refactor)

```
1. User pastes callback URL → handleCompleteOAuth() in AccountConnectionFlow
2. onCompleteConnection({ callbackUrl, state }) called
3. handleCompleteConnection calls:
     await submitChatGptOAuthCallback({ redirectUrl: data.callbackUrl })
4. On success → determine accountId from response
5. Trigger validation: testProviderAccount(providerId, accountId)
6. Pass result to AccountConnectionFlow
```

#### Kiro Import Flow (after refactor)

```
1. User clicks "Import Accounts" → handleCompleteKiroImport()
2. onCompleteConnection({ kiroImport: true, sourcePath? }) called
3. handleCompleteConnection calls:
     const result = await importKiroAccounts(sourcePath ? { sourcePath } : undefined)
4. Check: if result.imported === 0, throw error
5. On success → trigger validation against first imported account
6. Pass result to AccountConnectionFlow
```

### Validation Flow Detail

#### Determining providerId and accountId for each auth type

| Auth Type | providerId | accountId |
|---|---|---|
| API Key | Already known from modal props | `api-key-0` (convention from `accountApi.ts` mapping) |
| OAuth | Already known from modal props | Extracted from `ChatGptOAuthCallbackResponse.account.accountId` |
| Kiro | Already known from modal props | Fetch via `getKiroAccounts()` and use first active account |

#### Timeout implementation

```typescript
async function validateWithTimeout(
  providerId: string,
  accountId: string,
  timeoutMs: number = 10_000
): Promise<ValidationResult> {
  const testPromise = testProviderAccount(providerId, accountId);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('__TIMEOUT__')), timeoutMs)
  );

  try {
    const result = await Promise.race([testPromise, timeoutPromise]);
    return mapTestResultToValidation(result);
  } catch (err) {
    if (err instanceof Error && err.message === '__TIMEOUT__') {
      return { status: 'timeout' };
    }
    return {
      status: 'failed',
      errorMessage: err instanceof Error ? err.message : 'Validation failed',
      suggestedFix: 'Try testing the connection manually from the accounts list.',
    };
  }
}

function mapTestResultToValidation(result: ProviderTestResult): ValidationResult {
  if (result.status === 'success') {
    return {
      status: 'success',
      latencyMs: result.latencyMs,
      checks: {
        authOk: result.authOk,
        quotaOk: result.quotaOk,
        modelOk: result.modelOk,
        routingOk: result.routingOk,
      },
    };
  }

  if (result.status === 'partial') {
    return {
      status: 'partial',
      latencyMs: result.latencyMs,
      checks: {
        authOk: result.authOk,
        quotaOk: result.quotaOk,
        modelOk: result.modelOk,
        routingOk: result.routingOk,
      },
    };
  }

  return {
    status: 'failed',
    errorMessage: result.errorMessage,
    suggestedFix: result.suggestedFix,
    checks: {
      authOk: result.authOk,
      quotaOk: result.quotaOk,
      modelOk: result.modelOk,
      routingOk: result.routingOk,
    },
  };
}
```

#### UI state transitions in the complete step

```
handleCompleteConnection succeeds
  → setValidating(true), setValidationResult(null)
  → AccountConnectionFlow renders complete step with spinner

validateWithTimeout resolves
  → setValidating(false), setValidationResult(result)
  → AccountConnectionFlow renders success/warning/timeout based on result.status
```

The "Done" button is always shown regardless of validation state, so the user can dismiss even while validation is running.

### Error Handling

#### How 409 recovery works step by step

1. `createProvider(payload)` is called
2. Backend returns 409 with `{ error: { message: "Provider ... already exists" } }`
3. `apiSend` throws `Error("Provider ... already exists")`
4. `createOrRecoverProvider` catches, checks `message.includes("already exists")`
5. Calls `apiGet` to fetch the existing provider
6. Checks if the API key is already in `providerApiKeys`
7. If not, calls `updateProvider` to append the key
8. If `updateProvider` also fails, throws with the recovery error message (AC 3.4)
9. The entire sequence runs at most once — no retry loop (AC 3.5)

#### How API client errors propagate vs current manual parsing

**Current (raw fetch):**
```typescript
const res = await fetch(url, { method: 'POST', ... });
if (!res.ok) {
  const errBody = await res.json().catch(() => ({}));
  throw new Error(errBody.error?.message || 'Fallback message');
}
```

**After (typed client):**
```typescript
await createProvider(payload);
// apiSend internally does: throw new Error(payload?.error?.message || `POST /api/providers failed: 409`)
// Error propagates directly to handleCompleteConnection's catch block
```

The typed client's `apiSend` already performs the exact same error extraction logic internally. The `handleCompleteConnection` catch block just re-throws, letting `AccountConnectionFlow` display the error via `localError` state.

#### How validation failures are non-blocking

Validation runs AFTER `onAccountsChanged()` is called, so the account list is already refreshed. The `AccountConnectionFlow` shows the validation result in the complete step but always provides a "Done" button. A validation failure does not revert the saved connection — it's purely informational (AC 2.7).

## Interface Changes

### New Props for AccountConnectionFlow

```typescript
interface AccountConnectionFlowProps {
  providerId: string;
  authType: ProviderAuthType;
  connectionFlow: ConnectionFlow | null;
  connecting: boolean;
  error: string | null;
  onStartConnection: (authType: ProviderAuthType) => Promise<void>;
  onCompleteConnection: (data: any) => Promise<void>;
  onCancel: () => void;
  // NEW: validation props passed from parent after connection succeeds
  validationResult?: ValidationResult | null;
  validating?: boolean;
}

interface ValidationResult {
  status: 'success' | 'failed' | 'partial' | 'timeout';
  latencyMs?: number;
  errorMessage?: string;
  suggestedFix?: string;
  checks?: {
    authOk: boolean;
    quotaOk: boolean;
    modelOk: boolean;
    routingOk: boolean;
  };
}
```

### Updated handleCompleteConnection signature (no external change)

The function signature stays the same (`async (data: any) => Promise<void>`), but the internal body is fully replaced. It no longer calls `onClose()` on success — instead it triggers validation, and the "Done" button in the complete step calls `onCancel` (which maps to `onClose`).

### Updated submitChatGptOAuthCallback usage

The existing function signature:
```typescript
export function submitChatGptOAuthCallback(input: { redirectUrl: string }) {
  return apiSend<ChatGptOAuthCallbackResponse>("/api/chatgpt-oauth/callback", "POST", input);
}
```

The modal currently sends `{ callbackUrl, state }` via raw fetch. Resolution:
- The `callbackUrl` IS the redirect URL (the full URL the browser landed on after OAuth redirect)
- The `state` parameter is embedded in the URL's query string and extracted server-side
- Simply pass: `submitChatGptOAuthCallback({ redirectUrl: data.callbackUrl })`

No change to the `submitChatGptOAuthCallback` function itself is needed.

## Key Decisions

1. **Validation is triggered by the parent** (`AccountManagementModal`) after `handleCompleteConnection` succeeds, then passed down as props. This keeps `AccountConnectionFlow` a pure presentation component.

2. **The 409 recovery logic lives in a standalone helper function** (`createOrRecoverProvider`) for testability and reuse. It's a pure async function with no React dependencies.

3. **No new backend endpoints needed** — all existing APIs are sufficient:
   - `POST /api/providers` (create)
   - `PUT /api/providers/:id` (update)
   - `GET /api/providers/:id` (fetch for recovery)
   - `POST /api/chatgpt-oauth/callback` (OAuth)
   - `POST /api/kiro/import` (Kiro)
   - `POST /api/account-auth/accounts/:id/test` (validation)
   - `POST /api/providers/:id/test` (API key validation)

4. **The modal no longer calls `onClose()` immediately on success.** Instead, it calls `onAccountsChanged()` and transitions to the complete step. The user dismisses via the "Done" button after seeing validation results.

5. **Validation timeout is 10 seconds** (AC 2.6). Uses `Promise.race` pattern — simple, no external dependencies.

6. **`importKiroAccounts` return value is checked for `imported === 0`** and throws a descriptive error (AC 1.7). The typed response type `KiroImportResponse` already includes the `imported` field.

## Components and Interfaces

### ValidationResult Type (new)

```typescript
// Location: client/src/components/accounts/validateConnection.ts
export interface ValidationResult {
  status: 'success' | 'failed' | 'partial' | 'timeout';
  latencyMs?: number;
  errorMessage?: string;
  suggestedFix?: string;
  checks?: {
    authOk: boolean;
    quotaOk: boolean;
    modelOk: boolean;
    routingOk: boolean;
  };
}
```

### CreateOrRecoverInput Type (new)

```typescript
// Location: client/src/components/accounts/createOrRecoverProvider.ts
export interface CreateOrRecoverInput {
  providerId: string;
  apiKey: string;
}
```

### AccountConnectionFlowProps (extended)

```typescript
interface AccountConnectionFlowProps {
  providerId: string;
  authType: ProviderAuthType;
  connectionFlow: ConnectionFlow | null;
  connecting: boolean;
  error: string | null;
  onStartConnection: (authType: ProviderAuthType) => Promise<void>;
  onCompleteConnection: (data: any) => Promise<void>;
  onCancel: () => void;
  // NEW
  validationResult?: ValidationResult | null;
  validating?: boolean;
}
```

### Existing types used (no changes)

- `ProviderMutationInput` from `client/src/api/types.ts`
- `ProviderTestResult` from `client/src/features/providers/providerTypes.ts`
- `ChatGptOAuthCallbackResponse` from `client/src/api/types.ts`
- `KiroImportResponse` from `client/src/api/types.ts`

## Data Models

No new data models or database schema changes. All data flows use existing backend API response shapes:

- **Provider**: `{ id, name, baseUrl, authMode, providerApiKeys, capabilities, ... }` — from `GET/POST/PUT /api/providers`
- **KiroImportResult**: `{ ok, imported, sourcePath, destPath }` — from `POST /api/kiro/import`
- **OAuthCallbackResult**: `{ ok, account, provider, accounts, providers }` — from `POST /api/chatgpt-oauth/callback`
- **ProviderTestResult**: `{ providerId, accountId, status, latencyMs, authOk, quotaOk, modelOk, routingOk, errorMessage, suggestedFix }` — from `testProviderAccount()`

## Error Handling

### Error propagation strategy

All errors from the typed API client (`apiSend`, `apiGet`) throw standard `Error` objects with server-provided messages. The `handleCompleteConnection` function:

1. Catches errors and re-throws them to let `AccountConnectionFlow` display via its `localError` state
2. Does NOT perform manual JSON parsing or status code checks — the typed client handles this
3. For 409 conflicts, delegates to `createOrRecoverProvider` which has its own try/catch with specific message matching

### Error categories

| Error Source | Handling |
|---|---|
| `apiSend` throws (network/server error) | Error.message propagated to UI |
| 409 "already exists" | Recovery via fetch + update |
| 409 "already assigned to another provider" | User-friendly message, no retry |
| Validation timeout (10s) | Non-blocking warning shown |
| Validation failure | Non-blocking warning with suggestedFix |
| `importKiroAccounts` returns `imported: 0` | Throw descriptive error |

## Testing Strategy

### Unit tests for helpers

- `createOrRecoverProvider.test.ts`:
  - Test successful creation (no conflict)
  - Test 409 recovery (fetch existing + append key)
  - Test key already present (no-op)
  - Test "already assigned to another provider" error
  - Test double failure (create fails + recovery fails)

- `validateConnection.test.ts`:
  - Test success mapping from ProviderTestResult
  - Test failure mapping
  - Test partial mapping
  - Test timeout (mock timers)

### Integration verification

- Verify `AccountManagementModal` has zero `fetch()` references after refactor
- Verify all three flows (API key, OAuth, Kiro) call the correct typed client functions
- Verify validation props are passed to `AccountConnectionFlow`
- Verify "Done" button is always present regardless of validation state

## Files Modified

| File | Change Type | Description |
|---|---|---|
| `client/src/components/accounts/AccountManagementModal.tsx` | Major refactor | Replace all fetch() calls with typed client; add validation state management; stop calling onClose() on success |
| `client/src/components/accounts/AccountConnectionFlow.tsx` | Enhancement | Add `validationResult` and `validating` props; refactor `renderCompleteStep()` to show validation states |
| `client/src/components/accounts/createOrRecoverProvider.ts` | New file | Standalone helper for create-with-409-recovery logic |
| `client/src/components/accounts/validateConnection.ts` | New file | `validateWithTimeout` helper + `ValidationResult` type + `mapTestResultToValidation` |
