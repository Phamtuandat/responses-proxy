import assert from "node:assert/strict";
import test from "node:test";
import type { Context } from "grammy";
import type { BotDependencies } from "../actions.js";
import type { TelegramBotConfig } from "../config.js";
import { registerTailscaleCommand } from "./tailscale.js";

function createConfig(overrides: Partial<TelegramBotConfig> = {}): TelegramBotConfig {
  return {
    telegramBotToken: "token",
    allowedUserIds: new Set(),
    allowedChatIds: new Set(),
    ownerUserIds: new Set(["1"]),
    adminUserIds: new Set(),
    botMode: "polling",
    webhookUrl: undefined,
    webhookSecret: undefined,
    proxyAdminBaseUrl: "http://127.0.0.1:8318",
    proxyClientApiKey: undefined,
    defaultModel: "gpt-5.5",
    publicSignupEnabled: true,
    requireAdminApproval: false,
    defaultCustomerRoute: "customers",
    publicResponsesBaseUrl: "https://example.tailnet.ts.net/v1",
    proxyRequestTimeoutMs: 30_000,
    sessionDbPath: ":memory:",
    sessionTtlMs: 900_000,
    rateLimitWindowMs: 60_000,
    rateLimitMaxRequests: 12,
    logLevel: "info",
    ...overrides,
  };
}

function createBotHarness() {
  const handlers = new Map<string, (ctx: Context) => Promise<void> | void>();
  return {
    bot: {
      command(name: string, handler: (ctx: Context) => Promise<void> | void) {
        handlers.set(name, handler);
      },
    },
    handler(name: string) {
      const handler = handlers.get(name);
      assert.ok(handler);
      return handler;
    },
  };
}

function createContext(): Context & { replies: string[] } {
  const replies: string[] = [];
  return ({
    from: { id: 42, is_bot: false, first_name: "User" },
    chat: { id: 42, type: "private", first_name: "User" },
    message: {
      message_id: 1,
      date: 0,
      chat: { id: 42, type: "private", first_name: "User" },
      text: "/tailscale",
    },
    replies,
    reply(text: string) {
      replies.push(text);
      return Promise.resolve({} as any);
    },
  } as unknown) as Context & { replies: string[] };
}

test("tailscale command tells customer to ask admin for a fresh invite link", async () => {
  const deps = {
    config: createConfig(),
    proxyClient: {} as BotDependencies["proxyClient"],
  } satisfies BotDependencies;
  const harness = createBotHarness();
  registerTailscaleCommand(harness.bot as any, deps);

  const ctx = createContext();
  await harness.handler("tailscale")(ctx);

  assert.equal(ctx.replies.length, 1);
  assert.equal(ctx.replies[0].includes("Inbox admin in Telegram to get a fresh invite link"), true);
  assert.equal(ctx.replies[0].includes("https://example.tailnet.ts.net/v1"), true);
  assert.equal(ctx.replies[0].includes("https://login.tailscale.com/"), false);
});
