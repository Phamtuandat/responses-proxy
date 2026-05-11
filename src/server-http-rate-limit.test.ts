import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-server-rate-limit-"));
const dbFile = path.join(tempDir, "app.sqlite");

process.env.RESPONSES_PROXY_DISABLE_LISTEN = "true";
process.env.APP_DB_PATH = dbFile;
process.env.CUSTOMER_KEY_DB_PATH = dbFile;
process.env.UPSTREAM_BASE_URL = "https://upstream.example/v1";
process.env.UPSTREAM_API_KEY = "provider-key";
process.env.PROVIDER_USAGE_CHECK_ENABLED = "false";
process.env.CHATGPT_OAUTH_ENABLED = "false";
process.env.LOG_LEVEL = "silent";
process.env.HTTP_TRUST_PROXY = "false";
process.env.HTTP_RATE_LIMIT_ENABLED = "true";
process.env.HTTP_RATE_LIMIT_WINDOW_MS = "60000";
process.env.HTTP_RATE_LIMIT_RESPONSES_MAX_REQUESTS = "1";
process.env.HTTP_RATE_LIMIT_UNAUTHENTICATED_MAX_REQUESTS = "1";

const { app } = await import("./server.js");

test.after(async () => {
  await app.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("responses endpoint returns 429 after configured rate limit threshold", async () => {
  const first = await app.inject({
    method: "POST",
    url: "/v1/responses",
    headers: {
      "x-forwarded-for": "203.0.113.10",
    },
    payload: {},
  });
  assert.equal(first.statusCode, 400);
  assert.equal(first.headers["x-ratelimit-limit"], "1");
  assert.equal(first.headers["x-ratelimit-remaining"], "0");

  const second = await app.inject({
    method: "POST",
    url: "/v1/responses",
    headers: {
      "x-forwarded-for": "198.51.100.10",
    },
    payload: {},
  });
  assert.equal(second.statusCode, 429);
  assert.equal(second.headers["retry-after"], "60");
  assert.equal(second.headers["x-ratelimit-limit"], "1");
  assert.equal(second.headers["x-ratelimit-remaining"], "0");
  assert.equal(second.json().error.code, "HTTP_RATE_LIMIT_EXCEEDED");
});

test("bearer requests get separate rate limit buckets by token", async () => {
  const firstBearer = await app.inject({
    method: "POST",
    url: "/v1/responses",
    headers: {
      authorization: "Bearer bearer-token-a",
    },
    payload: {},
  });
  assert.equal(firstBearer.statusCode, 400);

  const secondBearer = await app.inject({
    method: "POST",
    url: "/v1/responses",
    headers: {
      authorization: "Bearer bearer-token-b",
    },
    payload: {},
  });
  assert.equal(secondBearer.statusCode, 400);

  const thirdBearer = await app.inject({
    method: "POST",
    url: "/v1/responses",
    headers: {
      authorization: "Bearer bearer-token-a",
    },
    payload: {},
  });
  assert.equal(thirdBearer.statusCode, 429);
});
