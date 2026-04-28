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
import { registerGrantCommand } from "./grant.js";
import { registerPlansCommand } from "./plans.js";

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
  return {
    async getClientConfigs() {
      return {
        clientRoutes: [{ key: "customers", apiKeys: [] }],
      };
    },
    async setClientRouteApiKeys() {
      return { ok: true };
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
    from: { id: input.fromId, is_bot: false, first_name: "Admin" },
    chat:
      input.chatType === "private"
        ? { id: input.chatId, type: "private", first_name: "Admin" }
        : { id: input.chatId, type: "group", title: "Ops" },
    message: {
      message_id: 1,
      date: 0,
      chat:
        input.chatType === "private"
          ? { id: input.chatId, type: "private", first_name: "Admin" }
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
  const dir = mkdtempSync(path.join(os.tmpdir(), "grant-command-"));
  try {
    const dbFile = path.join(dir, "bot.sqlite");
    await fn({
      identities: BotIdentityRepository.create(dbFile),
      workspaces: CustomerWorkspaceRepository.create(dbFile),
      customerKeys: CustomerKeyRepository.create(dbFile),
      billing: BillingRepository.create(dbFile),
      auditLog: AuditLogRepository.create(dbFile),
      deps: {
        config: createConfig({ sessionDbPath: dbFile }),
        proxyClient: createMockProxyClient() as any,
      },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("plans lists available seeded plan ids for admins", async () => {
  await withRepos(async ({ billing, deps }) => {
    const harness = createBotHarness();
    registerPlansCommand(harness.bot as any, deps, billing);

    const ctx = createContext({
      command: "plans",
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "",
    });

    await harness.handler("plans")(ctx);

    assert.equal(ctx.replies.length, 1);
    assert.equal(ctx.replies[0].includes("- trial:"), true);
    assert.equal(ctx.replies[0].includes("- basic:"), true);
  });
});

test("grant suggests valid plan ids when planId is unknown", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing, auditLog, deps }) => {
    const harness = createBotHarness();
    registerGrantCommand(harness.bot as any, deps, identities, workspaces, customerKeys, billing, auditLog);

    const ctx = createContext({
      command: "grant",
      fromId: 1,
      chatId: 1,
      chatType: "private",
      match: "42 pro 30",
    });

    await harness.handler("grant")(ctx);

    assert.equal(ctx.replies.length, 1);
    assert.equal(ctx.replies[0].includes("Unknown planId: pro"), true);
    assert.equal(ctx.replies[0].includes("Available planIds: basic, trial"), true);
  });
});
