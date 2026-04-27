import assert from "node:assert/strict";
import test from "node:test";
import type { Context, MiddlewareFn, NextFunction } from "grammy";
import { createAllowlistMiddleware, createCustomerCommandMiddleware, isAdmin } from "./auth.js";
import type { TelegramBotConfig } from "./config.js";

function config(overrides: Partial<TelegramBotConfig> = {}): TelegramBotConfig {
  return {
    telegramBotToken: "token",
    allowedUserIds: new Set(),
    allowedChatIds: new Set(),
    ownerUserIds: new Set(),
    adminUserIds: new Set(),
    botMode: "polling",
    proxyAdminBaseUrl: "http://127.0.0.1:8318",
    defaultModel: "gpt-5.5",
    publicSignupEnabled: false,
    requireAdminApproval: true,
    defaultCustomerRoute: "customers",
    publicResponsesBaseUrl: "http://127.0.0.1:8318/v1",
    proxyRequestTimeoutMs: 30_000,
    sessionDbPath: ":memory:",
    sessionTtlMs: 900_000,
    rateLimitWindowMs: 60_000,
    rateLimitMaxRequests: 12,
    logLevel: "info",
    ...overrides,
  };
}

function context(input: { userId?: number; chatId?: number; text?: string }): Context & {
  replies: string[];
} {
  const replies: string[] = [];
  return ({
    from: input.userId ? { id: input.userId, is_bot: false, first_name: "User" } : undefined,
    chat: input.chatId ? { id: input.chatId, type: "private", first_name: "User" } : undefined,
    message: input.text
      ? {
          message_id: 1,
          date: 0,
          chat: { id: input.chatId ?? input.userId ?? 1, type: "private", first_name: "User" },
          text: input.text,
        }
      : undefined,
    replies,
    reply(text: string) {
      replies.push(text);
      return Promise.resolve({} as any);
    },
  } as unknown) as Context & { replies: string[] };
}

async function runMiddleware(
  middleware: MiddlewareFn<Context>,
  ctx: Context,
): Promise<boolean> {
  let called = false;
  await Promise.resolve(
    middleware(ctx, (async () => {
      called = true;
    }) as NextFunction),
  );
  return called;
}

test("allowlist middleware rejects unknown users when public signup is disabled", async () => {
  const ctx = context({ userId: 1, chatId: 1, text: "/start" });
  const called = await runMiddleware(createAllowlistMiddleware(config()), ctx);

  assert.equal(called, false);
  assert.equal(ctx.replies[0], "This bot is restricted. Your user or chat is not authorized.");
});

test("allowlist middleware allows unknown users when public signup is enabled", async () => {
  const ctx = context({ userId: 1, chatId: 1, text: "/start" });
  const called = await runMiddleware(
    createAllowlistMiddleware(config({ publicSignupEnabled: true })),
    ctx,
  );

  assert.equal(called, true);
});

test("allowlist middleware treats allowed users as emergency lockdown when configured", async () => {
  const ctx = context({ userId: 7, chatId: 7, text: "/start" });
  const called = await runMiddleware(
    createAllowlistMiddleware(
      config({
        publicSignupEnabled: true,
        allowedUserIds: new Set(["42"]),
      }),
    ),
    ctx,
  );

  assert.equal(called, false);
  assert.equal(ctx.replies[0], "This bot is restricted. Your user or chat is not authorized.");
});

test("allowlist middleware still lets owner bypass emergency lockdown", async () => {
  const ctx = context({ userId: 99, chatId: 99, text: "/start" });
  const called = await runMiddleware(
    createAllowlistMiddleware(
      config({
        publicSignupEnabled: true,
        allowedUserIds: new Set(["42"]),
        ownerUserIds: new Set(["99"]),
      }),
    ),
    ctx,
  );

  assert.equal(called, true);
});

test("customer command middleware blocks public non-admin from operator commands", async () => {
  const ctx = context({ userId: 1, chatId: 1, text: "/providers" });
  const called = await runMiddleware(
    createCustomerCommandMiddleware(config({ publicSignupEnabled: true })),
    ctx,
  );

  assert.equal(called, false);
  assert.equal(ctx.replies[0], "This command is admin-only. Use /apikey to view your Responses API key.");
});

test("customer command middleware lets owner run operator commands", async () => {
  const ctx = context({ userId: 1, chatId: 1, text: "/providers" });
  const botConfig = config({ ownerUserIds: new Set(["1"]) });
  const called = await runMiddleware(createCustomerCommandMiddleware(botConfig), ctx);

  assert.equal(called, true);
  assert.equal(isAdmin(ctx, botConfig), true);
});
