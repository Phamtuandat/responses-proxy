import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Context } from "grammy";
import { BillingRepository } from "../../billing.js";
import { CustomerKeyRepository } from "../../customer-keys.js";
import type { BotDependencies } from "../actions.js";
import { BotIdentityRepository } from "../bot-identity-repository.js";
import type { TelegramBotConfig } from "../config.js";
import { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";
import { registerStartCommand } from "./start.js";

function createConfig(overrides: Partial<TelegramBotConfig> = {}): TelegramBotConfig {
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
    ...overrides,
  };
}

function createBotHarness() {
  const commandHandlers = new Map<string, (ctx: Context & { match?: string }) => Promise<void> | void>();
  const callbackHandlers: Array<{
    pattern: RegExp | string;
    handler: (ctx: Context & { match?: RegExpMatchArray | string[] }) => Promise<void> | void;
  }> = [];
  return {
    bot: {
      command(name: string, handler: (ctx: Context & { match?: string }) => Promise<void> | void) {
        commandHandlers.set(name, handler);
      },
      callbackQuery(
        pattern: RegExp | string,
        handler: (ctx: Context & { match?: RegExpMatchArray | string[] }) => Promise<void> | void,
      ) {
        callbackHandlers.push({ pattern, handler });
      },
    },
    handler(name: string) {
      const handler = commandHandlers.get(name);
      assert.ok(handler);
      return handler;
    },
    callbackHandler(data: string) {
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

function createContext(input: { fromId: number; chatId: number }) {
  const replies: Array<{ text: string; options?: any }> = [];
  const editedReplies: Array<{ text: string; options?: any }> = [];
  const answeredCallbacks: Array<{ text?: string; show_alert?: boolean }> = [];
  return ({
    from: { id: input.fromId, is_bot: false, first_name: "User" },
    chat: { id: input.chatId, type: "private", first_name: "User" },
    callbackQuery: {
      id: "callback-1",
      from: { id: input.fromId, is_bot: false, first_name: "User" },
      data: "callback",
      chat_instance: "chat",
      message: {
        message_id: 99,
        date: 0,
        chat: { id: input.chatId, type: "private", first_name: "User" },
        text: "Admin panel",
      },
    },
    match: "",
    replies,
    editedReplies,
    answeredCallbacks,
    reply(text: string, options?: any) {
      replies.push({ text, options });
      return Promise.resolve({} as any);
    },
    editMessageText(text: string, options?: any) {
      editedReplies.push({ text, options });
      return Promise.resolve({} as any);
    },
    answerCallbackQuery(payload?: { text?: string; show_alert?: boolean }) {
      answeredCallbacks.push(payload ?? {});
      return Promise.resolve(true);
    },
  } as unknown) as Context & {
    match: string;
    replies: Array<{ text: string; options?: any }>;
    editedReplies: Array<{ text: string; options?: any }>;
    answeredCallbacks: Array<{ text?: string; show_alert?: boolean }>;
  };
}

async function withRepos(
  fn: (args: {
    identities: BotIdentityRepository;
    workspaces: CustomerWorkspaceRepository;
    customerKeys: CustomerKeyRepository;
    billing: BillingRepository;
    deps: BotDependencies;
  }) => Promise<void>,
) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-start-test-"));
  const dbFile = path.join(dir, "bot.sqlite");
  try {
    const identities = BotIdentityRepository.create(dbFile);
    const workspaces = CustomerWorkspaceRepository.create(dbFile);
    const customerKeys = CustomerKeyRepository.create(dbFile);
    const billing = BillingRepository.create(dbFile);
    const deps: BotDependencies = {
      config: createConfig({ sessionDbPath: dbFile }),
      proxyClient: createMockProxyClient() as any,
    };
    await fn({ identities, workspaces, customerKeys, billing, deps });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function createMockProxyClient() {
  return {
    async getHealth() {
      return { ok: true };
    },
    async getProviders() {
      return { activeProviderId: "p1", providers: [{ id: "p1", name: "Provider 1" }], clientRoutes: [] };
    },
    async getLatestPromptCache() {
      return { latest: null };
    },
    async getUsageStats() {
      return { stats: { totalRequests: 1 } };
    },
    async getClientConfigs() {
      return { clients: {}, clientRoutes: [] };
    },
    async getModels() {
      return { models: ["gpt-test"] };
    },
    async getOauthStatus() {
      return { enabled: true, accounts: [] };
    },
  };
}

test("/start shows New button when the user has no active token", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, deps }) => {
    const harness = createBotHarness();
    registerStartCommand(harness.bot as any, deps, identities, workspaces, customerKeys, billing);
    const ctx = createContext({ fromId: 42, chatId: 42 });

    await harness.handler("start")(ctx as any);

    const firstResponse = ctx.editedReplies[0] ?? ctx.replies[0];
    const keyboard = JSON.parse(JSON.stringify(firstResponse?.options?.reply_markup));
    assert.equal(keyboard.inline_keyboard?.[0]?.[0]?.text, "🔐 View key");
    assert.equal(keyboard.inline_keyboard?.[0]?.[0]?.callback_data, "v1:customer:key");
    assert.equal(keyboard.inline_keyboard?.[1]?.[1]?.text, "🟢 New");
    assert.equal(keyboard.inline_keyboard?.[1]?.[1]?.callback_data, "v1:renew:open");
  });
});

