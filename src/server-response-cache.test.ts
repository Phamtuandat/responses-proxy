import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-server-response-cache-"));
const dbFile = path.join(tempDir, "app.sqlite");

const upstream = createServer((request, response) => {
  if (request.url !== "/responses") {
    response.statusCode = 404;
    response.end();
    return;
  }

  response.setHeader("Content-Type", "application/json");
  response.end(
    JSON.stringify({
      id: `upstream-${upstreamHits + 1}`,
      object: "response",
      status: "completed",
      output: [],
      usage: {
        input_tokens: 12,
        output_tokens: 3,
        total_tokens: 15,
        input_tokens_details: { cached_tokens: 0 },
      },
    }),
  );
  upstreamHits += 1;
});

let upstreamHits = 0;

process.env.RESPONSES_PROXY_DISABLE_LISTEN = "true";
process.env.APP_DB_PATH = dbFile;
process.env.CUSTOMER_KEY_DB_PATH = dbFile;
process.env.UPSTREAM_BASE_URL = "http://127.0.0.1:0";
process.env.UPSTREAM_API_KEY = "provider-key";
process.env.PROVIDER_USAGE_CHECK_ENABLED = "false";
process.env.CHATGPT_OAUTH_ENABLED = "false";
process.env.LOG_LEVEL = "silent";
process.env.RESPONSE_CACHE_ENABLED = "true";
process.env.RESPONSE_CACHE_TTL_MS = "60000";
process.env.RESPONSE_CACHE_MAX_PAYLOAD_BYTES = "524288";
process.env.RESPONSES_PROXY_CLIENT_API_KEY = "provider-key";

await new Promise<void>((resolve) => {
  upstream.listen(0, "127.0.0.1", () => resolve());
});

const upstreamAddress = upstream.address();
if (!upstreamAddress || typeof upstreamAddress === "string") {
  throw new Error("Upstream server did not bind to a port");
}

process.env.UPSTREAM_BASE_URL = `http://127.0.0.1:${upstreamAddress.port}`;

const { app } = await import("./server.js");

test.after(async () => {
  await app.close();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  rmSync(tempDir, { recursive: true, force: true });
});

test("response cache hits on repeated non-stream requests and analytics exposes stats", async () => {
  const payload = {
    model: "gpt-4.1",
    input: "hello",
  };

  const first = await app.inject({
    method: "POST",
    url: "/v1/responses",
    headers: {
      authorization: "Bearer provider-key",
    },
    payload,
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.headers["x-proxy-response-cache"], undefined);
  assert.equal(upstreamHits, 1);

  const second = await app.inject({
    method: "POST",
    url: "/v1/responses",
    headers: {
      authorization: "Bearer provider-key",
    },
    payload,
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.headers["x-proxy-response-cache"], "hit");
  assert.equal(upstreamHits, 1);
  assert.deepEqual(second.json(), first.json());

  const analytics = await app.inject({
    method: "GET",
    url: "/api/analytics/cost-summary",
    headers: {
      authorization: "Bearer provider-key",
    },
  });
  assert.equal(analytics.statusCode, 200);
  const body = analytics.json() as {
    summary: { totalRequests: number; promptCacheHits: number; estimatedTokensSaved: number };
    responseCacheStats: { totalEntries: number; expiredEntries: number; estimatedBytes: number } | null;
  };
  assert.equal(body.summary.totalRequests >= 1, true);
  assert.equal(body.responseCacheStats?.totalEntries, 1);

  const flushed = await app.inject({
    method: "POST",
    url: "/api/analytics/response-cache/flush",
    headers: {
      authorization: "Bearer provider-key",
    },
  });
  assert.equal(flushed.statusCode, 200);
  assert.equal(flushed.json().deleted, 1);
});
