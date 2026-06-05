# Implementation Plan: Kiro OAuth Device Login

## Overview

Implement the AWS SSO-OIDC Device Authorization Grant (RFC 8628) for connecting Kiro accounts from the responses-proxy dashboard. The implementation adds a backend service module, two API routes, client API functions, and a UI flow step — all in TypeScript.

## Tasks

- [x] 1. Add configuration environment variables
  - [x] 1.1 Add KIRO_DEVICE_CLIENT_NAME, KIRO_BUILDER_ID_START_URL, and KIRO_DEVICE_SCOPES to envSchema in `src/config.ts`
    - `KIRO_DEVICE_CLIENT_NAME`: z.string().min(1).default("responses-proxy")
    - `KIRO_BUILDER_ID_START_URL`: z.string().min(1).default("https://view.awsapps.com/start")
    - `KIRO_DEVICE_SCOPES`: z.string().min(1).default("codewhisperer:completions,codewhisperer:analysis").transform(split by comma, trim, filter empty)
    - _Requirements: 6.3_

  - [x] 1.2 Add new config keys with defaults to `.env.example`
    - Add `KIRO_DEVICE_CLIENT_NAME=responses-proxy`, `KIRO_BUILDER_ID_START_URL=https://view.awsapps.com/start`, `KIRO_DEVICE_SCOPES=codewhisperer:completions,codewhisperer:analysis`
    - _Requirements: 6.3_

- [x] 2. Create kiro-device-login.ts backend module
  - [x] 2.1 Define types and interfaces in `src/kiro-device-login.ts`
    - Export `DeviceLoginAuthMethod`, `StartDeviceLoginInput`, `StartDeviceLoginResult`, `PollStatus`, `PollDeviceLoginResult`, `DeviceSession`, `RegistrationCacheEntry`, `DeviceLoginServiceDeps`
    - _Requirements: 2.2, 2.3, 3.2, 3.3, 3.4, 3.5, 3.7_

  - [x] 2.2 Implement registration cache DDL and helpers in `src/kiro-device-login.ts`
    - Create `kiro_registration_cache` table (region, startUrl, clientId, clientSecret, clientSecretExpiresAt, createdAt) with PRIMARY KEY (region, startUrl)
    - Implement `getRegistrationCache(db, region, startUrl)` — returns cached entry if not expired
    - Implement `setRegistrationCache(db, entry)` — upserts the cache row
    - _Requirements: 1.3, 1.4_

  - [x] 2.3 Implement DeviceLoginService constructor and session management
    - Initialize `sessions: Map<string, DeviceSession>`
    - Implement `pruneExpiredSessions()` — removes sessions where `expiresAt < Date.now()`
    - _Requirements: 3.5_

  - [x] 2.4 Implement `startDeviceLogin` method
    - Validate IDC inputs: reject empty/whitespace startUrl or region
    - Resolve Builder ID defaults from config
    - Check registration cache; on miss or expired, call RegisterClient with correct body (include issuerUrl/grantTypes for IDC)
    - Store registration result in cache
    - Call StartDeviceAuthorization with clientId, clientSecret, startUrl
    - Create DeviceSession with crypto.randomUUID(), compute expiresAt
    - Return sessionId, userCode, verificationUri, verificationUriComplete, expiresIn, interval
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 2.5 Implement `pollDeviceLogin` method
    - Lookup session by sessionId; return not-found if missing
    - Check expiry; return "expired" if past
    - Enforce rate limit (lastPollAt + interval*1000 > now → return current status without calling OIDC)
    - Call CreateToken with clientId, clientSecret, deviceCode, grantType
    - Handle authorization_pending → return pending with current interval
    - Handle slow_down → increment interval by 5, return pending with new interval
    - Handle success → persist account, mark session completed, return account info
    - Handle terminal errors → mark session error, return error code/message
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 2.6 Implement account persistence logic
    - On successful CreateToken, write Account_Record to KIRO_DB_PATH providerConnections table
    - Set provider="kiro", Data_JSON with accessToken, refreshToken, expiresAt (computed), expiresIn, providerSpecificData (clientId, clientSecret, region, authMethod, startUrl, profileArn=null)
    - Set id=UUID, isActive=1, priority=positive integer, createdAt/updatedAt
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

- [x] 3. Add server routes
  - [x] 3.1 Add POST /api/kiro/device/start route in `src/server.ts`
    - Guard: reject with 409 if KIRO_ENABLED is false
    - Guard: reject with 409 if KIRO_WRITE_BACK_ENABLED is false
    - Parse body (authMethod, startUrl?, region?)
    - Call `deviceLoginService.startDeviceLogin(input)`
    - Return structured success or error response
    - _Requirements: 6.1, 6.2, 8.3_

  - [x] 3.2 Add POST /api/kiro/device/poll route in `src/server.ts`
    - Guard: reject with 409 if KIRO_ENABLED is false
    - Parse body (sessionId)
    - Call `deviceLoginService.pollDeviceLogin(sessionId)`
    - Return structured response (pending/completed/expired/error)
    - Unknown/completed session returns 404
    - _Requirements: 8.2, 8.3_

  - [x] 3.3 Instantiate DeviceLoginService in server startup
    - Create service instance with config and dbPath
    - Ensure secrets are excluded from all error responses and logs
    - _Requirements: 9.1, 9.2_

