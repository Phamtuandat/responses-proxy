# Requirements Document

## Introduction

The responses-proxy project can currently connect Kiro (AWS CodeWhisperer) accounts only by importing them from an existing 9router SQLite database; the proxy itself merely refreshes tokens it inherited. This feature adds a first-class OAuth2 login using the AWS SSO-OIDC Device Authorization Grant (RFC 8628), allowing users to connect Kiro accounts directly from the responses-proxy dashboard.

The Device Authorization Grant performs three calls against `https://oidc.{region}.amazonaws.com`: register a client, start device authorization (yielding a user code and verification URI), and poll the token endpoint until the user completes browser-based approval. The feature supports both AWS Builder ID accounts (personal, fixed region, well-known start URL) and IAM Identity Center (IDC) accounts (enterprise, user-supplied start URL and region).

On success, the resulting account is persisted into the same `providerConnections` schema already used by `kiro-token-store.ts` and `kiro-import.ts`, so the existing token-refresh and request-forwarding paths work without modification. All persistence targets the proxy-owned Kiro database (`KIRO_DB_PATH`), never the live 9router database. Client secrets and tokens are never logged or returned to the browser in full.

## Glossary

- **Device_Login_Service**: The backend component that orchestrates the AWS SSO-OIDC Device Authorization Grant (client registration, device authorization start, and token polling) and persists the resulting account.
- **OIDC_Endpoint**: The AWS SSO-OIDC HTTPS service at `https://oidc.{region}.amazonaws.com`, exposing `/client/register`, `/device_authorization`, and `/token`.
- **Registration_Cache**: A persistent store of `clientId`/`clientSecret`/`clientSecretExpiresAt` keyed by registration parameters, reused across logins until expiry.
- **Device_Session**: Server-side state for one in-progress device login, holding `deviceCode`, `clientId`, `clientSecret`, `interval`, `expiresAt`, `region`, `startUrl`, `authMethod`, and polling status.
- **Builder_ID**: A personal AWS Builder ID login, using a fixed region (`KIRO_DEFAULT_REGION`, default `us-east-1`) and a well-known Builder ID start URL that the user does not supply.
- **IDC**: AWS IAM Identity Center (enterprise) login, where the user supplies their organization start URL and region.
- **Provider_Connection_Store**: The `providerConnections` table in the proxy-owned Kiro database (`KIRO_DB_PATH`), read and written through `kiro-token-store.ts` and seeded by `kiro-import.ts`.
- **Account_Record**: One row in the Provider_Connection_Store with fields `id`, `provider='kiro'`, `authType`, `name`, `email`, `priority`, `isActive`, `data` (JSON), `createdAt`, `updatedAt`.
- **Data_JSON**: The JSON object stored in the `data` column, containing `accessToken`, `refreshToken`, `expiresAt`, `expiresIn`, and `providerSpecificData` (`clientId`, `clientSecret`, `region`, `authMethod`, `startUrl`, `profileArn`).
- **Dashboard_Client**: The React dashboard component (`AccountConnectionFlow.tsx`) that drives the device-login UI.
- **Device_Login_API**: The backend HTTP routes that expose the device login to the Dashboard_Client (e.g. `POST /api/kiro/device/start`, `POST /api/kiro/device/poll`).
- **Secret_Field**: Any `clientSecret`, `accessToken`, or `refreshToken` value.
- **Write_Back_Enabled**: The condition that `KIRO_WRITE_BACK_ENABLED` is true (or the destination database is proxy-owned), permitting persistence to the Provider_Connection_Store.

## Requirements

### Requirement 1: Client Registration with Caching

**User Story:** As a dashboard user, I want the proxy to register an OIDC client before a device login, so that the device authorization request is accepted by AWS without my having to manage client credentials.

#### Acceptance Criteria

1. WHEN a device login is started AND no unexpired Registration_Cache entry exists for the request parameters, THE Device_Login_Service SHALL send a RegisterClient request to `POST {OIDC_Endpoint}/client/register` with a body containing `clientName`, `clientType` set to `"public"`, and `scopes` set to `["codewhisperer:completions", "codewhisperer:analysis"]`.
2. WHERE the login is an IDC login, THE Device_Login_Service SHALL include `issuerUrl` and `grantTypes` in the RegisterClient request body.
3. WHEN a RegisterClient response is received, THE Device_Login_Service SHALL store the returned `clientId`, `clientSecret`, and `clientSecretExpiresAt` in the Registration_Cache keyed by the request parameters.
4. WHEN a device login is started AND a Registration_Cache entry exists whose `clientSecretExpiresAt` is later than the current time, THE Device_Login_Service SHALL reuse the cached `clientId` and `clientSecret` instead of sending a RegisterClient request.
5. IF a RegisterClient request returns a non-success HTTP status, THEN THE Device_Login_Service SHALL return an error result containing the HTTP status and a descriptive message without a Secret_Field.

