# Tasks

## Task 1: Create createOrRecoverProvider helper
- [x] Create new file `client/src/components/accounts/createOrRecoverProvider.ts`
- [x] Implement `CreateOrRecoverInput` interface with `providerId` and `apiKey` fields
- [x] Implement `createOrRecoverProvider` function that calls `createProvider` from `api/client.ts` with catalog-derived payload
- [x] Handle "already exists" error by calling `recoverFromConflict` (AC 3.1)
- [x] Handle "already assigned to another provider" error by throwing a user-friendly message without recovery (AC 3.6)
- [x] Implement `recoverFromConflict` that fetches existing provider via `apiGet`, checks if key is already present (AC 3.3), and appends key via `updateProvider` if not (AC 3.2)
- [x] If recovery update also fails, throw combined error message (AC 3.4)
- [x] Ensure no retry loops — create-then-recover runs at most once (AC 3.5)
- [x] Export `createOrRecoverProvider` and `CreateOrRecoverInput`

## Task 2: Create validateConnection helper
- [x] Create new file `client/src/components/accounts/validateConnection.ts`
- [x] Define and export `ValidationResult` interface with fields: `status` ('success' | 'failed' | 'partial' | 'timeout'), `latencyMs?`, `errorMessage?`, `suggestedFix?`, `checks?` (authOk, quotaOk, modelOk, routingOk)
- [x] Implement `mapTestResultToValidation` function that maps `ProviderTestResult` to `ValidationResult` handling success, partial, and failed statuses
- [x] Implement `validateWithTimeout` function that wraps `testProviderAccount` in a `Promise.race` with a 10-second timeout (AC 2.5, 2.6)
- [x] On timeout, return `{ status: 'timeout' }` (AC 2.6)
- [x] On test failure/error, return `{ status: 'failed', errorMessage, suggestedFix }` (AC 2.3)
- [x] Export `validateWithTimeout`, `ValidationResult`, and `mapTestResultToValidation`

## Task 3: Refactor AccountManagementModal handleCompleteConnection [depends:1]
- [x] Add imports for `createProvider`, `updateProvider`, `importKiroAccounts`, `submitChatGptOAuthCallback`, `apiGet` from `../../api/client`
- [x] Add import for `createOrRecoverProvider` from `./createOrRecoverProvider`
- [x] Replace Kiro import `fetch('/api/kiro/import')` with `importKiroAccounts(importBody)` (AC 1.4)
- [x] Add check: if `importKiroAccounts` returns `imported === 0`, throw descriptive error (AC 1.7)
- [x] Replace OAuth callback `fetch('/api/chatgpt-oauth/callback')` with `submitChatGptOAuthCallback({ redirectUrl: data.callbackUrl })` (AC 1.1)
- [x] Replace provider existence check `fetch(\`/api/providers/${providerId}\`)` with `apiGet(\`/api/providers/${encodeURIComponent(providerId)}\`)` (AC 1.5)
- [x] Replace provider auto-creation branch with `createOrRecoverProvider({ providerId, apiKey: newApiKey })` (AC 1.3)
- [x] Replace provider update `fetch(...PUT)` with `updateProvider(providerId, updatePayload)` (AC 1.2)
- [x] Remove all manual JSON parsing and `.ok` checks — let typed client handle errors (AC 1.6)
- [x] Verify zero `fetch()` references remain in `handleCompleteConnection` (AC 1.8)
- [x] Remove `onClose()` call from success path — keep only `onAccountsChanged()`

## Task 4: Enhance AccountConnectionFlow complete step [depends:2]
- [x] Add `validationResult?: ValidationResult | null` and `validating?: boolean` props to `AccountConnectionFlowProps` interface
- [x] Import `ValidationResult` type from `./validateConnection`
- [x] Refactor `renderCompleteStep()` to show validation states:
  - WHILE `validating === true`: show spinner with "Verifying connection..." text (AC 2.8)
  - WHEN `validationResult.status === 'success'`: show green check + latency in ms (AC 2.2)
  - WHEN `validationResult.status === 'failed'`: show yellow warning with errorMessage and suggestedFix (AC 2.3)
  - WHEN `validationResult.status === 'partial'`: show info notice listing which checks passed (AC 2.4 — show authOk, quotaOk, modelOk, routingOk)
  - WHEN `validationResult.status === 'timeout'`: show yellow warning "Validation timed out. Test manually." (AC 2.6)
- [x] Ensure "Done" button is always visible regardless of validation state (AC 2.7)
- [x] Keep existing success message as fallback when `validationResult` is undefined (backward compat)

## Task 5: Wire validation into AccountManagementModal [depends:3,4]
- [x] Add `validating` and `validationResult` state variables to `AccountManagementModal`
- [x] Import `validateWithTimeout` from `./validateConnection`
- [x] After `handleCompleteConnection` succeeds (after `onAccountsChanged()`), set `validating = true` and call `validateWithTimeout(providerId, accountId)`
- [x] Determine `accountId` based on connection type:
  - API Key: use `api-key-{index}` where index is the last key's position
  - OAuth: extract from `submitChatGptOAuthCallback` response (account.accountId)
  - Kiro: use first account from the import (or skip validation for bulk imports)
- [x] When `validateWithTimeout` resolves, set `validating = false` and `validationResult = result`
- [x] Pass `validating` and `validationResult` props to `AccountConnectionFlow` component
- [x] Reset `validating` and `validationResult` when modal reopens (in the existing `useEffect` cleanup)
- [x] Do NOT close modal on success — let user dismiss via "Done" button after seeing validation

## Task 6: Build verification [depends:5]
- [x] Run `npm run check` and verify zero TypeScript errors
- [x] Run `npm run build` and verify successful build
- [x] Verify no remaining `fetch()` calls in `AccountManagementModal.tsx` `handleCompleteConnection`
- [x] Verify new files exist: `createOrRecoverProvider.ts`, `validateConnection.ts`
