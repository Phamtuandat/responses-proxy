import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-server-sepay-"));
const dbFile = path.join(tempDir, "app.sqlite");

process.env.RESPONSES_PROXY_DISABLE_LISTEN = "true";
process.env.APP_DB_PATH = dbFile;
process.env.CUSTOMER_KEY_DB_PATH = dbFile;
process.env.UPSTREAM_BASE_URL = "https://upstream.example/v1";
process.env.UPSTREAM_API_KEY = "provider-key";
process.env.PROVIDER_USAGE_CHECK_ENABLED = "false";
process.env.CHATGPT_OAUTH_ENABLED = "false";
process.env.LOG_LEVEL = "silent";
process.env.SEPAY_WEBHOOK_ENABLED = "true";
process.env.SEPAY_WEBHOOK_SECRET = "webhook-secret";
process.env.HTTP_TRUST_PROXY = "true";
process.env.SEPAY_WEBHOOK_ALLOWED_IPS = "203.0.113.10,198.51.100.0/24";

const { app } = await import("./server.js");

test.after(async () => {
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("sepay webhook rejects non-allowed source ip", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/sepay/webhook",
    headers: {
      authorization: "Bearer webhook-secret",
      "x-forwarded-for": "192.0.2.10",
    },
    payload: {},
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "SEPAY_WEBHOOK_IP_FORBIDDEN");
});

test("sepay webhook accepts allowed exact ip and cidr", async () => {
  const exact = await app.inject({
    method: "POST",
    url: "/api/sepay/webhook",
    headers: {
      authorization: "Bearer webhook-secret",
      "x-forwarded-for": "203.0.113.10",
    },
    payload: {},
  });
  assert.equal(exact.statusCode, 200);

  const cidr = await app.inject({
    method: "POST",
    url: "/api/sepay/webhook",
    headers: {
      authorization: "Bearer webhook-secret",
      "x-forwarded-for": "198.51.100.42",
    },
    payload: {},
  });
  assert.equal(cidr.statusCode, 200);
});
