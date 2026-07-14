import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BillingRepository } from "./billing.js";
import { CustomerKeyRepository } from "./customer-keys.js";
import { CustomerWorkspaceRepository } from "./telegram-bot/customer-workspace-repository.js";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-codex-setup-"));
const dbFile = path.join(tempDir, "app.sqlite");

process.env.RESPONSES_PROXY_DISABLE_LISTEN = "true";
process.env.APP_DB_PATH = dbFile;
process.env.CUSTOMER_KEY_DB_PATH = dbFile;
process.env.UPSTREAM_BASE_URL = "https://upstream.example/v1";
process.env.UPSTREAM_API_KEY = "provider-key";
process.env.PROVIDER_USAGE_CHECK_ENABLED = "false";
process.env.CHATGPT_OAUTH_ENABLED = "false";
process.env.LOG_LEVEL = "silent";
process.env.RESPONSES_PROXY_DEFAULT_MODEL = "gpt-5.4";
process.env.BOT_PUBLIC_RESPONSES_BASE_URL = "https://proxy.example.com/v1";

// Seed billing/customer data BEFORE importing the server. The server opens its
// own SQLite connection to this file at import time; seeding first guarantees the
// customer key + entitlement are committed and visible to that connection on any
// filesystem (the prior order was flaky on slow CI runners → 403).
const billing = BillingRepository.create(dbFile);
const customerKeys = CustomerKeyRepository.create(dbFile);
const workspaces = CustomerWorkspaceRepository.create(dbFile);
const workspace = workspaces.ensureDefaultWorkspace({
  ownerTelegramUserId: "42",
  defaultClientRoute: "default",
  status: "active",
});

if (!billing.getPlan("curl-setup")) {
  billing.createPlan({
    id: "curl-setup",
    name: "Curl Setup",
    monthlyTokenLimit: 1_000_000,
    maxApiKeys: 1,
  });
}

billing.grantSubscription({
  workspaceId: workspace.id,
  planId: "curl-setup",
  days: 30,
});

const { apiKey } = customerKeys.createKey({
  workspaceId: workspace.id,
  telegramUserId: "42",
  clientRoute: "default",
  apiKey: "sk-customer-test-secret",
});

const { app } = await import("./server.js");

test.after(async () => {
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("customer Codex setup script requires customer API key auth", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/customer/codex/setup.sh",
  });

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error?.code, "CUSTOMER_API_KEY_REQUIRED");
});

test("customer Codex setup script returns patch script with customer key and public base URL", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/customer/codex/setup.sh",
    headers: {
      authorization: `Bearer ${apiKey}`,
    },
  });

  // Diagnostic: on a non-200, surface the error code + body so a CI-only failure
  // reveals which branch fired (missing key vs entitlement/token-lot).
  assert.equal(
    response.statusCode,
    200,
    `expected 200, got ${response.statusCode}: ${response.body}`,
  );
  assert.match(response.headers["content-type"] ?? "", /^text\/x-shellscript/);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.match(response.body, /model = "gpt-5\.4"/);
  assert.match(response.body, /base_url = "https:\/\/proxy\.example\.com\/v1"/);
  assert.match(response.body, /OPENAI_API_KEY": "sk-customer-test-secret"/);
  assert.match(response.body, /install_file "\$tmpdir\/config\.toml" "\$HOME\/\.codex\/config\.toml"/);
});
