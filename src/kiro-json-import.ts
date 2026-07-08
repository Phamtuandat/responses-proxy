import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import { KiroImportError, PROVIDER_CONNECTIONS_DDL } from "./kiro-import.js";

type Database = InstanceType<typeof BetterSqlite3>;
type FetchLike = typeof fetch;

/**
 * A single Kiro account as it can appear in a JSON blob pasted/exported from
 * 9router. Fields may be flattened at the top level (as in 9router's backup
 * export) or nested under `providerSpecificData` (as in its SQLite `data`
 * blob). Both shapes are accepted and normalized.
 */
type RawKiroInput = {
  id?: string;
  name?: string;
  email?: string | null;
  priority?: number;
  isActive?: boolean;
  authType?: string;
  provider?: string;
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: string;
  expiresIn?: number;
  testStatus?: string;
  clientId?: string | null;
  clientSecret?: string | null;
  region?: string | null;
  authMethod?: string | null;
  profileArn?: string | null;
  startUrl?: string | null;
  providerSpecificData?: Record<string, unknown> | null;
};

type NormalizedCandidate = {
  id?: string;
  name?: string;
  email?: string | null;
  priority?: number;
  isActive: boolean;
  refreshToken: string;
  accessToken?: string;
  expiresAt?: string;
  expiresIn?: number;
  clientId?: string;
  clientSecret?: string;
  region?: string;
  profileArn?: string | null;
  startUrl?: string;
  authMethod?: string;
  tokenEndpoint?: string;
};

export type KiroJsonImportedAccount = {
  id: string;
  name: string;
  email: string | null;
  authMethod: string;
  refreshed: boolean;
};

export type KiroJsonImportResult = {
  dest: string;
  imported: number;
  accounts: KiroJsonImportedAccount[];
};

/**
 * Decodes the email claim from a Kiro/CodeWhisperer access-token JWT, mirroring
 * 9router's `extractEmailFromJWT` (email → preferred_username → sub).
 */
export function extractEmailFromJWT(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) {
      return null;
    }
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
    const claims = JSON.parse(json) as Record<string, unknown>;
    const email = claims.email ?? claims.preferred_username ?? claims.sub;
    return typeof email === "string" && email.trim() ? email : null;
  } catch {
    return null;
  }
}

/**
 * Refreshes an imported account's token to validate it and obtain an
 * accessToken + profileArn, exactly like 9router's Kiro import flow: IDC/SSO
 * (clientId + clientSecret) hits the AWS SSO-OIDC `/token` endpoint, everything
 * else hits the Kiro social `refreshToken` endpoint.
 */
