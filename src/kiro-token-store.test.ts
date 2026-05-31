import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import BetterSqlite3 from "better-sqlite3";
import { KiroTokenStore, KiroTokenStoreError } from "./kiro-token-store.js";

type SeedRow = {
  id: string;
  provider?: string;
  authType?: string;
  name?: string | null;
  email?: string | null;
  priority?: number | null;
  isActive?: number | null;
  data: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

function createDbFile(rows: SeedRow[]): { dir: string; file: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "responses-proxy-kiro-store-"));
  const file = path.join(dir, "data.sqlite");
  const db = new BetterSqlite3(file);
  db.exec(`
    CREATE TABLE providerConnections (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      authType TEXT,
      name TEXT,
      email TEXT,
      priority INTEGER,
      isActive INTEGER,
      data TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);
  const insert = db.prepare(
    `INSERT INTO providerConnections
       (id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
     VALUES (@id, @provider, @authType, @name, @email, @priority, @isActive, @data, @createdAt, @updatedAt)`,
  );
  for (const row of rows) {
    insert.run({
      id: row.id,
      provider: row.provider ?? "kiro",
      authType: row.authType ?? "oauth",
      name: row.name ?? null,
      email: row.email ?? null,
      priority: row.priority ?? null,
      isActive: row.isActive ?? 1,
      data: JSON.stringify(row.data),
      createdAt: row.createdAt ?? "2026-05-01T00:00:00.000Z",
      updatedAt: row.updatedAt ?? "2026-05-01T00:00:00.000Z",
    });
  }
  db.close();
  return { dir, file };
}

test("open throws when the database file does not exist", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "responses-proxy-kiro-missing-"));
  try {
    assert.throws(
      () => KiroTokenStore.open(path.join(dir, "nope.sqlite")),
      (error: unknown) => error instanceof KiroTokenStoreError,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listAccounts maps rows, filters non-kiro and tokenless rows, and orders by priority", () => {
  const { dir, file } = createDbFile([
    {
      id: "acct-b",
      priority: 5,
      data: {
        accessToken: "access-b",
        refreshToken: "refresh-b",
        expiresAt: "2026-06-01T00:00:00.000Z",
        expiresIn: 3600,
        providerSpecificData: {
          profileArn: "arn:aws:codewhisperer:profile/b",
          region: "us-west-2",
          clientId: "client-b",
          clientSecret: "secret-b",
        },
      },
    },
    {
      id: "acct-a",
      priority: 1,
      data: { accessToken: "access-a", refreshToken: "refresh-a" },
    },
    {
      id: "no-tokens",
      data: { providerSpecificData: { region: "us-east-1" } },
    },
    {
      id: "other-provider",
      provider: "chatgpt",
      data: { accessToken: "x", refreshToken: "y" },
    },
  ]);
  try {
    const store = KiroTokenStore.open(file);
    const accounts = store.listAccounts();
    assert.deepEqual(
      accounts.map((a) => a.id),
      ["acct-a", "acct-b"],
    );
    const b = accounts.find((a) => a.id === "acct-b");
    assert.equal(b?.accessToken, "access-b");
    assert.equal(b?.providerSpecificData.profileArn, "arn:aws:codewhisperer:profile/b");
    assert.equal(b?.providerSpecificData.region, "us-west-2");
    assert.equal(b?.providerSpecificData.clientId, "client-b");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listAvailableAccounts excludes inactive accounts", () => {
  const { dir, file } = createDbFile([
    { id: "active", isActive: 1, data: { accessToken: "a", refreshToken: "r" } },
    { id: "inactive", isActive: 0, data: { accessToken: "a2", refreshToken: "r2" } },
  ]);
  try {
    const store = KiroTokenStore.open(file);
    assert.deepEqual(
      store.listAvailableAccounts().map((a) => a.id),
      ["active"],
    );
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getAccount returns a single mapped account or undefined", () => {
  const { dir, file } = createDbFile([
    { id: "acct-a", data: { accessToken: "a", refreshToken: "r" } },
  ]);
  try {
    const store = KiroTokenStore.open(file);
    assert.equal(store.getAccount("acct-a")?.id, "acct-a");
    assert.equal(store.getAccount("missing"), undefined);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("updateTokens writes back token fields, clears error markers, and preserves other keys", () => {
  const { dir, file } = createDbFile([
    {
      id: "acct-a",
      data: {
        accessToken: "old-access",
        refreshToken: "old-refresh",
        expiresAt: "2026-05-01T00:00:00.000Z",
        expiresIn: 3600,
        lastError: "boom",
        lastErrorAt: "2026-05-01T00:00:00.000Z",
        providerSpecificData: { region: "us-east-1", profileArn: "arn:keep" },
        someOtherKey: "keep-me",
      },
    },
  ]);
  try {
    const store = KiroTokenStore.open(file);
    const now = new Date("2026-05-15T12:00:00.000Z");
    const updated = store.updateTokens(
      "acct-a",
      {
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresAt: "2026-05-15T13:00:00.000Z",
        expiresIn: 3600,
      },
      now,
    );
    assert.equal(updated?.accessToken, "new-access");
    assert.equal(updated?.refreshToken, "new-refresh");
    assert.equal(updated?.expiresAt, "2026-05-15T13:00:00.000Z");

    // Re-open from a fresh handle to confirm persistence and preserved keys.
    const verifyDb = new BetterSqlite3(file, { readonly: true });
    const row = verifyDb
      .prepare(`SELECT data, updatedAt FROM providerConnections WHERE id = 'acct-a'`)
      .get() as { data: string; updatedAt: string };
    const data = JSON.parse(row.data) as Record<string, unknown>;
    assert.equal(data.accessToken, "new-access");
    assert.equal(data.lastError, null);
    assert.equal(data.lastErrorAt, null);
    assert.equal(data.someOtherKey, "keep-me");
    assert.deepEqual(data.providerSpecificData, {
      region: "us-east-1",
      profileArn: "arn:keep",
    });
    assert.equal(row.updatedAt, now.toISOString());
    verifyDb.close();
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("updateTokens is a no-op when write-back is disabled", () => {
  const { dir, file } = createDbFile([
    {
      id: "acct-a",
      data: { accessToken: "old-access", refreshToken: "old-refresh" },
    },
  ]);
  try {
    const store = KiroTokenStore.open(file, { writeBack: false });
    const result = store.updateTokens("acct-a", {
      accessToken: "new-access",
      expiresAt: "2026-05-15T13:00:00.000Z",
    });
    // Returns the current (unchanged) account.
    assert.equal(result?.accessToken, "old-access");

    const verifyDb = new BetterSqlite3(file, { readonly: true });
    const row = verifyDb
      .prepare(`SELECT data FROM providerConnections WHERE id = 'acct-a'`)
      .get() as { data: string };
    assert.equal((JSON.parse(row.data) as Record<string, unknown>).accessToken, "old-access");
    verifyDb.close();
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
