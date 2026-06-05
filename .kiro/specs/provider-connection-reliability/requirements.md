# Requirements Document

## Introduction

This feature improves the reliability of the provider connection flow in the responses-proxy dashboard. The `AccountManagementModal` currently uses raw `fetch()` calls instead of the typed API client, lacks post-connection validation, and has a race condition when auto-creating providers. This spec addresses all three issues to make the connection flow consistent, self-verifying, and resilient to concurrent operations.

## Glossary

- **Connection_Handler**: The `handleCompleteConnection` function in `AccountManagementModal.tsx` that orchestrates saving a new account (OAuth callback, API key, or Kiro import) to the backend.
- **API_Client**: The typed helper functions (`apiGet`, `apiSend`, `createProvider`, `updateProvider`, `importKiroAccounts`, `submitChatGptOAuthCallback`) exported from `client/src/api/client.ts`.
- **Health_Check**: A lightweight validation request sent to the provider after a connection is saved, to confirm the credentials actually work.
- **Provider_Repository**: The backend `RuntimeProviderRepository` that manages CRUD operations for providers in SQLite.
- **Catalog_Entry**: A static metadata record from `providerCatalog.ts` describing a provider's defaults (name, base URL, auth type).
- **Connection_Flow_UI**: The multi-step wizard rendered by `AccountConnectionFlow.tsx` that guides the user through connecting an account.

## Requirements

### Requirement 1: Unify API Calls with Typed Client

**User Story:** As a developer, I want all provider connection API calls to use the typed API client, so that error handling is consistent and future middleware (auth headers, retry logic) applies automatically.

#### Acceptance Criteria

1. WHEN the Connection_Handler processes an OAuth callback, THE Connection_Handler SHALL use `submitChatGptOAuthCallback` from the API_Client instead of a raw `fetch()` call
2. WHEN the Connection_Handler adds an API key to an existing provider, THE Connection_Handler SHALL use `updateProvider` from the API_Client instead of a raw `fetch()` PUT call
3. WHEN the Connection_Handler auto-creates a new provider, THE Connection_Handler SHALL use `createProvider` from the API_Client instead of a raw `fetch()` POST call
4. WHEN the Connection_Handler imports Kiro accounts, THE Connection_Handler SHALL use `importKiroAccounts` from the API_Client instead of a raw `fetch()` POST call
5. WHEN the Connection_Handler checks if a provider exists, THE Connection_Handler SHALL use `apiGet` from the API_Client instead of a raw `fetch()` GET call
6. IF the API_Client throws an error during any connection operation, THEN THE Connection_Handler SHALL propagate the error message from the thrown Error object to the calling UI component without performing additional JSON parsing or manual response status checks
7. IF `importKiroAccounts` from the API_Client returns a successful response with an `imported` count of 0, THEN THE Connection_Handler SHALL throw an error indicating that no accounts were found in the source database
8. WHEN any connection operation completes successfully, THE Connection_Handler SHALL contain zero direct references to the `fetch()` API within the `handleCompleteConnection` function

### Requirement 2: Post-Connection Validation

**User Story:** As a user, I want the system to automatically verify my new connection works after saving it, so that I know immediately if my API key is invalid or my OAuth token is expired.

#### Acceptance Criteria

1. WHEN a connection is successfully saved (API key, OAuth, or Kiro import), THE Connection_Flow_UI SHALL automatically trigger a Health_Check against the newly connected account within 500ms of the save completing
2. WHEN the Health_Check returns a `ProviderTestResult` with status "success", THE Connection_Flow_UI SHALL display a success indicator with the measured `latencyMs` value in milliseconds
3. WHEN the Health_Check returns a `ProviderTestResult` with status "failed", THE Connection_Flow_UI SHALL display a warning message showing the `errorMessage` and `suggestedFix` from the result, and indicate that the connection was saved but validation failed
4. WHEN the Health_Check returns a `ProviderTestResult` with status "partial", THE Connection_Flow_UI SHALL display an informational notice indicating that some checks passed (listing which of `authOk`, `quotaOk`, `modelOk`, `routingOk` are true) while others did not
5. THE Health_Check SHALL use the existing `testProviderAccount` function from `accountApi.ts`
6. THE Health_Check SHALL be wrapped in a timeout of 10 seconds; IF the timeout elapses, THEN THE Connection_Flow_UI SHALL display a warning that validation timed out and the user should test manually
7. IF the Health_Check times out or fails, THEN THE Connection_Flow_UI SHALL still treat the connection as saved and allow the user to dismiss the modal via a "Done" button
8. WHILE the Health_Check is running, THE Connection_Flow_UI SHALL display a spinner/loading indicator in the completion step with the text "Verifying connection..."

### Requirement 3: Race Condition Recovery on Provider Auto-Creation

**User Story:** As a user adding an API key to a provider that does not yet exist on the backend, I want the system to handle conflicts gracefully, so that my key is saved even if another request created the provider simultaneously.

#### Acceptance Criteria

1. WHEN `createProvider` throws an error whose message contains "already exists" (matching the `PROVIDER_ALREADY_EXISTS` server error), THE Connection_Handler SHALL fetch the existing provider by calling `apiGet` with the provider's ID path (`/api/providers/{providerId}`)
2. WHEN the existing provider is fetched after a 409 conflict, THE Connection_Handler SHALL check whether the new API key is already present in the provider's `providerApiKeys` array; IF it is not present, THEN THE Connection_Handler SHALL append the new API key to the existing provider using `updateProvider`
3. IF the new API key is already present in the fetched provider's `providerApiKeys` array, THEN THE Connection_Handler SHALL treat the operation as successful without calling `updateProvider`
4. IF both the initial `createProvider` call and the subsequent `updateProvider` recovery call fail, THEN THE Connection_Handler SHALL display an error message that includes the reason from the recovery failure
5. THE Connection_Handler SHALL attempt the create-then-recover sequence at most once (no repeated create or fetch-and-update cycles)
6. WHEN `createProvider` throws an error whose message contains "already assigned to another provider" (matching the `PROVIDER_API_KEY_ALREADY_EXISTS` server error), THE Connection_Handler SHALL display an error message indicating the key is registered with a different provider and SHALL NOT attempt recovery
