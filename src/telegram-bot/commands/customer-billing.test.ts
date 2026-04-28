import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Context } from "grammy";
import { AuditLogRepository } from "../../audit-log.js";
import { BillingRepository } from "../../billing.js";
import { CustomerKeyRepository } from "../../customer-keys.js";
import { BotIdentityRepository } from "../bot-identity-repository.js";
import { registerCustomerActionCallbacks } from "../customer-actions.js";
import { registerMeCommand } from "./me.js";
import { registerQuotaCommand } from "./quota.js";
import { registerUsageCommand } from "./usage.js";
import { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";

function createBotHarness() {
  const handlers = new Map<string, (ctx: Context) => Promise<void> | void>();
  const callbackHandlers: Array<{
    pattern: RegExp | string;
    handler: (ctx: Context & { match?: RegExpMatchArray | string[] }) => Promise<void> | void;
  }> = [];
  return {
    bot: {
      command(name: string, handler: (ctx: Context) => Promise<void> | void) {
        handlers.set(name, handler);
      },
      callbackQuery(
        pattern: RegExp | string,
        handler: (ctx: Context & { match?: RegExpMatchArray | string[] }) => Promise<void> | void,
      ) {
        callbackHandlers.push({ pattern, handler });
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
  };
}

function createContext(input: { userId: number; chatId: number; chatType: "private" | "group"; command: string }) {
  const replies: string[] = [];
  const replyOptions: unknown[] = [];
  const answeredCallbacks: Array<{ text?: string; show_alert?: boolean }> = [];
  return ({
    from: { id: input.userId, is_bot: false, first_name: "User" },
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
      text: `/${input.command}`,
    },
    replies,
    replyOptions,
    answeredCallbacks,
    reply(text: string, options?: unknown) {
      replies.push(text);
      replyOptions.push(options);
      return Promise.resolve({} as any);
    },
    answerCallbackQuery(payload?: { text?: string; show_alert?: boolean }) {
      answeredCallbacks.push(payload ?? {});
      return Promise.resolve(true);
    },
  } as unknown) as Context & { replies: string[]; replyOptions: unknown[]; answeredCallbacks: Array<{ text?: string; show_alert?: boolean }> };
}

async function withRepos(
  fn: (args: {
    identities: BotIdentityRepository;
    workspaces: CustomerWorkspaceRepository;
    customerKeys: CustomerKeyRepository;
    billing: BillingRepository;
    auditLog: AuditLogRepository;
  }) => Promise<void> | void,
): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "customer-billing-command-"));
  try {
    const dbFile = path.join(dir, "bot.sqlite");
    await fn({
      identities: BotIdentityRepository.create(dbFile),
      workspaces: CustomerWorkspaceRepository.create(dbFile),
      customerKeys: CustomerKeyRepository.create(dbFile),
      billing: BillingRepository.create(dbFile),
      auditLog: AuditLogRepository.create(dbFile),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("usage command shows zero usage for a new entitlement", async () => {
  await withRepos(async ({ workspaces, customerKeys, billing }) => {
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

    const harness = createBotHarness();
    registerUsageCommand(harness.bot as any, workspaces, customerKeys, billing);
    const ctx = createContext({ userId: 42, chatId: 42, chatType: "private", command: "usage" });

    await harness.handler("usage")(ctx);

    assert.equal(ctx.replies.length, 1);
    assert.equal(ctx.replies[0].includes("used_tokens: 0"), true);
    assert.equal(ctx.replies[0].includes("remaining_tokens: 1000000"), true);
  });
});

test("me command shows the full customer key only in private chat", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, auditLog }) => {
    identities.upsertUser({
      telegramUserId: "45",
      defaultRole: "customer",
      defaultStatus: "active",
    });
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "45",
      defaultClientRoute: "customers",
      status: "active",
    });
    const created = customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "45",
      clientRoute: "customers",
    });

    const harness = createBotHarness();
    registerMeCommand(harness.bot as any, identities, workspaces, customerKeys, auditLog);

    const privateCtx = createContext({ userId: 45, chatId: 45, chatType: "private", command: "me" });
    await harness.handler("me")(privateCtx);

    assert.equal(privateCtx.replies[0].includes(`api_key: ${created.apiKey}`), true);
    assert.equal(auditLog.listEvents({ event: "api_key.revealed", limit: 1 })[0]?.metadata.apiKey, "[redacted]");

    const groupCtx = createContext({ userId: 45, chatId: -45, chatType: "group", command: "me" });
    await harness.handler("me")(groupCtx);

    assert.equal(groupCtx.replies[0].includes("api_key:"), false);
    assert.equal(groupCtx.replies[0].includes("key_preview:"), true);
  });
});

