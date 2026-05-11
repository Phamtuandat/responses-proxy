import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Context } from "grammy";
import { BillingRepository } from "../../billing.js";
import { CustomerKeyRepository } from "../../customer-keys.js";
import { AuditLogRepository } from "../../audit-log.js";
import type { BotDependencies } from "../actions.js";
import { BotIdentityRepository } from "../bot-identity-repository.js";
import type { TelegramBotConfig } from "../config.js";
import { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";
import { SqliteSessionStore } from "../sessions.js";
import { registerRenewCommand } from "./renew.js";

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
    sepayAccountNumber: "8300138258001",
    sepayBankCode: "MBBank",
    sepayTemplate: "compact",
    sepayDownload: false,
    ...overrides,
  };
}

function createMockProxyClient() {
  let routeKeys: string[] = [];
  return {
    client: {
      async getClientConfigs() {
        return {
          clientRoutes: [{ key: "customers", apiKeys: [...routeKeys] }],
        };
      },
      async setClientRouteApiKeys(input: { client: string; apiKeys: string[] }) {
        if (input.client === "customers") {
          routeKeys = [...input.apiKeys];
        }
        return { ok: true };
      },
    },
  };
}

function createBotHarness() {
  const commandHandlers = new Map<string, (ctx: Context & { match?: string }) => Promise<void> | void>();
  const messageTextHandlers: Array<(ctx: Context & { match?: string }, next: () => Promise<void>) => Promise<void> | void> = [];
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
      on(event: string, handler: (ctx: Context & { match?: string }, next: () => Promise<void>) => Promise<void> | void) {
        if (event === "message:text") {
          messageTextHandlers.push(handler);
        }
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
      assert.fail(`missing callback handler for ${data}`);
    },
    async runText(ctx: Context & { match?: string }) {
      let index = 0;
      const next = async (): Promise<void> => {
        const handler = messageTextHandlers[index];
        index += 1;
        if (handler) {
          await handler(ctx, next);
        }
      };
      await next();
    },
  };
}

function createContext(input: {
  fromId: number;
  chatId: number;
  chatType: "private" | "group";
  match: string;
  callbackData?: string;
  sendMessageImpl?: (chatId: number, text: string) => Promise<void>;
}) {
  const replies: string[] = [];
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const sentDocuments: Array<{ chatId: number; filename?: string; content: string }> = [];
  const editedTexts: string[] = [];
  const replyMarkups: unknown[] = [];
  const editedMarkups: unknown[] = [];
  return ({
    from: { id: input.fromId, is_bot: false, first_name: "User" },
    chat:
      input.chatType === "private"
        ? { id: input.chatId, type: "private", first_name: "User" }
        : { id: input.chatId, type: "group", title: "Ops" },
    message: {
      message_id: 1,
      date: 0,
      chat:
        input.chatType === "private"
          ? { id: input.chatId, type: "private", first_name: "User" }
          : { id: input.chatId, type: "group", title: "Ops" },
      text: "/renew",
    },
    callbackQuery: input.callbackData
      ? {
          id: "callback-1",
          from: { id: input.fromId, is_bot: false, first_name: "User" },
          chat_instance: "chat",
          data: input.callbackData,
          message: {
            message_id: 99,
            date: 0,
            chat:
              input.chatType === "private"
                ? { id: input.chatId, type: "private", first_name: "User" }
                : { id: input.chatId, type: "group", title: "Ops" },
          },
        }
      : undefined,
    match: input.match,
    replies,
    sentMessages,
    sentDocuments,
    editedTexts,
    replyMarkups,
    editedMarkups,
    reply(text: string, options?: any) {
      replies.push(text);
      replyMarkups.push(options?.reply_markup);
      return Promise.resolve({} as any);
    },
    answerCallbackQuery() {
      return Promise.resolve(true as any);
    },
    editMessageReplyMarkup(options?: any) {
      editedMarkups.push(options?.reply_markup);
      return Promise.resolve({} as any);
    },
    editMessageText(text: string, options?: any) {
      editedTexts.push(text);
      editedMarkups.push(options?.reply_markup);
      return Promise.resolve({} as any);
    },
    api: {
      async sendMessage(chatId: number, text: string) {
        if (input.sendMessageImpl) {
          await input.sendMessageImpl(chatId, text);
        }
        sentMessages.push({ chatId, text });
        return {} as any;
      },
      async sendDocument(chatId: number, document: { filename?: string; fileData?: Uint8Array }) {
        sentDocuments.push({
          chatId,
          filename: document.filename,
          content: document.fileData ? Buffer.from(document.fileData).toString("utf8") : "",
        });
        return {} as any;
      },
      async editMessageText(_chatId: number, _messageId: number, text: string) {
        editedTexts.push(text);
        return {} as any;
      },
    },
  } as unknown) as Context & {
    match: string;
    replies: string[];
    sentMessages: Array<{ chatId: number; text: string }>;
    sentDocuments: Array<{ chatId: number; filename?: string; content: string }>;
    editedTexts: string[];
    replyMarkups: unknown[];
    editedMarkups: unknown[];
  };
}