### Requirement 2: Start Device Authorization

**User Story:** As a dashboard user, I want to start a device authorization and receive a user code and verification link, so that I can approve the login in my browser.

#### Acceptance Criteria

1. WHEN a device login is started AND a valid `clientId` and `clientSecret` are available, THE Device_Login_Service SHALL send a StartDeviceAuthorization request to `POST {OIDC_Endpoint}/device_authorization` with a body containing `clientId`, `clientSecret`, and `startUrl`.
2. WHEN a StartDeviceAuthorization response is received, THE Device_Login_Service SHALL create a Device_Session containing the returned `deviceCode`, `interval`, and an expiry time computed from the returned `expiresIn`.
3. WHEN a StartDeviceAuthorization response is received, THE Device_Login_Service SHALL return `userCode`, `verificationUri`, `verificationUriComplete`, `expiresIn`, and `interval` to the Device_Login_API caller.
4. IF a StartDeviceAuthorization request returns a non-success HTTP status, THEN THE Device_Login_Service SHALL return an error result containing the HTTP status and a descriptive message without a Secret_Field.

### Requirement 3: Token Polling with Pending, Slow-Down, and Expiry Handling

**User Story:** As a dashboard user, I want the proxy to poll for my token after I approve in the browser, so that the account connects automatically when authorization completes.

#### Acceptance Criteria

1. WHEN the Device_Login_API receives a poll request for an active Device_Session, THE Device_Login_Service SHALL send a CreateToken request to `POST {OIDC_Endpoint}/token` with a body containing `clientId`, `clientSecret`, `deviceCode`, and `grantType` set to `"urn:ietf:params:oauth:grant-type:device_code"`.
2. WHEN a CreateToken response indicates success, THE Device_Login_Service SHALL extract `accessToken`, `refreshToken`, and `expiresIn` and mark the Device_Session as completed.
3. IF a CreateToken response returns the error `authorization_pending`, THEN THE Device_Login_Service SHALL return a pending status that instructs the caller to poll again after the Device_Session interval.
4. IF a CreateToken response returns the error `slow_down`, THEN THE Device_Login_Service SHALL increase the Device_Session interval by 5 seconds and return a pending status reflecting the increased interval.
5. IF the current time is later than the Device_Session expiry, THEN THE Device_Login_Service SHALL return an expired status and reject further polling for that Device_Session.
6. WHILE a Device_Session is pending, THE Device_Login_Service SHALL enforce a minimum spacing between consecutive CreateToken requests equal to the current Device_Session interval.
7. IF a CreateToken response returns an error other than `authorization_pending` or `slow_down`, THEN THE Device_Login_Service SHALL return an error status containing the error code and a descriptive message without a Secret_Field.

### Requirement 4: Builder ID versus IDC Start-URL Handling

**User Story:** As a dashboard user, I want Builder ID and IAM Identity Center logins handled correctly, so that personal and enterprise accounts both connect with the right region and start URL.

#### Acceptance Criteria

1. WHERE the login is a Builder_ID login, THE Device_Login_Service SHALL use the configured Builder ID start URL and the configured default region without requiring a user-supplied start URL.
2. WHERE the login is an IDC login, THE Device_Login_Service SHALL use the user-supplied `startUrl` and the user-supplied `region`.
3. IF an IDC login is requested without a non-empty `startUrl`, THEN THE Device_Login_Service SHALL reject the request with a validation error and SHALL NOT send a StartDeviceAuthorization request.
4. IF an IDC login is requested without a non-empty `region`, THEN THE Device_Login_Service SHALL reject the request with a validation error and SHALL NOT send a StartDeviceAuthorization request.
5. WHEN a Device_Session is created, THE Device_Login_Service SHALL record the resolved `authMethod`, `startUrl`, and `region` in the Device_Session.
6. IF recording the resolved parameters in the Device_Session fails after a StartDeviceAuthorization response is received, THEN THE Device_Login_Service SHALL continue the login flow using the resolved parameters.

### Requirement 5: Account Persistence into providerConnections

