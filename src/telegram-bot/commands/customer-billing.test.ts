import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Context } from "grammy";
import { BillingRepository } from "../../billing.js";
import { CustomerKeyRepository } from "../../customer-keys.js";
import { BotIdentityRepository } from "../bot-identity-repository.js";
import { registerQuotaCommand } from "./quota.js";
import { registerUsageCommand } from "./usage.js";
import { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";

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

function createContext(input: { userId: number; chatId: number; chatType: "private" | "group"; command: string }) {
  const replies: string[] = [];
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
    reply(text: string) {
      replies.push(text);
      return Promise.resolve({} as any);
    },
  } as unknown) as Context & { replies: string[] };
}

async function withRepos(
  fn: (args: {
    identities: BotIdentityRepository;
    workspaces: CustomerWorkspaceRepository;
    customerKeys: CustomerKeyRepository;
    billing: BillingRepository;
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