async function withRepos(
  fn: (args: {
    identities: BotIdentityRepository;
    workspaces: CustomerWorkspaceRepository;
    customerKeys: CustomerKeyRepository;
    billing: BillingRepository;
    auditLog: AuditLogRepository;
    sessions: SqliteSessionStore;
    deps: BotDependencies;
  }) => Promise<void> | void,
): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "renew-command-"));
  try {
    const dbFile = path.join(dir, "bot.sqlite");
    const proxy = createMockProxyClient();
    await fn({
      identities: BotIdentityRepository.create(dbFile),
      workspaces: CustomerWorkspaceRepository.create(dbFile),
      customerKeys: CustomerKeyRepository.create(dbFile),
      billing: BillingRepository.create(dbFile),
      auditLog: AuditLogRepository.create(dbFile),
      sessions: SqliteSessionStore.create(dbFile, 60_000),
      deps: {
        config: createConfig({ sessionDbPath: dbFile }),
        proxyClient: proxy.client as any,
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("customer /renew without args creates a 24h purchase request", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const ctx = createContext({
      fromId: 42,
      chatId: 42,
      chatType: "private",
      match: "",
    });

    await harness.handler("renew")(ctx);

    const request = billing.listRenewalRequests("open")[0];
    assert.equal(request?.requestedDays, 1);
    assert.equal(request?.requestedPlanId, "basic");
    assert.equal(ctx.replies[0]?.includes("API key purchase request submitted."), true);
    assert.equal(ctx.replies[0]?.includes("plan: 5000 VND -> 10000000 tokens"), true);
    assert.equal(ctx.replies[0]?.includes("requested_plan_id: basic"), true);
    assert.equal(ctx.replies[0]?.includes("requested_days: 1"), true);
  });
});

test("customer can request 24h renewal from the start button", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const found = harness.callbackHandler("v1:renew:open");
    const ctx = createContext({
      fromId: 42,
      chatId: 42,
      chatType: "private",
      match: "",
      callbackData: "v1:renew:open",
    });
    (ctx as any).match = found.match;

    await found.handler(ctx as any);

    const request = billing.listRenewalRequests("open")[0];
    assert.equal(request?.requestedDays, 1);
    assert.equal(request?.requestedPlanId, "basic");
    assert.equal((ctx.replies[0] ?? ctx.editedTexts[0])?.includes("API key purchase request submitted."), true);
  });
});

test("customer can request token top-up from the dashboard button", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "42",
      clientRoute: "customers",
      status: "active",
    });
    billing.grantSubscription({
      workspaceId: workspace.id,
      planId: "basic",
      days: 1,
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const found = harness.callbackHandler("v1:topup:open");
    const ctx = createContext({
      fromId: 42,
      chatId: 42,
      chatType: "private",
      match: "",
      callbackData: "v1:topup:open",
    });

    await found.handler(ctx as any);

    const request = billing.listRenewalRequests("open")[0];
    assert.equal(request?.kind, "token_topup");
    assert.equal(request?.requestedTokenDelta, 10_000_000);
    assert.equal(request?.requestedTokenLotDays, 1);
    assert.equal((ctx.replies[0] ?? ctx.editedTexts[0])?.includes("Token top-up request submitted."), true);
  });
});

test("customer /renew creates a renewal request and notifies admin", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      firstName: "Atger",
      defaultRole: "customer",
      defaultStatus: "active",
    });
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
    billing.grantSubscription({
      workspaceId: workspace.id,
      planId: "basic",
      days: 30,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });

    const notified: Array<{ chatId: number; text: string }> = [];
    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const ctx = createContext({
      fromId: 42,
      chatId: 42,
      chatType: "private",
      match: "",
      sendMessageImpl: async (chatId, text) => {
        notified.push({ chatId, text });
      },
    });

    await harness.handler("renew")(ctx);

    assert.equal(billing.listRenewalRequests("open").length, 1);
    assert.equal(ctx.replies[0]?.includes("Renewal request submitted."), true);
    assert.equal(ctx.replies[0]?.includes("plan: 5000 VND -> 10000000 tokens"), true);
    assert.equal(ctx.replies[0]?.includes("Payment"), true);
    assert.equal(ctx.replies[0]?.includes("• Amount: 5,000 VND"), true);
    assert.equal(ctx.replies[0]?.includes("• Transfer note: Chuc ngon mieng ma "), true);
    assert.equal(ctx.replies[0]?.includes("• Scan QR: https://qr.sepay.vn/img?"), true);
    assert.equal(notified.length, 1);
    assert.equal(notified[0]?.chatId, 1);
    assert.equal(notified[0]?.text.includes("Renewal request"), true);
    assert.equal(notified[0]?.text.includes("• Telegram user: Atger | id=42"), true);
    assert.equal(notified[0]?.text.includes("• Requested plan: basic (Basic)"), true);
    assert.equal(notified[0]?.text.includes("• Requested days: 1"), true);
    assert.equal(notified[0]?.text.includes("• Current expiry:"), true);
  });
});