test("quota command shows expired entitlement details", async () => {
  await withRepos(async ({ workspaces, customerKeys, billing }) => {
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "43",
      defaultClientRoute: "customers",
      status: "active",
    });
    customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "43",
      clientRoute: "customers",
    });
    const granted = billing.grantSubscription({
      workspaceId: workspace.id,
      planId: "trial",
      days: 1,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    billing.incrementEntitlementUsage({
      entitlementId: granted.entitlement.id,
      workspaceId: workspace.id,
      totalTokens: 11,
      inputTokens: 5,
      outputTokens: 6,
      now: new Date("2026-04-27T01:00:00.000Z"),
    });
    billing.expireEntitlements(new Date("2026-04-29T00:00:00.000Z"));

    const harness = createBotHarness();
    registerQuotaCommand(harness.bot as any, workspaces, customerKeys, billing);
    const ctx = createContext({ userId: 43, chatId: 43, chatType: "private", command: "quota" });

    await harness.handler("quota")(ctx);

    assert.equal(ctx.replies.length, 1);
    assert.equal(ctx.replies[0].includes("entitlement_status: expired"), true);
    assert.equal(ctx.replies[0].includes("used_tokens: 11"), true);
    assert.equal(ctx.replies[0].includes("remaining_tokens: 0"), true);
  });
});

test("usage command refuses to show customer details in group chat", async () => {
  await withRepos(async ({ workspaces, customerKeys, billing }) => {
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "44",
      defaultClientRoute: "customers",
      status: "active",
    });
    customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "44",
      clientRoute: "customers",
    });
    billing.grantSubscription({
      workspaceId: workspace.id,
      planId: "basic",
      days: 30,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });

    const harness = createBotHarness();
    registerUsageCommand(harness.bot as any, workspaces, customerKeys, billing);
    const ctx = createContext({ userId: 44, chatId: -1001, chatType: "group", command: "usage" });

    await harness.handler("usage")(ctx);

    assert.equal(ctx.replies[0], "For safety, open a private chat with this bot and run /usage there.");
  });
});

test("customer action buttons load key, usage, quota, and dashboard", async () => {
  await withRepos(async ({ workspaces, customerKeys, billing, auditLog }) => {
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "46",
      defaultClientRoute: "customers",
      status: "active",
    });
    const created = customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "46",
      clientRoute: "customers",
    });
    const granted = billing.grantSubscription({
      workspaceId: workspace.id,
      planId: "basic",
      days: 30,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    billing.incrementEntitlementUsage({
      entitlementId: granted.entitlement.id,
      workspaceId: workspace.id,
      totalTokens: 13,
      inputTokens: 5,
      outputTokens: 8,
      now: new Date("2026-04-27T01:00:00.000Z"),
    });

    const harness = createBotHarness();
    registerCustomerActionCallbacks(harness.bot as any, workspaces, customerKeys, billing, auditLog);

    const keyFound = harness.callbackHandler("v1:customer:key");
    const keyCtx = createContext({ userId: 46, chatId: 46, chatType: "private", command: "callback" });
    (keyCtx as any).match = keyFound.match;
    await keyFound.handler(keyCtx as any);

    assert.equal(keyCtx.answeredCallbacks[0]?.text, "Loaded");
    assert.equal(keyCtx.replies[0].includes(`api_key: ${created.apiKey}`), true);
    assert.ok(keyCtx.replyOptions[0]);
    assert.equal(auditLog.listEvents({ event: "api_key.revealed", limit: 1 })[0]?.metadata.apiKey, "[redacted]");

    const usageFound = harness.callbackHandler("v1:customer:usage");
    const usageCtx = createContext({ userId: 46, chatId: 46, chatType: "private", command: "callback" });
    (usageCtx as any).match = usageFound.match;
    await usageFound.handler(usageCtx as any);
    assert.equal(usageCtx.replies[0].includes("Your usage"), true);
    assert.equal(usageCtx.replies[0].includes("used_tokens: 13"), true);

    const quotaFound = harness.callbackHandler("v1:customer:quota");
    const quotaCtx = createContext({ userId: 46, chatId: 46, chatType: "private", command: "callback" });
    (quotaCtx as any).match = quotaFound.match;
    await quotaFound.handler(quotaCtx as any);
    assert.equal(quotaCtx.replies[0].includes("Your quota"), true);
    assert.equal(quotaCtx.replies[0].includes("remaining_tokens: 999987"), true);

    const dashboardFound = harness.callbackHandler("v1:customer:dashboard");
    const dashboardCtx = createContext({ userId: 46, chatId: 46, chatType: "private", command: "callback" });
    (dashboardCtx as any).match = dashboardFound.match;
    await dashboardFound.handler(dashboardCtx as any);
    assert.equal(dashboardCtx.answeredCallbacks[0]?.text, "Refreshed");
    assert.equal(dashboardCtx.replies[0].includes("Your dashboard"), true);
  });
});
