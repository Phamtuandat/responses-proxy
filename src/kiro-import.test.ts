import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import BetterSqlite3 from "better-sqlite3";
import { importKiroAccounts, KiroImportError, PROVIDER_CONNECTIONS_DDL } from "./kiro-import.js";

function makeSourceDb(dir: string): string {
  const dbPath = path.join(dir, "source.sqlite");
  const db = new BetterSqlite3(dbPath);
  db.exec(PROVIDER_CONNECTIONS_DDL);
  const insert = db.prepare(
    `INSERT INTO providerConnections
       (id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
     VALUES (@id, @provider, @authType, @name, @email, @priority, @isActive, @data, @createdAt, @updatedAt)`,
  );
  insert.run({
    id: "acct-1",
    provider: "kiro",
    authType: "oauth",
    name: "Account 1",
    email: null,
    priority: 1,
    isActive: 1,
    data: JSON.stringify({ accessToken: "a1", refreshToken: "r1", providerSpecificData: { region: "us-east-1" } }),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  insert.run({
    id: "acct-2",
    provider: "kiro",
    authType: "oauth",
    name: "Account 2",
    email: null,
    priority: 2,
    isActive: 1,
    data: JSON.stringify({ accessToken: "a2", refreshToken: "r2", providerSpecificData: {} }),
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  });
  // A non-kiro row that must NOT be copied.
  insert.run({
    id: "other-1",
    provider: "cursor",
    authType: "oauth",
    name: "Cursor",
    email: null,
    priority: 1,
    isActive: 1,
    data: JSON.stringify({ accessToken: "x" }),
    createdAt: "2026-01-03T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
  });
  db.close();
  return dbPath;
}

function readDest(destPath: string): Array<Record<string, unknown>> {
  const db = new BetterSqlite3(destPath, { readonly: true });
  const rows = db.prepare("SELECT * FROM providerConnections ORDER BY id").all() as Array<
    Record<string, unknown>
  >;
  db.close();
  return rows;
}

test("importKiroAccounts copies only kiro rows verbatim", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kiro-import-"));
  try {
    const source = makeSourceDb(dir);
    const dest = path.join(dir, "nested", "kiro.sqlite");

    const result = importKiroAccounts({ sourceDbPath: source, destDbPath: dest });

    assert.equal(result.imported, 2);
    assert.deepEqual(result.ids.sort(), ["acct-1", "acct-2"]);

    const rows = readDest(dest);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, "acct-1");
    assert.equal(rows[0].provider, "kiro");
    assert.equal(rows[0].data, JSON.stringify({ accessToken: "a1", refreshToken: "r1", providerSpecificData: { region: "us-east-1" } }));
    assert.ok(!rows.some((r) => r.provider === "cursor"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("importKiroAccounts upserts on re-import (re-syncs from source)", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kiro-import-"));
  try {
    const source = makeSourceDb(dir);
    const dest = path.join(dir, "kiro.sqlite");

    importKiroAccounts({ sourceDbPath: source, destDbPath: dest });

    // Simulate the proxy refreshing a token in the dest DB.
    const destDb = new BetterSqlite3(dest);
    destDb
      .prepare("UPDATE providerConnections SET data = ? WHERE id = ?")
      .run(JSON.stringify({ accessToken: "PROXY_REFRESHED" }), "acct-1");
    destDb.close();

    // Re-import should overwrite with the source value and not duplicate rows.
    const result = importKiroAccounts({ sourceDbPath: source, destDbPath: dest });
    assert.equal(result.imported, 2);

    const rows = readDest(dest);
    assert.equal(rows.length, 2);
    const acct1 = rows.find((r) => r.id === "acct-1");
    assert.match(String(acct1?.data), /"accessToken":"a1"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("importKiroAccounts rejects identical source and dest", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kiro-import-"));
  try {
    const source = makeSourceDb(dir);
    assert.throws(
      () => importKiroAccounts({ sourceDbPath: source, destDbPath: source }),
      (error: unknown) => error instanceof KiroImportError,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("importKiroAccounts throws when the source DB is missing", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "kiro-import-"));
  try {
    assert.throws(
      () =>
        importKiroAccounts({
          sourceDbPath: path.join(dir, "nope.sqlite"),
          destDbPath: path.join(dir, "kiro.sqlite"),
        }),
      (error: unknown) => error instanceof KiroImportError,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