test("customer sees a warning when admin notification fails", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
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
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const ctx = createContext({
      fromId: 42,
      chatId: 42,
      chatType: "private",
      match: "",
      sendMessageImpl: async () => {
        throw new Error("telegram send failed");
      },
    });

    await harness.handler("renew")(ctx);

    assert.equal(billing.listRenewalRequests("open").length, 1);
    assert.equal(ctx.replies[0]?.includes("Renewal request submitted."), true);
    assert.equal(ctx.replies[0]?.includes("admin_notification: pending_manual_follow_up"), true);
  });
});

test("admin notification marks users without an active token as new access", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      firstName: "Atger",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });

    const notified: Array<{ chatId: number; text: string }> = [];
    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const ctx = createContext({
      fromId: 42,
      chatId: 42,
      chatType: "private",
      match: "",
      sendMessageImpl: async (chatId, text) => {
        notified.push({ chatId, text });
      },
    });

    await harness.handler("renew")(ctx);

    assert.equal(billing.listRenewalRequests("open").length, 1);
    assert.equal(notified.length, 1);
    assert.equal(notified[0]?.text.includes("New access request"), true);
    assert.equal(notified[0]?.text.includes("Key preview:"), false);
  });
});

test("admin can mark a renewal request as paid from command", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    const request = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 15,
      now: new Date("2026-04-28T00:00:00.000Z"),
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const ctx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: `paid ${request.request.id}`,
    });

    await harness.handler("renew")(ctx);

    const updatedRequest = billing.getRenewalRequest(request.request.id);
    assert.equal(updatedRequest?.status, "payment_confirmed");
    assert.equal(ctx.replies[0]?.includes("Payment confirmed manually."), true);
    assert.equal(ctx.replies[0]?.includes("• Amount: 5,000 VND"), true);
    assert.equal(JSON.stringify(ctx.replyMarkups[0]).includes("v1:renew:approve:"), true);
  });
});

test("admin can mark a renewal request as paid from callback button", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    const request = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 1,
      now: new Date("2026-04-28T00:00:00.000Z"),
    });
    const token = sessions.issueCallbackToken({
      kind: "renewal_request_action",
      action: "confirm_payment",
      requestId: request.request.id,
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const found = harness.callbackHandler(`v1:renew:confirm-payment:${token}`);
    const ctx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
      callbackData: `v1:renew:confirm-payment:${token}`,
    });
    (ctx as any).match = found.match;

    await found.handler(ctx as any);

    assert.equal(billing.getRenewalRequest(request.request.id)?.status, "payment_confirmed");
    assert.equal(ctx.editedTexts[0]?.includes("Payment confirmed manually."), true);
    assert.equal(ctx.editedTexts[0]?.includes("• Amount: 5,000 VND"), true);
    assert.ok(ctx.editedMarkups[0]);
    assert.equal(JSON.stringify(ctx.editedMarkups[0]).includes("v1:renew:approve:"), true);
  });
});

test("duplicate open /renew returns the existing request", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const first = createContext({
      fromId: 42,
      chatId: 42,
      chatType: "private",
      match: "",
    });
    const second = createContext({
      fromId: 42,
      chatId: 42,
      chatType: "private",
      match: "",
    });

    await harness.handler("renew")(first);
    await harness.handler("renew")(second);

    assert.equal(billing.listRenewalRequests("open").length, 1);
    assert.equal(second.replies[0]?.includes("You already have an open renewal request."), true);
  });
});

test("admin approve request extends subscription", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "42",
      clientRoute: "customers",
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    billing.grantSubscription({
      workspaceId: workspace.id,
      planId: "basic",
      days: 30,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    const request = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 15,
      now: new Date("2026-04-28T00:00:00.000Z"),
    });
    const before = billing.getLatestSubscriptionForWorkspace(workspace.id);
    assert.ok(before);
    billing.confirmRenewalPayment({ id: request.request.id });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const ctx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: `approve ${request.request.id} basic 15`,
    });

    await harness.handler("renew")(ctx);

    const after = billing.getLatestSubscriptionForWorkspace(workspace.id);
    const updatedRequest = billing.getRenewalRequest(request.request.id);
    const approvedEvent = auditLog.listEvents({ event: "renewal.approved", subjectId: request.request.id, limit: 1 })[0];
    assert.ok(after);
    assert.ok(approvedEvent);
    assert.ok(updatedRequest);
    assert.equal(updatedRequest?.status, "approved");
    assert.ok(new Date(after.currentPeriodEnd).getTime() > new Date(before.currentPeriodEnd).getTime());
    assert.equal(ctx.replies[0]?.includes("Renewal request approved"), true);
  });
});

