import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import BetterSqlite3 from "better-sqlite3";
import { readConfig } from "./config.js";
import {
  buildBuiltinProviderPresets,
  normalizeClientRouteKey,
  resolveClientTokenWindowStart,
  RuntimeProviderRepository,
  type RuntimeProviderPreset,
} from "./runtime-provider-repository.js";

test("refreshes unmodified seeded providers from current base config", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  const initialBaseProviders: RuntimeProviderPreset[] = [
    {
      id: "krouter",
      name: "krouter",
      baseUrl: "https://api.krouter.net/v1",
      responsesUrl: "https://api.krouter.net/v1/responses",
      providerApiKeys: ["provider-key"],
      clientApiKeys: ["client-key"],
      capabilities: {
        usageCheckEnabled: false,
        stripMaxOutputTokens: false,
        requestParameterPolicy: {},
        sanitizeReasoningSummary: false,
        stripModelPrefixes: [],
      },
    },
  ];

  const nextBaseProviders: RuntimeProviderPreset[] = [
    {
      id: "krouter",
      name: "krouter",
      baseUrl: "https://krouter.net/v1",
      responsesUrl: "https://krouter.net/v1/responses",
      providerApiKeys: ["provider-key"],
      clientApiKeys: ["client-key"],
      capabilities: {
        usageCheckEnabled: false,
        stripMaxOutputTokens: true,
        requestParameterPolicy: {
          maxOutputTokens: {
            mode: "strip",
          },
        },
        sanitizeReasoningSummary: false,
        stripModelPrefixes: [],
      },
    },
  ];

  try {
    const firstRepository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: initialBaseProviders,
    });
    assert.equal(firstRepository.getProvider("krouter")?.baseUrl, "https://api.krouter.net/v1");
    assert.equal(firstRepository.getProvider("krouter")?.capabilities.stripMaxOutputTokens, false);

    const secondRepository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: nextBaseProviders,
    });
    const provider = secondRepository.getProvider("krouter");

    assert.equal(provider?.baseUrl, "https://krouter.net/v1");
    assert.equal(provider?.responsesUrl, "https://krouter.net/v1/responses");
    assert.equal(provider?.capabilities.stripMaxOutputTokens, true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("derives the primary built-in provider identity from the upstream host", () => {
  const config = readConfig({
    PORT: "8318",
    HOST: "0.0.0.0",
    UPSTREAM_BASE_URL: "https://krouter.net/v1",
    UPSTREAM_API_KEY: "provider-key",
    APP_DB_PATH: "./logs/app.sqlite",
  });

  const [provider] = buildBuiltinProviderPresets(config);
  assert.equal(provider?.id, "krouter");
  assert.equal(provider?.name, "krouter");
});

test("reads persisted client token limit configuration", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "provider-a",
          name: "provider-a",
          baseUrl: "https://provider-a.example/v1",
          responsesUrl: "https://provider-a.example/v1/responses",
          providerApiKeys: ["provider-key"],
          clientApiKeys: [],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
      ],
    });

    const now = "2026-04-27T13:00:00.000Z";
    const db = new BetterSqlite3(dbFile);
    db.prepare(
      `INSERT INTO client_token_limits (
        client_route, enabled, token_limit, window_type, window_size_seconds, hard_block, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("codex", 1, 500000, "daily", null, 1, now, now);
    db.close();

    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [],
    });

    assert.deepEqual(repository.getClientTokenLimit("codex"), {
      clientRoute: "codex",
      enabled: true,
      tokenLimit: 500000,
      windowType: "daily",
      windowSizeSeconds: undefined,
      hardBlock: true,
      createdAt: now,
      updatedAt: now,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("upserts and deletes client token limit configuration", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "provider-a",
          name: "provider-a",
          baseUrl: "https://provider-a.example/v1",
          responsesUrl: "https://provider-a.example/v1/responses",
          providerApiKeys: ["provider-key"],
          clientApiKeys: [],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
      ],
    });

    const created = repository.setClientTokenLimit("codex", {
      enabled: true,
      tokenLimit: 1000,
      windowType: "monthly",
      hardBlock: true,
    });
    assert.equal(created.clientRoute, "codex");
    assert.equal(created.windowType, "monthly");
    assert.equal(created.tokenLimit, 1000);

    const updated = repository.setClientTokenLimit("codex", {
      enabled: false,
      tokenLimit: 500,
      windowType: "fixed",
      windowSizeSeconds: 3600,
      hardBlock: false,
    });
    assert.equal(updated.enabled, false);
    assert.equal(updated.tokenLimit, 500);
    assert.equal(updated.windowType, "fixed");
    assert.equal(updated.windowSizeSeconds, 3600);
    assert.equal(updated.hardBlock, false);

    assert.equal(repository.deleteClientTokenLimit("codex"), true);
    assert.equal(repository.getClientTokenLimit("codex"), undefined);
    assert.equal(repository.deleteClientTokenLimit("codex"), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("reads empty client token usage as zeros for the current window", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "provider-a",
          name: "provider-a",
          baseUrl: "https://provider-a.example/v1",
          responsesUrl: "https://provider-a.example/v1/responses",
          providerApiKeys: ["provider-key"],
          clientApiKeys: [],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
      ],
    });

    const now = new Date("2026-04-27T13:45:30.000Z");
    assert.deepEqual(repository.getClientTokenUsage("codex", now), {
      clientRoute: "codex",
      windowStart: "2026-04-27T00:00:00.000Z",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      updatedAt: "2026-04-27T00:00:00.000Z",
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("increments client token usage within the same window", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "provider-a",
          name: "provider-a",
          baseUrl: "https://provider-a.example/v1",
          responsesUrl: "https://provider-a.example/v1/responses",
          providerApiKeys: ["provider-key"],
          clientApiKeys: [],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
      ],
    });

    repository.setClientTokenLimit("codex", {
      enabled: true,
      tokenLimit: 5000,
      windowType: "daily",
      hardBlock: true,
    });

    const at = new Date("2026-04-27T13:45:30.000Z");
    repository.incrementClientTokenUsage(
      "codex",
      { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
      at,
    );
    const snapshot = repository.incrementClientTokenUsage(
      "codex",
      { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
      at,
    );

    assert.deepEqual(snapshot, {
      clientRoute: "codex",
      windowStart: "2026-04-27T00:00:00.000Z",
      inputTokens: 150,
      outputTokens: 35,
      totalTokens: 185,
      updatedAt: "2026-04-27T13:45:30.000Z",
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("increments client token usage into a new window without changing the previous one", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "provider-a",
          name: "provider-a",
          baseUrl: "https://provider-a.example/v1",
          responsesUrl: "https://provider-a.example/v1/responses",
          providerApiKeys: ["provider-key"],
          clientApiKeys: [],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
      ],
    });

    repository.setClientTokenLimit("codex", {
      enabled: true,
      tokenLimit: 5000,
      windowType: "fixed",
      windowSizeSeconds: 3600,
      hardBlock: true,
    });

    repository.incrementClientTokenUsage(
      "codex",
      { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      new Date("2026-04-27T13:15:00.000Z"),
    );
    repository.incrementClientTokenUsage(
      "codex",
      { inputTokens: 200, outputTokens: 40, totalTokens: 240 },
      new Date("2026-04-27T14:05:00.000Z"),
    );

    assert.deepEqual(repository.getClientTokenUsage("codex", new Date("2026-04-27T13:30:00.000Z")), {
      clientRoute: "codex",
      windowStart: "2026-04-27T13:00:00.000Z",
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      updatedAt: "2026-04-27T13:15:00.000Z",
    });
    assert.deepEqual(repository.getClientTokenUsage("codex", new Date("2026-04-27T14:10:00.000Z")), {
      clientRoute: "codex",
      windowStart: "2026-04-27T14:00:00.000Z",
      inputTokens: 200,
      outputTokens: 40,
      totalTokens: 240,
      updatedAt: "2026-04-27T14:05:00.000Z",
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("reset clears the current client token usage window", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "provider-a",
          name: "provider-a",
          baseUrl: "https://provider-a.example/v1",
          responsesUrl: "https://provider-a.example/v1/responses",
          providerApiKeys: ["provider-key"],
          clientApiKeys: [],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
      ],
    });

    repository.setClientTokenLimit("codex", {
      enabled: true,
      tokenLimit: 5000,
      windowType: "daily",
      hardBlock: true,
    });

    repository.incrementClientTokenUsage(
      "codex",
      { inputTokens: 100, outputTokens: 25, totalTokens: 125 },
      new Date("2026-04-27T13:00:00.000Z"),
    );
    const reset = repository.resetClientTokenUsage("codex", new Date("2026-04-27T14:00:00.000Z"));

    assert.deepEqual(reset, {
      clientRoute: "codex",
      windowStart: "2026-04-27T00:00:00.000Z",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      updatedAt: "2026-04-27T14:00:00.000Z",
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("lists client token limits with current usage snapshots", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "provider-a",
          name: "provider-a",
          baseUrl: "https://provider-a.example/v1",
          responsesUrl: "https://provider-a.example/v1/responses",
          providerApiKeys: ["provider-key"],
          clientApiKeys: [],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
      ],
    });

    repository.setClientRoute("codex", "provider-a");

    const now = "2026-04-27T13:00:00.000Z";
    const db = new BetterSqlite3(dbFile);
    db.prepare(
      `INSERT INTO client_token_limits (
        client_route, enabled, token_limit, window_type, window_size_seconds, hard_block, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("codex", 1, 1000, "daily", null, 1, now, now);
    db.prepare(
      `INSERT INTO client_token_usage (
        client_route, window_start, input_tokens, output_tokens, total_tokens, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("codex", "2026-04-27T00:00:00.000Z", 100, 50, 150, now);
    db.close();

    const views = repository.listClientTokenLimitsForUi(new Date(now));
    const codexView = views.find((entry) => entry.clientRoute === "codex");

    assert.equal(codexView?.config?.tokenLimit, 1000);
    assert.equal(codexView?.usage.totalTokens, 150);
    assert.equal(codexView?.usage.windowStart, "2026-04-27T00:00:00.000Z");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("deleting a client route clears token limit config and usage", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "provider-a",
          name: "provider-a",
          baseUrl: "https://provider-a.example/v1",
          responsesUrl: "https://provider-a.example/v1/responses",
          providerApiKeys: ["provider-key"],
          clientApiKeys: [],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
      ],
    });

    repository.addClientRoute("codex", "provider-a");
    repository.setClientTokenLimit("codex", {
      enabled: true,
      tokenLimit: 1000,
      windowType: "daily",
      hardBlock: true,
    });
    repository.incrementClientTokenUsage(
      "codex",
      { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      new Date("2026-04-27T12:00:00.000Z"),
    );

    repository.deleteClientRoute("codex");

    assert.equal(repository.getClientTokenLimit("codex"), undefined);
    assert.deepEqual(
      repository.getClientTokenUsage("codex", new Date("2026-04-27T12:30:00.000Z")),
      {
        clientRoute: "codex",
        windowStart: "2026-04-27T00:00:00.000Z",
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        updatedAt: "2026-04-27T00:00:00.000Z",
      },
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resolveClientTokenWindowStart supports daily weekly monthly and fixed windows", () => {
  const now = new Date("2026-04-29T13:45:30.000Z");

  assert.equal(
    resolveClientTokenWindowStart(now, { windowType: "daily" }),
    "2026-04-29T00:00:00.000Z",
  );
  assert.equal(
    resolveClientTokenWindowStart(now, { windowType: "weekly" }),
    "2026-04-27T00:00:00.000Z",
  );
  assert.equal(
    resolveClientTokenWindowStart(now, { windowType: "monthly" }),
    "2026-04-01T00:00:00.000Z",
  );
  assert.equal(
    resolveClientTokenWindowStart(now, { windowType: "fixed", windowSizeSeconds: 3600 }),
    "2026-04-29T13:00:00.000Z",
  );
});

test("backfills legacy request parameter policy rows in the database", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "krouter",
          name: "krouter",
          baseUrl: "https://krouter.net/v1",
          responsesUrl: "https://krouter.net/v1/responses",
          providerApiKeys: ["provider-key"],
          clientApiKeys: ["client-key"],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: true,
            requestParameterPolicy: {
              maxOutputTokens: {
                mode: "strip",
              },
            },
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
      ],
    });
    assert.equal(repository.getProvider("krouter")?.capabilities.requestParameterPolicy.maxOutputTokens?.mode, "strip");

    const db = new BetterSqlite3(dbFile);
    db.prepare("UPDATE providers SET request_parameter_policy = '{}' WHERE id = ?").run("krouter");
    db.close();

    await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [],
    });

    const verifyDb = new BetterSqlite3(dbFile, { readonly: true });
    const row = verifyDb
      .prepare("SELECT request_parameter_policy FROM providers WHERE id = ?")
      .get("krouter") as { request_parameter_policy: string };
    verifyDb.close();

    assert.equal(row.request_parameter_policy, '{"maxOutputTokens":{"mode":"strip"}}');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("persists client-route RTK policy overrides", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "provider-a",
          name: "provider-a",
          baseUrl: "https://provider-a.example/v1",
          responsesUrl: "https://provider-a.example/v1/responses",
          providerApiKeys: ["provider-key"],
          clientApiKeys: ["client-key"],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
      ],
    });

    repository.setClientRouteRtkPolicy("hermes", {
      enabled: true,
      toolOutputEnabled: true,
      maxChars: 1200,
      maxLines: 40,
      tailLines: 8,
      tailChars: 400,
      detectFormat: "command",
    });

    const reloaded = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [],
    });

    assert.deepEqual(reloaded.getClientRouteRtkPolicy("hermes"), {
      enabled: true,
      toolOutputEnabled: true,
      maxChars: 1200,
      maxLines: 40,
      tailLines: 8,
      tailChars: 400,
      detectFormat: "command",
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("persists client-route api key bindings and resolves route by key", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "provider-a",
          name: "provider-a",
          baseUrl: "https://provider-a.example/v1",
          responsesUrl: "https://provider-a.example/v1/responses",
          providerApiKeys: ["provider-key"],
          clientApiKeys: ["client-key"],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
      ],
    });

    repository.setClientRoute("hermes", "provider-a");
    repository.setClientRouteApiKeys("hermes", ["sk-hermes-route"]);

    assert.equal(repository.findClientRouteByApiKey("sk-hermes-route"), "hermes");
    assert.deepEqual(repository.getClientRouteApiKeys("hermes"), ["sk-hermes-route"]);

    const reloaded = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [],
    });

    assert.equal(reloaded.findClientRouteByApiKey("sk-hermes-route"), "hermes");
    assert.deepEqual(reloaded.getClientRouteApiKeys("hermes"), ["sk-hermes-route"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("routes client CRUD api keys to the bound provider", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "provider-a",
          name: "provider-a",
          baseUrl: "https://provider-a.example/v1",
          responsesUrl: "https://provider-a.example/v1/responses",
          providerApiKeys: ["provider-a-key"],
          clientApiKeys: ["legacy-client-a-key"],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
        {
          id: "provider-b",
          name: "provider-b",
          baseUrl: "https://provider-b.example/v1",
          responsesUrl: "https://provider-b.example/v1/responses",
          providerApiKeys: ["provider-b-key"],
          clientApiKeys: [],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
      ],
    });

    repository.setClientRoute("mobile-app", "provider-b");
    repository.setClientRouteApiKeys("mobile-app", ["sk-mobile-client"]);

    const matchedProviders = repository.findProvidersByAccessKey("sk-mobile-client");
    assert.equal(repository.findClientRouteByApiKey("sk-mobile-client"), "mobile-app");
    assert.deepEqual(
      matchedProviders.map((provider) => provider.id),
      ["provider-b"],
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("does not resolve access by legacy provider-level client API keys", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "provider-a",
          name: "provider-a",
          baseUrl: "https://provider-a.example/v1",
          responsesUrl: "https://provider-a.example/v1/responses",
          providerApiKeys: ["provider-a-key"],
          clientApiKeys: ["shared-client-key"],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
      ],
    });

    repository.createProvider({
      name: "provider-b",
      baseUrl: "https://provider-b.example/v1",
      providerApiKeys: ["provider-b-key"],
      clientApiKeys: ["shared-client-key"],
    });

    const matchedProviders = repository.findProvidersByAccessKey("shared-client-key");
    assert.equal(matchedProviders.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("creating and updating a provider does not switch the default route when one already exists", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "provider-a",
          name: "provider-a",
          baseUrl: "https://provider-a.example/v1",
          responsesUrl: "https://provider-a.example/v1/responses",
          providerApiKeys: ["provider-a-key"],
          clientApiKeys: ["client-a-key"],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
      ],
    });

    assert.equal(repository.getActiveProviderId(), "provider-a");
    assert.equal(repository.getProviderIdForClient("default"), "provider-a");

    const created = repository.createProvider({
      name: "provider-b",
      baseUrl: "https://provider-b.example/v1",
      providerApiKeys: ["provider-b-key"],
      clientApiKeys: ["client-b-key"],
    });

    assert.equal(repository.getActiveProviderId(), "provider-a");
    assert.equal(repository.getProviderIdForClient("default"), "provider-a");

    repository.updateProvider(created.id, {
      name: "provider-b-renamed",
      baseUrl: "https://provider-b.example/v1",
      providerApiKeys: ["provider-b-key"],
      clientApiKeys: ["client-b-key"],
    });

    assert.equal(repository.getActiveProviderId(), "provider-a");
    assert.equal(repository.getProviderIdForClient("default"), "provider-a");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("createProvider and updateProvider allow explicit responsesUrl overrides", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [],
    });

    const created = repository.createProvider({
      id: "chatgpt-pool",
      name: "ChatGPT Pool",
      baseUrl: "https://chatgpt.com/backend-api/codex",
      responsesUrl: "https://chatgpt.com/backend-api/codex/responses",
      authMode: "chatgpt_oauth",
      capabilities: {
        usageCheckEnabled: false,
        stripMaxOutputTokens: false,
        requestParameterPolicy: {},
        sanitizeReasoningSummary: false,
        stripModelPrefixes: [],
      },
    });

    assert.equal(created.responsesUrl, "https://chatgpt.com/backend-api/codex/responses");

    const updated = repository.updateProvider(created.id, {
      id: created.id,
      name: created.name,
      baseUrl: created.baseUrl,
      responsesUrl: "https://chatgpt.com/backend-api/codex/responses?via=override",
      authMode: "chatgpt_oauth",
      capabilities: created.capabilities,
    });

    assert.equal(updated.responsesUrl, "https://chatgpt.com/backend-api/codex/responses?via=override");

    const reloaded = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [],
    });
    assert.equal(
      reloaded.getProviderOrThrow(created.id)?.responsesUrl,
      "https://chatgpt.com/backend-api/codex/responses?via=override",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("explicit empty client api keys stay empty instead of falling back to provider keys", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "provider-a",
          name: "provider-a",
          baseUrl: "https://provider-a.example/v1",
          responsesUrl: "https://provider-a.example/v1/responses",
          providerApiKeys: ["provider-a-key"],
          clientApiKeys: ["client-a-key"],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
      ],
    });

    repository.updateProvider("provider-a", {
      name: "provider-a",
      baseUrl: "https://provider-a.example/v1",
      providerApiKeys: ["provider-a-key"],
      clientApiKeys: [],
    });

    assert.deepEqual(repository.getProvider("provider-a")?.clientApiKeys, []);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("keeps explicit hermes and codex client routes distinct", () => {
  assert.equal(normalizeClientRouteKey("hermes"), "hermes");
  assert.equal(normalizeClientRouteKey("codex"), "codex");
  assert.equal(normalizeClientRouteKey("openclaw"), "openclaw");
});

test("prefers the codex route as fallback for default traffic", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "provider-default",
          name: "provider-default",
          baseUrl: "https://default.example/v1",
          responsesUrl: "https://default.example/v1/responses",
          providerApiKeys: ["provider-default-key"],
          clientApiKeys: [],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
        {
          id: "provider-codex",
          name: "provider-codex",
          baseUrl: "https://codex.example/v1",
          responsesUrl: "https://codex.example/v1/responses",
          providerApiKeys: ["provider-codex-key"],
          clientApiKeys: [],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
      ],
    });

    repository.setClientRoute("default", "provider-default");
    repository.setClientRoute("codex", "provider-codex");

    assert.equal(repository.getFallbackProvider("default", "provider-default")?.id, "provider-codex");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("uses the default route as fallback for codex traffic", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "provider-default",
          name: "provider-default",
          baseUrl: "https://default.example/v1",
          responsesUrl: "https://default.example/v1/responses",
          providerApiKeys: ["provider-default-key"],
          clientApiKeys: [],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
        {
          id: "provider-codex",
          name: "provider-codex",
          baseUrl: "https://codex.example/v1",
          responsesUrl: "https://codex.example/v1/responses",
          providerApiKeys: ["provider-codex-key"],
          clientApiKeys: [],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
      ],
    });

    repository.setClientRoute("default", "provider-default");
    repository.setClientRoute("codex", "provider-codex");

    assert.equal(repository.getFallbackProvider("codex", "provider-codex")?.id, "provider-default");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("does not fall back to an unbound provider outside configured client routes", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "provider-default",
          name: "provider-default",
          baseUrl: "https://default.example/v1",
          responsesUrl: "https://default.example/v1/responses",
          providerApiKeys: ["provider-default-key"],
          clientApiKeys: [],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
        {
          id: "provider-extra",
          name: "provider-extra",
          baseUrl: "https://extra.example/v1",
          responsesUrl: "https://extra.example/v1/responses",
          providerApiKeys: ["provider-extra-key"],
          clientApiKeys: [],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
      ],
    });

    repository.setClientRoute("default", "provider-default");

    assert.equal(repository.getFallbackProvider("default", "provider-default"), undefined);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("persists provider error policy rules in the database", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "provider-a",
          name: "provider-a",
          baseUrl: "https://provider-a.example/v1",
          responsesUrl: "https://provider-a.example/v1/responses",
          providerApiKeys: ["provider-key"],
          clientApiKeys: ["client-key"],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
            errorPolicy: {
              rules: [
                {
                  statusCodes: [413],
                  code: "UPSTREAM_REQUEST_TOO_LARGE",
                  message: "Prompt body too large",
                  retryable: false,
                },
              ],
            },
          },
        },
      ],
    });

    assert.equal(
      repository.getProvider("provider-a")?.capabilities.errorPolicy?.rules[0]?.code,
      "UPSTREAM_REQUEST_TOO_LARGE",
    );

    const reloaded = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [],
    });

    assert.deepEqual(reloaded.getProvider("provider-a")?.capabilities.errorPolicy, {
      rules: [
        {
          statusCodes: [413],
          upstreamCodes: undefined,
          upstreamTypes: undefined,
          messageIncludes: undefined,
          bodyIncludes: undefined,
          code: "UPSTREAM_REQUEST_TOO_LARGE",
          message: "Prompt body too large",
          retryable: false,
        },
      ],
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("persists provider model aliases in the database", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "provider-a",
          name: "provider-a",
          baseUrl: "https://provider-a.example/v1",
          responsesUrl: "https://provider-a.example/v1/responses",
          providerApiKeys: ["provider-key"],
          clientApiKeys: ["client-key"],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
            modelAliases: {
              "cheap-default": "gpt-5.4-mini",
              "quality-default": "gpt-5.4",
            },
          },
        },
      ],
    });

    const reloaded = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [],
    });

    assert.deepEqual(reloaded.getProvider("provider-a")?.capabilities.modelAliases, {
      "cheap-default": "gpt-5.4-mini",
      "quality-default": "gpt-5.4",
    });
    assert.deepEqual(repository.getProvider("provider-a")?.capabilities.modelAliases, {
      "cheap-default": "gpt-5.4-mini",
      "quality-default": "gpt-5.4",
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("hides system-managed providers from CRUD list while keeping client selector options", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [
        {
          id: "manual-provider",
          name: "manual-provider",
          baseUrl: "https://manual.example/v1",
          responsesUrl: "https://manual.example/v1/responses",
          providerApiKeys: ["provider-key"],
          clientApiKeys: ["client-key"],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
          },
        },
        {
          id: "account-openai-codex",
          name: "OpenAI / Codex Account Pool",
          baseUrl: "https://chatgpt.com/backend-api/codex",
          responsesUrl: "https://chatgpt.com/backend-api/codex/v1/responses",
          authMode: "chatgpt_oauth",
          providerApiKeys: [],
          clientApiKeys: [],
          capabilities: {
            usageCheckEnabled: false,
            stripMaxOutputTokens: false,
            requestParameterPolicy: {},
            sanitizeReasoningSummary: false,
            stripModelPrefixes: [],
            systemManaged: true,
            accountPlatform: "openai_codex",
            accountPoolRequired: true,
          },
        },
      ],
    });

    assert.deepEqual(
      repository.listProvidersForUi().map((provider) => provider.id),
      ["manual-provider"],
    );
    assert.deepEqual(
      repository.listProviderOptionsForClientSetup().map((provider) => provider.id),
      ["manual-provider", "account-openai-codex"],
    );

    const reloaded = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [],
    });
    const accountProvider = reloaded.getProvider("account-openai-codex");

    assert.equal(accountProvider?.capabilities.systemManaged, true);
    assert.equal(accountProvider?.capabilities.accountPlatform, "openai_codex");
    assert.equal(accountProvider?.capabilities.accountPoolRequired, true);
    assert.deepEqual(
      reloaded.listProvidersForUi().map((provider) => provider.id),
      ["manual-provider"],
    );
    assert.ok(
      reloaded
        .listProviderOptionsForClientSetup()
        .some((provider) => provider.id === "account-openai-codex"),
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function clientKeyCaps(): RuntimeProviderPreset["capabilities"] {
  return {
    usageCheckEnabled: false,
    stripMaxOutputTokens: false,
    requestParameterPolicy: {},
    sanitizeReasoningSummary: false,
    stripModelPrefixes: [],
  };
}

function twoProviderRepo(dbFile: string, legacyStateFile: string) {
  return RuntimeProviderRepository.create({
    dbFile,
    legacyStateFile,
    baseProviders: [
      {
        id: "provider-a",
        name: "provider-a",
        baseUrl: "https://provider-a.example/v1",
        responsesUrl: "https://provider-a.example/v1/responses",
        providerApiKeys: ["provider-a-key"],
        clientApiKeys: [],
        capabilities: clientKeyCaps(),
      },
      {
        id: "provider-b",
        name: "provider-b",
        baseUrl: "https://provider-b.example/v1",
        responsesUrl: "https://provider-b.example/v1/responses",
        providerApiKeys: ["provider-b-key"],
        clientApiKeys: [],
        capabilities: clientKeyCaps(),
      },
    ],
  });
}

test("client API key bound to the default route survives a reload", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await twoProviderRepo(dbFile, legacyStateFile);
    repository.setClientRoute("default", "provider-a");
    repository.setClientRouteApiKeys("default", ["sk-default-client"]);

    assert.equal(repository.findClientRouteByApiKey("sk-default-client"), "default");

    const reloaded = await RuntimeProviderRepository.create({
      dbFile,
      legacyStateFile,
      baseProviders: [],
    });

    // Regression: default-route keys used to be dropped on load.
    assert.equal(reloaded.findClientRouteByApiKey("sk-default-client"), "default");
    assert.deepEqual(reloaded.getClientRouteApiKeys("default"), ["sk-default-client"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("two client keys route to their own providers", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await twoProviderRepo(dbFile, legacyStateFile);
    repository.setClientRoute("route-a", "provider-a");
    repository.setClientRouteApiKeys("route-a", ["sk-a"]);
    repository.setClientRoute("route-b", "provider-b");
    repository.setClientRouteApiKeys("route-b", ["sk-b"]);

    assert.deepEqual(
      repository.findProvidersByAccessKey("sk-a").map((p) => p.id),
      ["provider-a"],
    );
    assert.deepEqual(
      repository.findProvidersByAccessKey("sk-b").map((p) => p.id),
      ["provider-b"],
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("rejects a client key already assigned to another route", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await twoProviderRepo(dbFile, legacyStateFile);
    repository.setClientRoute("route-a", "provider-a");
    repository.setClientRouteApiKeys("route-a", ["sk-shared"]);
    repository.setClientRoute("route-b", "provider-b");

    assert.throws(
      () => repository.setClientRouteApiKeys("route-b", ["sk-shared"]),
      (error: unknown) =>
        error instanceof Error &&
        (error as { body?: { code?: string } }).body?.code === "CLIENT_ROUTE_API_KEY_ALREADY_EXISTS",
    );
    // The original binding is untouched.
    assert.equal(repository.findClientRouteByApiKey("sk-shared"), "route-a");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("rejects a client key that collides with a provider API key", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await twoProviderRepo(dbFile, legacyStateFile);
    repository.setClientRoute("route-a", "provider-a");

    assert.throws(
      () => repository.setClientRouteApiKeys("route-a", ["provider-b-key"]),
      (error: unknown) =>
        error instanceof Error &&
        (error as { body?: { code?: string } }).body?.code === "CLIENT_ROUTE_API_KEY_CONFLICTS_PROVIDER",
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("re-assigning the same key to the same route is allowed (idempotent)", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await twoProviderRepo(dbFile, legacyStateFile);
    repository.setClientRoute("route-a", "provider-a");
    repository.setClientRouteApiKeys("route-a", ["sk-a"]);
    // Same route + same key must not trip the cross-route guard.
    assert.deepEqual(repository.setClientRouteApiKeys("route-a", ["sk-a", "sk-a2"]), ["sk-a", "sk-a2"]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("addClientRoute without a provider does not pin the active provider", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await twoProviderRepo(dbFile, legacyStateFile);
    // provider-a is active (first provider). A new route with no explicit provider
    // must not copy it into the stored route binding. Mirror the /api/clients flow,
    // which also assigns a key so the route is registered.
    repository.addClientRoute("route-x");
    repository.setClientRouteApiKeys("route-x", ["sk-x"]);
    const view = repository.getClientRoutesForUi().find((r) => r.key === "route-x");
    assert.ok(view);
    // Unbound: falls through to the active provider at request time, but the stored
    // route does not pin provider-a.
    assert.equal(view.providerId, null);
    assert.equal(repository.getProviderIdForClient("route-x"), "provider-a");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("addClientRoute with an explicit provider still binds it", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-provider-repo-"));
  const dbFile = path.join(tempDir, "app.sqlite");
  const legacyStateFile = path.join(tempDir, "providers.json");

  try {
    const repository = await twoProviderRepo(dbFile, legacyStateFile);
    repository.addClientRoute("route-y", "provider-b");
    const view = repository.getClientRoutesForUi().find((r) => r.key === "route-y");
    assert.ok(view);
    assert.equal(view.providerId, "provider-b");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
