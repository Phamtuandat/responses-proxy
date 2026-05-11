import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-server-body-limit-"));
const dbFile = path.join(tempDir, "app.sqlite");

process.env.RESPONSES_PROXY_DISABLE_LISTEN = "true";
process.env.APP_DB_PATH = dbFile;
process.env.CUSTOMER_KEY_DB_PATH = dbFile;
process.env.UPSTREAM_BASE_URL = "https://upstream.example/v1";
process.env.UPSTREAM_API_KEY = "provider-key";
process.env.PROVIDER_USAGE_CHECK_ENABLED = "false";
process.env.CHATGPT_OAUTH_ENABLED = "false";
process.env.LOG_LEVEL = "silent";
process.env.REQUEST_BODY_LIMIT_BYTES = "1024";

const { app } = await import("./server.js");

test.after(async () => {
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("server rejects payloads above configured body limit", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/v1/responses",
    headers: {
      authorization: "Bearer provider-key",
    },
    payload: {
      model: "gpt-4.1",
      input: "x".repeat(2048),
    },
  });

  assert.equal(response.statusCode, 413);
});