test("admin close request records an audit event", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    const request = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 15,
      now: new Date("2026-04-28T00:00:00.000Z"),
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const ctx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: `close ${request.request.id} paid_offline`,
    });

    await harness.handler("renew")(ctx);

    const updatedRequest = billing.getRenewalRequest(request.request.id);
    const closedEvent = auditLog.listEvents({ event: "renewal.closed", subjectId: request.request.id, limit: 1 })[0];
    assert.ok(updatedRequest);
    assert.ok(closedEvent);
    assert.equal(updatedRequest?.status, "closed");
    assert.equal(updatedRequest?.resolution, "paid_offline");
    assert.equal(ctx.replies[0]?.includes("Renewal request closed."), true);
  });
});

test("admin can approve a renewal request from callback button", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "42",
      clientRoute: "customers",
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    billing.grantSubscription({
      workspaceId: workspace.id,
      planId: "basic",
      days: 30,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    const request = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 15,
      now: new Date("2026-04-28T00:00:00.000Z"),
    });
    billing.confirmRenewalPayment({ id: request.request.id });
    const token = sessions.issueCallbackToken({
      kind: "renewal_request_action",
      action: "approve",
      requestId: request.request.id,
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const found = harness.callbackHandler(`v1:renew:approve:${token}`);
    const ctx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
      callbackData: `v1:renew:approve:${token}`,
    });
    (ctx as any).match = found.match;

    await found.handler(ctx as any);

    assert.equal(billing.getRenewalRequest(request.request.id)?.status, "approved");
    assert.equal(ctx.editedTexts[0]?.includes("Renewal request approved"), true);
    assert.equal(ctx.editedTexts[0]?.includes("• Value: approved"), true);
    assert.equal(ctx.editedMarkups[0], undefined);
  });
});

test("admin approval of a new access request sends the full key to the customer", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    const request = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 15,
      now: new Date("2026-04-28T00:00:00.000Z"),
    });
    billing.confirmRenewalPayment({ id: request.request.id });
    const token = sessions.issueCallbackToken({
      kind: "renewal_request_action",
      action: "approve",
      requestId: request.request.id,
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const found = harness.callbackHandler(`v1:renew:approve:${token}`);
    const ctx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
      callbackData: `v1:renew:approve:${token}`,
    });
    (ctx as any).match = found.match;

    await found.handler(ctx as any);

    assert.equal(billing.getRenewalRequest(request.request.id)?.status, "approved");
    assert.equal(customerKeys.getActiveKeyForUser("42")?.status, "active");
    assert.equal(ctx.sentMessages[0]?.chatId, 42);
    assert.equal(ctx.sentMessages[0]?.text.includes("Your access has been approved"), true);
    assert.equal(ctx.sentMessages[0]?.text.includes("api_key:"), false);
    assert.deepEqual(ctx.sentDocuments.map((document) => document.filename), ["config.toml", "auth.json"]);
    assert.match(ctx.sentDocuments[0]?.content ?? "", /base_url = "http:\/\/127\.0\.0\.1:8318\/v1"/);
    assert.match(ctx.sentDocuments[0]?.content ?? "", /api_key = "sk-/);
    assert.match(ctx.sentDocuments[1]?.content ?? "", /"OPENAI_API_KEY": "sk-/);
    assert.equal(auditLog.listEvents({ event: "api_key.revealed", limit: 5 }).length, 2);
  });
});

test("admin can approve a token top-up request and create a new lot", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "42",
      clientRoute: "customers",
      status: "active",
    });
    billing.grantSubscription({
      workspaceId: workspace.id,
      planId: "basic",
      days: 1,
    });
    const request = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      kind: "token_topup",
      requestedTokenDelta: 1_000_000,
      requestedTokenLotDays: 7,
      priceVnd: 5_000,
    });
    billing.confirmRenewalPayment({ id: request.request.id });
    const token = sessions.issueCallbackToken({
      kind: "renewal_request_action",
      action: "approve",
      requestId: request.request.id,
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const found = harness.callbackHandler(`v1:renew:approve:${token}`);
    const ctx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
      callbackData: `v1:renew:approve:${token}`,
    });
    (ctx as any).match = found.match;

    await found.handler(ctx as any);

    const lots = billing.getActiveEntitlementLotsForWorkspace(workspace.id);
    assert.equal(billing.getRenewalRequest(request.request.id)?.status, "approved");
    assert.equal(lots.length >= 2, true);
    assert.equal(ctx.editedTexts[0]?.includes("Token top-up request approved"), true);
    assert.equal(ctx.editedTexts[0]?.includes("• Value: approved"), true);
  });
});

