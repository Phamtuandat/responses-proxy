import type { KiroAccount, KiroTokenStore, KiroTokenUpdate } from "./kiro-token-store.js";

export type KiroRotationMode = "round_robin" | "random" | "first_available";

export type KiroResolvedCredentials = {
  accountId: string;
  accessToken: string;
  profileArn: string | null;
  region: string;
  authMethod?: string | null;
};

export class KiroAuthError extends Error {
  readonly statusCode = 409;
  readonly body: { type: string; code: string; message: string };

  constructor(code: string, message: string) {
    super(message);
    this.body = { type: "authentication_error", code, message };
  }
}

type FetchLike = typeof fetch;

const refreshLocks = new Map<string, Promise<KiroAccount>>();
const accountCursors = new Map<string, number>();

type RefreshResponse = {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
};

/**
 * Refreshes a Kiro/CodeWhisperer token using the AWS SSO-OIDC endpoint for IDC
 * accounts (clientId + clientSecret present), or the Kiro social refresh
 * endpoint otherwise. Mirrors the flow used by the 9router desktop app.
 */
export async function refreshKiroToken(
  account: KiroAccount,
  options: { defaultRegion: string; fetchImpl?: FetchLike } = { defaultRegion: "us-east-1" },
): Promise<KiroTokenUpdate> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const { clientId, clientSecret, region } = account.providerSpecificData;
  const resolvedRegion = region?.trim() || options.defaultRegion;

  let payload: RefreshResponse;
  if (clientId && clientSecret) {
    const url = `https://oidc.${resolvedRegion}.amazonaws.com/token`;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        clientSecret,
        refreshToken: account.refreshToken,
        grantType: "refresh_token",
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new KiroAuthError("KIRO_TOKEN_REFRESH_FAILED", `Token refresh failed (${response.status}): ${text}`);
    }
    payload = (await response.json()) as RefreshResponse;
  } else {
    const response = await fetchImpl("https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: account.refreshToken }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new KiroAuthError("KIRO_TOKEN_REFRESH_FAILED", `Token refresh failed (${response.status}): ${text}`);
    }
    payload = (await response.json()) as RefreshResponse;
  }

  if (!payload.accessToken) {
    throw new KiroAuthError("KIRO_TOKEN_REFRESH_FAILED", "Token refresh did not return an accessToken");
  }
  const expiresIn = typeof payload.expiresIn === "number" && payload.expiresIn > 0 ? payload.expiresIn : 3600;
  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken || account.refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    expiresIn,
  };
}

/**
 * Selects an account (optionally pinned), refreshes its token if it is within
 * the refresh lead window, persists the new token back to 9router's DB, and
 * returns the credentials to use for a CodeWhisperer request.
 */
export async function resolveKiroCredentials(args: {
  store: KiroTokenStore;
  accountId?: string;
  rotationMode?: KiroRotationMode;
  defaultRegion: string;
  refreshLeadSeconds: number;
  poolKey?: string;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<KiroResolvedCredentials> {
  const account = args.accountId?.trim()
    ? args.store.getAccount(args.accountId.trim())
    : selectNextAccount(args.poolKey ?? "kiro", args.store, args.rotationMode ?? "round_robin");

  if (!account || !account.isActive) {
    throw new KiroAuthError(
      "KIRO_ACCOUNT_UNAVAILABLE",
      "No connected Kiro accounts are available. Sign in through 9router first.",
    );
  }

  const fresh = await ensureFreshAccount(account, args);
  return {
    accountId: fresh.id,
    accessToken: fresh.accessToken,
    profileArn: fresh.providerSpecificData.profileArn ?? null,
    region: fresh.providerSpecificData.region?.trim() || args.defaultRegion,
    authMethod: fresh.providerSpecificData.authMethod ?? null,
  };
}

async function ensureFreshAccount(
  account: KiroAccount,
  args: {
    store: KiroTokenStore;
    defaultRegion: string;
    refreshLeadSeconds: number;
    fetchImpl?: FetchLike;
    now?: Date;
  },
): Promise<KiroAccount> {
  const now = args.now ?? new Date();
  const leadMs = args.refreshLeadSeconds * 1000;
  const expiresAtMs = account.expiresAt ? Date.parse(account.expiresAt) : NaN;
  const stillValid = Number.isFinite(expiresAtMs) && expiresAtMs - now.getTime() > leadMs;
  if (stillValid && account.accessToken) {
    return account;
  }

  const existingLock = refreshLocks.get(account.id);
  if (existingLock) {
    return existingLock;
  }

  const refreshPromise = (async () => {
    const update = await refreshKiroToken(account, {
      defaultRegion: args.defaultRegion,
      fetchImpl: args.fetchImpl,
    });
    const persisted = args.store.updateTokens(account.id, update, now);
    // Always overlay the fresh token onto whatever account we have. When write-back
    // is disabled, `persisted` is the stale DB row, so without this overlay the
    // refreshed token would be discarded and an expired token returned.
    const base = persisted ?? account;
    return {
      ...base,
      accessToken: update.accessToken,
      refreshToken: update.refreshToken ?? base.refreshToken,
      expiresAt: update.expiresAt,
      expiresIn: update.expiresIn ?? base.expiresIn,
    };
  })().finally(() => {
    refreshLocks.delete(account.id);
  });

  refreshLocks.set(account.id, refreshPromise);
  return refreshPromise;
}

function selectNextAccount(
  poolKey: string,
  store: KiroTokenStore,
  rotationMode: KiroRotationMode,
): KiroAccount | undefined {
  const accounts = store.listAvailableAccounts();
  if (!accounts.length) {
    return undefined;
  }
  if (rotationMode === "first_available") {
    return accounts[0];
  }
  if (rotationMode === "random") {
    return accounts[Math.floor(Math.random() * accounts.length)];
  }
  const cursor = accountCursors.get(poolKey) ?? 0;
  const account = accounts[cursor % accounts.length];
  accountCursors.set(poolKey, (cursor + 1) % accounts.length);
  return account;
}

export function __resetKiroAuthStateForTests(): void {
  refreshLocks.clear();
  accountCursors.clear();
}
