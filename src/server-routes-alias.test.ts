import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-server-routes-alias-"));
const dbFile = path.join(tempDir, "app.sqlite");

process.env.RESPONSES_PROXY_DISABLE_LISTEN = "true";
process.env.APP_DB_PATH = dbFile;
process.env.CUSTOMER_KEY_DB_PATH = dbFile;
process.env.UPSTREAM_BASE_URL = "https://upstream.example/v1";
process.env.UPSTREAM_API_KEY = "provider-key";
process.env.PROVIDER_USAGE_CHECK_ENABLED = "false";
process.env.CHATGPT_OAUTH_ENABLED = "false";
process.env.LOG_LEVEL = "silent";

const { app } = await import("./server.js");

test.after(async () => {
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("route alias /v1/chat/completions routes to responses handler and fails validation with 400", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    payload: {},
  });
  // If it was a 404, it would return 404. Returning 400 means it hit the handler and failed validation.
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error?.code, "INVALID_RESPONSES_REQUEST");
});

test("route alias /v1/completions routes to responses handler and fails validation with 400", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/completions",
    payload: {},
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error?.code, "INVALID_RESPONSES_REQUEST");
});