test("failed renewal approval closes request so customer can buy again", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    const first = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 1,
    });
    billing.confirmRenewalPayment({ id: first.request.id });
    const token = sessions.issueCallbackToken({
      kind: "renewal_request_action",
      action: "approve",
      requestId: first.request.id,
    });

    const proxy = deps.proxyClient as any;
    proxy.getClientConfigs = async () => {
      throw new Error("Dashboard login required");
    };

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);

    const approveFound = harness.callbackHandler(`v1:renew:approve:${token}`);
    const approveCtx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
      callbackData: `v1:renew:approve:${token}`,
    });
    (approveCtx as any).match = approveFound.match;
    await approveFound.handler(approveCtx as any);

    const failedRequest = billing.getRenewalRequest(first.request.id);
    assert.equal(failedRequest?.status, "closed");
    assert.equal(failedRequest?.resolution, "approval_failed");
    assert.equal(approveCtx.sentMessages.some((message) => message.chatId === 42), true);
    assert.equal(approveCtx.editedTexts[0]?.includes("Renewal approval failed."), true);
    assert.equal(approveCtx.editedTexts[0]?.includes("status: closed"), true);
    assert.equal(approveCtx.editedMarkups[0], undefined);

    const renewCtx = createContext({
      fromId: 42,
      chatId: 42,
      chatType: "private",
      match: "",
    });
    await harness.handler("renew")(renewCtx);

    const renewalRequests = billing.listRenewalRequests();
    assert.equal(renewalRequests.filter((request) => request.workspaceId === workspace.id).length, 2);
    assert.equal(renewalRequests[0]?.status, "open");
    assert.notEqual(renewalRequests[0]?.id, first.request.id);
    assert.equal(renewCtx.replies[0]?.includes("API key purchase request submitted."), true);
  });
});

test("admin approval falls back to default purchase plan for legacy 24h requests", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    const request = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedDays: 1,
      now: new Date("2026-04-28T00:00:00.000Z"),
    });
    billing.confirmRenewalPayment({ id: request.request.id });
    const token = sessions.issueCallbackToken({
      kind: "renewal_request_action",
      action: "approve",
      requestId: request.request.id,
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const found = harness.callbackHandler(`v1:renew:approve:${token}`);
    const ctx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
      callbackData: `v1:renew:approve:${token}`,
    });
    (ctx as any).match = found.match;

    await found.handler(ctx as any);

    const approved = billing.getRenewalRequest(request.request.id);
    assert.equal(approved?.status, "approved");
    assert.equal(approved?.approvedPlanId, "basic");
    assert.equal(customerKeys.getActiveKeyForUser("42")?.status, "active");
    assert.equal(ctx.editedTexts[0]?.includes("• Plan ID: basic"), true);
  });
});

test("admin can approve and rotate key from callback button", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    const firstKey = customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "42",
      clientRoute: "customers",
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    billing.grantSubscription({
      workspaceId: workspace.id,
      planId: "basic",
      days: 30,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    const request = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 15,
      now: new Date("2026-04-28T00:00:00.000Z"),
    });
    billing.confirmRenewalPayment({ id: request.request.id });
    const token = sessions.issueCallbackToken({
      kind: "renewal_request_action",
      action: "approve_rotate",
      requestId: request.request.id,
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const found = harness.callbackHandler(`v1:renew:approve-rotate:${token}`);
    const ctx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
      callbackData: `v1:renew:approve-rotate:${token}`,
    });
    (ctx as any).match = found.match;

    await found.handler(ctx as any);

    assert.equal(billing.getRenewalRequest(request.request.id)?.status, "approved");
    assert.equal(customerKeys.getById(firstKey.record.id)?.status, "revoked");
    assert.equal(customerKeys.getActiveKeyForUser("42")?.id === firstKey.record.id, false);
    assert.equal(ctx.sentMessages[0]?.chatId, 42);
    assert.equal(ctx.sentMessages[0]?.text.includes("Your access has been approved"), true);
    assert.equal(ctx.sentMessages[0]?.text.includes("api_key:"), false);
    assert.deepEqual(ctx.sentDocuments.map((document) => document.filename), ["config.toml", "auth.json"]);
    assert.match(ctx.sentDocuments[0]?.content ?? "", /base_url = "http:\/\/127\.0\.0\.1:8318\/v1"/);
    assert.match(ctx.sentDocuments[0]?.content ?? "", /api_key = "sk-/);
    assert.equal(ctx.editedTexts[0]?.includes("Renewal request approved"), true);
  });
});

