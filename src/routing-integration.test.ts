import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  RuntimeProviderRepository,
  type RuntimeProviderPreset,
} from "./runtime-provider-repository.js";
import { RoutingEngine, type ProviderHealth } from "./routing-engine.js";
import { RoutingComboRepository, type RoutingComboInput } from "./routing-combo-repository.js";
import {
  resolveProviderWithRouting,
  type RoutingIntegrationContext,
  type RoutingRequest,
} from "./routing-integration.js";

function caps(): RuntimeProviderPreset["capabilities"] {
  return {
    usageCheckEnabled: false,
    stripMaxOutputTokens: false,
    requestParameterPolicy: {},
    sanitizeReasoningSummary: false,
    stripModelPrefixes: [],
  };
}

function providerPreset(id: string): RuntimeProviderPreset {
  return {
    id,
    name: id,
    baseUrl: `https://${id}.example/v1`,
    responsesUrl: `https://${id}.example/v1/responses`,
    authMode: "api_key",
    providerApiKeys: [`${id}-key`],
    clientApiKeys: [],
    capabilities: caps(),
  };
}

function healthy(providerId: string): ProviderHealth {
  return {
    providerId,
    isHealthy: true,
    averageResponseTime: 100,
    errorRate: 0,
    quotaUsagePercent: 0,
    hasValidAccounts: true,
    accountsNearExpiry: false,
    lastChecked: Number.MAX_SAFE_INTEGER,
  };
}

function comboInput(name: string, providerId: string, isDefault: boolean): RoutingComboInput {
  return {
    name,
    isActive: true,
    isDefault,
    tiers: [
      {
        id: "tier-1",
        name: "tier-1",
        priority: 1,
        tier: "custom",
        isEnabled: true,
        fallbackDelay: 0,
        maxRetries: 0,
        providers: [{ id: "binding-1", providerId, weight: 1, isEnabled: true }],
      },
    ],
    policies: {
      loadBalancing: "weighted",
      failoverStrategy: "immediate",
      tokenBudgetMode: "unlimited",
    },
    clientRoutes: [],
  };
}

async function harness(providerIds: string[]) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-routing-integration-"));
  const repo = await RuntimeProviderRepository.create({
    dbFile: path.join(tempDir, "app.sqlite"),
    legacyStateFile: path.join(tempDir, "providers.json"),
    baseProviders: providerIds.map(providerPreset),
  });
  const healthCache = new Map<string, ProviderHealth>();
  for (const id of providerIds) {
    healthCache.set(id, healthy(id));
  }
  const engine = new RoutingEngine(repo, healthCache);
  const comboRepo = new RoutingComboRepository(repo.getDatabase());
  const context: RoutingIntegrationContext = {
    routingComboRepository: comboRepo,
    routingEngine: engine,
    // healthService is only used by recordRequestResult, not the selection path.
    healthService: { recordRequestResult() {} } as unknown as RoutingIntegrationContext["healthService"],
  };
  return { repo, engine, comboRepo, context, tempDir };
}

function request(allowed: RuntimeProviderPreset[]): RoutingRequest {
  return {
    clientRoute: "default",
    providers: allowed,
    providerHint: {},
    requestId: "req-1",
    startedAt: 0,
    headers: {},
    metadata: undefined,
  };
}

test("assigned combo cannot route to a provider outside the key's allowed set", async () => {
  const { repo, comboRepo, context, tempDir } = await harness(["provider-a", "provider-b"]);
  try {
    // Combo routes to provider-b, but the key is only entitled to provider-a.
    const combo = await comboRepo.createCombo(comboInput("combo-b", "provider-b", false));
    await comboRepo.assignClientRouteCombo("default", combo.id);

    const allowedA = repo.getProvider("provider-a")!;
    const result = await resolveProviderWithRouting(request([allowedA]), context);

    assert.ok(!("error" in result));
    // Entitlement guard: falls back to the allowed provider, never serves B.
    assert.equal(result.provider.id, "provider-a");
    assert.equal(result.matchReason, "fallback");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("default combo cannot override the key's allowed set", async () => {
  const { repo, comboRepo, context, tempDir } = await harness(["provider-a", "provider-b"]);
  try {
    const combo = await comboRepo.createCombo(comboInput("default-b", "provider-b", true));
    await comboRepo.setDefaultCombo(combo.id);

    const allowedA = repo.getProvider("provider-a")!;
    const result = await resolveProviderWithRouting(request([allowedA]), context);

    assert.ok(!("error" in result));
    assert.equal(result.provider.id, "provider-a");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("combo IS used when its provider is within the allowed set", async () => {
  const { repo, comboRepo, context, tempDir } = await harness(["provider-a", "provider-b"]);
  try {
    const combo = await comboRepo.createCombo(comboInput("combo-b", "provider-b", false));
    await comboRepo.assignClientRouteCombo("default", combo.id);

    const allowed = [repo.getProvider("provider-a")!, repo.getProvider("provider-b")!];
    const result = await resolveProviderWithRouting(request(allowed), context);

    assert.ok(!("error" in result));
    assert.equal(result.provider.id, "provider-b");
    assert.equal(result.matchReason, "routing_combo");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("assignClientRouteCombo replaces the prior assignment (deterministic lookup)", async () => {
  const { comboRepo, tempDir } = await harness(["provider-a", "provider-b"]);
  try {
    const comboA = await comboRepo.createCombo(comboInput("combo-a", "provider-a", false));
    const comboB = await comboRepo.createCombo(comboInput("combo-b", "provider-b", false));
    await comboRepo.assignClientRouteCombo("default", comboA.id);
    await comboRepo.assignClientRouteCombo("default", comboB.id);

    assert.equal(await comboRepo.getClientRouteCombo("default"), comboB.id);
    assert.deepEqual(await comboRepo.getComboClientRoutes(comboA.id), []);
    assert.deepEqual(await comboRepo.getComboClientRoutes(comboB.id), ["default"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("getDefaultCombo ignores an inactive default combo", async () => {
  const { comboRepo, tempDir } = await harness(["provider-a"]);
  try {
    const input = comboInput("default-a", "provider-a", true);
    input.isActive = false;
    await comboRepo.createCombo(input);
    assert.equal(await comboRepo.getDefaultCombo(), null);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