**User Story:** As a dashboard user, I want a successful login saved as a Kiro account, so that the existing refresh and forwarding paths use it without changes.

#### Acceptance Criteria

1. WHEN a Device_Session completes successfully, THE Device_Login_Service SHALL write an Account_Record to the Provider_Connection_Store with `provider` set to `"kiro"`.
2. WHEN an Account_Record is written, THE Device_Login_Service SHALL set the Data_JSON to include `accessToken`, `refreshToken`, `expiresAt`, and `expiresIn`.
3. WHEN an Account_Record is written, THE Device_Login_Service SHALL set Data_JSON `providerSpecificData` to include `clientId`, `clientSecret`, `region`, `authMethod`, `startUrl`, and `profileArn`.
4. WHEN an Account_Record is written, THE Device_Login_Service SHALL set `expiresAt` to the timestamp computed by adding the token `expiresIn` seconds to the completion time.
5. WHEN an Account_Record is written, THE Device_Login_Service SHALL set `id`, `createdAt`, `updatedAt`, `isActive` to active, and `priority` to a positive integer so that the record is readable by `kiro-token-store.ts` as an active Kiro account.
6. THE Device_Login_Service SHALL write Account_Records only to the proxy-owned Kiro database identified by `KIRO_DB_PATH`.

### Requirement 6: Persistence Preconditions and Configuration

**User Story:** As an operator, I want device login gated by configuration, so that it only runs when Kiro is enabled and the destination database is writable by the proxy.

#### Acceptance Criteria

1. IF `KIRO_ENABLED` is not true WHEN a device login is started, THEN THE Device_Login_API SHALL reject the request with a configuration error and SHALL NOT contact the OIDC_Endpoint.
2. IF Write_Back_Enabled is false WHEN a device login is started, THEN THE Device_Login_API SHALL reject the request with a configuration error that states that login cannot persist.
3. THE Device_Login_Service SHALL read the OIDC scopes, Builder ID start URL, client name, and Registration_Cache location from configuration values.

### Requirement 7: Dashboard Device-Login UI

**User Story:** As a dashboard user, I want a guided device-login option in the connection wizard, so that I can connect a Kiro account without using the 9router app.

#### Acceptance Criteria

1. WHEN a user selects the Kiro device-login option in the connection wizard, THE Dashboard_Client SHALL present a choice between a Builder_ID login and an IDC login.
2. WHERE the user selects an IDC login, THE Dashboard_Client SHALL present inputs for `startUrl` and `region` before starting the login.
3. WHEN a device authorization start succeeds, THE Dashboard_Client SHALL display the `userCode` and `verificationUri` and SHALL render `verificationUriComplete` as a clickable link.
4. WHILE a Device_Session is pending AND the Device_Login_API has not reported an expired or error status, THE Dashboard_Client SHALL poll the Device_Login_API at the interval returned by the server.
5. WHEN the Device_Login_API reports completion, THE Dashboard_Client SHALL display a success state identifying the connected account.
6. WHEN the Device_Login_API reports an expired or error status, THE Dashboard_Client SHALL stop polling immediately upon receiving the status and SHALL display the corresponding message.
7. THE Dashboard_Client SHALL communicate with the Device_Login_API through the typed API client and SHALL NOT call `fetch` directly.

### Requirement 8: Error Handling

**User Story:** As a dashboard user, I want clear, actionable errors when a device login fails, so that I can understand and correct the problem.

#### Acceptance Criteria

1. IF a network request to the OIDC_Endpoint fails to complete, THEN THE Device_Login_Service SHALL return an error result with a descriptive message and SHALL NOT mark the Device_Session as completed.
2. IF a poll request references an unknown or completed Device_Session, THEN THE Device_Login_API SHALL return a not-found or already-completed status rather than contacting the OIDC_Endpoint.
3. WHEN the Device_Login_Service returns any error result, THE Device_Login_API SHALL return a structured error containing a `type`, a `code`, and a human-readable `message`.

### Requirement 9: Secret and Token Handling

**User Story:** As a security-conscious operator, I want secrets and tokens protected, so that login does not leak credentials to logs or the browser.

#### Acceptance Criteria

1. THE Device_Login_Service SHALL exclude every Secret_Field from log output.
2. WHEN the Device_Login_API returns a response to the Dashboard_Client, THE Device_Login_API SHALL exclude every full Secret_Field from the response body.
3. THE Device_Login_Service SHALL persist `clientSecret`, `accessToken`, and `refreshToken` only inside the Data_JSON of the Provider_Connection_Store.
