import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Context } from "grammy";
import { DashboardAuthRepository } from "./dashboard-auth.js";
import { registerDashboardLoginCallbacks } from "./telegram-bot/dashboard-login.js";

test("dashboard approval challenge resolves and consumes once", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-dashboard-auth-"));
  const dbFile = path.join(tempDir, "auth.sqlite");
  try {
    const repo = DashboardAuthRepository.create(dbFile);
    const challenge = repo.createApprovalChallenge({ telegramUserIds: ["1", "2"], ttlMs: 60_000 });
    assert.match(challenge.displayCode, /^\d{2}$/);

    const initial = repo.getApprovalChallengeStatus({ challengeId: challenge.id, pollToken: challenge.pollToken });
    assert.equal(initial.ok, true);
    assert.equal(initial.status, "pending");

    const resolved = repo.resolveApprovalChoice({
      challengeId: challenge.id,
      telegramUserId: "1",
      selectedCode: challenge.displayCode,
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.status, "approved");

    const approved = repo.getApprovalChallengeStatus({ challengeId: challenge.id, pollToken: challenge.pollToken });
    assert.equal(approved.ok, true);
    assert.equal(approved.status, "approved");

    const consumed = repo.consumeApprovedChallenge({ challengeId: challenge.id, pollToken: challenge.pollToken });
    assert.equal(consumed.ok, true);
    assert.equal(consumed.telegramUserId, "1");

    const second = repo.consumeApprovedChallenge({ challengeId: challenge.id, pollToken: challenge.pollToken });
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.reason, "consumed");
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("dashboard login callback approves or rejects selected code", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-dashboard-login-"));
  const dbFile = path.join(tempDir, "auth.sqlite");
  try {
    const repo = DashboardAuthRepository.create(dbFile);
    const challenge = repo.createApprovalChallenge({ telegramUserIds: ["1"], ttlMs: 60_000 });

    const handler = createCallbackHarness();
    registerDashboardLoginCallbacks(handler.bot as any, {
      telegramBotToken: "token",
      allowedUserIds: new Set(),
      allowedChatIds: new Set(),
      ownerUserIds: new Set(["1"]),
      adminUserIds: new Set(["1"]),
      botMode: "polling",
      proxyAdminBaseUrl: "http://127.0.0.1:8318",
      defaultModel: "gpt-5.5",
      publicSignupEnabled: false,
      requireAdminApproval: true,
      defaultCustomerRoute: "customers",
      publicResponsesBaseUrl: "http://127.0.0.1:8318/v1",
      proxyRequestTimeoutMs: 30_000,
      sessionDbPath: dbFile,
      sessionTtlMs: 900_000,
      rateLimitWindowMs: 60_000,
      rateLimitMaxRequests: 12,
      logLevel: "info",
    }, repo);

    const approved = handler.find(`v1:dashauth:${challenge.id}:${challenge.displayCode}`);
    const approveCtx = createCallbackContext({ fromId: 1, chatId: 1, data: `v1:dashauth:${challenge.id}:${challenge.displayCode}` });
    (approveCtx as any).match = approved.match;
    await approved.handler(approveCtx as any);
    assert.equal(approveCtx.answeredCallbacks[0]?.text, "Dashboard login approved.");
    assert.match(approveCtx.editedReplies[0]?.text ?? "", /approved/i);

    const rejectedChallenge = repo.createApprovalChallenge({ telegramUserIds: ["1"], ttlMs: 60_000 });
    const rejected = handler.find(`v1:dashauth:${rejectedChallenge.id}:00`);
    const rejectCtx = createCallbackContext({ fromId: 1, chatId: 1, data: `v1:dashauth:${rejectedChallenge.id}:00` });
    (rejectCtx as any).match = rejected.match;
    await rejected.handler(rejectCtx as any);
    assert.equal(rejectCtx.answeredCallbacks[0]?.show_alert, true);
    assert.match(rejectCtx.answeredCallbacks[0]?.text ?? "", /Wrong code/i);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createCallbackHarness() {
  const callbackHandlers: Array<{
    pattern: RegExp | string;
    handler: (ctx: Context & { match?: RegExpMatchArray | string[] }) => Promise<void> | void;
  }> = [];
  return {
    bot: {
      callbackQuery(
        pattern: RegExp | string,
        handler: (ctx: Context & { match?: RegExpMatchArray | string[] }) => Promise<void> | void,
      ) {
        callbackHandlers.push({ pattern, handler });
      },
    },
    find(data: string) {
      for (const entry of callbackHandlers) {
        if (typeof entry.pattern === "string") {
          if (entry.pattern === data) {
            return { handler: entry.handler, match: [data] };
          }
          continue;
        }
        const match = data.match(entry.pattern);
        if (match) {
          return { handler: entry.handler, match };
        }
      }
      assert.fail(`No callback handler for ${data}`);
    },
  };
}

function createCallbackContext(input: { fromId: number; chatId: number; data: string }) {
  const answeredCallbacks: Array<{ text?: string; show_alert?: boolean }> = [];
  const editedReplies: Array<{ text: string }> = [];
  return {
    from: { id: input.fromId },
    chat: { id: input.chatId, type: "private" },
    callbackQuery: { data: input.data, message: { message_id: 1, chat: { id: input.chatId, type: "private" } } },
    answeredCallbacks,
    editedReplies,
    answerCallbackQuery(payload?: { text?: string; show_alert?: boolean }) {
      answeredCallbacks.push(payload ?? {});
      return Promise.resolve();
    },
    editMessageText(text: string) {
      editedReplies.push({ text });
      return Promise.resolve();
    },
    reply(text: string) {
      editedReplies.push({ text });
      return Promise.resolve();
    },
  };
}