test("admin can approve a renewal request with 90 day override", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "42",
      clientRoute: "customers",
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    billing.grantSubscription({
      workspaceId: workspace.id,
      planId: "basic",
      days: 30,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    const request = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 15,
      now: new Date("2026-04-28T00:00:00.000Z"),
    });
    const before = billing.getLatestSubscriptionForWorkspace(workspace.id);
    assert.ok(before);
    billing.confirmRenewalPayment({ id: request.request.id });
    const token = sessions.issueCallbackToken({
      kind: "renewal_request_action",
      action: "approve_override",
      requestId: request.request.id,
      overrideDays: 90,
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const found = harness.callbackHandler(`v1:renew:approve-90:${token}`);
    const ctx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
      callbackData: `v1:renew:approve-90:${token}`,
    });
    (ctx as any).match = found.match;

    await found.handler(ctx as any);

    const after = billing.getLatestSubscriptionForWorkspace(workspace.id);
    assert.ok(after);
    assert.equal(billing.getRenewalRequest(request.request.id)?.status, "approved");
    assert.ok(new Date(after.currentPeriodEnd).getTime() > new Date(before.currentPeriodEnd).getTime());
    assert.equal(ctx.editedTexts[0]?.includes("• Days: 90"), true);
  });
});

test("admin can reject a renewal request with a canned reason", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    const request = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 15,
      now: new Date("2026-04-28T00:00:00.000Z"),
    });
    billing.confirmRenewalPayment({ id: request.request.id });
    const token = sessions.issueCallbackToken({
      kind: "renewal_request_action",
      action: "reject_reason",
      requestId: request.request.id,
      resolution: "rejected_unpaid",
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const found = harness.callbackHandler(`v1:renew:reject:${token}`);
    const ctx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
      callbackData: `v1:renew:reject:${token}`,
    });
    (ctx as any).match = found.match;

    await found.handler(ctx as any);

    assert.equal(billing.getRenewalRequest(request.request.id)?.status, "closed");
    assert.equal(billing.getRenewalRequest(request.request.id)?.resolution, "rejected_unpaid");
    assert.equal(ctx.editedTexts[0]?.includes("resolution: rejected_unpaid"), true);
    assert.equal(ctx.editedMarkups[0], undefined);
    assert.equal(ctx.sentMessages[0]?.chatId, 42);
    assert.equal(ctx.sentMessages[0]?.text.includes("Your renewal request was not approved."), true);
    assert.equal(ctx.sentMessages[0]?.text.includes("reason: rejected_unpaid"), true);
  });
});

test("admin can switch between reject reasons and main renewal actions", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    const request = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 15,
      now: new Date("2026-04-28T00:00:00.000Z"),
    });
    const rejectToken = sessions.issueCallbackToken({
      kind: "renewal_request_action",
      action: "show_reject_reasons",
      requestId: request.request.id,
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const rejectFound = harness.callbackHandler(`v1:renew:reject-reasons:${rejectToken}`);
    const rejectCtx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
      callbackData: `v1:renew:reject-reasons:${rejectToken}`,
    });
    (rejectCtx as any).match = rejectFound.match;
    await rejectFound.handler(rejectCtx as any);
    assert.equal(rejectCtx.editedTexts[0]?.includes("Choose a rejection reason."), true);

    const backToken = sessions.issueCallbackToken({
      kind: "renewal_request_action",
      action: "show_main_actions",
      requestId: request.request.id,
    });
    const backFound = harness.callbackHandler(`v1:renew:back:${backToken}`);
    const backCtx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
      callbackData: `v1:renew:back:${backToken}`,
    });
    (backCtx as any).match = backFound.match;
    await backFound.handler(backCtx as any);
    assert.equal(
      backCtx.editedTexts[0]?.includes("Renewal request") || backCtx.editedTexts[0]?.includes("New access request"),
      true,
    );
    assert.equal(backCtx.editedTexts[0]?.includes(`• Request ID: ${request.request.id}`), true);
  });
});

test("admin can approve a renewal request with custom days input", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "42",
      clientRoute: "customers",
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    billing.grantSubscription({
      workspaceId: workspace.id,
      planId: "basic",
      days: 30,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    const request = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 15,
      now: new Date("2026-04-28T00:00:00.000Z"),
    });
    billing.confirmRenewalPayment({ id: request.request.id });
    const token = sessions.issueCallbackToken({
      kind: "renewal_request_action",
      action: "prompt_custom_days",
      requestId: request.request.id,
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const found = harness.callbackHandler(`v1:renew:approve-custom:${token}`);
    const callbackCtx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
      callbackData: `v1:renew:approve-custom:${token}`,
    });
    (callbackCtx as any).match = found.match;
    await found.handler(callbackCtx as any);
    assert.equal(callbackCtx.editedTexts[0]?.includes("Awaiting custom approval days."), true);

    const inputCtx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
    });
    (inputCtx as any).message.text = "45";
    await harness.runText(inputCtx as any);

    assert.equal(billing.getRenewalRequest(request.request.id)?.status, "approved");
    assert.equal(inputCtx.editedTexts.at(-1)?.includes("• Days: 45"), true);
  });
});

