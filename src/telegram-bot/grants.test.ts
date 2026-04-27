import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BillingRepository } from "../billing.js";
import { CustomerKeyRepository } from "../customer-keys.js";
import { BotIdentityRepository } from "./bot-identity-repository.js";
import { CustomerWorkspaceRepository } from "./customer-workspace-repository.js";
import { grantCustomerAccess, renewCustomerAccess } from "./grants.js";

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
    getRouteKeys() {
      return [...routeKeys];
    },
  };
}

async function withRepos(
  fn: (args: {
    identities: BotIdentityRepository;
    workspaces: CustomerWorkspaceRepository;
    customerKeys: CustomerKeyRepository;
    billing: BillingRepository;
  }) => Promise<void> | void,
): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "grant-customer-access-"));
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

test("grantCustomerAccess creates workspace, entitlement, and a new key", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing }) => {
    const proxy = createMockProxyClient();
    const result = await grantCustomerAccess({
      telegramUserId: "1283361952",
      planId: "basic",
      days: 30,
      defaultClientRoute: "customers",
      identities,
      workspaces,
      customerKeys,
      billing,
      proxyClient: proxy.client as any,
    });

    assert.equal(result.mode, "new_key_created");
    assert.equal(typeof result.apiKey, "string");
    assert.equal(proxy.getRouteKeys().length, 1);
    assert.equal(identities.getUser("1283361952")?.status, "active");
    assert.equal(workspaces.getDefaultWorkspace("1283361952")?.status, "active");
    assert.ok(billing.getActiveEntitlementForWorkspace(result.workspaceId));
  });
});

test("grantCustomerAccess reactivates an existing suspended key", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing }) => {
    const proxy = createMockProxyClient();
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "suspended",
    });
    const created = customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "42",
      clientRoute: "customers",
    });
    customerKeys.setStatus(created.record.id, "suspended");

    const result = await grantCustomerAccess({
      telegramUserId: "42",
      planId: "basic",
      days: 7,
      defaultClientRoute: "customers",
      identities,
      workspaces,
      customerKeys,
      billing,
      proxyClient: proxy.client as any,
    });

    assert.equal(result.mode, "existing_key_reactivated");
    assert.equal(result.apiKey, undefined);
    assert.equal(customerKeys.getActiveKeyForUser("42")?.id, created.record.id);
    assert.equal(workspaces.getById(workspace.id)?.status, "active");
  });
});

test("renewCustomerAccess extends an active subscription window", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing }) => {
    const proxy = createMockProxyClient();
    const first = await grantCustomerAccess({
      telegramUserId: "77",
      planId: "basic",
      days: 30,
      defaultClientRoute: "customers",
      identities,
      workspaces,
      customerKeys,
      billing,
      proxyClient: proxy.client as any,
    });

    const before = billing.getLatestSubscriptionForWorkspace(first.workspaceId);
    assert.ok(before);

    const renewed = await renewCustomerAccess({
      telegramUserId: "77",
      planId: "basic",
      days: 15,
      defaultClientRoute: "customers",
      identities,
      workspaces,
      customerKeys,
      billing,
      proxyClient: proxy.client as any,
    });

    const after = billing.getLatestSubscriptionForWorkspace(first.workspaceId);
    assert.ok(after);
    assert.equal(renewed.mode, "existing_key_already_active");
    assert.ok(new Date(after.currentPeriodEnd).getTime() > new Date(before.currentPeriodEnd).getTime());
  });
});

test("renewCustomerAccess can replace the latest key", async () => {
  await withRepos(async ({ identities, workspaces, customerKeys, billing }) => {
    const proxy = createMockProxyClient();
    const first = await grantCustomerAccess({
      telegramUserId: "88",
      planId: "basic",
      days: 30,
      defaultClientRoute: "customers",
      identities,
      workspaces,
      customerKeys,
      billing,
      proxyClient: proxy.client as any,
    });

    const previousKey = customerKeys.getLatestKeyForUser("88");
    assert.ok(previousKey);

    const renewed = await renewCustomerAccess({
      telegramUserId: "88",
      planId: "basic",
      days: 30,
      replaceKey: true,
      defaultClientRoute: "customers",
      identities,
      workspaces,
      customerKeys,
      billing,
      proxyClient: proxy.client as any,
    });

    const latestKey = customerKeys.getLatestKeyForUser("88");
    assert.equal(renewed.mode, "existing_key_replaced");
    assert.equal(typeof renewed.apiKey, "string");
    assert.ok(latestKey);
    assert.notEqual(latestKey.id, previousKey.id);
    assert.equal(customerKeys.getById(previousKey.id)?.status, "revoked");
    assert.equal(customerKeys.getById(latestKey.id)?.status, "active");
    assert.equal(proxy.getRouteKeys().includes(renewed.apiKey as string), true);
    assert.equal(first.apiKey === renewed.apiKey, false);
  });
});
