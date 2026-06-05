import { randomUUID } from "node:crypto";
import BetterSqlite3 from "better-sqlite3";
import type { AppConfig } from "./config.js";
import { PROVIDER_CONNECTIONS_DDL } from "./kiro-import.js";

type Database = InstanceType<typeof BetterSqlite3>;
type FetchLike = typeof fetch;

// ─── Types & Interfaces (Task 2.1) ───

export type DeviceLoginAuthMethod = "builder_id" | "idc";

export interface StartDeviceLoginInput {
  authMethod: DeviceLoginAuthMethod;
  startUrl?: string;
  region?: string;
}

export interface StartDeviceLoginResult {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export type PollStatus = "pending" | "completed" | "expired" | "error";

export interface PollDeviceLoginResult {
  status: PollStatus;
  interval?: number;
  account?: { id: string; name: string };
  error?: { code: string; message: string };
}

export interface DeviceSession {
  sessionId: string;
  deviceCode: string;
  clientId: string;
  clientSecret: string;
  interval: number;
  expiresAt: number; // Unix ms
  region: string;
  startUrl: string;
  authMethod: DeviceLoginAuthMethod;
  status: PollStatus;
  lastPollAt: number; // Unix ms, for rate limiting
  completedAccount?: { id: string; name: string };
  error?: { code: string; message: string };
}

export interface RegistrationCacheEntry {
  region: string;
  startUrl: string;
  clientId: string;
  clientSecret: string;
  clientSecretExpiresAt: number; // Unix seconds (from AWS response)
}

export interface DeviceLoginServiceDeps {
  config: AppConfig;
  appDb: Database;
  kiroDbPath: string;
  fetchImpl?: FetchLike;
}

// ─── Error Class ───

export class DeviceLoginError extends Error {
  readonly statusCode: number;
  readonly body: { type: string; code: string; message: string };

  constructor(statusCode: number, body: { type: string; code: string; message: string }) {
    super(body.message);
    this.statusCode = statusCode;
    this.body = body;
  }
}

// ─── Registration Cache DDL & Helpers (Task 2.2) ───

export const REGISTRATION_CACHE_DDL = `
CREATE TABLE IF NOT EXISTS kiro_registration_cache (
  region TEXT NOT NULL,
  startUrl TEXT NOT NULL,
  clientId TEXT NOT NULL,
  clientSecret TEXT NOT NULL,
  clientSecretExpiresAt INTEGER NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (region, startUrl)
);
`;

type RegistrationCacheRow = {
  region: string;
  startUrl: string;
  clientId: string;
  clientSecret: string;
  clientSecretExpiresAt: number;
  createdAt: string;
};

export function getRegistrationCache(
  db: Database,
  region: string,
  startUrl: string,
): RegistrationCacheEntry | undefined {
  const nowUnixSeconds = Math.floor(Date.now() / 1000);
  const row = db
    .prepare(
      `SELECT region, startUrl, clientId, clientSecret, clientSecretExpiresAt
       FROM kiro_registration_cache
       WHERE region = ? AND startUrl = ? AND clientSecretExpiresAt > ?`,
    )
    .get(region, startUrl, nowUnixSeconds) as RegistrationCacheRow | undefined;

  if (!row) return undefined;

  return {
    region: row.region,
    startUrl: row.startUrl,
    clientId: row.clientId,
    clientSecret: row.clientSecret,
    clientSecretExpiresAt: row.clientSecretExpiresAt,
  };
}

export function setRegistrationCache(db: Database, entry: RegistrationCacheEntry): void {
  db.prepare(
    `INSERT INTO kiro_registration_cache (region, startUrl, clientId, clientSecret, clientSecretExpiresAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(region, startUrl) DO UPDATE SET
       clientId = excluded.clientId,
       clientSecret = excluded.clientSecret,
       clientSecretExpiresAt = excluded.clientSecretExpiresAt,
       createdAt = excluded.createdAt`,
  ).run(
    entry.region,
    entry.startUrl,
    entry.clientId,
    entry.clientSecret,
    entry.clientSecretExpiresAt,
    new Date().toISOString(),
  );
}

// ─── DeviceLoginService (Tasks 2.3–2.6) ───

export class DeviceLoginService {
  private sessions: Map<string, DeviceSession> = new Map();
  private readonly config: AppConfig;
  private readonly appDb: Database;
  private readonly kiroDbPath: string;
  private readonly fetchImpl: FetchLike;

  constructor(deps: DeviceLoginServiceDeps) {
    this.config = deps.config;
    this.appDb = deps.appDb;
    this.kiroDbPath = deps.kiroDbPath;
    this.fetchImpl = deps.fetchImpl ?? fetch;

    // Ensure the registration cache table exists
    this.appDb.exec(REGISTRATION_CACHE_DDL);
  }

