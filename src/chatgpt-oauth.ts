import { createHash, randomBytes } from "node:crypto";
import type { AppConfig } from "./config.js";

export type ChatGptPkceCodes = {
  codeVerifier: string;
  codeChallenge: string;
};

export type ChatGptTokenBundle = {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  accountId: string;
  email: string;
  expiresAt: string;
  lastRefreshAt: string;
};

export type ChatGptJwtClaims = {
  email?: string;
  accountId?: string;
};

type TokenEndpointResponse = {
  id_token?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
};

export function generateChatGptPkceCodes(): ChatGptPkceCodes {
  const codeVerifier = base64UrlEncode(randomBytes(96));
  const codeChallenge = base64UrlEncode(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export function generateChatGptOAuthState(): string {
  return base64UrlEncode(randomBytes(32));
}

export function buildChatGptAuthUrl(
  config: Pick<
    AppConfig,
    "CHATGPT_OAUTH_AUTH_URL" | "CHATGPT_OAUTH_CLIENT_ID" | "CHATGPT_OAUTH_REDIRECT_URI"
  >,
  state: string,
  pkce: ChatGptPkceCodes,
): string {
  const url = new URL(config.CHATGPT_OAUTH_AUTH_URL);
  url.searchParams.set("client_id", config.CHATGPT_OAUTH_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.CHATGPT_OAUTH_REDIRECT_URI);
  url.searchParams.set("scope", "openid email profile offline_access");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", pkce.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "login");
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  return url.toString();
}

export async function exchangeChatGptCodeForTokens(
  config: Pick<AppConfig, "CHATGPT_OAUTH_TOKEN_URL" | "CHATGPT_OAUTH_CLIENT_ID">,
  code: string,
  redirectUri: string,
  codeVerifier: string,
  fetchFn: typeof fetch = fetch,
  now = new Date(),
): Promise<ChatGptTokenBundle> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.CHATGPT_OAUTH_CLIENT_ID,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  return requestTokenBundle(config.CHATGPT_OAUTH_TOKEN_URL, body, fetchFn, now);
}

export async function refreshChatGptTokens(
  config: Pick<AppConfig, "CHATGPT_OAUTH_TOKEN_URL" | "CHATGPT_OAUTH_CLIENT_ID">,
  refreshToken: string,
  fetchFn: typeof fetch = fetch,
  now = new Date(),
): Promise<ChatGptTokenBundle> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.CHATGPT_OAUTH_CLIENT_ID,
    refresh_token: refreshToken,
    scope: "openid profile email",
  });
  return requestTokenBundle(config.CHATGPT_OAUTH_TOKEN_URL, body, fetchFn, now);
}

export function parseChatGptJwtClaims(idToken: string): ChatGptJwtClaims {
  const [, payload] = idToken.split(".");
  if (!payload) {
    return {};
  }
  try {
    const decoded = JSON.parse(Buffer.from(base64UrlToBase64(payload), "base64").toString("utf8")) as
      | Record<string, unknown>
      | undefined;
    if (!decoded || typeof decoded !== "object") {
      return {};
    }
    const openAiAuth = readObject(decoded["https://api.openai.com/auth"]);
    return {
      email: readString(decoded.email),
      accountId:
        readString(openAiAuth?.account_id) ??
        readString(openAiAuth?.accountId) ??
        readString(decoded.account_id) ??
        readString(decoded.accountId) ??
        readString(decoded.sub),
    };
  } catch {
    return {};
  }
}

async function requestTokenBundle(
  tokenUrl: string,
  body: URLSearchParams,
  fetchFn: typeof fetch,
  now: Date,
): Promise<ChatGptTokenBundle> {
  const response = await fetchFn(tokenUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ChatGPT OAuth token request failed with ${response.status}: ${text}`);
  }
  const payload = JSON.parse(text) as TokenEndpointResponse;
  return normalizeChatGptTokenBundle(payload, now);
}

export function normalizeChatGptTokenBundle(
  payload: TokenEndpointResponse,
  now = new Date(),
): ChatGptTokenBundle {
  const idToken = requireString(payload.id_token, "id_token");
  const accessToken = requireString(payload.access_token, "access_token");
  const refreshToken = requireString(payload.refresh_token, "refresh_token");
  const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
  const claims = parseChatGptJwtClaims(idToken);
  return {
    idToken,
    accessToken,
    refreshToken,
    accountId: claims.accountId ?? "",
    email: claims.email ?? "",
    expiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
    lastRefreshAt: now.toISOString(),
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`ChatGPT OAuth token response missing ${field}`);
  }
  return value;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function base64UrlEncode(bytes: Buffer): string {
  return bytes.toString("base64url");
}

function base64UrlToBase64(value: string): string {
  return value.replace(/-/g, "+").replace(/_/g, "/");
}
