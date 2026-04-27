import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyCodexAuth,
  applyCodexConfig,
  applyHermesConfig,
  normalizeProxyBaseUrl,
  readCodexAuthStatus,
  readQuickApplyStatus,
  resolveQuickApplyPaths,
  writeQuickConfigFile,
} from "./client-config-apply.js";

test("applyHermesConfig points Hermes to proxy while preserving unrelated sections", () => {
  const raw = [
    "model:",
    "  default: gpt-5.5",
    "  provider: custom",
    "  api_key: old-key",
    "browser:",
    "  inactivity_timeout: 120",
    "",
  ].join("\n");

  const next = applyHermesConfig(raw, {
    client: "hermes",
    proxyBaseUrl: "http://127.0.0.1:8318/v1",
    routeApiKey: "sk-hermes-route-abc",
  });

  assert.match(next, /model:\n  default: gpt-5\.5\n  provider: custom\n  api_key: sk-hermes-route-abc\n  base_url: http:\/\/127\.0\.0\.1:8318\/v1\n  api_mode: codex_responses\n/);
  assert.match(next, /browser:\n  inactivity_timeout: 120/);
});

test("applyCodexConfig switches active provider to responses_proxy and preserves project sections", () => {
  const raw = [
    'model = "gpt-5.4"',
    'model_provider = "cliproxy"',
    "",
    "[model_providers.cliproxy]",
    'name = "cliproxy"',
    'base_url = "http://100.111.102.37:8317/v1"',
    'api_key = "sk-old"',
    'wire_api = "responses"',
    "",
    '[projects."/Volumes/Home_EX/Projects/responses-proxy"]',
    'trust_level = "trusted"',
    "",
  ].join("\n");

  const next = applyCodexConfig(raw, {
    client: "codex",
    proxyBaseUrl: "http://127.0.0.1:8318/v1",
    routeApiKey: "sk-codex-route-abc",
  });

  assert.match(next, /^model = "gpt-5\.4"$/m);
  assert.match(next, /^model_provider = "responses_proxy"$/m);
  assert.match(next, /\[model_providers\.responses_proxy\][\s\S]*base_url = "http:\/\/127\.0\.0\.1:8318\/v1"[\s\S]*api_key = "sk-codex-route-abc"[\s\S]*wire_api = "responses"/m);
  assert.match(next, /\[projects\."\/Volumes\/Home_EX\/Projects\/responses-proxy"\]\ntrust_level = "trusted"/);
});

test("applyCodexConfig uses the selected helper model when provided", () => {
  const next = applyCodexConfig('model = "gpt-5.5"\n', {
    client: "codex",
    proxyBaseUrl: "http://127.0.0.1:8318/v1",
    routeApiKey: "sk-codex-route-abc",
    model: "gpt-5.4",
  });

  assert.match(next, /^model = "gpt-5\.4"$/m);
});

test("applyCodexAuth stores the selected route API key in auth.json", () => {
  const next = applyCodexAuth('{\n  "OPENAI_API_KEY": "sk-old"\n}\n', "sk-codex-route-abc");
  assert.equal(JSON.parse(next).OPENAI_API_KEY, "sk-codex-route-abc");
});

test("readQuickApplyStatus marks Hermes as configured only when route key and base URL match", () => {
  const raw = [
    "model:",
    "  default: cx/gpt-5.4",
    "  provider: custom",
    "  api_key: sk-hermes-route-abc",
    "  base_url: http://127.0.0.1:8318/v1",
    "  api_mode: codex_responses",
    "",
  ].join("\n");

  const status = readQuickApplyStatus(
    raw,
    {
      client: "hermes",
      proxyBaseUrl: "http://127.0.0.1:8318/v1",
      routeApiKey: "sk-hermes-route-abc",
    },
    "/tmp/hermes.yaml",
  );

  assert.equal(status.configured, true);
  assert.equal(status.detected.baseUrl, "http://127.0.0.1:8318/v1");
  assert.equal(status.detected.apiKey, "sk-hermes-route-abc");
});

test("readCodexAuthStatus detects when auth.json already matches the route key", () => {
  const status = readCodexAuthStatus(
    '{\n  "OPENAI_API_KEY": "sk-codex-route-abc"\n}\n',
    "sk-codex-route-abc",
    "/tmp/auth.json",
  );

  assert.equal(status.configured, true);
  assert.equal(status.detectedApiKey, "sk-codex-route-abc");
});

test("writeQuickConfigFile stores backup in configured backup directory", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-quick-apply-"));
  const configFile = path.join(tempDir, "config.toml");
  const backupDir = path.join(tempDir, "backups");

  try {
    writeQuickConfigFile(configFile, 'model = "gpt-5.4"\n');
    writeQuickConfigFile(configFile, 'model = "gpt-5.5"\n', { backupDir });

    const backupFiles = readdirSync(backupDir);
    assert.equal(backupFiles.length, 1);
    assert.match(backupFiles[0], /^config\.toml\.\d{8}-\d{6}-\d{3}\.bak$/);
    assert.equal(readFileSync(path.join(backupDir, backupFiles[0]), "utf8"), 'model = "gpt-5.4"\n');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("writeQuickConfigFile skips backup when content is unchanged", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-quick-apply-"));
  const configFile = path.join(tempDir, "config.toml");
  const backupDir = path.join(tempDir, "backups");

  try {
    const firstWrite = writeQuickConfigFile(configFile, 'model = "gpt-5.4"\n');
    const secondWrite = writeQuickConfigFile(configFile, 'model = "gpt-5.4"\n', { backupDir });

    assert.equal(firstWrite.changed, true);
    assert.equal(firstWrite.backupCreated, false);
    assert.equal(secondWrite.changed, false);
    assert.equal(secondWrite.backupCreated, false);
    assert.equal(readdirSync(tempDir).includes("backups"), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("readQuickApplyStatus treats normalized trailing slash base URLs as configured", () => {
  const raw = [
    "model:",
    "  default: gpt-5.5",
    "  provider: custom",
    "  api_key: sk-hermes-route-abc",
    "  base_url: http://127.0.0.1:8318/v1/",
    "  api_mode: codex_responses",
    "",
  ].join("\n");

  const status = readQuickApplyStatus(
    raw,
    {
      client: "hermes",
      proxyBaseUrl: "http://127.0.0.1:8318/v1",
      routeApiKey: "sk-hermes-route-abc",
    },
    "/tmp/hermes.yaml",
  );

  assert.equal(status.configured, true);
});

test("normalizeProxyBaseUrl trims trailing slashes", () => {
  assert.equal(normalizeProxyBaseUrl(" http://127.0.0.1:8318/v1/ "), "http://127.0.0.1:8318/v1");
  assert.equal(normalizeProxyBaseUrl(""), "");
});

test("resolveQuickApplyPaths keeps Codex auth alongside override config path", () => {
  const paths = resolveQuickApplyPaths({
    codexConfigPath: "/host-home/.codex/config.toml",
  });

  assert.equal(paths.codexConfigPath, "/host-home/.codex/config.toml");
  assert.equal(paths.codexAuthPath, "/host-home/.codex/auth.json");
});
