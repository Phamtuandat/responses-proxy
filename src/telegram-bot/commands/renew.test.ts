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
import { registerRenewCommand } from "./renew.js";
import { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";

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
  const handlers = new Map<string, (ctx: Context & { match?: string }) => Promise<void> | void>();
  return {
    bot: {
      command(name: string, handler: (ctx: Context & { match?: string }) => Promise<void> | void) {
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

function createContext(input: {
  fromId: number;
  chatId: number;
  chatType: "private" | "group";
  match: string;
  sendMessageImpl?: (chatId: number, text: string) => Promise<void>;
}) {
  const replies: string[] = [];
  const sentMessages: Array<{ chatId: number; text: string }> = [];
  const ctx = ({
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
      text: `/renew ${input.match}`.trim(),
    },
    match: input.match,
    replies,
    sentMessages,
    reply(text: string) {
      replies.push(text);
      return Promise.resolve({} as any);
    },
    api: {
      async sendMessage(chatId: number, text: string) {
        sentMessages.push({ chatId, text });
        if (input.sendMessageImpl) {
          await input.sendMessageImpl(chatId, text);
        }
        return {} as any;
      },
    },
  } as unknown) as Context & {
    match: string;
    replies: string[];
    sentMessages: Array<{ chatId: number; text: string }>;
  };
  return ctx;
}

async function withRepos(
  fn: (args: {
    identities: BotIdentityRepository;
    workspaces: CustomerWorkspaceRepository;
    customerKeys: CustomerKeyRepository;
    billing: BillingRepository;
    auditLog: AuditLogRepository;
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
      deps: {
        config: createConfig({ sessionDbPath: dbFile }),
        proxyClient: proxy.client as any,
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("customer /renew creates a renewal request and notifies admin", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, deps }) => {
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
    registerRenewCommand(harness.bot as any, deps, identities, workspaces, customerKeys, billing, auditLog);
    const ctx = createContext({
      fromId: 42,
      chatId: 42,
      chatType: "private",
      match: "basic 30",
    });

    await harness.handler("renew")(ctx);

    const requests = billing.listRenewalRequests("open");
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.requestedPlanId, "basic");
    assert.equal(requests[0]?.requestedDays, 30);
    assert.equal(ctx.replies[0]?.includes("Renewal request submitted."), true);
    assert.equal(ctx.sentMessages.length, 1);
    assert.equal(ctx.sentMessages[0]?.chatId, 1);
    assert.equal(ctx.sentMessages[0]?.text.includes("request_id:"), true);
  });
});

test("duplicate open /renew returns the existing request", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, deps }) => {
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
    registerRenewCommand(harness.bot as any, deps, identities, workspaces, customerKeys, billing, auditLog);

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
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, deps }) => {
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
    registerRenewCommand(harness.bot as any, deps, identities, workspaces, customerKeys, billing, auditLog);
    const ctx = createContext({
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: `approve ${request.request.id} basic 15`,
    });

    await harness.handler("renew")(ctx);

    const after = billing.getLatestSubscriptionForWorkspace(workspace.id);
    const updatedRequest = billing.getRenewalRequest(request.request.id);
    assert.ok(after);
    assert.ok(updatedRequest);
    assert.equal(updatedRequest?.status, "approved");
    assert.ok(new Date(after.currentPeriodEnd).getTime() > new Date(before.currentPeriodEnd).getTime());
    assert.equal(ctx.replies[0]?.includes("Renewal request approved."), true);
  });
});
