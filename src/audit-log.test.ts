import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Context } from "grammy";
import { AuditLogRepository } from "./audit-log.js";
import { BillingRepository } from "./billing.js";
import { CustomerKeyRepository } from "./customer-keys.js";
import { registerApiKeyCommand } from "./telegram-bot/commands/apikey.js";
import { registerGrantCommand } from "./telegram-bot/commands/grant.js";
import { registerRenewUserCommand } from "./telegram-bot/commands/renew-user.js";
import type { BotDependencies } from "./telegram-bot/actions.js";
import { BotIdentityRepository } from "./telegram-bot/bot-identity-repository.js";
import type { TelegramBotConfig } from "./telegram-bot/config.js";
import { CustomerWorkspaceRepository } from "./telegram-bot/customer-workspace-repository.js";
import { grantCustomerAccess } from "./telegram-bot/grants.js";

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
  command: string;
  fromId: number;
  chatId: number;
  chatType: "private" | "group";
  match: string;
}) {
  const replies: string[] = [];
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
      text: `/${input.command} ${input.match}`.trim(),
    },
    match: input.match,
    replies,
    reply(text: string) {
      replies.push(text);
      return Promise.resolve({} as any);
    },
    api: {
      async sendMessage() {
        return {} as any;
      },
    },
  } as unknown) as Context & { match: string; replies: string[] };
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
  const dir = mkdtempSync(path.join(os.tmpdir(), "audit-log-"));
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

test("AuditLogRepository redacts full API keys in metadata", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "audit-redaction-"));
  try {
    const repo = AuditLogRepository.create(path.join(dir, "audit.sqlite"));
    repo.record({
      event: "api_key.revealed",
      actor: { type: "admin", id: "1" },
      subjectType: "customer_api_key",
      subjectId: "key-1",
      metadata: {
        apiKey: "sk-customer-secret-value",
        keyPreview: "sk-customer-...value",
      },
    });

    const event = repo.listEvents({ event: "api_key.revealed", limit: 1 })[0];
    assert.ok(event);
    assert.equal(event.metadata.apiKey, "[redacted]");
    assert.equal(event.metadata.keyPreview, "sk-customer-...value");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("grantCustomerAccess writes audit events for lifecycle mutations", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, deps }) => {
    await grantCustomerAccess({
      telegramUserId: "1283361952",
      planId: "basic",
      days: 30,
      defaultClientRoute: "customers",
      identities,
      workspaces,
      customerKeys,
      billing,
      proxyClient: deps.proxyClient,
      auditLog,
      actor: { type: "admin", id: "1" },
    });

    const events = auditLog.listEvents();
    const names = new Set(events.map((event) => event.event));
    assert.equal(names.has("user.created"), true);
    assert.equal(names.has("workspace.created"), true);
    assert.equal(names.has("api_key.created"), true);
    assert.equal(names.has("subscription.granted"), true);
  });
});

test("apikey issue writes redacted reveal audit metadata", async () => {
  await withRepos(async ({ workspaces, customerKeys, billing, auditLog, deps }) => {
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    billing.grantSubscription({
      workspaceId: workspace.id,
      planId: "basic",
      days: 30,
    });

    const harness = createBotHarness();
    registerApiKeyCommand(harness.bot as any, deps, customerKeys, workspaces, billing, auditLog);

    const ctx = createContext({
      command: "apikey",
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "issue 42 customers",
    });

    await harness.handler("apikey")(ctx);

    const event = auditLog.listEvents({ event: "api_key.revealed", limit: 1 })[0];
    assert.ok(event);
    assert.equal(event.metadata.apiKey, "[redacted]");
  });
});

test("grant in admin group does not print the full key or reveal it in audit", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, deps }) => {
    const harness = createBotHarness();
    registerGrantCommand(harness.bot as any, deps, identities, workspaces, customerKeys, billing, auditLog);

    const ctx = createContext({
      command: "grant",
      fromId: 1,
      chatId: -1001,
      chatType: "group",
      match: "42 basic 30",
    });

    await harness.handler("grant")(ctx);

    assert.equal(ctx.replies[0]?.includes("api_key:"), false);
    assert.equal(ctx.replies[0]?.includes("api_key_delivery: full key is only shown in a private admin chat."), true);
    assert.equal(auditLog.listEvents({ event: "api_key.revealed", limit: 1 }).length, 0);
  });
});

test("apikey issue in admin group does not print the full key or reveal it in audit", async () => {
  await withRepos(async ({ workspaces, customerKeys, billing, auditLog, deps }) => {
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    billing.grantSubscription({
      workspaceId: workspace.id,
      planId: "basic",
      days: 30,
    });

    const harness = createBotHarness();
    registerApiKeyCommand(harness.bot as any, deps, customerKeys, workspaces, billing, auditLog);

    const ctx = createContext({
      command: "apikey",
      fromId: 1,
      chatId: -1001,
      chatType: "group",
      match: "issue 42 customers",
    });

    await harness.handler("apikey")(ctx);

    assert.equal(ctx.replies[0]?.includes("api_key:"), false);
    assert.equal(ctx.replies[0]?.includes("api_key_delivery: full key is only shown in a private admin chat."), true);
    assert.equal(auditLog.listEvents({ event: "api_key.revealed", limit: 1 }).length, 0);
  });
});

test("apikey issue respects the workspace maxApiKeys limit", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, deps }) => {
    await grantCustomerAccess({
      telegramUserId: "42",
      planId: "basic",
      days: 30,
      defaultClientRoute: "customers",
      identities,
      workspaces,
      customerKeys,
      billing,
      proxyClient: deps.proxyClient,
      auditLog,
      actor: { type: "admin", id: "1" },
    });

    const harness = createBotHarness();
    registerApiKeyCommand(harness.bot as any, deps, customerKeys, workspaces, billing, auditLog);

    const ctx = createContext({
      command: "apikey",
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "issue 42 customers",
    });

    await harness.handler("apikey")(ctx);

    assert.equal(
      ctx.replies[0],
      "API key limit reached for this workspace (1/1). Revoke or rotate an existing key first.",
    );
    assert.equal(customerKeys.listKeysByWorkspace(workspaces.getDefaultWorkspace("42")!.id).length, 1);
  });
});

test("failed authorization does not write success audit events", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, deps }) => {
    const harness = createBotHarness();
    registerRenewUserCommand(
      harness.bot as any,
      deps,
      identities,
      workspaces,
      customerKeys,
      billing,
      auditLog,
    );

    const ctx = createContext({
      command: "renewuser",
      fromId: 2,
      chatId: 2,
      chatType: "private",
      match: "42 basic 30",
    });

    await harness.handler("renewuser")(ctx);

    assert.equal(ctx.replies[0], "Only admins can renew customer access.");
    assert.equal(auditLog.listEvents().length, 0);
  });
});
