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

test("keeps explicit hermes and codex client routes distinct", () => {
  assert.equal(normalizeClientRouteKey("hermes"), "hermes");
  assert.equal(normalizeClientRouteKey("codex"), "codex");
  assert.equal(normalizeClientRouteKey("openclaw"), "openclaw");
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
