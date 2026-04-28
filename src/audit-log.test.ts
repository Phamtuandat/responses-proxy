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
  const messageTextHandlers: Array<(ctx: Context & { match?: string }, next: () => Promise<void>) => Promise<void> | void> = [];
  const callbackHandlers: Array<{
    pattern: RegExp | string;
    handler: (ctx: Context & { match?: RegExpMatchArray | string[] }) => Promise<void> | void;
  }> = [];
  return {
    bot: {
      command(name: string, handler: (ctx: Context & { match?: string }) => Promise<void> | void) {
        handlers.set(name, handler);
      },
      callbackQuery(
        pattern: RegExp | string,
        handler: (ctx: Context & { match?: RegExpMatchArray | string[] }) => Promise<void> | void,
      ) {
        callbackHandlers.push({ pattern, handler });
      },
      on(filter: string, handler: (ctx: Context & { match?: string }, next: () => Promise<void>) => Promise<void> | void) {
        if (filter === "message:text") {
          messageTextHandlers.push(handler);
        }
      },
    },
    handler(name: string) {
      const handler = handlers.get(name);
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
    async runText(ctx: Context & { match?: string }) {
      let index = 0;
      const next = async (): Promise<void> => {
        const handler = messageTextHandlers[index++];
        if (handler) {
          await handler(ctx, next);
        }
      };
      await next();
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
  const replyMarkups: unknown[] = [];
  const answeredCallbacks: Array<{ text?: string; show_alert?: boolean }> = [];
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
    callbackQuery: {
      id: "callback-id",
      from: { id: input.fromId, is_bot: false, first_name: "User" },
      data: input.match,
      chat_instance: "chat-instance",
    },
    replies,
    replyMarkups,
    answeredCallbacks,
    reply(text: string, options?: { reply_markup?: unknown }) {
      replies.push(text);
      replyMarkups.push(options?.reply_markup);
      return Promise.resolve({} as any);
    },
    answerCallbackQuery(payload?: { text?: string; show_alert?: boolean }) {
      answeredCallbacks.push(payload ?? {});
      return Promise.resolve(true);
    },
    api: {
      async sendMessage() {
        return {} as any;
      },
    },
  } as unknown) as Context & { match: string; replies: string[]; replyMarkups: unknown[]; answeredCallbacks: Array<{ text?: string; show_alert?: boolean }> };
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
    assert.equal(customerKeys.getActiveKeyForUser("42")?.status, "active");
    assert.equal(ctx.replies[0]?.includes("api_key:"), true);

    const customerCtx = createContext({
      command: "apikey",
      fromId: 42,
      chatId: 42,
      chatType: "private",
      match: "",
    });
    await harness.handler("apikey")(customerCtx);

    assert.equal(customerCtx.replies[0]?.includes("api_key:"), true);
    assert.equal(customerCtx.replies[0]?.includes("full_key: unavailable_for_legacy_key"), false);
  });
});

test("admin can list, show, suspend, activate, and rotate customer API keys", async () => {
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

    const issueCtx = createContext({
      command: "apikey",
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "issue 42 customers",
    });
    await harness.handler("apikey")(issueCtx);

    const firstKey = customerKeys.getActiveKeyForUser("42");
    assert.ok(firstKey);

    const listCtx = createContext({
      command: "apikey",
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "list 42",
    });
    await harness.handler("apikey")(listCtx);
    assert.equal(listCtx.replies[0]?.includes(firstKey.id), true);
    assert.equal(listCtx.replies[0]?.includes("status=active"), true);
    assert.ok(listCtx.replyMarkups[0]);
    const listKeyboard = JSON.parse(JSON.stringify(listCtx.replyMarkups[0]));
    assert.equal(listKeyboard.inline_keyboard?.[0]?.[0]?.copy_text?.text, firstKey.id);

    const pasteCtx = createContext({
      command: "message",
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: firstKey.id,
    });
    (pasteCtx as any).message.text = firstKey.id;
    await harness.runText(pasteCtx);
    assert.equal(pasteCtx.replies[0]?.includes("Customer API key"), true);
    assert.equal(pasteCtx.replies[0]?.includes(`key_id: ${firstKey.id}`), true);
    assert.ok(pasteCtx.replyMarkups[0]);

    const callbackShow = harness.callbackHandler(`v1:apikey:show:${firstKey.id}`);
    const callbackShowCtx = createContext({
      command: "callback",
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: `v1:apikey:show:${firstKey.id}`,
    });
    (callbackShowCtx as any).match = callbackShow.match;
    await callbackShow.handler(callbackShowCtx as any);

    assert.equal(callbackShowCtx.answeredCallbacks[0]?.text, "Key details loaded");
    assert.equal(callbackShowCtx.replies[0]?.includes("api_key:"), true);
    assert.ok(callbackShowCtx.replyMarkups[0]);

    const showCtx = createContext({
      command: "apikey",
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: `show ${firstKey.id}`,
    });
    await harness.handler("apikey")(showCtx);
    assert.equal(showCtx.replies[0]?.includes("api_key:"), true);
    assert.equal(auditLog.listEvents({ event: "api_key.revealed", limit: 1 })[0]?.metadata.apiKey, "[redacted]");

    const suspendFound = harness.callbackHandler(`v1:apikey:suspend:${firstKey.id}`);
    const suspendCtx = createContext({
      command: "callback",
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: `v1:apikey:suspend:${firstKey.id}`,
    });
    (suspendCtx as any).match = suspendFound.match;
    await suspendFound.handler(suspendCtx as any);
    assert.equal(customerKeys.getById(firstKey.id)?.status, "suspended");
    assert.equal(suspendCtx.answeredCallbacks[0]?.text, "Key suspended");
    assert.equal(suspendCtx.replies[0]?.includes("proxy_sync: removed_from_route"), true);

    const activateFound = harness.callbackHandler(`v1:apikey:activate:${firstKey.id}`);
    const activateCtx = createContext({
      command: "callback",
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: `v1:apikey:activate:${firstKey.id}`,
    });
    (activateCtx as any).match = activateFound.match;
    await activateFound.handler(activateCtx as any);
    assert.equal(customerKeys.getById(firstKey.id)?.status, "active");
    assert.equal(activateCtx.answeredCallbacks[0]?.text, "Key activated");
    assert.equal(activateCtx.replies[0]?.includes("proxy_sync: added_to_route"), true);

    const rotateFound = harness.callbackHandler(`v1:apikey:rotate:${firstKey.id}`);
    const rotateCtx = createContext({
      command: "callback",
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: `v1:apikey:rotate:${firstKey.id}`,
    });
    (rotateCtx as any).match = rotateFound.match;
    await rotateFound.handler(rotateCtx as any);

    const nextKey = customerKeys.getActiveKeyForUser("42");
    assert.ok(nextKey);
    assert.notEqual(nextKey.id, firstKey.id);
    assert.equal(customerKeys.getById(firstKey.id)?.status, "revoked");
    assert.equal(rotateCtx.answeredCallbacks[0]?.text, "Key rotated");
    assert.equal(rotateCtx.replies[0]?.includes(`new_key_id: ${nextKey.id}`), true);
    assert.equal(rotateCtx.replies[0]?.includes("api_key:"), true);
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

test("apikey issue in admin group without explicit key is rejected before creating a secret", async () => {
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

    assert.equal(
      ctx.replies[0],
      "Run /apikey issue in a private admin chat when generating a new key, or provide an explicit apiKey.",
    );
    assert.equal(customerKeys.listKeysByWorkspace(workspace.id).length, 0);
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