test("/start shows Renew button when the user already has an active token", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, deps }) => {
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "42",
      clientRoute: "customers",
    });
    const harness = createBotHarness();
    registerStartCommand(harness.bot as any, deps, identities, workspaces, customerKeys, billing);
    const ctx = createContext({ fromId: 42, chatId: 42 });

    await harness.handler("start")(ctx as any);

    const firstResponse = ctx.editedReplies[0] ?? ctx.replies[0];
    const keyboard = JSON.parse(JSON.stringify(firstResponse?.options?.reply_markup));
    assert.equal(keyboard.inline_keyboard?.[0]?.[0]?.text, "🔐 View key");
    assert.equal(keyboard.inline_keyboard?.[0]?.[0]?.callback_data, "v1:customer:key");
    assert.equal(keyboard.inline_keyboard?.[1]?.[1]?.text, "🔵 Renew");
    assert.equal(keyboard.inline_keyboard?.[1]?.[1]?.callback_data, "v1:renew:open");
  });
});

test("/start shows admin panel for admins without creating a customer workspace", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, deps }) => {
    const harness = createBotHarness();
    registerStartCommand(harness.bot as any, deps, identities, workspaces, customerKeys, billing);
    const ctx = createContext({ fromId: 1, chatId: 1 });

    await harness.handler("start")(ctx as any);

    assert.equal(ctx.replies[0]?.text.includes("Admin panel"), true);
    assert.equal(workspaces.getDefaultWorkspace("1"), undefined);
    const keyboard = JSON.parse(JSON.stringify(ctx.replies[0]?.options?.reply_markup));
    assert.equal(keyboard.inline_keyboard?.[0]?.[0]?.text, "📈 Status");
    assert.equal(keyboard.inline_keyboard?.[0]?.[0]?.callback_data, "v1:admin:status");
    assert.equal(keyboard.inline_keyboard?.[2]?.[1]?.text, "🧾 Renewals");
    assert.equal(keyboard.inline_keyboard?.[2]?.[1]?.callback_data, "v1:admin:renewals");
  });
});

test("admin start panel buttons run real actions", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, deps }) => {
    const harness = createBotHarness();
    registerStartCommand(harness.bot as any, deps, identities, workspaces, customerKeys, billing);
    const found = harness.callbackHandler("v1:admin:status");
    const ctx = createContext({ fromId: 1, chatId: 1 });
    (ctx as any).match = found.match;

    await found.handler(ctx as any);

    assert.equal(ctx.answeredCallbacks[0]?.text, "Loaded");
    assert.equal(ctx.editedReplies[0]?.text.includes("Proxy status"), true);
    const loopKeyboard = JSON.parse(JSON.stringify(ctx.editedReplies[0]?.options?.reply_markup));
    assert.equal(loopKeyboard.inline_keyboard?.[0]?.[0]?.callback_data, "v1:admin:status");
    assert.equal(loopKeyboard.inline_keyboard?.[0]?.[1]?.callback_data, "v1:admin:providers");
    assert.equal(loopKeyboard.inline_keyboard?.[2]?.[1]?.callback_data, "v1:admin:menu");
  });
});

test("admin start panel can show billing plans and renewal requests", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, deps }) => {
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 30,
    });
    const harness = createBotHarness();
    registerStartCommand(harness.bot as any, deps, identities, workspaces, customerKeys, billing);

    const plans = harness.callbackHandler("v1:admin:plans");
    const plansCtx = createContext({ fromId: 1, chatId: 1 });
    (plansCtx as any).match = plans.match;
    await plans.handler(plansCtx as any);
    assert.equal(plansCtx.editedReplies[0]?.text.includes("Billing plans:"), true);
    const plansKeyboard = JSON.parse(JSON.stringify(plansCtx.editedReplies[0]?.options?.reply_markup));
    assert.equal(plansKeyboard.inline_keyboard?.[0]?.[0]?.callback_data, "v1:admin:plans");
    assert.equal(plansKeyboard.inline_keyboard?.[0]?.[1]?.callback_data, "v1:admin:renewals");

    const renewals = harness.callbackHandler("v1:admin:renewals");
    const renewalsCtx = createContext({ fromId: 1, chatId: 1 });
    (renewalsCtx as any).match = renewals.match;
    await renewals.handler(renewalsCtx as any);
    assert.equal(renewalsCtx.editedReplies[0]?.text.includes("Open renewal requests:"), true);
    assert.equal(renewalsCtx.editedReplies[0]?.text.includes("telegram_user_id=42"), true);
  });
});

test("admin start panel shows recent API keys with manage buttons", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, deps }) => {
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    const created = customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "42",
      clientRoute: "customers",
    });
    const harness = createBotHarness();
    registerStartCommand(harness.bot as any, deps, identities, workspaces, customerKeys, billing);

    const found = harness.callbackHandler("v1:admin:apikeys");
    const ctx = createContext({ fromId: 1, chatId: 1 });
    (ctx as any).match = found.match;
    await found.handler(ctx as any);

    assert.equal(ctx.editedReplies[0]?.text.includes("Customer API keys"), true);
    assert.equal(ctx.editedReplies[0]?.text.includes(`user=42`), true);
    assert.equal(ctx.editedReplies[0]?.text.includes(created.record.apiKeyPreview), true);
    const keyKeyboard = JSON.parse(JSON.stringify(ctx.editedReplies[0]?.options?.reply_markup));
    assert.equal(keyKeyboard.inline_keyboard?.[0]?.[0]?.copy_text?.text, created.record.id);
    const callbackButtons = keyKeyboard.inline_keyboard
      ?.flatMap((row: any[]) => row)
      .filter((button: any) => typeof button?.callback_data === "string")
      .map((button: any) => button.callback_data);
    assert.equal(callbackButtons.includes("v1:admin:apikeys"), true);
    assert.equal(callbackButtons.includes("v1:admin:plans"), true);
  });
});
