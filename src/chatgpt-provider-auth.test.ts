import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveChatGptAccessToken } from "./chatgpt-provider-auth.js";
import { ChatGptOAuthStore } from "./chatgpt-oauth-store.js";
import type { AppConfig } from "./config.js";
import type { RuntimeProviderPreset } from "./runtime-provider-repository.js";

const config = {
  CHATGPT_OAUTH_REFRESH_LEAD_DAYS: 1,
  CHATGPT_OAUTH_TOKEN_URL: "https://auth.openai.com/oauth/token",
  CHATGPT_OAUTH_CLIENT_ID: "client",
} as AppConfig;

const provider = {
  id: "chatgpt-oauth",
  name: "ChatGPT OAuth",
  baseUrl: "https://chatgpt.com/backend-api/codex",
  responsesUrl: "https://chatgpt.com/backend-api/codex/responses",
  authMode: "chatgpt_oauth",
  providerApiKeys: [],
  clientApiKeys: [],
  capabilities: {
    usageCheckEnabled: false,
    stripMaxOutputTokens: false,
    requestParameterPolicy: {},
    sanitizeReasoningSummary: false,
    stripModelPrefixes: [],
  },
} satisfies RuntimeProviderPreset;

test("ChatGPT OAuth shared provider rotates through available accounts", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "responses-proxy-oauth-pool-"));
  try {
    const store = ChatGptOAuthStore.create(path.join(dir, "app.db"));
    const now = new Date("2026-04-27T00:00:00.000Z");
    store.upsertAccount(
      {
        idToken: "id-token-a",
        accessToken: "access-token-a",
        refreshToken: "refresh-token-a",
        accountId: "acct_a",
        email: "a@example.com",
        expiresAt: "2026-05-27T00:00:00.000Z",
        lastRefreshAt: now.toISOString(),
      },
      now,
    );
    store.upsertAccount(
      {
        idToken: "id-token-b",
        accessToken: "access-token-b",
        refreshToken: "refresh-token-b",
        accountId: "acct_b",
        email: "b@example.com",
        expiresAt: "2026-05-27T00:00:00.000Z",
        lastRefreshAt: now.toISOString(),
      },
      now,
    );

    assert.equal(await resolveChatGptAccessToken({ provider, store, config, now }), "access-token-a");
    assert.equal(await resolveChatGptAccessToken({ provider, store, config, now }), "access-token-b");
    assert.equal(await resolveChatGptAccessToken({ provider, store, config, now }), "access-token-a");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ChatGPT OAuth shared provider can use first available rotation", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "responses-proxy-oauth-pool-"));
  try {
    const store = ChatGptOAuthStore.create(path.join(dir, "app.db"));
    const now = new Date("2026-04-27T00:00:00.000Z");
    store.upsertAccount(
      {
        idToken: "id-token-a",
        accessToken: "first-token",
        refreshToken: "refresh-token-a",
        accountId: "acct_a",
        email: "a@example.com",
        expiresAt: "2026-05-27T00:00:00.000Z",
        lastRefreshAt: now.toISOString(),
      },
      now,
    );
    store.upsertAccount(
      {
        idToken: "id-token-b",
        accessToken: "second-token",
        refreshToken: "refresh-token-b",
        accountId: "acct_b",
        email: "b@example.com",
        expiresAt: "2026-05-27T00:00:00.000Z",
        lastRefreshAt: now.toISOString(),
      },
      now,
    );

    assert.equal(
      await resolveChatGptAccessToken({
        provider,
        store,
        config,
        rotationMode: "first_available",
        now,
      }),
      "first-token",
    );
    assert.equal(
      await resolveChatGptAccessToken({
        provider,
        store,
        config,
        rotationMode: "first_available",
        now,
      }),
      "first-token",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
