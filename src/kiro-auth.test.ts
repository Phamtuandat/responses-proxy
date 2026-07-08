import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  KiroAuthError,
  __resetKiroAuthStateForTests,
  refreshKiroToken,
  resolveKiroCredentials,
} from "./kiro-auth.js";
import type { KiroAccount, KiroTokenStore, KiroTokenUpdate } from "./kiro-token-store.js";

function makeAccount(overrides: Partial<KiroAccount> = {}): KiroAccount {
  return {
    id: "acct-a",
    name: "Account A",
    priority: 1,
    isActive: true,
    accessToken: "access-a",
    refreshToken: "refresh-a",
    expiresAt: "2026-06-01T00:00:00.000Z",
    expiresIn: 3600,
    providerSpecificData: {
      profileArn: "arn:keep",
      clientId: null,
      clientSecret: null,
      region: "us-east-1",
      authMethod: null,
      startUrl: null,
    },
    raw: {},
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

class FakeStore {
  readonly accounts = new Map<string, KiroAccount>();
  readonly updates: Array<{ id: string; update: KiroTokenUpdate }> = [];

  constructor(accounts: KiroAccount[]) {
    for (const account of accounts) {
      this.accounts.set(account.id, account);
    }
  }

  getAccount(id: string): KiroAccount | undefined {
    return this.accounts.get(id);
  }

  listAvailableAccounts(): KiroAccount[] {
    return [...this.accounts.values()].filter((a) => a.isActive);
  }

  updateTokens(id: string, update: KiroTokenUpdate, now: Date = new Date()): KiroAccount | undefined {
    this.updates.push({ id, update });
    const current = this.accounts.get(id);
    if (!current) {
      return undefined;
    }
    const next: KiroAccount = {
      ...current,
      accessToken: update.accessToken,
      refreshToken: update.refreshToken ?? current.refreshToken,
      expiresAt: update.expiresAt,
      expiresIn: update.expiresIn ?? current.expiresIn,
      updatedAt: now.toISOString(),
    };
    this.accounts.set(id, next);
    return next;
  }

  asStore(): KiroTokenStore {
    return this as unknown as KiroTokenStore;
  }
}

type MockCall = { url: string; init: RequestInit | undefined };

function mockFetch(
  handler: (url: string, init: RequestInit | undefined) => { status?: number; body: unknown },
): { fetchImpl: typeof fetch; calls: MockCall[] } {
  const calls: MockCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    const { status = 200, body } = handler(url, init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

beforeEach(() => {
  __resetKiroAuthStateForTests();
});

test("refreshKiroToken uses the social endpoint when no IDC client credentials", async () => {
  const { fetchImpl, calls } = mockFetch(() => ({
    body: { accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 1800 },
  }));
  const update = await refreshKiroToken(makeAccount(), { defaultRegion: "us-east-1", fetchImpl });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken");
  assert.equal(JSON.parse(calls[0].init?.body as string).refreshToken, "refresh-a");
  assert.equal(update.accessToken, "new-access");
  assert.equal(update.refreshToken, "new-refresh");
  assert.equal(update.expiresIn, 1800);
});

test("refreshKiroToken uses the regional OIDC endpoint for IDC accounts", async () => {
  const { fetchImpl, calls } = mockFetch(() => ({
    body: { accessToken: "idc-access", refreshToken: "idc-refresh", expiresIn: 3600 },
  }));
  const account = makeAccount({
    providerSpecificData: {
      profileArn: null,
      clientId: "client-x",
      clientSecret: "secret-x",
      region: "eu-west-1",
      authMethod: "idc",
      startUrl: null,
    },
  });
  await refreshKiroToken(account, { defaultRegion: "us-east-1", fetchImpl });

  assert.equal(calls[0].url, "https://oidc.eu-west-1.amazonaws.com/token");
  const body = JSON.parse(calls[0].init?.body as string);
  assert.equal(body.clientId, "client-x");
  assert.equal(body.clientSecret, "secret-x");
  assert.equal(body.grantType, "refresh_token");
});

test("refreshKiroToken uses the tokenEndpoint and URLSearchParams for external_idp accounts", async () => {
  const { fetchImpl, calls } = mockFetch(() => ({
    body: { access_token: "ext-access", refresh_token: "ext-refresh", expires_in: 7200 },
  }));
  const account = makeAccount({
    providerSpecificData: {
      profileArn: null,
      clientId: "client-ext",
      clientSecret: null,
      region: "us-east-1",
      authMethod: "external_idp",
      tokenEndpoint: "https://login.microsoftonline.com/tenant-ext/oauth2/v2.0/token",
      startUrl: null,
      scopes: "api://b59b6a0b-258a-49f6-bcc8-bcc2023a3cdb/Codewhisperer.Request",
    },
  });
  const update = await refreshKiroToken(account, { defaultRegion: "us-east-1", fetchImpl });

  assert.equal(calls[0].url, "https://login.microsoftonline.com/tenant-ext/oauth2/v2.0/token");
  assert.equal((calls[0].init?.headers as any)?.["Content-Type"], "application/x-www-form-urlencoded");
  const params = new URLSearchParams(calls[0].init?.body as string);
  assert.equal(params.get("client_id"), "client-ext");
  assert.equal(params.get("grant_type"), "refresh_token");
  assert.equal(params.get("refresh_token"), "refresh-a");
  assert.equal(params.get("scope"), "api://b59b6a0b-258a-49f6-bcc8-bcc2023a3cdb/Codewhisperer.Request");

  assert.equal(update.accessToken, "ext-access");
  assert.equal(update.refreshToken, "ext-refresh");
  assert.equal(update.expiresIn, 7200);
});

test("refreshKiroToken throws KiroAuthError on a non-ok response", async () => {
  const { fetchImpl } = mockFetch(() => ({ status: 400, body: { error: "bad" } }));
  await assert.rejects(
    () => refreshKiroToken(makeAccount(), { defaultRegion: "us-east-1", fetchImpl }),
    (error: unknown) =>
      error instanceof KiroAuthError && error.body.code === "KIRO_TOKEN_REFRESH_FAILED",
  );
});

test("refreshKiroToken throws when the response omits an accessToken", async () => {
  const { fetchImpl } = mockFetch(() => ({ body: { refreshToken: "r" } }));
  await assert.rejects(
    () => refreshKiroToken(makeAccount(), { defaultRegion: "us-east-1", fetchImpl }),
    (error: unknown) => error instanceof KiroAuthError,
  );
});

test("resolveKiroCredentials returns a still-valid account without refreshing", async () => {
  const store = new FakeStore([makeAccount()]);
  const { fetchImpl, calls } = mockFetch(() => ({ body: {} }));
  const creds = await resolveKiroCredentials({
    store: store.asStore(),
    accountId: "acct-a",
    defaultRegion: "us-east-1",
    refreshLeadSeconds: 120,
    fetchImpl,
    now: new Date("2026-05-15T00:00:00.000Z"),
  });

  assert.equal(calls.length, 0);
  assert.equal(creds.accessToken, "access-a");
  assert.equal(creds.profileArn, "arn:keep");
  assert.equal(creds.region, "us-east-1");
});

test("resolveKiroCredentials refreshes when inside the lead window and persists the new token", async () => {
  const store = new FakeStore([
    makeAccount({ expiresAt: "2026-05-15T00:01:00.000Z" }),
  ]);
  const { fetchImpl, calls } = mockFetch(() => ({
    body: { accessToken: "fresh-access", refreshToken: "fresh-refresh", expiresIn: 3600 },
  }));
  const creds = await resolveKiroCredentials({
    store: store.asStore(),
    accountId: "acct-a",
    defaultRegion: "us-east-1",
    refreshLeadSeconds: 120,
    fetchImpl,
    now: new Date("2026-05-15T00:00:00.000Z"),
  });

  assert.equal(calls.length, 1);
  assert.equal(creds.accessToken, "fresh-access");
  assert.equal(store.updates.length, 1);
  assert.equal(store.getAccount("acct-a")?.accessToken, "fresh-access");
});

test("resolveKiroCredentials rotates round-robin across available accounts", async () => {
  const store = new FakeStore([
    makeAccount({ id: "acct-a", priority: 1 }),
    makeAccount({ id: "acct-b", priority: 2 }),
  ]);
  const { fetchImpl } = mockFetch(() => ({ body: {} }));
  const common = {
    store: store.asStore(),
    defaultRegion: "us-east-1",
    refreshLeadSeconds: 120,
    fetchImpl,
    now: new Date("2026-05-15T00:00:00.000Z"),
  };
  const first = await resolveKiroCredentials(common);
  const second = await resolveKiroCredentials(common);
  const third = await resolveKiroCredentials(common);

  assert.equal(first.accountId, "acct-a");
  assert.equal(second.accountId, "acct-b");
  assert.equal(third.accountId, "acct-a");
});

test("resolveKiroCredentials returns the fresh token even when write-back is disabled", async () => {
  // Simulate writeBack:false: updateTokens persists nothing and returns the stale row.
  class NoWriteBackStore extends FakeStore {
    updateTokens(id: string): KiroAccount | undefined {
      return this.getAccount(id);
    }
  }
  const store = new NoWriteBackStore([makeAccount({ expiresAt: "2026-05-15T00:01:00.000Z" })]);
  const { fetchImpl, calls } = mockFetch(() => ({
    body: { accessToken: "fresh-access", refreshToken: "fresh-refresh", expiresIn: 3600 },
  }));
  const creds = await resolveKiroCredentials({
    store: store.asStore(),
    accountId: "acct-a",
    defaultRegion: "us-east-1",
    refreshLeadSeconds: 120,
    fetchImpl,
    now: new Date("2026-05-15T00:00:00.000Z"),
  });

  assert.equal(calls.length, 1);
  // The refreshed token must be used, not the stale one the store returned.
  assert.equal(creds.accessToken, "fresh-access");
  // And the store row is intentionally left unchanged (no write-back).
  assert.equal(store.getAccount("acct-a")?.accessToken, "access-a");
});

test("resolveKiroCredentials throws KIRO_ACCOUNT_UNAVAILABLE when no accounts are connected", async () => {
  const store = new FakeStore([]);
  const { fetchImpl } = mockFetch(() => ({ body: {} }));
  await assert.rejects(
    () =>
      resolveKiroCredentials({
        store: store.asStore(),
        defaultRegion: "us-east-1",
        refreshLeadSeconds: 120,
        fetchImpl,
      }),
    (error: unknown) =>
      error instanceof KiroAuthError && error.body.code === "KIRO_ACCOUNT_UNAVAILABLE",
  );
});

test("concurrent refreshes for the same account share a single refresh call", async () => {
  const store = new FakeStore([makeAccount({ expiresAt: "2026-05-15T00:01:00.000Z" })]);
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(
      JSON.stringify({ accessToken: "fresh", refreshToken: "fresh-r", expiresIn: 3600 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  const args = {
    store: store.asStore(),
    accountId: "acct-a",
    defaultRegion: "us-east-1",
    refreshLeadSeconds: 120,
    fetchImpl,
    now: new Date("2026-05-15T00:00:00.000Z"),
  };
  const [a, b] = await Promise.all([
    resolveKiroCredentials(args),
    resolveKiroCredentials(args),
  ]);

  assert.equal(calls, 1);
  assert.equal(a.accessToken, "fresh");
  assert.equal(b.accessToken, "fresh");
});
