import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import BetterSqlite3 from "better-sqlite3";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-server-token-limits-"));
const dbFile = path.join(tempDir, "app.sqlite");

process.env.RESPONSES_PROXY_DISABLE_LISTEN = "true";
process.env.APP_DB_PATH = dbFile;
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

test("client token limit admin API creates reads and resets limits", async () => {
  const initial = await app.inject({
    method: "GET",
    url: "/api/client-token-limits/default",
  });
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.json().client.config, null);

  const update = await app.inject({
    method: "PUT",
    url: "/api/client-token-limits/default",
    payload: {
      enabled: true,
      tokenLimit: 12,
      windowType: "daily",
      hardBlock: true,
    },
  });
  assert.equal(update.statusCode, 200);
  assert.equal(update.json().client.config.tokenLimit, 12);
  assert.equal(update.json().client.status.remaining, 12);

  const reset = await app.inject({
    method: "POST",
    url: "/api/client-token-limits/default/reset",
  });
  assert.equal(reset.statusCode, 200);
  assert.equal(reset.json().client.usage.totalTokens, 0);
});

test("client token limit admin API accepts disabled config without usable limit values", async () => {
  const update = await app.inject({
    method: "PUT",
    url: "/api/client-token-limits/default",
    payload: {
      enabled: false,
      tokenLimit: 0,
      windowType: "fixed",
      windowSizeSeconds: 0,
      hardBlock: true,
    },
  });
  assert.equal(update.statusCode, 200);
  assert.equal(update.json().client.config.enabled, false);
  assert.equal(update.json().client.status.blocked, false);
});

test("client token limit enforcement rejects over-limit requests before upstream", async () => {
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setUTCHours(0, 0, 0, 0);

  await app.inject({
    method: "PUT",
    url: "/api/client-token-limits/default",
    payload: {
      enabled: true,
      tokenLimit: 1,
      windowType: "daily",
      hardBlock: true,
    },
  });

  const db = new BetterSqlite3(dbFile);
  try {
    db.prepare(
      `INSERT INTO client_token_usage (
        client_route,
        window_start,
        input_tokens,
        output_tokens,
        total_tokens,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(client_route, window_start) DO UPDATE SET
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        total_tokens = excluded.total_tokens,
        updated_at = excluded.updated_at`,
    ).run("default", windowStart.toISOString(), 1, 0, 1, now.toISOString());
  } finally {
    db.close();
  }

  const response = await app.inject({
    method: "POST",
    url: "/v1/responses",
    headers: {
      authorization: "Bearer provider-key",
    },
    payload: {
      model: "test-model",
      input: "hello",
    },
  });

  assert.equal(response.statusCode, 429);
  assert.equal(response.headers["x-proxy-error-code"], "CLIENT_TOKEN_LIMIT_EXCEEDED");
  assert.equal(response.json().error.code, "CLIENT_TOKEN_LIMIT_EXCEEDED");
  assert.equal(response.json().error.client, "default");
  assert.equal(response.json().error.usage.blocked, true);
});
