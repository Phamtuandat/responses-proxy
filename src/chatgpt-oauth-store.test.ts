import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ChatGptOAuthStore } from "./chatgpt-oauth-store.js";

test("stores ChatGPT OAuth accounts without exposing token fields in UI views", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "responses-proxy-oauth-"));
  try {
    const store = ChatGptOAuthStore.create(path.join(dir, "app.db"));
    const account = store.upsertAccount(
      {
        idToken: "id-token",
        accessToken: "access-token",
        refreshToken: "refresh-token",
        accountId: "acct_123",
        email: "user@example.com",
        expiresAt: "2026-04-27T01:00:00.000Z",
        lastRefreshAt: "2026-04-27T00:00:00.000Z",
      },
      new Date("2026-04-27T00:00:00.000Z"),
    );

    assert.equal(account.id, "chatgpt-oauth:acct_123");
    assert.equal(account.accessToken, "access-token");

    const [view] = store.listAccountsForUi();
    assert.equal(view.id, "chatgpt-oauth:acct_123");
    assert.equal(view.email, "user@example.com");
    assert.equal("accessToken" in view, false);
    assert.equal("refreshToken" in view, false);
    assert.equal("idToken" in view, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects expired OAuth sessions", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "responses-proxy-oauth-"));
  try {
    const store = ChatGptOAuthStore.create(path.join(dir, "app.db"));
    store.createSession({
      state: "state",
      codeVerifier: "verifier",
      redirectUri: "http://localhost/callback",
      ttlMs: 1,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });

    assert.throws(
      () => store.consumeSession("state", new Date("2026-04-27T00:00:01.000Z")),
      /expired/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("persists ChatGPT OAuth rotation mode", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "responses-proxy-oauth-"));
  try {
    const dbFile = path.join(dir, "app.db");
    const store = ChatGptOAuthStore.create(dbFile);
    assert.equal(store.getRotationMode(), "round_robin");
    assert.equal(store.setRotationMode("random"), "random");
    assert.equal(ChatGptOAuthStore.create(dbFile).getRotationMode(), "random");
    assert.equal(store.setRotationMode("first_available"), "first_available");
    assert.equal(store.setRotationMode("invalid"), "round_robin");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("can disable and re-enable ChatGPT OAuth accounts", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "responses-proxy-oauth-"));
  try {
    const store = ChatGptOAuthStore.create(path.join(dir, "app.db"));
    const account = store.upsertAccount(
      {
        idToken: "id-token",
        accessToken: "access-token",
        refreshToken: "refresh-token",
        accountId: "acct_123",
        email: "user@example.com",
        expiresAt: "2026-04-27T01:00:00.000Z",
        lastRefreshAt: "2026-04-27T00:00:00.000Z",
      },
      new Date("2026-04-27T00:00:00.000Z"),
    );

    assert.equal(store.disableAccount(account.id), true);
    assert.equal(store.getAccount(account.id)?.disabled, true);
    assert.equal(store.listAvailableAccounts().length, 0);

    assert.equal(store.enableAccount(account.id), true);
    assert.equal(store.getAccount(account.id)?.disabled, false);
    assert.equal(store.listAvailableAccounts().length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