async function refreshForImport(
  candidate: NormalizedCandidate,
  options: { defaultRegion: string; fetchImpl: FetchLike },
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; profileArn: string | null }> {
  const isIdc = !!(candidate.clientId && candidate.clientSecret);
  const isExternalIdp = candidate.authMethod === "external_idp" && !!candidate.tokenEndpoint;
  const region = candidate.region?.trim() || options.defaultRegion;

  let response: Response;
  if (isExternalIdp) {
    const bodyParams = new URLSearchParams({
      client_id: candidate.clientId || "",
      grant_type: "refresh_token",
      refresh_token: candidate.refreshToken,
    });
    response = await options.fetchImpl(candidate.tokenEndpoint!, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: bodyParams.toString(),
    });
  } else if (isIdc) {
    response = await options.fetchImpl(`https://oidc.${region}.amazonaws.com/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: candidate.clientId,
        clientSecret: candidate.clientSecret,
        refreshToken: candidate.refreshToken,
        grantType: "refresh_token",
      }),
    });
  } else {
    response = await options.fetchImpl("https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: candidate.refreshToken }),
    });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new KiroImportError(`Token refresh failed (${response.status}): ${text}`);
  }
  const payload = (await response.json()) as {
    accessToken?: string;
    access_token?: string;
    refreshToken?: string;
    refresh_token?: string;
    expiresIn?: number;
    expires_in?: number;
    profileArn?: string | null;
    profile_arn?: string | null;
  };
  const accessToken = payload.accessToken ?? payload.access_token;
  if (!accessToken) {
    throw new KiroImportError("Token refresh did not return an accessToken");
  }
  const rawExpiresIn = payload.expiresIn ?? payload.expires_in;
  return {
    accessToken,
    refreshToken: payload.refreshToken ?? payload.refresh_token ?? candidate.refreshToken,
    expiresIn: typeof rawExpiresIn === "number" && rawExpiresIn > 0 ? rawExpiresIn : 3600,
    profileArn: payload.profileArn ?? payload.profile_arn ?? null,
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Flattens one raw account object (top-level or nested `providerSpecificData`)
 * into a normalized candidate. Returns undefined when it carries no usable
 * refresh token (nothing we can import).
 */
function normalizeAccount(raw: RawKiroInput): NormalizedCandidate | undefined {
  const rawObj = raw as Record<string, unknown>;
  const psd = (raw.providerSpecificData ?? {}) as Record<string, unknown>;

  const refreshToken = asString(rawObj.refreshToken) ?? asString(rawObj.refresh_token);
  if (!refreshToken) {
    return undefined;
  }

  return {
    id: asString(rawObj.id),
    name: asString(rawObj.name),
    email: typeof rawObj.email === "string" ? rawObj.email : null,
    priority: typeof rawObj.priority === "number" ? rawObj.priority : undefined,
    isActive: rawObj.isActive !== false && rawObj.is_active !== false && rawObj.disabled !== true,
    refreshToken,
    accessToken: asString(rawObj.accessToken) ?? asString(rawObj.access_token),
    expiresAt: asString(rawObj.expiresAt) ?? asString(rawObj.expires_at) ?? asString(rawObj.expired),
    expiresIn: typeof rawObj.expiresIn === "number" ? rawObj.expiresIn : (typeof rawObj.expires_in === "number" ? rawObj.expires_in : undefined),
    clientId: asString(rawObj.clientId) ?? asString(rawObj.client_id) ?? asString(psd.clientId) ?? asString(psd.client_id),
    clientSecret: asString(rawObj.clientSecret) ?? asString(rawObj.client_secret) ?? asString(psd.clientSecret) ?? asString(psd.client_secret),
    region: asString(rawObj.region) ?? asString(psd.region),
    profileArn: asString(rawObj.profileArn) ?? asString(rawObj.profile_arn) ?? asString(psd.profileArn) ?? asString(psd.profile_arn) ?? null,
    startUrl: asString(rawObj.startUrl) ?? asString(rawObj.start_url) ?? asString(psd.startUrl) ?? asString(psd.start_url),
    authMethod: asString(rawObj.authMethod) ?? asString(rawObj.auth_method) ?? asString(psd.authMethod) ?? asString(psd.auth_method),
    tokenEndpoint: asString(rawObj.tokenEndpoint) ?? asString(rawObj.token_endpoint) ?? asString(psd.tokenEndpoint) ?? asString(psd.token_endpoint),
  };
}

/**
 * Accepts any of the JSON shapes 9router produces or consumes and returns the
 * list of importable Kiro accounts:
 *  - a single account object
 *  - a bare array of account objects
 *  - a 9router backup ({ providerConnections: [...] }) — kiro rows only
 */
function normalizeImportInput(raw: unknown): NormalizedCandidate[] {
  const collect = (items: unknown[]): NormalizedCandidate[] =>
    items
      .filter((item): item is RawKiroInput => typeof item === "object" && item !== null)
      .filter((item) => item.provider === undefined || item.provider === "kiro")
      .map(normalizeAccount)
      .filter((candidate): candidate is NormalizedCandidate => candidate !== undefined);

  if (Array.isArray(raw)) {
    return collect(raw);
  }
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.providerConnections)) {
      return collect(obj.providerConnections);
    }
    return collect([obj]);
  }
  return [];
}

/**
 * Imports Kiro/CodeWhisperer accounts from a JSON payload (string, parsed
 * value, or file path) into a resproxy-owned SQLite database, mirroring
 * 9router's Kiro import: each account is refreshed to obtain a live access
 * token + profileArn, its email is decoded from the JWT, and it is stored with
 * 9router's `providerSpecificData` shape. Accounts are deduplicated by refresh
 * token (re-import updates the existing row instead of duplicating it).
 */
export async function importKiroAccountsFromJson(args: {
  json?: unknown;
  jsonText?: string;
  filePath?: string;
  destDbPath: string;
  defaultRegion?: string;
  refresh?: boolean;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<KiroJsonImportResult> {
  const defaultRegion = args.defaultRegion?.trim() || "us-east-1";
  const fetchImpl = args.fetchImpl ?? fetch;
  const shouldRefresh = args.refresh !== false;
  const now = args.now ?? new Date();
  const destDbPath = path.resolve(args.destDbPath);

  let raw: unknown = args.json;
  if (raw === undefined) {
    let text = args.jsonText;
    if (text === undefined && args.filePath) {
      const source = path.resolve(args.filePath);
      if (!existsSync(source)) {
        throw new KiroImportError(`JSON file not found at ${source}`);
      }
      text = readFileSync(source, "utf-8");
    }
    if (text === undefined) {
      throw new KiroImportError("No JSON provided: pass `json`, `jsonText`, or `filePath`");
    }
    try {
      raw = JSON.parse(text);
    } catch (error) {
      throw new KiroImportError(`Invalid JSON: ${(error as Error).message}`);
    }
  }

  const candidates = normalizeImportInput(raw);
  if (candidates.length === 0) {
    throw new KiroImportError("No Kiro accounts with a refreshToken found in the JSON");
  }

  mkdirSync(path.dirname(destDbPath), { recursive: true });
  const db: Database = new BetterSqlite3(destDbPath);
  const accounts: KiroJsonImportedAccount[] = [];
  try {
    db.pragma("journal_mode = WAL");
    db.exec(PROVIDER_CONNECTIONS_DDL);

    const upsert = db.prepare(
      `INSERT INTO providerConnections
         (id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
       VALUES (@id, 'kiro', 'oauth', @name, @email, @priority, @isActive, @data, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         email = excluded.email,
         priority = excluded.priority,
         isActive = excluded.isActive,
         data = excluded.data,
         updatedAt = excluded.updatedAt`,
    );

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const isIdc = !!(candidate.clientId && candidate.clientSecret);

      let accessToken = candidate.accessToken ?? "";
      let refreshToken = candidate.refreshToken;
      let expiresAt = candidate.expiresAt;
      let expiresIn = candidate.expiresIn;
      let profileArn = candidate.profileArn ?? null;
      let refreshed = false;

      if (shouldRefresh) {
        const result = await refreshForImport(candidate, { defaultRegion, fetchImpl });
        accessToken = result.accessToken;
        refreshToken = result.refreshToken;
        expiresIn = result.expiresIn;
        expiresAt = new Date(now.getTime() + result.expiresIn * 1000).toISOString();
        profileArn = profileArn ?? result.profileArn;
        refreshed = true;
      }

      const email =
        (typeof candidate.email === "string" && candidate.email.trim() ? candidate.email.trim() : null) ??
        (accessToken ? extractEmailFromJWT(accessToken) : null);

      const isExternalIdp = candidate.authMethod === "external_idp" && !!candidate.tokenEndpoint;

      // Mirror 9router's providerSpecificData shape exactly.
      const providerSpecificData: Record<string, unknown> = {
        profileArn,
        authMethod: isIdc ? "idc" : (isExternalIdp ? "external_idp" : "imported"),
        provider: isIdc ? "Enterprise" : (isExternalIdp ? "External IDP" : "Imported"),
        ...(isIdc
          ? {
              clientId: candidate.clientId,
              clientSecret: candidate.clientSecret,
              region: candidate.region?.trim() || defaultRegion,
            }
          : {}),
        ...(isExternalIdp
          ? {
              clientId: candidate.clientId,
              tokenEndpoint: candidate.tokenEndpoint,
              region: candidate.region?.trim() || defaultRegion,
            }
          : {}),
        ...(candidate.startUrl ? { startUrl: candidate.startUrl } : {}),
      };

      const dataJson = JSON.stringify({
        accessToken,
        refreshToken,
        expiresAt: expiresAt ?? null,
        expiresIn: expiresIn ?? null,
        testStatus: "active",
        providerSpecificData,
      });

      // Like 9router, each import creates a fresh connection; a caller-supplied
      // `id` (e.g. restoring a backup) upserts the existing row instead.
      const id = candidate.id ?? randomUUID();
      const name = candidate.name ?? email ?? `Kiro Account ${index + 1}`;

      upsert.run({
        id,
        name,
        email,
        priority: candidate.priority ?? index + 1,
        isActive: candidate.isActive ? 1 : 0,
        data: dataJson,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });

      accounts.push({ id, name, email, authMethod: isIdc ? "idc" : (isExternalIdp ? "external_idp" : "imported"), refreshed });
    }
  } finally {
    db.close();
  }

  return { dest: destDbPath, imported: accounts.length, accounts };
}
