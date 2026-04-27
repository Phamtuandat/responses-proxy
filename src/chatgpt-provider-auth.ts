import type { AppConfig } from "./config.js";
import { refreshChatGptTokens } from "./chatgpt-oauth.js";
import type { ChatGptOAuthStore } from "./chatgpt-oauth-store.js";
import type { ChatGptOAuthRotationMode } from "./chatgpt-oauth-store.js";
import type { RuntimeProviderPreset } from "./runtime-provider-repository.js";

const refreshLocks = new Map<string, Promise<string>>();
const accountCursors = new Map<string, number>();

export class AccountPoolAuthError extends Error {
  readonly statusCode = 409;
  readonly body: {
    type: string;
    code: string;
    message: string;
  };

  constructor(code: string, message: string) {
    super(message);
    this.body = {
      type: "authentication_error",
      code,
      message,
    };
  }
}

export async function resolveChatGptAccessToken(args: {
  provider: RuntimeProviderPreset;
  store: ChatGptOAuthStore;
  config: AppConfig;
  rotationMode?: ChatGptOAuthRotationMode;
  now?: Date;
}): Promise<string> {
  const account = args.provider.chatgptAccountId?.trim()
    ? args.store.getAccount(args.provider.chatgptAccountId.trim())
    : selectNextChatGptAccount(args.provider.id, args.store, args.rotationMode ?? "round_robin");
  if (!account || account.disabled) {
    throw new AccountPoolAuthError(
      "ACCOUNT_POOL_UNAVAILABLE",
      "No connected accounts are available for this provider.",
    );
  }
  const now = args.now ?? new Date();
  const refreshLeadMs = args.config.CHATGPT_OAUTH_REFRESH_LEAD_DAYS * 24 * 60 * 60 * 1000;
  if (Date.parse(account.expiresAt) - now.getTime() > refreshLeadMs) {
    return account.accessToken;
  }

  const existingLock = refreshLocks.get(account.id);
  if (existingLock) {
    return existingLock;
  }

  const refreshPromise = refreshChatGptTokens(args.config, account.refreshToken, fetch, now)
    .then((bundle) => args.store.updateTokens(account.id, bundle, now).accessToken)
    .finally(() => {
      refreshLocks.delete(account.id);
    });
  refreshLocks.set(account.id, refreshPromise);
  return refreshPromise;
}

function selectNextChatGptAccount(
  providerId: string,
  store: ChatGptOAuthStore,
  rotationMode: ChatGptOAuthRotationMode,
) {
  const accounts = store.listAvailableAccounts();
  if (!accounts.length) {
    return undefined;
  }
  if (rotationMode === "first_available") {
    return accounts[0];
  }
  if (rotationMode === "random") {
    return accounts[Math.floor(Math.random() * accounts.length)];
  }
  const cursor = accountCursors.get(providerId) ?? 0;
  const account = accounts[cursor % accounts.length];
  accountCursors.set(providerId, (cursor + 1) % accounts.length);
  return account;
}

export function buildChatGptCodexHeaders(): Record<string, string> {
  return {
    Originator: "codex-tui",
  };
}