  // ─── Session Management (Task 2.3) ───

  pruneExpiredSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.expiresAt < now) {
        this.sessions.delete(id);
      }
    }
  }

  // ─── startDeviceLogin (Task 2.4) ───

  async startDeviceLogin(input: StartDeviceLoginInput): Promise<StartDeviceLoginResult> {
    // Validate IDC inputs
    if (input.authMethod === "idc") {
      if (!input.startUrl?.trim()) {
        throw new DeviceLoginError(422, {
          type: "validation_error",
          code: "VALIDATION_MISSING_START_URL",
          message: "IDC login requires a non-empty startUrl.",
        });
      }
      if (!input.region?.trim()) {
        throw new DeviceLoginError(422, {
          type: "validation_error",
          code: "VALIDATION_MISSING_REGION",
          message: "IDC login requires a non-empty region.",
        });
      }
    }

    // Resolve region and startUrl based on authMethod
    const region =
      input.authMethod === "builder_id"
        ? this.config.KIRO_DEFAULT_REGION
        : input.region!.trim();
    const startUrl =
      input.authMethod === "builder_id"
        ? this.config.KIRO_BUILDER_ID_START_URL
        : input.startUrl!.trim();

    // Check registration cache
    let clientId: string;
    let clientSecret: string;
    const cached = getRegistrationCache(this.appDb, region, startUrl);

    if (cached) {
      clientId = cached.clientId;
      clientSecret = cached.clientSecret;
    } else {
      // Call RegisterClient
      const registerResult = await this.registerClient(region, startUrl, input.authMethod);
      clientId = registerResult.clientId;
      clientSecret = registerResult.clientSecret;

      // Store in cache
      setRegistrationCache(this.appDb, {
        region,
        startUrl,
        clientId,
        clientSecret,
        clientSecretExpiresAt: registerResult.clientSecretExpiresAt,
      });
    }

    // Call StartDeviceAuthorization
    const oidcBase = `https://oidc.${region}.amazonaws.com`;
    let deviceAuthResponse: Response;
    try {
      deviceAuthResponse = await this.fetchImpl(`${oidcBase}/device_authorization`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, clientSecret, startUrl }),
      });
    } catch {
      throw new DeviceLoginError(502, {
        type: "upstream_error",
        code: "OIDC_NETWORK_ERROR",
        message: "Cannot reach AWS SSO-OIDC endpoint.",
      });
    }

    if (!deviceAuthResponse.ok) {
      const status = deviceAuthResponse.status;
      throw new DeviceLoginError(502, {
        type: "upstream_error",
        code: "OIDC_DEVICE_AUTH_FAILED",
        message: `Device authorization failed: ${status}.`,
      });
    }

    const deviceAuthData = (await deviceAuthResponse.json()) as {
      deviceCode: string;
      userCode: string;
      verificationUri: string;
      verificationUriComplete: string;
      expiresIn: number;
      interval: number;
    };

    // Create DeviceSession
    const sessionId = randomUUID();
    const session: DeviceSession = {
      sessionId,
      deviceCode: deviceAuthData.deviceCode,
      clientId,
      clientSecret,
      interval: deviceAuthData.interval,
      expiresAt: Date.now() + deviceAuthData.expiresIn * 1000,
      region,
      startUrl,
      authMethod: input.authMethod,
      status: "pending",
      lastPollAt: 0,
    };
    this.sessions.set(sessionId, session);

    return {
      sessionId,
      userCode: deviceAuthData.userCode,
      verificationUri: deviceAuthData.verificationUri,
      verificationUriComplete: deviceAuthData.verificationUriComplete,
      expiresIn: deviceAuthData.expiresIn,
      interval: deviceAuthData.interval,
    };
  }

  // ─── pollDeviceLogin (Task 2.5) ───

  async pollDeviceLogin(sessionId: string): Promise<PollDeviceLoginResult> {
    const session = this.sessions.get(sessionId);

    // Session not found or already completed/errored
    if (!session || session.status === "completed" || session.status === "error") {
      throw new DeviceLoginError(404, {
        type: "internal_error",
        code: "SESSION_NOT_FOUND",
        message: "Device login session not found or already completed.",
      });
    }

    // Check expiry
    const now = Date.now();
    if (now >= session.expiresAt) {
      session.status = "expired";
      return { status: "expired" };
    }

    // Rate limit: if interval hasn't elapsed since last poll, return current status
    if (session.lastPollAt > 0 && now - session.lastPollAt < session.interval * 1000) {
      return { status: "pending", interval: session.interval };
    }

    // Call CreateToken
    session.lastPollAt = now;
    const oidcBase = `https://oidc.${session.region}.amazonaws.com`;

    let tokenResponse: Response;
    try {
      tokenResponse = await this.fetchImpl(`${oidcBase}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: session.clientId,
          clientSecret: session.clientSecret,
          deviceCode: session.deviceCode,
          grantType: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });
    } catch {
      // Network error — don't mark session as errored, allow retry
      throw new DeviceLoginError(502, {
        type: "upstream_error",
        code: "OIDC_NETWORK_ERROR",
        message: "Cannot reach AWS SSO-OIDC endpoint.",
      });
    }

    if (tokenResponse.ok) {
      // Success — persist account and mark completed
      const tokenData = (await tokenResponse.json()) as {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      };

      const account = this.persistAccount(session, tokenData);
      session.status = "completed";
      session.completedAccount = account;

      return {
        status: "completed",
        account,
      };
    }

    // Error response from OIDC
    const errorBody = (await tokenResponse.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };
    const errorCode = errorBody.error ?? "unknown_error";

    if (errorCode === "authorization_pending") {
      return { status: "pending", interval: session.interval };
    }

    if (errorCode === "slow_down") {
      session.interval += 5;
      return { status: "pending", interval: session.interval };
    }

    // Terminal error
    const errorMessage = errorBody.error_description ?? `Authorization failed: ${errorCode}`;
    session.status = "error";
    session.error = { code: errorCode, message: errorMessage };

    return {
      status: "error",
      error: { code: errorCode, message: errorMessage },
    };
  }

  // ─── Account Persistence (Task 2.6) ───

  private persistAccount(
    session: DeviceSession,
    tokenData: { accessToken: string; refreshToken: string; expiresIn: number },
  ): { id: string; name: string } {
    const accountId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + tokenData.expiresIn * 1000).toISOString();
    const name = "Kiro Device Login";

    const dataJson = JSON.stringify({
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt,
      expiresIn: tokenData.expiresIn,
      providerSpecificData: {
        clientId: session.clientId,
        clientSecret: session.clientSecret,
        region: session.region,
        authMethod: session.authMethod,
        startUrl: session.startUrl,
        profileArn: null,
      },
    });

    let db: Database | undefined;
    try {
      db = new BetterSqlite3(this.kiroDbPath);
      db.pragma("journal_mode = WAL");
      db.exec(PROVIDER_CONNECTIONS_DDL);

      db.prepare(
        `INSERT INTO providerConnections
           (id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        accountId,
        "kiro",
        "sso-oidc",
        name,
        null,
        100,
        1,
        dataJson,
        now.toISOString(),
        now.toISOString(),
      );
    } catch (err) {
      throw new DeviceLoginError(500, {
        type: "internal_error",
        code: "ACCOUNT_PERSIST_FAILED",
        message: "Failed to save account after successful login.",
      });
    } finally {
      db?.close();
    }

    return { id: accountId, name };
  }

  // ─── RegisterClient Helper ───

  private async registerClient(
    region: string,
    startUrl: string,
    authMethod: DeviceLoginAuthMethod,
  ): Promise<{ clientId: string; clientSecret: string; clientSecretExpiresAt: number }> {
    const oidcBase = `https://oidc.${region}.amazonaws.com`;

    const body: Record<string, unknown> = {
      clientName: this.config.KIRO_DEVICE_CLIENT_NAME,
      clientType: "public",
      scopes: this.config.KIRO_DEVICE_SCOPES,
    };

    if (authMethod === "idc") {
      body.issuerUrl = startUrl;
      body.grantTypes = [
        "urn:ietf:params:oauth:grant-type:device_code",
        "refresh_token",
      ];
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${oidcBase}/client/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new DeviceLoginError(502, {
        type: "upstream_error",
        code: "OIDC_NETWORK_ERROR",
        message: "Cannot reach AWS SSO-OIDC endpoint.",
      });
    }

    if (!response.ok) {
      const status = response.status;
      const text = await response.text().catch(() => "");
      const excerpt = text.slice(0, 200);
      throw new DeviceLoginError(502, {
        type: "upstream_error",
        code: "OIDC_REGISTER_FAILED",
        message: `Client registration failed: ${status} ${excerpt}.`,
      });
    }

    const data = (await response.json()) as {
      clientId: string;
      clientSecret: string;
      clientSecretExpiresAt: number;
    };

    return {
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      clientSecretExpiresAt: data.clientSecretExpiresAt,
    };
  }
}