- [x] 4. Checkpoint - Backend verification
  - Ensure `npm run check` passes with no new type errors in `src/`.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add client API functions and types
  - [x] 5.1 Add types to `client/src/api/types.ts`
    - Export `KiroDeviceStartInput`, `KiroDeviceStartResponse`, `KiroDevicePollResponse`
    - _Requirements: 7.7_

  - [x] 5.2 Add API functions to `client/src/api/client.ts`
    - `startKiroDeviceLogin(input: KiroDeviceStartInput)` → POST /api/kiro/device/start
    - `pollKiroDeviceLogin(sessionId: string)` → POST /api/kiro/device/poll
    - Use existing `apiSend` helper pattern
    - _Requirements: 7.7_

- [x] 6. Enhance AccountConnectionFlow UI
  - [x] 6.1 Add 'device_login' step to FlowStep type in `AccountConnectionFlow.tsx`
    - Add to the existing step union type
    - _Requirements: 7.1_

  - [x] 6.2 Implement auth method picker UI
    - Render Builder ID vs IDC choice
    - For IDC: show startUrl and region text inputs
    - On submit: call `startKiroDeviceLogin` via typed API client
    - _Requirements: 7.1, 7.2, 7.7_

  - [x] 6.3 Implement user code display and polling UI
    - Display userCode prominently after start succeeds
    - Render verificationUriComplete as a clickable link
    - Show polling spinner with "Waiting for browser approval..." text
    - Poll at server-returned interval using `pollKiroDeviceLogin`
    - _Requirements: 7.3, 7.4_

  - [x] 6.4 Implement completion and error handling in device_login step
    - On "completed" status: transition to complete step, show connected account
    - On "expired" or "error" status: stop polling, display error/expiry message inline
    - _Requirements: 7.5, 7.6_

- [x] 7. Checkpoint - Full build verification
  - Ensure `npm run check` passes.
  - Ensure `npm run build` completes successfully.
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Write property-based tests
  - [ ]* 8.1 Set up test file and fast-check generators in `src/__tests__/kiro-device-login.prop.test.ts`
    - Create `arbDeviceSession()`, `arbRegistrationResponse()`, `arbTokenResponse()`, `arbOidcErrorCode()`, `arbRegionStartUrl()`, `arbWhitespaceString()` generators
    - _Requirements: 1.3, 1.4, 3.3, 3.4, 3.5, 3.7_

  - [ ]* 8.2 Write property test: Registration cache round-trip
    - **Property 1: Registration cache round-trip**
    - **Validates: Requirements 1.3, 1.4**

  - [ ]* 8.3 Write property test: authorization_pending keeps session pending
    - **Property 5: authorization_pending keeps session pending**
    - **Validates: Requirements 3.3**

  - [ ]* 8.4 Write property test: slow_down increases interval by exactly 5
    - **Property 6: slow_down increases interval by exactly 5 seconds**
    - **Validates: Requirements 3.4**

  - [ ]* 8.5 Write property test: Expired session rejects polling
    - **Property 7: Expired session rejects polling**
    - **Validates: Requirements 3.5**

  - [ ]* 8.6 Write property test: Terminal error transitions to error state
    - **Property 8: Terminal OIDC error transitions session to error state**
    - **Validates: Requirements 3.7**

  - [ ]* 8.7 Write property test: Polling rate limit enforcement
    - **Property 9: Polling rate limit enforcement**
    - **Validates: Requirements 3.6**

  - [ ]* 8.8 Write property test: IDC validation rejects empty startUrl/region
    - **Property 10: IDC validation rejects empty startUrl or region**
    - **Validates: Requirements 4.3, 4.4**

  - [ ]* 8.9 Write property test: Account persistence fields
    - **Property 11: Account persistence on successful completion**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

  - [ ]* 8.10 Write property test: Error response structure invariant
    - **Property 12: Error responses have consistent structure**
    - **Validates: Requirements 8.3**

  - [ ]* 8.11 Write property test: No secrets in API responses
    - **Property 13: No secrets in API responses**
    - **Validates: Requirements 9.2**

- [ ] 9. Write unit tests
  - [ ]* 9.1 Write unit tests in `src/__tests__/kiro-device-login.test.ts`
    - Builder ID parameter resolution (uses configured defaults)
    - IDC parameter pass-through
    - Full happy-path flow with mocked OIDC (register → authorize → poll → account persisted)
    - KIRO_ENABLED / KIRO_WRITE_BACK_ENABLED gate checks (409 responses)
    - Unknown/completed session poll returns 404
    - RegisterClient error → structured error response
    - Network timeout handling
    - Registration cache SQLite read/write cycle
    - _Requirements: 1.1, 1.2, 1.4, 2.1, 3.2, 4.1, 4.2, 6.1, 6.2, 8.1, 8.2_

- [x] 10. Final checkpoint - Full test suite
  - Ensure `npm run check` passes.
  - Ensure `npm run build` completes successfully.
  - Ensure `npm test` passes with all new tests green.
  - Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The project uses Vitest for testing and fast-check for property-based tests
- Backend typecheck covers `src/` only; client is transpile-only (known tech debt)
- All API calls from the client MUST use the typed API client — no direct `fetch()`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3"] },
    { "id": 3, "tasks": ["2.4"] },
    { "id": 4, "tasks": ["2.5", "2.6"] },
    { "id": 5, "tasks": ["3.1", "3.2", "3.3"] },
    { "id": 6, "tasks": ["5.1", "5.2"] },
    { "id": 7, "tasks": ["6.1"] },
    { "id": 8, "tasks": ["6.2", "6.3"] },
    { "id": 9, "tasks": ["6.4"] },
    { "id": 10, "tasks": ["8.1", "9.1"] },
    { "id": 11, "tasks": ["8.2", "8.3", "8.4", "8.5", "8.6", "8.7", "8.8", "8.9", "8.10", "8.11"] }
  ]
}
```