test("admin can reject a renewal request with custom reason input", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    const request = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 15,
      now: new Date("2026-04-28T00:00:00.000Z"),
    });
    billing.confirmRenewalPayment({ id: request.request.id });
    const token = sessions.issueCallbackToken({
      kind: "renewal_request_action",
      action: "prompt_custom_reason",
      requestId: request.request.id,
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const found = harness.callbackHandler(`v1:renew:reject-custom:${token}`);
    const callbackCtx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
      callbackData: `v1:renew:reject-custom:${token}`,
    });
    (callbackCtx as any).match = found.match;
    await found.handler(callbackCtx as any);
    assert.equal(callbackCtx.editedTexts[0]?.includes("Awaiting custom rejection reason."), true);

    const inputCtx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
    });
    (inputCtx as any).message.text = "customer asked to pay later";
    await harness.runText(inputCtx as any);

    assert.equal(billing.getRenewalRequest(request.request.id)?.status, "closed");
    assert.equal(billing.getRenewalRequest(request.request.id)?.resolution, "customer asked to pay later");
    assert.equal(inputCtx.editedTexts.at(-1)?.includes("resolution: customer asked to pay later"), true);
    assert.equal(inputCtx.sentMessages[0]?.chatId, 42);
    assert.equal(inputCtx.sentMessages[0]?.text.includes("Your renewal request was not approved."), true);
    assert.equal(inputCtx.sentMessages[0]?.text.includes("reason: customer asked to pay later"), true);
  });
});

test("admin /renew list renders open requests in one admin screen", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    const request = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 15,
      now: new Date("2026-04-28T00:00:00.000Z"),
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const ctx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "list",
    });

    await harness.handler("renew")(ctx as any);

    assert.equal(ctx.replies[0]?.includes("Open renewal requests:"), true);
    assert.equal(ctx.replies[0]?.includes(request.request.id), true);
    assert.ok(ctx.replyMarkups[0]);
  });
});

test("admin can view customer details from callback button", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      firstName: "Atger",
      username: "atger",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    const created = customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "42",
      clientRoute: "customers",
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    billing.grantSubscription({
      workspaceId: workspace.id,
      planId: "basic",
      days: 30,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    const request = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 15,
      now: new Date("2026-04-28T00:00:00.000Z"),
    });
    billing.confirmRenewalPayment({ id: request.request.id });
    const token = sessions.issueCallbackToken({
      kind: "renewal_request_action",
      action: "view_customer",
      requestId: request.request.id,
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const found = harness.callbackHandler(`v1:renew:view-customer:${token}`);
    const ctx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
      callbackData: `v1:renew:view-customer:${token}`,
    });
    (ctx as any).match = found.match;

    await found.handler(ctx as any);

    assert.equal(ctx.editedTexts[0]?.includes("Customer renewal review"), true);
    assert.equal(ctx.editedTexts[0]?.includes("customer: Atger | @atger | id=42"), true);
    assert.equal(ctx.editedTexts[0]?.includes(`api_key: ${created.apiKey}`), true);
    assert.equal(ctx.editedTexts[0]?.includes("request_status: payment_confirmed"), true);
    assert.equal(auditLog.listEvents({ event: "api_key.revealed", limit: 1 })[0]?.metadata.apiKey, "[redacted]");
  });
});

test("v1:renew:open callback refuses to run in a group chat", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const found = harness.callbackHandler("v1:renew:open");
    const ctx = createContext({
      fromId: 42,
      chatId: 999,
      chatType: "group",
      match: "",
      callbackData: "v1:renew:open",
    });
    (ctx as any).match = found.match;

    await found.handler(ctx as any);

    assert.equal(billing.listRenewalRequests("open").length, 0);
    assert.equal(ctx.replies.length, 0);
    assert.equal(ctx.editedTexts.length, 0);
  });
});

test("v1:topup:open callback refuses to run in a group chat", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "42",
      clientRoute: "customers",
      status: "active",
    });
    billing.grantSubscription({ workspaceId: workspace.id, planId: "basic", days: 1 });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const found = harness.callbackHandler("v1:topup:open");
    const ctx = createContext({
      fromId: 42,
      chatId: 999,
      chatType: "group",
      match: "",
      callbackData: "v1:topup:open",
    });
    (ctx as any).match = found.match;

    await found.handler(ctx as any);

    assert.equal(billing.listRenewalRequests("open").length, 0);
    assert.equal(ctx.replies.length, 0);
  });
});

test("/renew shows payment amount that matches the plan price", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    billing.createPlan({
      id: "premium",
      name: "Premium",
      monthlyTokenLimit: 50_000_000,
      maxApiKeys: 1,
      priceCents: 20_000,
      currency: "VND",
      billingInterval: "month",
    });
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
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
    // Seed an open request with explicit priceVnd matching premium plan.
    const created = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "premium",
      requestedDays: 30,
      priceVnd: 20_000,
    });

    // Confirm via the admin command path which derives amount from the request.
    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const ctx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: `paid ${created.request.id}`,
    });
    await harness.handler("renew")(ctx);

    assert.equal(ctx.replies[0]?.includes("Payment"), true);
    assert.equal(ctx.replies[0]?.includes("• Amount: 20,000 VND"), true);
    const paidEvent = auditLog.listEvents({ event: "payment.confirmed_manual", limit: 1 })[0];
    assert.equal(paidEvent?.metadata.amountVnd, 20_000);
  });
});

