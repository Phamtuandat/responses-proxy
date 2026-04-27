import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BillingRepository } from "./billing.js";
import { CustomerKeyRepository } from "./customer-keys.js";
import { resolveCustomerRoutingAccess } from "./customer-key-access.js";
import { RuntimeProviderRepository, type RuntimeProviderPreset } from "./runtime-provider-repository.js";
import { CustomerWorkspaceRepository } from "./telegram-bot/customer-workspace-repository.js";

function createProvider(id: string): RuntimeProviderPreset {
  return {
    id,
    name: id,
    baseUrl: `https://${id}.example/v1`,
    responsesUrl: `https://${id}.example/v1/responses`,
    providerApiKeys: [`${id}-provider-key`],
    clientApiKeys: [],
    capabilities: {
      usageCheckEnabled: false,
      stripMaxOutputTokens: false,
      requestParameterPolicy: {},
      sanitizeReasoningSummary: false,
      stripModelPrefixes: [],
    },
  };
}

async function createRepositories() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "customer-key-access-"));
  const providerDbFile = path.join(dir, "app.sqlite");
  const workspaceDbFile = path.join(dir, "bot.sqlite");
  const legacyStateFile = path.join(dir, "providers.json");
  const providerRepository = await RuntimeProviderRepository.create({
    dbFile: providerDbFile,
    legacyStateFile,
    baseProviders: [createProvider("provider-a"), createProvider("provider-b")],
  });
  providerRepository.setClientRoute("customers", "provider-a");
  return {
    dir,
    providerRepository,
    customerKeys: CustomerKeyRepository.create(workspaceDbFile),
    workspaces: CustomerWorkspaceRepository.create(workspaceDbFile),
    billing: BillingRepository.create(workspaceDbFile),
  };
}

test("customer key resolves to its bound client route provider", async () => {
  const repos = await createRepositories();
  try {
    const workspace = repos.workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    const created = repos.customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "42",
      clientRoute: "customers",
    });
    repos.billing.grantSubscription({
      workspaceId: workspace.id,
      planId: "basic",
      days: 30,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });

    const result = resolveCustomerRoutingAccess({
      routingApiKey: created.apiKey,
      resolvedClientRoute: "default",
      providerRepository: repos.providerRepository,
      customerKeyRepository: repos.customerKeys,
      workspaceRepository: repos.workspaces,
      billingRepository: repos.billing,
    });

    assert.equal("kind" in result && result.kind, "customer");
    if ("kind" in result && result.kind === "customer") {
      assert.equal(result.clientRoute, "customers");
      assert.equal(result.providers[0]?.id, "provider-a");
      assert.equal(result.entitlement.workspaceId, workspace.id);
    }
  } finally {
    rmSync(repos.dir, { recursive: true, force: true });
  }
});

test("suspended customer key is rejected before operator routing", async () => {
  const repos = await createRepositories();
  try {
    const workspace = repos.workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    const created = repos.customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "42",
      clientRoute: "customers",
    });
    repos.customerKeys.setStatus(created.record.id, "suspended");

    const result = resolveCustomerRoutingAccess({
      routingApiKey: created.apiKey,
      resolvedClientRoute: "default",
      providerRepository: repos.providerRepository,
      customerKeyRepository: repos.customerKeys,
      workspaceRepository: repos.workspaces,
      billingRepository: repos.billing,
    });

    assert.equal("error" in result, true);
    if ("error" in result) {
      assert.equal(result.error.statusCode, 403);
      assert.equal(result.error.body.error.code, "API_KEY_SUSPENDED");
    }
  } finally {
    rmSync(repos.dir, { recursive: true, force: true });
  }
});

test("customer key without active entitlement is rejected", async () => {
  const repos = await createRepositories();
  try {
    const workspace = repos.workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    const created = repos.customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: "42",
      clientRoute: "customers",
    });

    const result = resolveCustomerRoutingAccess({
      routingApiKey: created.apiKey,
      resolvedClientRoute: "default",
      providerRepository: repos.providerRepository,
      customerKeyRepository: repos.customerKeys,
      workspaceRepository: repos.workspaces,
      billingRepository: repos.billing,
    });

    assert.equal("error" in result, true);
    if ("error" in result) {
      assert.equal(result.error.statusCode, 403);
      assert.equal(result.error.body.error.code, "SUBSCRIPTION_REQUIRED");
    }
  } finally {
    rmSync(repos.dir, { recursive: true, force: true });
  }
});

test("operator keys continue to use runtime provider repository access", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "customer-key-access-operator-"));
  try {
    const dbFile = path.join(dir, "app.sqlite");
    const legacyStateFile = path.join(dir, "providers.json");
    const botDbFile = path.join(dir, "bot.sqlite");
    const providerRepository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [createProvider("provider-a")],
    });
    providerRepository.setClientRoute("default", "provider-a");
    providerRepository.setClientRouteApiKeys("default", ["operator-key"]);

    const result = resolveCustomerRoutingAccess({
      routingApiKey: "operator-key",
      resolvedClientRoute: "default",
      providerRepository,
      customerKeyRepository: CustomerKeyRepository.create(botDbFile),
      workspaceRepository: CustomerWorkspaceRepository.create(botDbFile),
      billingRepository: BillingRepository.create(botDbFile),
    });

    assert.equal("kind" in result && result.kind, "operator");
    if ("kind" in result && result.kind === "operator") {
      assert.equal(result.clientRoute, "default");
      assert.equal(result.providers[0]?.id, "provider-a");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
