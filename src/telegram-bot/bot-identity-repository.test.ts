import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import BetterSqlite3 from "better-sqlite3";
import { BotIdentityRepository } from "./bot-identity-repository.js";

function withRepository(fn: (repo: BotIdentityRepository, dbFile: string) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "telegram-identity-"));
  try {
    const dbFile = path.join(dir, "bot.sqlite");
    fn(BotIdentityRepository.create(dbFile), dbFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("BotIdentityRepository creates and updates Telegram users", () => {
  withRepository((repo) => {
    const first = repo.upsertUser({
      telegramUserId: "1283361952",
      username: "atger",
      firstName: "Atger",
      languageCode: "en",
      now: new Date("2026-04-27T00:00:00.000Z"),
    });

    assert.equal(first.role, "customer");
    assert.equal(first.status, "active");
    assert.equal(first.username, "atger");
    assert.equal(first.createdAt, "2026-04-27T00:00:00.000Z");

    repo.setUserStatus("1283361952", "blocked", new Date("2026-04-27T00:05:00.000Z"));

    const updated = repo.upsertUser({
      telegramUserId: "1283361952",
      username: "new_name",
      firstName: "New",
      languageCode: "vi",
      now: new Date("2026-04-27T00:10:00.000Z"),
    });

    assert.equal(updated.username, "new_name");
    assert.equal(updated.firstName, "New");
    assert.equal(updated.languageCode, "vi");
    assert.equal(updated.status, "blocked");
    assert.equal(updated.createdAt, "2026-04-27T00:00:00.000Z");
    assert.equal(updated.lastSeenAt, "2026-04-27T00:10:00.000Z");
  });
});

test("BotIdentityRepository creates chats and memberships", () => {
  withRepository((repo, dbFile) => {
    repo.upsertUser({ telegramUserId: "1" });
    const chat = repo.upsertChat({
      telegramChatId: "-100",
      chatType: "supergroup",
      title: "Customers",
      now: new Date("2026-04-27T01:00:00.000Z"),
    });
    repo.upsertMembership({
      telegramUserId: "1",
      telegramChatId: "-100",
      role: "member",
      now: new Date("2026-04-27T01:00:01.000Z"),
    });

    assert.equal(chat.telegramChatId, "-100");
    assert.equal(chat.chatType, "supergroup");
    assert.equal(chat.title, "Customers");

    const db = new BetterSqlite3(dbFile);
    const row = db
      .prepare(
        `SELECT telegram_user_id, telegram_chat_id, role
         FROM telegram_chat_memberships
         WHERE telegram_user_id = ? AND telegram_chat_id = ?`,
      )
      .get("1", "-100") as { telegram_user_id: string; telegram_chat_id: string; role: string };
    db.close();

    assert.deepEqual(row, {
      telegram_user_id: "1",
      telegram_chat_id: "-100",
      role: "member",
    });
  });
});