test("second admin approval does not double-provision the request", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    const request = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 15,
    });
    billing.confirmRenewalPayment({ id: request.request.id, expectedStatus: "open" });
    const firstToken = sessions.issueCallbackToken({
      kind: "renewal_request_action",
      action: "approve",
      requestId: request.request.id,
    });
    const secondToken = sessions.issueCallbackToken({
      kind: "renewal_request_action",
      action: "approve",
      requestId: request.request.id,
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);

    const first = harness.callbackHandler(`v1:renew:approve:${firstToken}`);
    const firstCtx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
      callbackData: `v1:renew:approve:${firstToken}`,
    });
    (firstCtx as any).match = first.match;
    await first.handler(firstCtx as any);

    const second = harness.callbackHandler(`v1:renew:approve:${secondToken}`);
    const secondCtx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
      callbackData: `v1:renew:approve:${secondToken}`,
    });
    (secondCtx as any).match = second.match;
    await second.handler(secondCtx as any);

    assert.equal(billing.getRenewalRequest(request.request.id)?.status, "approved");
    assert.equal(auditLog.listEvents({ event: "renewal.approved", subjectId: request.request.id, limit: 5 }).length, 1);
    assert.equal(auditLog.listEvents({ event: "subscription.renewed", limit: 5 }).length, 1);
  });
});

test("concurrent approve-transition guard prevents a second DB side-effect", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "approve-race-"));
  try {
    const dbFile = path.join(dir, "bot.sqlite");
    const billing = BillingRepository.create(dbFile);
    const workspaces = CustomerWorkspaceRepository.create(dbFile);
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    const request = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 1,
    });
    billing.confirmRenewalPayment({ id: request.request.id, expectedStatus: "open" });

    const firstApprove = billing.approveRenewalRequest({
      id: request.request.id,
      approvedPlanId: "basic",
      approvedDays: 1,
      expectedStatus: "payment_confirmed",
    });
    assert.ok(firstApprove);
    const secondApprove = billing.approveRenewalRequest({
      id: request.request.id,
      approvedPlanId: "basic",
      approvedDays: 1,
      expectedStatus: "payment_confirmed",
    });
    assert.equal(secondApprove, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("token top-up rolls back the lot when approve transition fails", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "42",
      clientRoute: "customers",
      status: "active",
    });
    billing.grantSubscription({ workspaceId: workspace.id, planId: "basic", days: 1 });
    const request = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      kind: "token_topup",
      requestedTokenDelta: 1_000_000,
      requestedTokenLotDays: 7,
      priceVnd: 5_000,
    });
    // Mark as approved directly: second approve attempt must not create a lot.
    billing.confirmRenewalPayment({ id: request.request.id, expectedStatus: "open" });
    billing.approveTokenTopUpRequest({
      id: request.request.id,
      approvedTokenDelta: 1_000_000,
      approvedTokenLotDays: 7,
    });
    const lotsBefore = billing.getActiveEntitlementLotsForWorkspace(workspace.id);

    const token = sessions.issueCallbackToken({
      kind: "renewal_request_action",
      action: "approve",
      requestId: request.request.id,
    });
    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const found = harness.callbackHandler(`v1:renew:approve:${token}`);
    const ctx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
      callbackData: `v1:renew:approve:${token}`,
    });
    (ctx as any).match = found.match;
    await found.handler(ctx as any);

    const lotsAfter = billing.getActiveEntitlementLotsForWorkspace(workspace.id);
    assert.equal(lotsAfter.length, lotsBefore.length);
  });
});

test("approving renewal also records user.approved when user is pending_approval", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, sessions, deps }) => {
    identities.upsertUser({
      telegramUserId: "42",
      defaultRole: "customer",
      defaultStatus: "pending_approval",
    });
    workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "pending_approval",
    });
    const request = billing.createRenewalRequest({
      workspaceId: (workspaces.getDefaultWorkspace("42") as any).id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 1,
    });
    billing.confirmRenewalPayment({ id: request.request.id, expectedStatus: "open" });
    const token = sessions.issueCallbackToken({
      kind: "renewal_request_action",
      action: "approve",
      requestId: request.request.id,
    });

    const harness = createBotHarness();
    registerRenewCommand(harness.bot as any, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
    const found = harness.callbackHandler(`v1:renew:approve:${token}`);
    const ctx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
      callbackData: `v1:renew:approve:${token}`,
    });
    (ctx as any).match = found.match;
    await found.handler(ctx as any);

    assert.equal(identities.getUser("42")?.status, "active");
    assert.equal(auditLog.listEvents({ event: "user.approved", limit: 5 }).length, 1);
    assert.equal(auditLog.listEvents({ event: "workspace.approved", limit: 5 }).length, 1);
  });
});
