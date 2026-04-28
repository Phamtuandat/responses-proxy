import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import BetterSqlite3 from "better-sqlite3";
import { CustomerKeyRepository, hashApiKey } from "./customer-keys.js";

function withRepository(fn: (repo: CustomerKeyRepository, dbFile: string) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "customer-keys-"));
  try {
    const dbFile = path.join(dir, "keys.sqlite");
    fn(CustomerKeyRepository.create(dbFile), dbFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("CustomerKeyRepository creates keys and stores revealable plaintext secrets", () => {
  withRepository((repo, dbFile) => {
    const created = repo.createKey({
      workspaceId: "workspace-1",
      telegramUserId: "1283361952",
      clientRoute: "Paid Customers",
      now: new Date("2026-04-27T00:00:00.000Z"),
    });

    assert.match(created.apiKey, /^sk-customer-/);
    assert.equal(created.record.clientRoute, "paid-customers");
    assert.equal(created.record.apiKeyHash, hashApiKey(created.apiKey));
    assert.equal(created.record.apiKeySecret, created.apiKey);
    assert.equal(repo.getApiKeySecret(created.record.id), created.apiKey);
    assert.equal(created.record.status, "active");

    const db = new BetterSqlite3(dbFile);
    const raw = JSON.stringify(db.prepare("SELECT * FROM customer_api_keys").all());
    db.close();

    assert.equal(raw.includes(created.apiKey), true);
  });
});

test("CustomerKeyRepository looks up keys by raw key and hash", () => {
  withRepository((repo) => {
    const created = repo.createKey({
      workspaceId: "workspace-1",
      telegramUserId: "42",
      clientRoute: "customers",
    });

    assert.equal(repo.getByApiKey(created.apiKey)?.id, created.record.id);
    assert.equal(repo.getByHash(hashApiKey(created.apiKey))?.id, created.record.id);
    assert.equal(repo.getActiveKeyForUser("42")?.id, created.record.id);
  });
});

test("CustomerKeyRepository supports lifecycle status changes", () => {
  withRepository((repo) => {
    const created = repo.createKey({
      workspaceId: "workspace-1",
      telegramUserId: "42",
      clientRoute: "customers",
    });

    const suspended = repo.setStatus(created.record.id, "suspended");
    assert.equal(suspended?.status, "suspended");
    assert.equal(repo.getActiveKeyForUser("42"), undefined);

    const active = repo.setStatus(created.record.id, "active");
    assert.equal(active?.status, "active");

    const revoked = repo.setStatus(created.record.id, "revoked", {
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    assert.equal(revoked?.status, "revoked");
    assert.equal(revoked?.revokedAt, "2026-04-27T00:00:00.000Z");
  });
});
