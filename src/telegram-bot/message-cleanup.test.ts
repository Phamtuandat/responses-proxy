import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "grammy";
import type { TelegramBotConfig } from "./config.js";
import { createCustomerMessageCleanupMiddleware } from "./message-cleanup.js";

function createConfig(): TelegramBotConfig {
  return {
    telegramBotToken: "token",
    allowedUserIds: new Set(),
    allowedChatIds: new Set(),
    ownerUserIds: new Set(["1"]),
    adminUserIds: new Set(),
    botMode: "polling",
    proxyAdminBaseUrl: "http://127.0.0.1:8318",
    defaultModel: "gpt-5.5",
    publicSignupEnabled: true,
    requireAdminApproval: false,
    defaultCustomerRoute: "customers",
    publicResponsesBaseUrl: "http://127.0.0.1:8318/v1",
    proxyRequestTimeoutMs: 30_000,
    sessionDbPath: ":memory:",
    sessionTtlMs: 900_000,
    rateLimitWindowMs: 60_000,
    rateLimitMaxRequests: 12,
    logLevel: "info",
  };
}

function createContext(input: {
  userId: number;
  chatId: number;
  text: string;
  deleteImpl?: (chatId: number, messageId: number) => Promise<void>;
}) {
  const deleted: Array<{ chatId: number; messageId: number }> = [];
  return ({
    from: { id: input.userId, is_bot: false, first_name: "User" },
    chat: { id: input.chatId, type: "private", first_name: "User" },
    message: {
      message_id: 99,
      date: 0,
      chat: { id: input.chatId, type: "private", first_name: "User" },
      text: input.text,
    },
    api: {
      async deleteMessage(chatId: number, messageId: number) {
        if (input.deleteImpl) {
          await input.deleteImpl(chatId, messageId);
        }
        deleted.push({ chatId, messageId });
        return true as any;
      },
    },
    deleted,
  } as unknown) as Context & {
    deleted: Array<{ chatId: number; messageId: number }>;
  };
}

test("cleanup middleware deletes customer command messages after handling", async () => {
  const ctx = createContext({ userId: 42, chatId: 42, text: "/renew" });
  const middleware = createCustomerMessageCleanupMiddleware(createConfig());
  let handled = false;

  await middleware(ctx, async () => {
    handled = true;
  });

  assert.equal(handled, true);
  assert.deepEqual(ctx.deleted, [{ chatId: 42, messageId: 99 }]);
});

test("cleanup middleware does not delete admin command messages", async () => {
  const ctx = createContext({ userId: 1, chatId: 1, text: "/renew" });
  const middleware = createCustomerMessageCleanupMiddleware(createConfig());

  await middleware(ctx, async () => {});

  assert.deepEqual(ctx.deleted, []);
});

test("cleanup middleware ignores delete errors", async () => {
  const ctx = createContext({
    userId: 42,
    chatId: 42,
    text: "/start",
    deleteImpl: async () => {
      throw new Error("delete forbidden");
    },
  });
  const middleware = createCustomerMessageCleanupMiddleware(createConfig());

  await middleware(ctx, async () => {});

  assert.deepEqual(ctx.deleted, []);
});
