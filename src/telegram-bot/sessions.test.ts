import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { buildTelegramSessionScope, SqliteSessionStore } from "./sessions.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("SqliteSessionStore persists sessions across store recreation", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "telegram-session-store-"));
  tempDirs.push(directory);
  const dbFile = path.join(directory, "bot.sqlite");

  const firstStore = SqliteSessionStore.create(dbFile, 60_000);
  const scope = buildTelegramSessionScope("chat-1", "user-1");
  firstStore.set(scope, {
    kind: "awaiting_apply_model_input",
    client: "codex",
    providerId: "provider-1",
    providerName: "Provider One",
    models: ["gpt-5.5"],
  });

  const secondStore = SqliteSessionStore.create(dbFile, 60_000);
  assert.deepEqual(secondStore.get(scope), {
    kind: "awaiting_apply_model_input",
    client: "codex",
    providerId: "provider-1",
    providerName: "Provider One",
    models: ["gpt-5.5"],
  });
});

test("SqliteSessionStore expires stale sessions", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "telegram-session-store-"));
  tempDirs.push(directory);
  const dbFile = path.join(directory, "bot.sqlite");
  const store = SqliteSessionStore.create(dbFile, 100);
  const scope = buildTelegramSessionScope("chat-2", "user-2");

  store.set(scope, { kind: "awaiting_oauth_callback" }, 1_000);

  assert.equal(store.get(scope, 1_050)?.kind, "awaiting_oauth_callback");
  assert.equal(store.get(scope, 1_101), undefined);
});

test("SqliteSessionStore keeps sessions isolated by user within the same chat", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "telegram-session-store-"));
  tempDirs.push(directory);
  const dbFile = path.join(directory, "bot.sqlite");
  const store = SqliteSessionStore.create(dbFile, 60_000);

  store.set(buildTelegramSessionScope("chat-shared", "user-a"), { kind: "awaiting_oauth_callback" });
  store.set(buildTelegramSessionScope("chat-shared", "user-b"), { kind: "awaiting_test_prompt" });

  assert.equal(
    store.get(buildTelegramSessionScope("chat-shared", "user-a"))?.kind,
    "awaiting_oauth_callback",
  );
  assert.equal(
    store.get(buildTelegramSessionScope("chat-shared", "user-b"))?.kind,
    "awaiting_test_prompt",
  );
});

test("SqliteSessionStore issues short callback tokens and resolves stored account actions", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "telegram-session-store-"));
  tempDirs.push(directory);
  const dbFile = path.join(directory, "bot.sqlite");
  const store = SqliteSessionStore.create(dbFile, 60_000);

  const token = store.issueCallbackToken({
    kind: "account_action",
    action: "delete",
    accountId: "chatgpt-oauth:very.long.email.address@example.com",
  });

  assert.ok(token.length < 40);
  assert.deepEqual(store.readCallbackToken(token), {
    kind: "account_action",
    action: "delete",
    accountId: "chatgpt-oauth:very.long.email.address@example.com",
  });
});
