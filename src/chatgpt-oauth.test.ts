import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChatGptAuthUrl,
  generateChatGptPkceCodes,
  normalizeChatGptTokenBundle,
  parseChatGptJwtClaims,
} from "./chatgpt-oauth.js";

function jwtPayload(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

test("generates PKCE codes suitable for S256 OAuth", () => {
  const pkce = generateChatGptPkceCodes();
  assert.ok(pkce.codeVerifier.length >= 43);
  assert.match(pkce.codeVerifier, /^[A-Za-z0-9_-]+$/);
  assert.match(pkce.codeChallenge, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(pkce.codeVerifier, pkce.codeChallenge);
});

test("builds ChatGPT auth URL with CLIProxyAPI-compatible parameters", () => {
  const url = new URL(
    buildChatGptAuthUrl(
      {
        CHATGPT_OAUTH_AUTH_URL: "https://auth.openai.com/oauth/authorize",
        CHATGPT_OAUTH_CLIENT_ID: "client-id",
        CHATGPT_OAUTH_REDIRECT_URI: "http://localhost:1455/auth/callback",
      },
      "state-value",
      {
        codeVerifier: "verifier",
        codeChallenge: "challenge",
      },
    ),
  );

  assert.equal(url.searchParams.get("client_id"), "client-id");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:1455/auth/callback");
  assert.equal(url.searchParams.get("scope"), "openid email profile offline_access");
  assert.equal(url.searchParams.get("state"), "state-value");
  assert.equal(url.searchParams.get("code_challenge"), "challenge");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("prompt"), "login");
  assert.equal(url.searchParams.get("id_token_add_organizations"), "true");
  assert.equal(url.searchParams.get("codex_cli_simplified_flow"), "true");
});

test("parses account id and email from ChatGPT id token claims", () => {
  const claims = parseChatGptJwtClaims(
    jwtPayload({
      email: "user@example.com",
      "https://api.openai.com/auth": {
        account_id: "acct_123",
      },
    }),
  );

  assert.deepEqual(claims, {
    email: "user@example.com",
    accountId: "acct_123",
  });
});

test("normalizes token response into persisted bundle", () => {
  const now = new Date("2026-04-27T00:00:00.000Z");
  const bundle = normalizeChatGptTokenBundle(
    {
      id_token: jwtPayload({
        email: "user@example.com",
        account_id: "acct_123",
      }),
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 60,
    },
    now,
  );

  assert.equal(bundle.email, "user@example.com");
  assert.equal(bundle.accountId, "acct_123");
  assert.equal(bundle.accessToken, "access-token");
  assert.equal(bundle.refreshToken, "refresh-token");
  assert.equal(bundle.expiresAt, "2026-04-27T00:01:00.000Z");
  assert.equal(bundle.lastRefreshAt, "2026-04-27T00:00:00.000Z");
});
