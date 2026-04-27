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
import { registerRenewUserCommand } from "./renew-user.js";
import { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";
import type { TelegramBotConfig } from "../config.js";
import { grantCustomerAccess } from "../grants.js";

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
      text: `/renewuser ${input.match}`.trim(),
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
  const dir = mkdtempSync(path.join(os.tmpdir(), "renew-user-command-"));
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

test("renewuser is admin-only", async () => {
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
      fromId: 2,
      chatId: 2,
      chatType: "private",
      match: "1283361952 basic 30",
    });

    await harness.handler("renewuser")(ctx);
    assert.equal(ctx.replies[0], "Only admins can renew customer access.");
  });
});

test("renewuser replace-key does not print the new key into a group chat", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, deps }) => {
    await grantCustomerAccess({
      telegramUserId: "1283361952",
      planId: "basic",
      days: 30,
      defaultClientRoute: deps.config.defaultCustomerRoute,
      identities,
      workspaces,
      customerKeys,
      billing,
      proxyClient: deps.proxyClient,
      auditLog,
      actor: { type: "admin", id: "1" },
    });

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
      fromId: 1,
      chatId: -1001,
      chatType: "group",
      match: "1283361952 basic 30 replace-key",
    });

    await harness.handler("renewuser")(ctx);

    assert.equal(ctx.replies.length >= 1, true);
    assert.equal(ctx.replies[0].includes("api_key:"), false);
    assert.equal(
      ctx.replies[0].includes("api_key_delivery: replacement key is only shown in a private chat."),
      true,
    );
    assert.equal(ctx.sentMessages.length, 1);
    assert.equal(ctx.sentMessages[0]?.chatId, 1283361952);
    assert.equal(ctx.sentMessages[0]?.text.includes("api_key:"), true);
  });
});
