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
import type { RoutingCombo } from "./routing-combo-repository.js";

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
    lastChecked: Number.MAX_SAFE_INTEGER, // never expires within a test
  };
}

function comboWith(providerIds: string[], loadBalancing: RoutingCombo["policies"]["loadBalancing"]): RoutingCombo {
  return {
    id: "combo-1",
    name: "combo-1",
    isActive: true,
    isDefault: false,
    tiers: [
      {
        id: "tier-1",
        name: "tier-1",
        priority: 1,
        tier: "custom",
        isEnabled: true,
        fallbackDelay: 0,
        maxRetries: 0,
        providers: providerIds.map((providerId, index) => ({
          id: `binding-${index}`,
          providerId,
          weight: 1,
          isEnabled: true,
        })),
      },
    ],
    policies: {
      loadBalancing,
      failoverStrategy: "immediate",
      tokenBudgetMode: "unlimited",
    },
    clientRoutes: [],
    createdAt: "",
    updatedAt: "",
  };
}

async function makeEngine(providerIds: string[]) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-routing-engine-"));
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
  return { engine, tempDir };
}

test("round-robin rotates across eligible providers", async () => {
  const { engine, tempDir } = await makeEngine(["provider-a", "provider-b", "provider-c"]);
  try {
    const combo = comboWith(["provider-a", "provider-b", "provider-c"], "round_robin");
    const picks: string[] = [];
    for (let i = 0; i < 6; i++) {
      const result = await engine.selectProvider(combo, {
        route: "/v1/responses",
        clientRoute: "default",
        startTime: 0,
      });
      assert.equal(result.success, true);
      picks.push(result.provider!.id);
      engine.releaseConnection(result.provider!.id);
    }
    // Six calls over three providers must hit each exactly twice (true rotation),
    // not pin to one provider like the old route-hash behavior.
    const counts = picks.reduce<Record<string, number>>((acc, id) => {
      acc[id] = (acc[id] ?? 0) + 1;
      return acc;
    }, {});
    assert.deepEqual(counts, { "provider-a": 2, "provider-b": 2, "provider-c": 2 });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("acquire/release keeps the in-flight count balanced", async () => {
  const { engine, tempDir } = await makeEngine(["provider-a"]);
  try {
    const combo = comboWith(["provider-a"], "least_connections");
    const result = await engine.selectProvider(combo, {
      route: "/v1/responses",
      clientRoute: "default",
      startTime: 0,
    });
    assert.equal(result.success, true);
    // selectProvider acquires one connection; the caller must release it.
    assert.equal(engine.getActiveConnections("provider-a"), 1);
    engine.releaseConnection("provider-a");
    assert.equal(engine.getActiveConnections("provider-a"), 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("returns a clean failure when no tiers are enabled", async () => {
  const { engine, tempDir } = await makeEngine(["provider-a"]);
  try {
    const combo = comboWith(["provider-a"], "weighted");
    combo.tiers[0].isEnabled = false;
    const result = await engine.selectProvider(combo, {
      route: "/v1/responses",
      clientRoute: "default",
      startTime: 0,
    });
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /tier/i);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
