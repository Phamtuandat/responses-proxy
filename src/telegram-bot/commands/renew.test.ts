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
  const editedTexts: string[] = [];
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
    editedTexts,
    reply(text: string) {
      replies.push(text);
      return Promise.resolve({} as any);
    },
    answerCallbackQuery() {
      return Promise.resolve(true as any);
    },
    editMessageReplyMarkup() {
      return Promise.resolve({} as any);
    },
    editMessageText(text: string) {
      editedTexts.push(text);
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
      async editMessageText(_chatId: number, _messageId: number, text: string) {
        editedTexts.push(text);
        return {} as any;
      },
    },
  } as unknown) as Context & {
    match: string;
    replies: string[];
    sentMessages: Array<{ chatId: number; text: string }>;
    editedTexts: string[];
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

test("customer /renew without args shows a plan picker", async () => {
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

    assert.equal(ctx.replies[0], "Choose a plan for your renewal request.");
  });
});

test("customer can open the plan picker from the start button", async () => {
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

    assert.equal(ctx.replies[0], "Choose a plan for your renewal request.");
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
      match: "basic 15",
      sendMessageImpl: async (chatId, text) => {
        notified.push({ chatId, text });
      },
    });

    await harness.handler("renew")(ctx);

    assert.equal(billing.listRenewalRequests("open").length, 1);
    assert.equal(ctx.replies[0]?.includes("Renewal request submitted."), true);
    assert.equal(notified.length, 1);
    assert.equal(notified[0]?.chatId, 1);
    assert.equal(notified[0]?.text.includes("Renewal request."), true);
    assert.equal(notified[0]?.text.includes("customer: Atger | id=42"), true);
    assert.equal(notified[0]?.text.includes("requested_plan: basic (Basic)"), true);
    assert.equal(notified[0]?.text.includes("current_expiry:"), true);
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
      match: "basic 15",
      sendMessageImpl: async () => {
        throw new Error("telegram send failed");
      },
    });

    await harness.handler("renew")(ctx);

    assert.equal(billing.listRenewalRequests("open").length, 1);
    assert.equal(ctx.replies[0]?.includes("Renewal request submitted."), true);
    assert.equal(
      ctx.replies[1],
      "Admin notification could not be delivered. Your request is saved, but please contact support.",
    );
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
      match: "basic 15",
      sendMessageImpl: async (chatId, text) => {
        notified.push({ chatId, text });
      },
    });

    await harness.handler("renew")(ctx);

    assert.equal(billing.listRenewalRequests("open").length, 1);
    assert.equal(notified.length, 1);
    assert.equal(notified[0]?.text.includes("New access request."), true);
    assert.equal(notified[0]?.text.includes("key_preview:"), false);
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
      match: "basic 15",
    });
    const second = createContext({
      fromId: 42,
      chatId: 42,
      chatType: "private",
      match: "basic 15",
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
    assert.equal(ctx.replies[0]?.includes("Renewal request approved."), true);
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
    assert.equal(ctx.editedTexts[0]?.includes("Renewal request approved."), true);
    assert.equal(ctx.editedTexts[0]?.includes("status: approved"), true);
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
    assert.equal(ctx.sentMessages[0]?.text.includes("Your Responses access has been approved."), true);
    assert.equal(ctx.sentMessages[0]?.text.includes("api_key:"), true);
    assert.equal(auditLog.listEvents({ event: "api_key.revealed", limit: 5 }).length, 2);
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
    assert.equal(ctx.sentMessages[0]?.text.includes("Your Responses access has been approved."), true);
    assert.equal(ctx.sentMessages[0]?.text.includes("api_key:"), true);
    assert.equal(ctx.editedTexts[0]?.includes("Renewal request approved."), true);
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
    assert.equal(ctx.editedTexts[0]?.includes("days: 90"), true);
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
    assert.equal(ctx.sentMessages[0]?.chatId, 42);
    assert.equal(ctx.sentMessages[0]?.text.includes("Your renewal request was not approved."), true);
    assert.equal(ctx.sentMessages[0]?.text.includes("reason: rejected_unpaid"), true);
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

    const inputCtx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
    });
    (inputCtx as any).message.text = "45";
    await harness.runText(inputCtx as any);

    assert.equal(billing.getRenewalRequest(request.request.id)?.status, "approved");
    assert.equal(inputCtx.editedTexts[0]?.includes("days: 45"), true);
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
    assert.equal(inputCtx.editedTexts[0]?.includes("resolution: customer asked to pay later"), true);
    assert.equal(inputCtx.sentMessages[0]?.chatId, 42);
    assert.equal(inputCtx.sentMessages[0]?.text.includes("Your renewal request was not approved."), true);
    assert.equal(inputCtx.sentMessages[0]?.text.includes("reason: customer asked to pay later"), true);
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

    assert.equal(ctx.replies[0]?.includes("Customer renewal review"), true);
    assert.equal(ctx.replies[0]?.includes("customer: Atger | @atger | id=42"), true);
    assert.equal(ctx.replies[0]?.includes(`api_key: ${created.apiKey}`), true);
    assert.equal(ctx.replies[0]?.includes("request_status: open"), true);
    assert.equal(auditLog.listEvents({ event: "api_key.revealed", limit: 1 })[0]?.metadata.apiKey, "[redacted]");
  });
});
