import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BillingRepository } from "./billing.js";
import { runBillingExpiration } from "./billing-expiration.js";
import { CustomerKeyRepository } from "./customer-keys.js";
import { CustomerWorkspaceRepository } from "./telegram-bot/customer-workspace-repository.js";

async function withRepos(
  fn: (args: {
    billing: BillingRepository;
    customerKeys: CustomerKeyRepository;
    workspaces: CustomerWorkspaceRepository;
  }) => Promise<void> | void,
): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "billing-expiration-"));
  try {
    const dbFile = path.join(dir, "bot.sqlite");
    await fn({
      billing: BillingRepository.create(dbFile),
      customerKeys: CustomerKeyRepository.create(dbFile),
      workspaces: CustomerWorkspaceRepository.create(dbFile),
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("expired subscription becomes expired and active key becomes suspended", async () => {
  await withRepos(async ({ billing, customerKeys, workspaces }) => {
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
      now: new Date("2026-04-20T00:00:00.000Z"),
    });
    const granted = billing.grantSubscription({
      workspaceId: workspace.id,
      planId: "trial",
      days: 1,
      now: new Date("2026-04-20T00:00:00.000Z"),
    });
    const created = customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "42",
      clientRoute: "customers",
      now: new Date("2026-04-20T00:00:00.000Z"),
    });

    const notifications: Array<{ telegramUserId: string; text: string }> = [];
    const summary = await runBillingExpiration({
      billing,
      customerKeys,
      workspaces,
      now: new Date("2026-04-22T00:00:00.000Z"),
      notifyCustomer: async (input) => {
        notifications.push(input);
      },
    });

    assert.equal(summary.expiredEntitlements, 1);
    assert.equal(summary.suspendedWorkspaces, 1);
    assert.equal(summary.suspendedKeys, 1);
    assert.equal(summary.notificationsSent, 1);
    assert.equal(billing.getLatestSubscriptionForWorkspace(workspace.id)?.status, "expired");
    assert.equal(billing.getLatestEntitlementForWorkspace(workspace.id)?.status, "expired");
    assert.equal(workspaces.getById(workspace.id)?.status, "suspended");
    assert.equal(customerKeys.getById(created.record.id)?.status, "suspended");
    assert.equal(notifications[0]?.telegramUserId, "42");
    assert.equal(notifications[0]?.text.includes(granted.entitlement.validUntil), true);
  });
});

test("running billing expiration twice is idempotent", async () => {
  await withRepos(async ({ billing, customerKeys, workspaces }) => {
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "77",
      defaultClientRoute: "customers",
      status: "active",
      now: new Date("2026-04-20T00:00:00.000Z"),
    });
    customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "77",
      clientRoute: "customers",
      now: new Date("2026-04-20T00:00:00.000Z"),
    });
    billing.grantSubscription({
      workspaceId: workspace.id,
      planId: "trial",
      days: 1,
      now: new Date("2026-04-20T00:00:00.000Z"),
    });

    const sent: string[] = [];
    const first = await runBillingExpiration({
      billing,
      customerKeys,
      workspaces,
      now: new Date("2026-04-22T00:00:00.000Z"),
      notifyCustomer: async ({ telegramUserId }) => {
        sent.push(telegramUserId);
      },
    });
    const second = await runBillingExpiration({
      billing,
      customerKeys,
      workspaces,
      now: new Date("2026-04-22T00:00:00.000Z"),
      notifyCustomer: async ({ telegramUserId }) => {
        sent.push(telegramUserId);
      },
    });

    assert.equal(first.suspendedWorkspaces, 1);
    assert.equal(first.suspendedKeys, 1);
    assert.equal(first.notificationsSent, 1);
    assert.equal(second.expiredEntitlements, 0);
    assert.equal(second.suspendedWorkspaces, 0);
    assert.equal(second.suspendedKeys, 0);
    assert.equal(second.notificationsSent, 0);
    assert.deepEqual(sent, ["77"]);
  });
});
