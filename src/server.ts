import Fastify from "fastify";
import type { FastifyBaseLogger } from "fastify";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";
import { readConfig } from "./config.js";
import {
  buildChatGptAuthUrl,
  exchangeChatGptCodeForTokens,
  generateChatGptOAuthState,
  generateChatGptPkceCodes,
  refreshChatGptTokens,
} from "./chatgpt-oauth.js";
import {
  AccountPoolAuthError,
  buildChatGptCodexHeaders,
  resolveChatGptAccessToken,
} from "./chatgpt-provider-auth.js";
import { ChatGptOAuthStore, redactAccount } from "./chatgpt-oauth-store.js";
import {
  applyQuickConfig,
  generateRouteApiKey,
  listRecentConfigBackups,
  readQuickApplyStatus,
  readQuickConfigFile,
  resolveQuickApplyPaths,
  writeQuickConfigFile,
  type QuickApplyClient,
} from "./client-config-apply.js";
import { buildUpstreamError, forwardJson, forwardSse } from "./forward.js";
import {
  OPENAI_ORGANIZATION_USAGE_COMPLETIONS_URL,
  ProviderUsageLimitError,
  ensureProviderUsageAvailable,
  fetchOpenAiCompletionsUsage,
  fetchProviderUsage,
} from "./provider-usage.js";
import {
  defaultProxyErrorCode,
  resolveProxyError,
} from "./error-response.js";
import { normalizeResponsesRequestWithCache } from "./normalize-request.js";
import {
  applyProviderRequestParameterPolicy,
  resolveMaxOutputTokensRule,
} from "./provider-request-parameters.js";
import {
  readRequestProviderHint,
  resolveProviderForRequest,
} from "./provider-routing.js";
import { resolveRequestTimeoutMs } from "./request-timeout-policy.js";
import {
  type ClientRouteKey,
  buildBuiltinProviderPresets,
  normalizeClientRouteKey,
  RuntimeProviderError,
  type RuntimeProviderInput,
  type RuntimeProviderPreset,
  RuntimeProviderRepository,
} from "./runtime-provider-repository.js";
import { proxyResponsesRequestSchema } from "./schema.js";
import { createSessionLogContext, deriveSessionKey } from "./session-log.js";
import {
  PromptCacheStateStore,
  type PromptCacheObservation,
} from "./prompt-cache-state.js";
import { applyRtkLayer, parseRtkLayerPolicyInput, resolveRtkLayerPolicy } from "./rtk-layer.js";

const config = readConfig(process.env);
const CHATGPT_OAUTH_PROVIDER_ID = "account-openai-codex";

const providerRepository = await RuntimeProviderRepository.create({
  dbFile: path.resolve(config.APP_DB_PATH),
  legacyStateFile: path.resolve(config.SESSION_LOG_DIR, "..", "runtime-state.json"),
  baseProviders: buildBuiltinProviderPresets(config),
});
const chatGptOAuthStore = ChatGptOAuthStore.create(path.resolve(config.APP_DB_PATH));
const promptCacheStateStore = PromptCacheStateStore.create(path.resolve(config.APP_DB_PATH));
const publicDir = path.resolve(process.cwd(), "public");
const publicAssetFiles = [
  "app.css",
  "app.js",
  "favicon.svg",
  "logo.svg",
  "app-icon.svg",
  "dashboard-illustration.svg",
  "providers-illustration.svg",
] as const;
const publicAssets = {
  indexHtml: readFileSync(path.join(publicDir, "index.html"), "utf8"),
  files: Object.fromEntries(
    publicAssetFiles.map((fileName) => [
      fileName,
      {
        body: readFileSync(path.join(publicDir, fileName), "utf8"),
        contentType: resolvePublicAssetContentType(fileName),
      },
    ]),
  ) as Record<(typeof publicAssetFiles)[number], { body: string; contentType: string }>,
};
const quickApplyPaths = resolveQuickApplyPaths({
  hermesConfigPath: process.env.QUICK_APPLY_HERMES_CONFIG_PATH,
  codexConfigPath: process.env.QUICK_APPLY_CODEX_CONFIG_PATH,
  backupDir: path.resolve(config.SESSION_LOG_DIR, "..", "client-config-backups"),
});
const localProxyBaseUrl = `http://127.0.0.1:${config.PORT}/v1`;
const quickApplyRuntime = existsSync("/.dockerenv") ? "container" : "native";
let latestPromptCacheObservation: PromptCacheObservation | undefined;
const latestPromptCacheObservationByProvider = new Map<string, PromptCacheObservation>();
const inflightJsonRequests = new Map<
  string,
  Promise<{
    payload: unknown;
    target: ForwardTarget;
    upstreamStatus: number;
  }>
>();
const DATE_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

hydratePromptCacheObservationsFromStore(promptCacheStateStore);
await hydrateLatestPromptCacheObservations(path.resolve(config.SESSION_LOG_DIR));

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
  },
  requestTimeout: config.REQUEST_TIMEOUT_MS,
  bodyLimit: config.REQUEST_BODY_LIMIT_BYTES,
  disableRequestLogging: true,
});

app.get("/health", async () => ({
  ok: true,
  service: "responses-proxy",
  upstream: providerRepository.getActiveProvider()?.baseUrl ?? null,
  activeProviderId: providerRepository.getActiveProviderId(),
  fallback: getFallbackProviderPreset()?.responsesUrl,
}));

app.get("/api/debug/prompt-cache/latest", async (request) => {
  const query = request.query as { providerId?: unknown } | undefined;
  const providerId =
    typeof query?.providerId === "string" && query.providerId.trim()
      ? query.providerId.trim()
      : undefined;

  return {
    ok: true,
    latest: providerId
      ? latestPromptCacheObservationByProvider.get(providerId) ?? null
      : latestPromptCacheObservation ?? null,
  };
});

app.get("/api/stats/usage", async (_request, reply) => {
  try {
    return reply.send({
      ok: true,
      stats: await buildUsageStats(),
    });
  } catch (error) {
    return reply.code(500).send({
      error: {
        type: "internal_error",
        code: "USAGE_STATS_FAILED",
        message: error instanceof Error ? error.message : "Could not read usage stats",
      },
    });
  }
});

app.get("/api/model-override", async (request, reply) => {
  const query = request.query as { client?: unknown } | undefined;
  const client =
    typeof query?.client === "string" && query.client.trim()
      ? normalizeClientRouteKey(query.client)
      : "default";
  const model = providerRepository.getModelOverride(client);
  return reply.send({
    ok: true,
    client,
    mode: model ? "override" : "default",
    model: model ?? null,
  });
});

app.get("/api/provider-models", async (request, reply) => {
  const query = request.query as { providerId?: unknown } | undefined;
  const providerId =
    typeof query?.providerId === "string" && query.providerId.trim()
      ? query.providerId.trim()
      : providerRepository.getActiveProviderId();
  const provider = providerRepository.getProvider(providerId);

  if (!provider) {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "INVALID_PROVIDER_ID",
        message: "providerId must match one of the configured runtime providers",
      },
    });
  }

  try {
    const models = await fetchProviderModels(provider);
    return reply.send({
      ok: true,
      providerId: provider.id,
      models,
    });
  } catch (error) {
    return reply.code(502).send({
      error: {
        type: "proxy_error",
        code: "MODEL_LIST_FAILED",
        message: error instanceof Error ? error.message : "Could not fetch models",
      },
    });
  }
});

app.post("/api/model-override", async (request, reply) => {
  const body = request.body as { client?: unknown; model?: unknown } | undefined;
  const client =
    typeof body?.client === "string" && body.client.trim()
      ? normalizeClientRouteKey(body.client)
      : "default";
  const nextModel = typeof body?.model === "string" ? body.model.trim() : "";
  const modelOverride = providerRepository.setModelOverride(client, nextModel || undefined);

  return reply.send({
    ok: true,
    client,
    mode: modelOverride ? "override" : "default",
    model: modelOverride ?? null,
  });
});

app.post("/api/rtk-policies", async (request, reply) => {
  const body = request.body as { client?: unknown; policy?: unknown } | undefined;
  if (typeof body?.client !== "string" || !body.client.trim()) {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "INVALID_CLIENT",
        message: "client is required",
      },
    });
  }

  const client = normalizeClientRouteKey(body.client);
  const policy = parseRtkLayerPolicyInput(body.policy);
  const resolved = providerRepository.setClientRouteRtkPolicy(client, policy);
  return reply.send({
    ok: true,
    client,
    rtkPolicy: resolved ?? null,
    clientRoutes: providerRepository.getClientRoutesForUi(),
  });
});

app.post("/api/client-route-keys", async (request, reply) => {
  const body = request.body as { client?: unknown; apiKeys?: unknown } | undefined;
  if (typeof body?.client !== "string" || !body.client.trim()) {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "INVALID_CLIENT",
        message: "client is required",
      },
    });
  }

  const client = normalizeClientRouteKey(body.client);
  const apiKeys = Array.isArray(body.apiKeys)
    ? body.apiKeys
    : typeof body?.apiKeys === "string"
      ? body.apiKeys.split(/\r?\n|,/g)
      : [];
  const resolved = providerRepository.setClientRouteApiKeys(
    client,
    apiKeys
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean),
  );
  return reply.send({
    ok: true,
    client,
    apiKeys: resolved,
    clientRoutes: providerRepository.getClientRoutesForUi(),
  });
});

app.get("/api/providers", async () => {
  ensureAccountBackedProvidersForExistingAccounts();
  return {
    ok: true,
    activeProviderId: providerRepository.getActiveProviderId(),
    clientRoutes: providerRepository.getClientRoutesForUi(),
    providerOptions: providerRepository.listProviderOptionsForClientSetup(),
    providers: providerRepository.listProvidersForUi(),
  };
});

app.get("/api/chatgpt-oauth/status", async () => {
  ensureAccountBackedProvidersForExistingAccounts();
  return {
    ok: true,
    enabled: config.CHATGPT_OAUTH_ENABLED,
    rotationMode: chatGptOAuthStore.getRotationMode(),
    accounts: chatGptOAuthStore.listAccountsForUi(),
  };
});

app.patch("/api/chatgpt-oauth/settings", async (request, reply) => {
  if (!config.CHATGPT_OAUTH_ENABLED) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "CHATGPT_OAUTH_DISABLED",
        message: "ChatGPT OAuth is disabled. Set CHATGPT_OAUTH_ENABLED=true to use it.",
      },
    });
  }
  const body = request.body as { rotationMode?: unknown } | undefined;
  return reply.send({
    ok: true,
    rotationMode: chatGptOAuthStore.setRotationMode(body?.rotationMode),
    accounts: chatGptOAuthStore.listAccountsForUi(),
  });
});

app.post("/api/chatgpt-oauth/start", async (_request, reply) => {
  if (!config.CHATGPT_OAUTH_ENABLED) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "CHATGPT_OAUTH_DISABLED",
        message: "ChatGPT OAuth is disabled. Set CHATGPT_OAUTH_ENABLED=true to use it.",
      },
    });
  }

  const state = generateChatGptOAuthState();
  const pkce = generateChatGptPkceCodes();
  chatGptOAuthStore.createSession({
    state,
    codeVerifier: pkce.codeVerifier,
    redirectUri: config.CHATGPT_OAUTH_REDIRECT_URI,
  });
  return reply.send({
    ok: true,
    state,
    authUrl: buildChatGptAuthUrl(config, state, pkce),
  });
});

app.post("/api/chatgpt-oauth/callback", async (request, reply) => {
  if (!config.CHATGPT_OAUTH_ENABLED) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "CHATGPT_OAUTH_DISABLED",
        message: "ChatGPT OAuth is disabled. Set CHATGPT_OAUTH_ENABLED=true to use it.",
      },
    });
  }

  const callback = parseChatGptOAuthCallbackInput(request.body);
  if (!callback.state) {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "MISSING_OAUTH_STATE",
        message: "state is required. Paste the full callback URL or provide state directly.",
      },
    });
  }
  if (callback.errorMessage) {
    chatGptOAuthStore.markSessionError(callback.state, callback.errorMessage);
    return reply.code(400).send({
      error: {
        type: "authentication_error",
        code: "CHATGPT_OAUTH_ERROR",
        message: callback.errorMessage,
      },
    });
  }
  if (!callback.code) {
    chatGptOAuthStore.markSessionError(callback.state, "Missing authorization code");
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "MISSING_AUTHORIZATION_CODE",
        message: "code is required. Paste the full callback URL or provide code directly.",
      },
    });
  }

  try {
    const result = await completeChatGptOAuthCallback(callback.state, callback.code);
    return reply.send({
      ok: true,
      account: result.account,
      provider: result.provider,
      accounts: chatGptOAuthStore.listAccountsForUi(),
      providers: providerRepository.listProvidersForUi(),
    });
  } catch (error) {
    chatGptOAuthStore.markSessionError(
      callback.state,
      error instanceof Error ? error.message : "OAuth failed",
    );
    return reply.code(400).send({
      error: {
        type: "authentication_error",
        code: "CHATGPT_OAUTH_CALLBACK_FAILED",
        message: error instanceof Error ? error.message : "OAuth failed",
      },
    });
  }
});

app.get("/auth/chatgpt/callback", async (request, reply) => {
  if (!config.CHATGPT_OAUTH_ENABLED) {
    return reply.code(409).type("text/html").send(renderOAuthResultPage("ChatGPT OAuth disabled"));
  }

  const callback = parseChatGptOAuthCallbackInput(request.query);

  if (!callback.state) {
    return reply.code(400).type("text/html").send(renderOAuthResultPage("Missing OAuth state"));
  }
  if (callback.errorMessage) {
    chatGptOAuthStore.markSessionError(callback.state, callback.errorMessage);
    return reply.code(400).type("text/html").send(renderOAuthResultPage(callback.errorMessage));
  }
  if (!callback.code) {
    chatGptOAuthStore.markSessionError(callback.state, "Missing authorization code");
    return reply.code(400).type("text/html").send(renderOAuthResultPage("Missing authorization code"));
  }

  try {
    const result = await completeChatGptOAuthCallback(callback.state, callback.code);
    return reply
      .type("text/html")
      .send(
        renderOAuthResultPage(
          `ChatGPT OAuth connected: ${result.account.email || result.account.accountId}`,
          result.provider.id,
        ),
      );
  } catch (error) {
    chatGptOAuthStore.markSessionError(
      callback.state,
      error instanceof Error ? error.message : "OAuth failed",
    );
    return reply
      .code(400)
      .type("text/html")
      .send(renderOAuthResultPage(error instanceof Error ? error.message : "OAuth failed"));
  }
});

app.post("/api/chatgpt-oauth/accounts/:accountId/refresh", async (request, reply) => {
  if (!config.CHATGPT_OAUTH_ENABLED) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "CHATGPT_OAUTH_DISABLED",
        message: "ChatGPT OAuth is disabled. Set CHATGPT_OAUTH_ENABLED=true to use it.",
      },
    });
  }

  const params = request.params as { accountId?: string };
  const accountId = params.accountId ? decodeURIComponent(params.accountId) : "";
  const account = chatGptOAuthStore.getAccount(accountId);
  if (!account) {
    return reply.code(404).send({
      error: {
        type: "not_found",
        code: "CHATGPT_OAUTH_ACCOUNT_NOT_FOUND",
        message: "ChatGPT OAuth account was not found",
      },
    });
  }

  const bundle = await refreshChatGptTokens(config, account.refreshToken);
  const updated = chatGptOAuthStore.updateTokens(account.id, bundle);
  return reply.send({
    ok: true,
    account: chatGptOAuthStore.listAccountsForUi().find((item) => item.id === updated.id) ?? null,
  });
});

app.post("/api/account-auth/accounts/:accountId/refresh", async (request, reply) => {
  if (!config.CHATGPT_OAUTH_ENABLED) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "ACCOUNT_AUTH_DISABLED",
        message: "Account auth is disabled. Enable the account platform before refreshing accounts.",
      },
    });
  }

  const params = request.params as { accountId?: string };
  const accountId = params.accountId ? decodeURIComponent(params.accountId) : "";
  const account = chatGptOAuthStore.getAccount(accountId);
  if (!account) {
    return reply.code(404).send({
      error: {
        type: "not_found",
        code: "ACCOUNT_AUTH_ACCOUNT_NOT_FOUND",
        message: "Connected account was not found",
      },
    });
  }

  const bundle = await refreshChatGptTokens(config, account.refreshToken);
  const updated = chatGptOAuthStore.updateTokens(account.id, bundle);
  return reply.send({
    ok: true,
    account: chatGptOAuthStore.listAccountsForUi().find((item) => item.id === updated.id) ?? null,
    accounts: chatGptOAuthStore.listAccountsForUi(),
  });
});

app.post("/api/account-auth/accounts/:accountId/disable", async (request, reply) => {
  const params = request.params as { accountId?: string };
  const accountId = params.accountId ? decodeURIComponent(params.accountId) : "";
  const ok = chatGptOAuthStore.disableAccount(accountId);
  if (!ok) {
    return reply.code(404).send({
      error: {
        type: "not_found",
        code: "ACCOUNT_AUTH_ACCOUNT_NOT_FOUND",
        message: "Connected account was not found",
      },
    });
  }
  return reply.send({
    ok: true,
    accounts: chatGptOAuthStore.listAccountsForUi(),
  });
});

app.post("/api/account-auth/accounts/:accountId/enable", async (request, reply) => {
  const params = request.params as { accountId?: string };
  const accountId = params.accountId ? decodeURIComponent(params.accountId) : "";
  const ok = chatGptOAuthStore.enableAccount(accountId);
  if (!ok) {
    return reply.code(404).send({
      error: {
        type: "not_found",
        code: "ACCOUNT_AUTH_ACCOUNT_NOT_FOUND",
        message: "Connected account was not found",
      },
    });
  }
  return reply.send({
    ok: true,
    accounts: chatGptOAuthStore.listAccountsForUi(),
  });
});

app.delete("/api/account-auth/accounts/:accountId", async (request, reply) => {
  const params = request.params as { accountId?: string };
  const accountId = params.accountId ? decodeURIComponent(params.accountId) : "";
  const ok = chatGptOAuthStore.deleteAccount(accountId);
  if (!ok) {
    return reply.code(404).send({
      error: {
        type: "not_found",
        code: "ACCOUNT_AUTH_ACCOUNT_NOT_FOUND",
        message: "Connected account was not found",
      },
    });
  }
  return reply.send({
    ok: true,
    accounts: chatGptOAuthStore.listAccountsForUi(),
  });
});

app.delete("/api/chatgpt-oauth/accounts/:accountId", async (request, reply) => {
  const params = request.params as { accountId?: string };
  const accountId = params.accountId ? decodeURIComponent(params.accountId) : "";
  return reply.send({
    ok: chatGptOAuthStore.deleteAccount(accountId),
    accounts: chatGptOAuthStore.listAccountsForUi(),
  });
});

app.get("/api/client-configs/status", async (_request, reply) => {
  ensureAccountBackedProvidersForExistingAccounts();
  return reply.send({
    ok: true,
    runtime: quickApplyRuntime,
    proxyBaseUrl: localProxyBaseUrl,
    providerOptions: providerRepository.listProviderOptionsForClientSetup(),
    clients: {
      hermes: buildQuickApplyClientStatus("hermes"),
      codex: buildQuickApplyClientStatus("codex"),
    },
  });
});

app.post("/api/client-configs/apply", async (request, reply) => {
  const body = request.body as {
    client?: unknown;
    baseUrl?: unknown;
    routeApiKey?: unknown;
    clientApiKey?: unknown;
    model?: unknown;
  } | undefined;
  const client = normalizeQuickApplyClient(body?.client);
  if (!client) {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "INVALID_CLIENT",
        message: "client must be either hermes or codex",
      },
    });
  }

  const requestedBaseUrl =
    typeof body?.baseUrl === "string" && body.baseUrl.trim()
      ? body.baseUrl.trim()
      : localProxyBaseUrl;
  const requestedModel =
    typeof body?.model === "string" && body.model.trim()
      ? body.model.trim()
      : "";
  if (!requestedModel) {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "MODEL_REQUIRED",
        message: "model must be selected from the available models for the chosen client API key.",
      },
    });
  }
  const access = getQuickApplyAccess(client);
  if (!access.canPatch) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "QUICK_APPLY_HOST_PATH_UNAVAILABLE",
        message: access.reason,
      },
    });
  }

  const routeApiKeys = providerRepository.getClientRouteApiKeys(client);
  const allClientApiKeys = providerRepository
    .getClientRoutesForUi()
    .filter((route) => route.key !== "default")
    .flatMap((route) => route.apiKeys);
  const requestedRouteApiKey =
    typeof body?.routeApiKey === "string" && body.routeApiKey.trim()
      ? body.routeApiKey.trim()
      : typeof body?.clientApiKey === "string" && body.clientApiKey.trim()
        ? body.clientApiKey.trim()
        : "";
  if (requestedRouteApiKey && !allClientApiKeys.includes(requestedRouteApiKey)) {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "CLIENT_API_KEY_NOT_FOUND",
        message: "Selected client API key does not belong to any configured client.",
      },
    });
  }
  const routeApiKey = requestedRouteApiKey || routeApiKeys[0] || generateRouteApiKey(client);
  const selectedClientRoute = providerRepository.findClientRouteByApiKey(routeApiKey) ?? client;
  const selectedProvider = providerRepository.getProviderForClient(selectedClientRoute);
  if (!selectedProvider) {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "CLIENT_PROVIDER_NOT_FOUND",
        message: "Selected client API key is not bound to a configured provider.",
      },
    });
  }
  try {
    const availableModels = await fetchProviderModels(selectedProvider);
    if (!availableModels.includes(requestedModel)) {
      return reply.code(400).send({
        error: {
          type: "validation_error",
          code: "MODEL_NOT_AVAILABLE",
          message: "Selected model is not available for the chosen client API key provider.",
        },
      });
    }
  } catch (error) {
    return reply.code(502).send({
      error: {
        type: "proxy_error",
        code: "MODEL_LIST_FAILED",
        message: error instanceof Error ? error.message : "Could not validate available models",
      },
    });
  }
  if (!routeApiKeys.length && !requestedRouteApiKey) {
    providerRepository.setClientRouteApiKeys(client, [routeApiKey]);
  }
  const configPath = client === "hermes" ? quickApplyPaths.hermesConfigPath : quickApplyPaths.codexConfigPath;
  const currentRaw = readQuickConfigFile(configPath);
  const nextRaw = applyQuickConfig(currentRaw, {
    client,
    proxyBaseUrl: requestedBaseUrl,
    routeApiKey,
    model: requestedModel,
  });
  writeQuickConfigFile(configPath, nextRaw, {
    backupDir: quickApplyPaths.backupDir,
  });

  return reply.send({
    ok: true,
    client,
    proxyBaseUrl: requestedBaseUrl,
    status: buildQuickApplyClientStatus(client, requestedBaseUrl),
    clientRoutes: providerRepository.getClientRoutesForUi(),
  });
});

app.post("/api/provider-routes", async (request, reply) => {
  const body = request.body as { client?: unknown; providerId?: unknown } | undefined;
  if (typeof body?.client !== "string" || !body.client.trim()) {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "INVALID_CLIENT",
        message: "client is required",
      },
    });
  }
  const client = normalizeClientRouteKey(body.client);

  try {
    const resolvedProviderId = providerRepository.setClientRoute(
      client,
      typeof body?.providerId === "string" ? body.providerId : undefined,
    );
    return reply.send({
      ok: true,
      activeProviderId: providerRepository.getActiveProviderId(),
      clientRoutes: providerRepository.getClientRoutesForUi(),
      provider: providerRepository.getProviderForUiOrThrow(resolvedProviderId),
    });
  } catch (error) {
    return sendProviderRepositoryError(reply, error);
  }
});

app.post("/api/clients", async (request, reply) => {
  const body = request.body as {
    client?: unknown;
    providerId?: unknown;
    model?: unknown;
    apiKeys?: unknown;
  } | undefined;
  if (typeof body?.client !== "string" || !body.client.trim()) {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "INVALID_CLIENT",
        message: "client is required",
      },
    });
  }

  try {
    const client = normalizeClientRouteKey(body.client);
    const apiKeys = normalizeClientApiKeysInput(body?.apiKeys);
    if (client !== "default" && apiKeys.length === 0) {
      return reply.code(400).send({
        error: {
          type: "validation_error",
          code: "CLIENT_API_KEY_REQUIRED",
          message: "At least one client API key is required.",
        },
      });
    }
    providerRepository.addClientRoute(
      client,
      typeof body?.providerId === "string" ? body.providerId : undefined,
    );
    providerRepository.setModelOverride(
      client,
      typeof body?.model === "string" && body.model.trim() ? body.model.trim() : undefined,
    );
    providerRepository.setClientRouteApiKeys(client, apiKeys);
    return reply.code(201).send({
      ok: true,
      client,
      clientRoutes: providerRepository.getClientRoutesForUi(),
      providerOptions: providerRepository.listProviderOptionsForClientSetup(),
    });
  } catch (error) {
    return sendProviderRepositoryError(reply, error);
  }
});

app.put("/api/clients/:client", async (request, reply) => {
  const params = request.params as { client?: string };
  const body = request.body as { providerId?: unknown; model?: unknown; apiKeys?: unknown } | undefined;
  if (typeof params.client !== "string" || !params.client.trim()) {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "INVALID_CLIENT",
        message: "client is required",
      },
    });
  }

  try {
    const client = normalizeClientRouteKey(params.client);
    const apiKeys = normalizeClientApiKeysInput(body?.apiKeys);
    if (client !== "default" && apiKeys.length === 0) {
      return reply.code(400).send({
        error: {
          type: "validation_error",
          code: "CLIENT_API_KEY_REQUIRED",
          message: "At least one client API key is required.",
        },
      });
    }
    providerRepository.setClientRoute(
      client,
      typeof body?.providerId === "string" ? body.providerId : undefined,
    );
    providerRepository.setModelOverride(
      client,
      typeof body?.model === "string" && body.model.trim() ? body.model.trim() : undefined,
    );
    providerRepository.setClientRouteApiKeys(client, apiKeys);
    return reply.send({
      ok: true,
      client,
      clientRoutes: providerRepository.getClientRoutesForUi(),
      providerOptions: providerRepository.listProviderOptionsForClientSetup(),
    });
  } catch (error) {
    return sendProviderRepositoryError(reply, error);
  }
});

app.delete("/api/clients/:client", async (request, reply) => {
  const params = request.params as { client?: string };
  if (typeof params.client !== "string" || !params.client.trim()) {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "INVALID_CLIENT",
        message: "client is required",
      },
    });
  }

  try {
    const client = normalizeClientRouteKey(params.client);
    providerRepository.deleteClientRoute(client);
    return reply.send({
      ok: true,
      client,
      clientRoutes: providerRepository.getClientRoutesForUi(),
      providerOptions: providerRepository.listProviderOptionsForClientSetup(),
    });
  } catch (error) {
    return sendProviderRepositoryError(reply, error);
  }
});

app.get("/api/providers/:providerId", async (request, reply) => {
  const params = request.params as { providerId?: string };
  try {
    return reply.send({
      ok: true,
      provider: providerRepository.getProviderForUiOrThrow(params.providerId),
    });
  } catch (error) {
    return sendProviderRepositoryError(reply, error);
  }
});

app.post("/api/providers", async (request, reply) => {
  try {
    const provider = providerRepository.createProvider(
      (request.body as RuntimeProviderInput | undefined) ?? {},
    );
    return reply.code(201).send({
      ok: true,
      activeProviderId: providerRepository.getActiveProviderId(),
      provider: providerRepository.getProviderForUiOrThrow(provider.id),
    });
  } catch (error) {
    return sendProviderRepositoryError(reply, error);
  }
});

app.post("/api/providers/select", async (request, reply) => {
  const body = request.body as { providerId?: unknown } | undefined;
  const providerId =
    typeof body?.providerId === "string" ? body.providerId.trim() : "";
  try {
    const nextProvider = providerRepository.selectProvider(providerId);
    return reply.send({
      ok: true,
      activeProviderId: providerRepository.getActiveProviderId(),
      provider: {
        id: nextProvider.id,
        name: nextProvider.name,
        baseUrl: nextProvider.baseUrl,
      },
    });
  } catch (error) {
    return sendProviderRepositoryError(reply, error);
  }
});

app.post("/api/providers/custom", async (request, reply) => {
  return app.inject({
    method: "POST",
    url: "/api/providers",
    payload: request.body as Record<string, unknown> | undefined,
  }).then((response) => reply.code(response.statusCode).send(response.json()));
});

app.put("/api/providers/:providerId", async (request, reply) => {
  const params = request.params as { providerId?: string };
  const providerId = typeof params.providerId === "string" ? params.providerId.trim() : "";
  try {
    const provider = providerRepository.updateProvider(
      providerId,
      (request.body as RuntimeProviderInput | undefined) ?? {},
    );
    return reply.send({
      ok: true,
      activeProviderId: providerRepository.getActiveProviderId(),
      provider: providerRepository.getProviderForUiOrThrow(provider.id),
    });
  } catch (error) {
    return sendProviderRepositoryError(reply, error);
  }
});

app.delete("/api/providers/:providerId", async (request, reply) => {
  const params = request.params as { providerId?: string };
  const providerId = typeof params.providerId === "string" ? params.providerId.trim() : "";
  try {
    const activeProviderId = providerRepository.deleteProvider(providerId);
    return reply.send({
      ok: true,
      activeProviderId,
    });
  } catch (error) {
    return sendProviderRepositoryError(reply, error);
  }
});

app.post("/api/providers/delete", async (request, reply) => {
  const body = request.body as { providerId?: unknown } | undefined;
  const providerId =
    typeof body?.providerId === "string" ? body.providerId.trim() : "";
  return app
    .inject({
      method: "DELETE",
      url: `/api/providers/${encodeURIComponent(providerId)}`,
    })
    .then((response) => reply.code(response.statusCode).send(response.json()));
});

app.get("/", async (_request, reply) => {
  reply.type("text/html; charset=utf-8").send(publicAssets.indexHtml);
});

for (const [fileName, asset] of Object.entries(publicAssets.files)) {
  app.get(`/${fileName}`, async (_request, reply) => {
    reply.type(asset.contentType).send(asset.body);
  });
}

app.get("/favicon.ico", async (_request, reply) => {
  const favicon = publicAssets.files["favicon.svg"];
  reply.type(favicon.contentType).send(favicon.body);
});

async function handleProviderUsageCheck(
  request: {
    body: unknown;
    log: FastifyBaseLogger;
  },
  reply: {
    code(statusCode: number): { send(payload: Record<string, unknown>): unknown };
    send(payload: unknown): unknown;
  },
): Promise<unknown> {
  const requestId = randomUUID();
  const body = request.body as { apiKey?: unknown; providerId?: unknown } | undefined;
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  const providerId = typeof body?.providerId === "string" ? body.providerId.trim() : "";

  if (!apiKey) {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "MISSING_API_KEY",
        message: "apiKey is required",
      },
    });
  }

  const provider =
    providerRepository.findProviderByProviderApiKey(apiKey) ||
    (providerId ? providerRepository.getProvider(providerId) : undefined);
  if (!provider) {
    return reply.code(404).send({
      error: {
        type: "not_found",
        code: "PROVIDER_NOT_FOUND",
        message: "No provider matched the supplied API key or providerId",
      },
    });
  }
  if (!provider.capabilities.usageCheckEnabled || !provider.capabilities.usageCheckUrl) {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "PROVIDER_USAGE_CHECK_UNSUPPORTED",
        message: `Usage check is not configured for provider ${provider.id}`,
      },
    });
  }

  const usage = await fetchProviderUsage({
    apiKey,
    requestId,
    logger: request.log,
    timeoutMs: config.REQUEST_TIMEOUT_MS,
    url: provider.capabilities.usageCheckUrl,
  });

  if (!usage) {
    return reply.code(502).send({
      error: {
        type: "proxy_error",
        code: "PROVIDER_USAGE_CHECK_FAILED",
        message: "Could not fetch provider token usage",
      },
    });
  }

  const isExhausted =
    usage.allowed === false || (usage.remaining !== undefined && usage.remaining <= 0);

  return reply.send({
    ok: !isExhausted,
    providerId: provider.id,
    usage: summarizeUsage(usage),
    raw: usage.raw,
  });
}

app.post("/api/providers/check-usage", async (request, reply) =>
  handleProviderUsageCheck(request, reply),
);

app.get("/api/providers/live-usage", async (request, reply) => {
  ensureAccountBackedProvidersForExistingAccounts();
  const requestId = randomUUID();
  const providers = providerRepository.listProviders();
  const entries = await Promise.all(
    providers.map((provider) => buildLiveProviderUsageEntry(provider, requestId, request.log)),
  );
  return reply.send({
    ok: true,
    timestamp: new Date().toISOString(),
    providers: entries,
  });
});

app.get("/v1/models", async (request, reply) => {
  const routingApiKey = readBearerToken(request.headers.authorization);
  const providerHint = readRequestProviderHint(request.headers, undefined);
  const providerResolution = resolveProviderForRequest({
    providers: providerRepository.findProvidersByAccessKey(routingApiKey),
    explicitProviderId: providerHint.providerId,
    explicitProviderName: providerHint.providerName,
  });

  if ("error" in providerResolution) {
    return reply.code(providerResolution.error.statusCode).send({
      error: providerResolution.error,
    });
  }
  const selectedProvider = providerResolution.provider;

  const target = await buildForwardTarget(selectedProvider);
  const response = await fetch(`${selectedProvider.baseUrl.replace(/\/+$/, "")}/models`, {
    headers:
      target.headers ??
      (target.apiKey
        ? {
            Authorization: `Bearer ${target.apiKey}`,
          }
        : undefined),
  });

  if (!response.ok) {
    return reply.code(response.status).send(await response.text());
  }

  const payload = await response.json();
  return reply.send(payload);
});

async function handleResponsesRequest(
  request: {
    body: unknown;
    headers: Record<string, unknown>;
    log: FastifyBaseLogger;
    params?: unknown;
  },
  reply: {
    code(statusCode: number): { send(payload: Record<string, unknown>): unknown };
    header(name: string, value: string): unknown;
    send(payload: unknown): unknown;
    hijack(): void;
    raw: NodeJS.WritableStream & {
      headersSent?: boolean;
      setHeader(name: string, value: string): void;
      flushHeaders?: () => void;
      end(chunk?: unknown): void;
      destroy(error?: Error): void;
    };
  },
  routePath: string,
): Promise<unknown> {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const parsed = proxyResponsesRequestSchema.safeParse(request.body);

  if (!parsed.success) {
    const fallbackSession = createSessionLogContext(
      config.SESSION_LOG_DIR,
      "invalid-request",
      config.SESSION_LOG_RETENTION_DAYS,
      {
        cacheMetricsStore: promptCacheStateStore,
      },
    );
    request.log.warn(
      {
        requestId,
        validationErrors: parsed.error.flatten(),
      },
      "responses proxy request validation failed",
    );
    await fallbackSession.write({
      event: "validation_failed",
      requestId,
      route: routePath,
      validationErrors: parsed.error.flatten(),
    });
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "INVALID_RESPONSES_REQUEST",
        message: "Request body does not match the supported Responses proxy schema",
        details: parsed.error.flatten(),
      },
    });
  }

  const routingApiKey = readBearerToken(request.headers.authorization);
  const clientRoute = resolveClientRoute(request.headers, parsed.data, routingApiKey);
  const providerHint = readRequestProviderHint(request.headers, parsed.data.metadata);
  const providerResolution = resolveProviderForRequest({
    providers: providerRepository.findProvidersByAccessKey(routingApiKey),
    explicitProviderId: providerHint.providerId,
    explicitProviderName: providerHint.providerName,
  });
  if ("error" in providerResolution) {
    return reply.code(providerResolution.error.statusCode).send({
      error: providerResolution.error,
    });
  }
  const selectedProvider = providerResolution.provider;
  const currentModelOverride = providerRepository.getModelOverride(clientRoute);
  const clientRouteRtkPolicy = providerRepository.getClientRouteRtkPolicy(clientRoute);
  const maxOutputTokensRule = resolveMaxOutputTokensRule(selectedProvider.capabilities);
  const requestBody = currentModelOverride
    ? {
        ...parsed.data,
        model: currentModelOverride,
      }
    : parsed.data;
  const resolvedRtkPolicy = resolveRtkLayerPolicy(
    {
      enabled: config.RTK_LAYER_ENABLED,
      toolOutputEnabled: config.RTK_LAYER_TOOL_OUTPUT_ENABLED,
      maxChars: config.RTK_LAYER_TOOL_OUTPUT_MAX_CHARS,
      maxLines: config.RTK_LAYER_TOOL_OUTPUT_MAX_LINES,
      tailLines: config.RTK_LAYER_TOOL_OUTPUT_TAIL_LINES,
      tailChars: config.RTK_LAYER_TOOL_OUTPUT_TAIL_CHARS,
      detectFormat: config.RTK_LAYER_TOOL_OUTPUT_DETECT_FORMAT,
    },
    selectedProvider.capabilities.rtkPolicy,
    clientRouteRtkPolicy,
  );
  const rtkLayerResult = applyRtkLayer(requestBody, resolvedRtkPolicy);
  const effectiveRequestBody = rtkLayerResult.body;

  const normalizedResult = normalizeResponsesRequestWithCache(effectiveRequestBody, {
    openClawTokenOptimizationEnabled: config.OPENCLAW_TOKEN_OPTIMIZATION_ENABLED,
    defaultReasoningEffort: config.OPENCLAW_DEFAULT_REASONING_EFFORT,
    defaultReasoningSummary: config.OPENCLAW_DEFAULT_REASONING_SUMMARY,
    defaultTextVerbosity: config.OPENCLAW_DEFAULT_TEXT_VERBOSITY,
    defaultMaxOutputTokens: config.OPENCLAW_DEFAULT_MAX_OUTPUT_TOKENS,
    autoPromptCacheKey: config.OPENCLAW_AUTO_PROMPT_CACHE_KEY,
    defaultPromptCacheRetention: config.OPENCLAW_PROMPT_CACHE_RETENTION,
    promptCacheRedesignEnabled: config.PROVIDER_PROMPT_CACHE_REDESIGN_ENABLED,
    promptCacheStableSummarizationEnabled:
      config.PROVIDER_PROMPT_CACHE_STABLE_SUMMARIZATION_ENABLED,
    promptCacheSummaryTriggerItems: config.PROVIDER_PROMPT_CACHE_SUMMARY_TRIGGER_ITEMS,
    promptCacheSummaryKeepRecentItems: config.PROVIDER_PROMPT_CACHE_SUMMARY_KEEP_RECENT_ITEMS,
    promptCacheRetentionByFamilyEnabled:
      config.PROVIDER_PROMPT_CACHE_RETENTION_BY_FAMILY_ENABLED,
    promptCacheRetentionByFamilyRules: config.PROVIDER_PROMPT_CACHE_RETENTION_BY_FAMILY,
    defaultTruncation:
      maxOutputTokensRule.mode === "strip" ? undefined : config.OPENCLAW_DEFAULT_TRUNCATION,
    maxOutputTokensPolicy: maxOutputTokensRule,
    sanitizeReasoningSummary: selectedProvider.capabilities.sanitizeReasoningSummary,
  });
  const normalized = normalizedResult.request;
  const activeProviderId = selectedProvider.id;
  const isStream = normalized.stream === true;
  const traceContext: Record<string, unknown> = {
    ...buildTraceContext(
      effectiveRequestBody,
      normalized,
      normalizedResult.cacheLayout,
      rtkLayerResult.stats,
    ),
    providerId: activeProviderId,
  };
  const sessionLog = createSessionLogContext(
    config.SESSION_LOG_DIR,
    deriveSessionKey(effectiveRequestBody, traceContext),
    config.SESSION_LOG_RETENTION_DAYS,
    {
      cacheMetricsStore: promptCacheStateStore,
    },
  );
  latestPromptCacheObservation = {
    requestId,
    providerId: activeProviderId,
    clientRoute,
    model: stringOrUndefined(normalized.model),
    familyId: stringOrUndefined(traceContext.familyId),
    staticKey: stringOrUndefined(traceContext.staticKey),
    requestKey: stringOrUndefined(traceContext.requestKey),
    promptCacheKey: stringOrUndefined(normalized.prompt_cache_key),
    promptCacheRetention: stringOrUndefined(normalized.prompt_cache_retention),
    truncation: stringOrUndefined(traceContext.truncation),
    reasoningEffort: stringOrUndefined(traceContext.reasoningEffort),
    reasoningSummary: stringOrUndefined(traceContext.reasoningSummary),
    textVerbosity: stringOrUndefined(traceContext.textVerbosity),
    rtkApplied: rtkLayerResult.stats.applied,
    rtkCharsSaved: rtkLayerResult.stats.charsSaved,
    stream: isStream,
    timestamp: new Date().toISOString(),
  };
  setLatestPromptCacheObservation(latestPromptCacheObservation);

  request.log.info(
    {
      requestId,
      clientRoute,
      ...traceContext,
    },
    "forwarding responses request",
  );
  await sessionLog.write({
    event: "request_started",
    requestId,
    clientRoute,
    route: routePath,
    rtk: rtkLayerResult.stats,
    ...traceContext,
  });

  if (config.LOG_BODY) {
    request.log.debug({ requestId, normalized }, "normalized responses payload");
  }

  try {
    if (isStream) {
      setProxyResponseHeaders(reply.raw, {
        requestId,
        providerId: activeProviderId,
        familyId: stringOrUndefined(traceContext.familyId),
        staticKey: stringOrUndefined(traceContext.staticKey),
        requestKey: stringOrUndefined(traceContext.requestKey),
        promptCacheKey: stringOrUndefined(traceContext.promptCacheKey),
        promptCacheRetention: stringOrUndefined(traceContext.promptCacheRetention),
        rtkApplied: rtkLayerResult.stats.applied,
        rtkCharsSaved: rtkLayerResult.stats.charsSaved,
      });
      reply.hijack();
      const streamTarget = await forwardSseWithFallback({
        requestId,
        clientRoute,
        providerId: activeProviderId,
        routingApiKey,
        body: normalized,
        responseRaw: reply.raw,
        logger: request.log,
        sessionLog,
        logContext: traceContext,
        onEvent: (entry) => updateLatestPromptCacheObservationFromEntry(entry),
      });
      latestPromptCacheObservation = {
        ...(latestPromptCacheObservation ?? {
          requestId,
          providerId: activeProviderId,
          clientRoute,
          stream: true,
          timestamp: new Date().toISOString(),
        }),
        upstreamTarget: streamTarget.name,
        timestamp: new Date().toISOString(),
      };
      setLatestPromptCacheObservation(latestPromptCacheObservation);
      request.log.info(
        {
        requestId,
        clientRoute,
        upstreamTarget: streamTarget.name,
          ...traceContext,
          totalMs: Date.now() - startedAt,
        },
        "responses proxy stream request completed",
      );
      await sessionLog.write({
        event: "request_completed",
        requestId,
        clientRoute,
        mode: "stream",
        totalMs: Date.now() - startedAt,
        upstreamTarget: streamTarget.name,
        ...traceContext,
      });
      return reply;
    }

    const dedupeKey = buildInflightDedupeKey(activeProviderId, normalized, traceContext);
    const dedupeEnabled =
      config.PROVIDER_PROMPT_CACHE_INFLIGHT_DEDUPE_ENABLED && typeof dedupeKey === "string";
    if (dedupeEnabled && dedupeKey) {
      await sessionLog.write({
        event: "inflight_dedupe_candidate",
        requestId,
        clientRoute,
        dedupeKey,
        ...traceContext,
      });
    }

    const { payload, target, upstreamStatus } = await runJsonRequestWithInflightDedupe(
      dedupeKey,
      {
        requestId,
        clientRoute,
        providerId: activeProviderId,
        routingApiKey,
        body: normalized,
        logger: request.log,
        sessionLog,
      },
      dedupeEnabled,
    );
    latestPromptCacheObservation = {
      ...(latestPromptCacheObservation ?? {
        requestId,
        providerId: activeProviderId,
        clientRoute,
        stream: false,
        timestamp: new Date().toISOString(),
      }),
      upstreamTarget: target.name,
      cachedTokens: readUsageCachedTokens(payload),
      cacheSavedPercent: readCacheSavedPercent(payload),
      cacheHit: readUsageCachedTokens(payload) !== undefined ? readUsageCachedTokens(payload)! > 0 : undefined,
      timestamp: new Date().toISOString(),
    };
    setLatestPromptCacheObservation(latestPromptCacheObservation);
    request.log.info(
      {
        requestId,
        clientRoute,
        ...traceContext,
        upstreamTarget: target.name,
        upstreamStatus,
        totalMs: Date.now() - startedAt,
        responseId: readStringField(payload, "id"),
        responseStatus: readStringField(payload, "status"),
        cachedTokens: readUsageCachedTokens(payload),
        cacheSavedPercent: readCacheSavedPercent(payload),
      },
      "responses proxy JSON request completed",
    );
    await sessionLog.write({
      event: "request_completed",
      requestId,
      clientRoute,
      mode: "json",
      totalMs: Date.now() - startedAt,
      upstreamTarget: target.name,
      upstreamStatus,
      responseId: readStringField(payload, "id"),
      responseStatus: readStringField(payload, "status"),
      usage: readResponseUsage(payload),
      inputTokensDetails: readResponseInputTokensDetails(payload),
      cachedTokens: readUsageCachedTokens(payload),
      cacheSavedPercent: readCacheSavedPercent(payload),
      ...traceContext,
    });
    reply.header("x-proxy-request-id", requestId);
    reply.header("x-proxy-provider-id", activeProviderId);
    reply.header("x-proxy-upstream-target", target.name);
    reply.header("x-proxy-upstream-status", String(upstreamStatus));
    reply.header("x-proxy-family-id", stringOrUndefined(traceContext.familyId) ?? "");
    reply.header("x-proxy-static-key", stringOrUndefined(traceContext.staticKey) ?? "");
    reply.header("x-proxy-request-key", stringOrUndefined(traceContext.requestKey) ?? "");
    reply.header("x-proxy-prompt-cache-key", stringOrUndefined(traceContext.promptCacheKey) ?? "");
    reply.header(
      "x-proxy-prompt-cache-retention",
      stringOrUndefined(traceContext.promptCacheRetention) ?? "",
    );
    reply.header("x-proxy-rtk-applied", rtkLayerResult.stats.applied ? "1" : "0");
    reply.header("x-proxy-rtk-chars-saved", String(rtkLayerResult.stats.charsSaved));
    reply.send(payload);
  } catch (error) {
    request.log.error(
      {
        err: error,
        requestId,
        clientRoute,
        ...traceContext,
        totalMs: Date.now() - startedAt,
      },
      "responses proxy request failed",
    );
    const statusCode =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number((error as { statusCode?: number }).statusCode) || 502
        : 502;
    const upstreamBody =
      typeof error === "object" && error !== null && "body" in error
        ? (error as { body?: string }).body
        : undefined;
    const errorCode =
      error instanceof AccountPoolAuthError
        ? error.body.code
        : error instanceof ProviderUsageLimitError
        ? error.code
        : statusCode >= 500
          ? "UPSTREAM_REQUEST_FAILED"
          : "UPSTREAM_BAD_REQUEST";
    await sessionLog.write({
      event: "request_failed",
      requestId,
      clientRoute,
      totalMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : "Unknown proxy error",
      upstreamBody,
      ...traceContext,
    });

    const resolvedError = resolveProxyError({
      statusCode,
      message: error instanceof Error ? error.message : "Unknown proxy error",
      requestId,
      upstreamBody,
      usage: error instanceof ProviderUsageLimitError ? error.usage : undefined,
      defaultCode: errorCode,
      errorType: "proxy_error",
      providerErrorPolicy: selectedProvider.capabilities.errorPolicy,
    });

    if (isStream) {
      sendHijackedStreamError(reply.raw, {
        statusCode,
        message: error instanceof Error ? error.message : "Unknown proxy error",
        requestId,
        upstreamBody,
        usage: error instanceof ProviderUsageLimitError ? error.usage : undefined,
        defaultCode: errorCode,
        providerErrorPolicy: selectedProvider.capabilities.errorPolicy,
      });
      return reply;
    }

    reply.header("x-proxy-error-code", resolvedError.errorCode);
    reply.header("x-proxy-retryable", resolvedError.retryable ? "1" : "0");
    return reply.code(statusCode).send(resolvedError.envelope);
  }
}

app.post("/v1/responses", async (request, reply) =>
  handleResponsesRequest(request, reply, "/v1/responses"),
);


function sendHijackedStreamError(
  raw: NodeJS.WritableStream & {
    statusCode?: number;
    headersSent?: boolean;
    writableEnded?: boolean;
    writableFinished?: boolean;
    setHeader?(name: string, value: string): void;
    end(chunk?: unknown): void;
    destroy(error?: Error): void;
  },
  payload: {
    statusCode: number;
    message: string;
    requestId?: string;
    upstreamBody?: string;
    usage?: {
      allowed?: boolean;
      remaining?: number;
      limit?: number;
      used?: number;
      raw: unknown;
    };
    defaultCode?: string;
    providerErrorPolicy?: RuntimeProviderPreset["capabilities"]["errorPolicy"];
  },
): void {
  if (raw.writableEnded || raw.writableFinished) {
    return;
  }

  if (!raw.headersSent) {
    raw.statusCode = payload.statusCode;
    raw.setHeader?.("Content-Type", "application/json; charset=utf-8");
    const resolvedError = resolveProxyError({
      statusCode: payload.statusCode,
      message: payload.message,
      requestId: payload.requestId,
      upstreamBody: payload.upstreamBody,
      usage: payload.usage,
      defaultCode: payload.defaultCode,
      errorType: "proxy_error",
      providerErrorPolicy: payload.providerErrorPolicy,
    });
    raw.setHeader?.("x-proxy-error-code", resolvedError.errorCode);
    raw.setHeader?.("x-proxy-retryable", resolvedError.retryable ? "1" : "0");
    raw.end(JSON.stringify(resolvedError.envelope));
    return;
  }

  raw.destroy(new Error(payload.message));
}

function buildTraceContext(
  original: Record<string, unknown>,
  normalized: Record<string, unknown>,
  cacheLayout?: {
    familyId?: string;
    staticKey?: string;
    requestKey?: string;
    summaryApplied?: boolean;
    summaryItemCount?: number;
  },
  rtkStats?: {
    enabled?: boolean;
    applied?: boolean;
    toolOutputsSeen?: number;
    toolOutputsReduced?: number;
    charsBefore?: number;
    charsAfter?: number;
    charsSaved?: number;
  },
): Record<string, unknown> {
  return {
    model:
      typeof normalized.model === "string"
        ? normalized.model
        : typeof original.model === "string"
          ? original.model
          : undefined,
    stream: normalized.stream === true,
    toolsCount: Array.isArray(original.tools) ? original.tools.length : 0,
    messagesCount: Array.isArray(original.messages) ? original.messages.length : undefined,
    inputItemsCount: Array.isArray(normalized.input) ? normalized.input.length : undefined,
    user: stringOrUndefined(original.user),
    previousResponseId: stringOrUndefined(original.previous_response_id),
    familyId: stringOrUndefined(cacheLayout?.familyId),
    staticKey: stringOrUndefined(cacheLayout?.staticKey),
    requestKey: stringOrUndefined(cacheLayout?.requestKey),
    promptCacheKey:
      stringOrUndefined(normalized.prompt_cache_key) ?? stringOrUndefined(original.prompt_cache_key),
    promptCacheRetention:
      stringOrUndefined(normalized.prompt_cache_retention) ??
      stringOrUndefined(original.prompt_cache_retention),
    stableSummaryApplied: cacheLayout?.summaryApplied === true,
    stableSummaryItemCount:
      typeof cacheLayout?.summaryItemCount === "number" ? cacheLayout.summaryItemCount : undefined,
    rtkEnabled: rtkStats?.enabled === true,
    rtkApplied: rtkStats?.applied === true,
    rtkToolOutputsSeen:
      typeof rtkStats?.toolOutputsSeen === "number" ? rtkStats.toolOutputsSeen : undefined,
    rtkToolOutputsReduced:
      typeof rtkStats?.toolOutputsReduced === "number" ? rtkStats.toolOutputsReduced : undefined,
    rtkCharsBefore:
      typeof rtkStats?.charsBefore === "number" ? rtkStats.charsBefore : undefined,
    rtkCharsAfter:
      typeof rtkStats?.charsAfter === "number" ? rtkStats.charsAfter : undefined,
    rtkCharsSaved:
      typeof rtkStats?.charsSaved === "number" ? rtkStats.charsSaved : undefined,
    truncation: stringOrUndefined(normalized.truncation) ?? stringOrUndefined(original.truncation),
    reasoningEffort: readReasoningField(normalized.reasoning, "effort"),
    reasoningSummary: readReasoningField(normalized.reasoning, "summary"),
    textVerbosity: readTextField(normalized.text, "verbosity"),
    metadataUserId: readMetadataUserId(original.metadata),
    inputPreview: extractInputPreview(normalized.input),
  };
}

function setProxyResponseHeaders(
  raw: {
    setHeader?(name: string, value: string): void;
  },
  headers: {
    requestId: string;
    providerId?: string;
    familyId?: string;
    staticKey?: string;
    requestKey?: string;
    promptCacheKey?: string;
    promptCacheRetention?: string;
    rtkApplied?: boolean;
    rtkCharsSaved?: number;
  },
): void {
  raw.setHeader?.("x-proxy-request-id", headers.requestId);
  if (headers.providerId) {
    raw.setHeader?.("x-proxy-provider-id", headers.providerId);
  }
  if (headers.familyId) {
    raw.setHeader?.("x-proxy-family-id", headers.familyId);
  }
  if (headers.staticKey) {
    raw.setHeader?.("x-proxy-static-key", headers.staticKey);
  }
  if (headers.requestKey) {
    raw.setHeader?.("x-proxy-request-key", headers.requestKey);
  }
  if (headers.promptCacheKey) {
    raw.setHeader?.("x-proxy-prompt-cache-key", headers.promptCacheKey);
  }
  if (headers.promptCacheRetention) {
    raw.setHeader?.("x-proxy-prompt-cache-retention", headers.promptCacheRetention);
  }
  if (typeof headers.rtkApplied === "boolean") {
    raw.setHeader?.("x-proxy-rtk-applied", headers.rtkApplied ? "1" : "0");
  }
  if (typeof headers.rtkCharsSaved === "number") {
    raw.setHeader?.("x-proxy-rtk-chars-saved", String(headers.rtkCharsSaved));
  }
}

function readMetadataUserId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const userId = (value as Record<string, unknown>).user_id;
  return typeof userId === "string" ? userId : undefined;
}

function readMetadataClientRoute(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const clientRoute = (value as Record<string, unknown>).client_route;
  return typeof clientRoute === "string" && clientRoute.trim() ? clientRoute.trim() : undefined;
}

function readMetadataProviderId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const providerId = (value as Record<string, unknown>).provider_id;
  return typeof providerId === "string" && providerId.trim() ? providerId.trim() : undefined;
}

function readReasoningField(
  value: unknown,
  key: "effort" | "summary",
): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return stringOrUndefined((value as Record<string, unknown>)[key]);
}

function readTextField(value: unknown, key: "verbosity"): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return stringOrUndefined((value as Record<string, unknown>)[key]);
}

function extractInputPreview(input: unknown): string | undefined {
  if (typeof input === "string") {
    return clipText(input);
  }

  if (!Array.isArray(input)) {
    return undefined;
  }

  for (const item of input) {
    const preview = extractPreviewFromInputItem(item);
    if (preview) {
      return preview;
    }
  }

  return undefined;
}

function extractPreviewFromInputItem(item: unknown): string | undefined {
  if (typeof item !== "object" || item === null || Array.isArray(item)) {
    return undefined;
  }

  const content = (item as Record<string, unknown>).content;
  if (typeof content === "string") {
    return clipText(content);
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  for (const part of content) {
    if (typeof part !== "object" || part === null || Array.isArray(part)) {
      continue;
    }
    const text = (part as Record<string, unknown>).text;
    if (typeof text === "string" && text.trim()) {
      return clipText(text);
    }
  }

  return undefined;
}

function clipText(value: string, maxLength = 160): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 1)}…`;
}

function resolveClientRoute(
  headers: Record<string, unknown>,
  body: Record<string, unknown>,
  routingApiKey?: string,
): ClientRouteKey {
  const routedByApiKey = providerRepository.findClientRouteByApiKey(routingApiKey);
  if (routedByApiKey) {
    return routedByApiKey;
  }

  const headerValue = readHeaderString(headers["x-client-route"]);
  if (headerValue) {
    return normalizeClientRouteKey(headerValue);
  }

  const metadataValue = readMetadataClientRoute(body.metadata);
  if (metadataValue) {
    return normalizeClientRouteKey(metadataValue);
  }

  return "default";
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readHeaderString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === "string" && entry.trim());
    return typeof first === "string" ? first.trim() : undefined;
  }
  return undefined;
}

function resolvePublicAssetContentType(fileName: string): string {
  if (fileName.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (fileName.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }
  if (fileName.endsWith(".svg")) {
    return "image/svg+xml; charset=utf-8";
  }
  return "application/octet-stream";
}

function readBearerToken(value: unknown): string | undefined {
  const header = readHeaderString(value);
  if (!header) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || undefined;
}

type ForwardTarget = {
  name: string;
  url: string;
  apiKey?: string;
  headers?: Record<string, string>;
};

async function resolveForwardTarget(args: {
  requestId: string;
  clientRoute: ClientRouteKey;
  providerId?: string;
  routingApiKey?: string;
  logger: FastifyBaseLogger;
  sessionLog: ReturnType<typeof createSessionLogContext>;
}): Promise<ForwardTarget> {
  const activeProvider =
    (args.providerId ? providerRepository.getProvider(args.providerId) : undefined) ??
    requireProviderPresetForClient(args.clientRoute);
  const primaryTarget = await buildForwardTarget(activeProvider);

  try {
    await runPrimaryPreflight(args);
    return primaryTarget;
  } catch (error) {
    const fallbackProvider = getFallbackProviderPreset();
    if (!shouldFallbackFromError(error) || !fallbackProvider) {
      throw error;
    }

    args.logger.warn(
      {
        requestId: args.requestId,
        fallbackTarget: fallbackProvider.id,
        reason: error instanceof Error ? error.message : "Unknown preflight error",
      },
      "primary upstream preflight failed, switching to fallback",
    );
    await args.sessionLog.write({
      event: "fallback_activated",
      requestId: args.requestId,
      fallbackTarget: fallbackProvider.id,
      phase: "preflight",
      reason: error instanceof Error ? error.message : "Unknown preflight error",
    });

    return buildForwardTarget(fallbackProvider);
  }
}

async function buildForwardTarget(provider: RuntimeProviderPreset): Promise<ForwardTarget> {
  if (provider.authMode === "chatgpt_oauth") {
    const accessToken = await resolveChatGptAccessToken({
      provider,
      store: chatGptOAuthStore,
      config,
      rotationMode: chatGptOAuthStore.getRotationMode(),
    });
    return {
      name: provider.id,
      url: provider.responsesUrl,
      headers: {
        ...buildChatGptCodexHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
    };
  }

  return {
    name: provider.id,
    url: provider.responsesUrl,
    apiKey: getDefaultProviderApiKey(provider),
  };
}

async function forwardJsonWithFallback(args: {
  requestId: string;
  clientRoute: ClientRouteKey;
  providerId?: string;
  routingApiKey?: string;
  body: Record<string, unknown>;
  logger: FastifyBaseLogger;
  sessionLog: ReturnType<typeof createSessionLogContext>;
}): Promise<{ upstream: Response; target: ForwardTarget }> {
  const primaryTarget = await resolveForwardTarget(args);
  const fallbackProvider = getFallbackProviderPreset();
  const usingFallbackAsPrimary = fallbackProvider
    ? primaryTarget.name === fallbackProvider.id
    : false;
  const timeoutMs = resolveRequestTimeoutMs(args.body, {
    defaultTimeoutMs: config.REQUEST_TIMEOUT_MS,
    summaryTimeoutMs: config.SUMMARY_REQUEST_TIMEOUT_MS,
    extendHermesSummaryTimeout: config.HERMES_EXTEND_SUMMARY_TIMEOUT,
  });
  const primaryResponse = await forwardJson({
    requestId: args.requestId,
    url: primaryTarget.url,
    body: args.body,
    apiKey: primaryTarget.apiKey,
    headers: primaryTarget.headers,
    timeoutMs,
    logger: args.logger,
    onEvent: (entry) => args.sessionLog.write(entry),
  }).catch((error: unknown) => error);

  if (primaryResponse instanceof Response) {
    if (primaryResponse.ok || usingFallbackAsPrimary) {
      return { upstream: primaryResponse, target: primaryTarget };
    }

    if (!shouldFallbackFromStatus(primaryResponse.status) || !fallbackProvider) {
      throw await buildUpstreamError(args.requestId, primaryResponse);
    }

    const primaryError = await buildUpstreamError(args.requestId, primaryResponse);
    await logFallbackAttempt(args, "response", primaryError, primaryResponse.status);
  } else {
    if (!shouldFallbackFromError(primaryResponse) || !fallbackProvider) {
      throw primaryResponse;
    }

    await logFallbackAttempt(args, "request", primaryResponse);
  }

  if (!fallbackProvider) {
    throw new Error("Fallback provider is not configured");
  }

  const fallbackTarget = await buildForwardTarget(fallbackProvider);
  const fallbackResponse = await forwardJson({
    requestId: args.requestId,
    url: fallbackTarget.url,
    body: rewriteBodyForProvider(args.body, fallbackProvider),
    apiKey: fallbackTarget.apiKey,
    headers: fallbackTarget.headers,
    timeoutMs,
    logger: args.logger,
    onEvent: (entry) => args.sessionLog.write(entry),
  });

  if (!fallbackResponse.ok) {
    throw await buildUpstreamError(args.requestId, fallbackResponse);
  }

  return {
    upstream: fallbackResponse,
    target: fallbackTarget,
  };
}

async function runJsonRequestWithInflightDedupe(
  dedupeKey: string | undefined,
  args: {
    requestId: string;
    clientRoute: ClientRouteKey;
    providerId?: string;
    routingApiKey?: string;
    body: Record<string, unknown>;
    logger: FastifyBaseLogger;
    sessionLog: ReturnType<typeof createSessionLogContext>;
  },
  enabled: boolean,
): Promise<{
  payload: unknown;
  target: ForwardTarget;
  upstreamStatus: number;
}> {
  const execute = async (): Promise<{
    payload: unknown;
    target: ForwardTarget;
    upstreamStatus: number;
  }> => {
    const { upstream, target } = await forwardJsonWithFallback(args);
    return {
      payload: await upstream.json(),
      target,
      upstreamStatus: upstream.status,
    };
  };

  if (!enabled || !dedupeKey) {
    return execute();
  }

  const existing = inflightJsonRequests.get(dedupeKey);
  if (existing) {
    args.logger.info(
      {
        requestId: args.requestId,
        clientRoute: args.clientRoute,
        dedupeKey,
      },
      "joined inflight JSON request",
    );
    await args.sessionLog.write({
      event: "inflight_dedupe_joined",
      requestId: args.requestId,
      clientRoute: args.clientRoute,
      dedupeKey,
    });
    return existing;
  }

  const promise = execute().finally(() => {
    inflightJsonRequests.delete(dedupeKey);
  });
  inflightJsonRequests.set(dedupeKey, promise);
  await args.sessionLog.write({
    event: "inflight_dedupe_owner",
    requestId: args.requestId,
    clientRoute: args.clientRoute,
    dedupeKey,
  });
  return promise;
}

async function runPrimaryPreflight(args: {
  requestId: string;
  clientRoute: ClientRouteKey;
  providerId?: string;
  routingApiKey?: string;
  logger: FastifyBaseLogger;
  sessionLog: ReturnType<typeof createSessionLogContext>;
}): Promise<void> {
  const activeProvider =
    (args.providerId ? providerRepository.getProvider(args.providerId) : undefined) ??
    requireProviderPresetForClient(args.clientRoute);
  if (!activeProvider.capabilities.usageCheckEnabled || !activeProvider.capabilities.usageCheckUrl) {
    return;
  }

  await ensureProviderUsageAvailable({
    apiKey: getDefaultProviderApiKey(activeProvider),
    requestId: args.requestId,
    logger: args.logger,
    timeoutMs: config.REQUEST_TIMEOUT_MS,
    url: activeProvider.capabilities.usageCheckUrl,
    onEvent: (entry) => args.sessionLog.write(entry),
  });
}

async function logFallbackAttempt(
  args: {
    requestId: string;
    clientRoute: ClientRouteKey;
    logger: FastifyBaseLogger;
    sessionLog: ReturnType<typeof createSessionLogContext>;
  },
  phase: "preflight" | "request" | "response",
  error: unknown,
  statusCode?: number,
): Promise<void> {
  const fallbackProvider = getFallbackProviderPreset();
  if (!fallbackProvider) {
    return;
  }

  args.logger.warn(
    {
      requestId: args.requestId,
      fallbackTarget: fallbackProvider.id,
      phase,
      upstreamStatus: statusCode,
      reason: error instanceof Error ? error.message : "Unknown upstream error",
    },
    "primary upstream failed, retrying against fallback",
  );
  await args.sessionLog.write({
    event: "fallback_activated",
    requestId: args.requestId,
    fallbackTarget: fallbackProvider.id,
    phase,
    upstreamStatus: statusCode,
    reason: error instanceof Error ? error.message : "Unknown upstream error",
  });
}

function shouldFallbackFromError(error: unknown): boolean {
  if (error instanceof ProviderUsageLimitError) {
    return true;
  }

  const statusCode =
    typeof error === "object" && error !== null && "statusCode" in error
      ? Number((error as { statusCode?: number }).statusCode)
      : undefined;

  return statusCode !== undefined && shouldFallbackFromStatus(statusCode);
}

function shouldFallbackFromStatus(statusCode: number): boolean {
  return config.FALLBACK_STATUS_CODES.includes(statusCode);
}

async function forwardSseWithFallback(args: {
  requestId: string;
  clientRoute: ClientRouteKey;
  providerId?: string;
  routingApiKey?: string;
  body: Record<string, unknown>;
  responseRaw: NodeJS.WritableStream & {
    headersSent?: boolean;
    setHeader(name: string, value: string): void;
    flushHeaders?: () => void;
    end(chunk?: unknown): void;
    destroy(error?: Error): void;
  };
  logger: FastifyBaseLogger;
  sessionLog: ReturnType<typeof createSessionLogContext>;
  logContext?: Record<string, unknown>;
  onEvent?: (entry: Record<string, unknown>) => void;
}): Promise<ForwardTarget> {
  const primaryTarget = await resolveForwardTarget(args);
  const fallbackProvider = getFallbackProviderPreset();
  const usingFallbackAsPrimary = fallbackProvider
    ? primaryTarget.name === fallbackProvider.id
    : false;
  const timeoutMs = resolveRequestTimeoutMs(args.body, {
    defaultTimeoutMs: config.REQUEST_TIMEOUT_MS,
    summaryTimeoutMs: config.SUMMARY_REQUEST_TIMEOUT_MS,
    extendHermesSummaryTimeout: config.HERMES_EXTEND_SUMMARY_TIMEOUT,
  });

  try {
    await forwardSse({
      requestId: args.requestId,
      url: primaryTarget.url,
      body: args.body,
      apiKey: primaryTarget.apiKey,
      headers: primaryTarget.headers,
      timeoutMs,
      idleTimeoutMs: config.STREAM_IDLE_TIMEOUT_MS,
      responseRaw: args.responseRaw,
      logger: args.logger,
      onEvent: (entry) => {
        args.onEvent?.(entry);
        return args.sessionLog.write({
          ...args.logContext,
          ...entry,
        });
      },
    });
    return primaryTarget;
  } catch (error) {
    if (
      usingFallbackAsPrimary ||
      !fallbackProvider ||
      args.responseRaw.headersSent ||
      !shouldFallbackFromError(error)
    ) {
      throw error;
    }

    await logFallbackAttempt(args, "request", error);
    const fallbackTarget = await buildForwardTarget(fallbackProvider);
    await forwardSse({
      requestId: args.requestId,
      url: fallbackTarget.url,
      body: rewriteBodyForProvider(args.body, fallbackProvider),
      apiKey: fallbackTarget.apiKey,
      headers: fallbackTarget.headers,
      timeoutMs,
      idleTimeoutMs: config.STREAM_IDLE_TIMEOUT_MS,
      responseRaw: args.responseRaw,
      logger: args.logger,
      onEvent: (entry) => {
        args.onEvent?.(entry);
        return args.sessionLog.write({
          ...args.logContext,
          ...entry,
        });
      },
    });
    return fallbackTarget;
  }
}

async function fetchProviderModels(provider: RuntimeProviderPreset): Promise<string[]> {
  const target = await buildForwardTarget(provider);
  const response = await fetch(`${provider.baseUrl.replace(/\/+$/, "")}/models`, {
    headers:
      target.headers ??
      (target.apiKey
        ? {
            Authorization: `Bearer ${target.apiKey}`,
          }
        : undefined),
  });

  if (!response.ok) {
    throw new Error(`Model list failed with ${response.status} ${response.statusText}`);
  }

  const payload = (await response.json()) as {
    data?: Array<{ id?: unknown }>;
  };
  const models = Array.isArray(payload.data)
    ? payload.data
        .map((item) => (typeof item?.id === "string" ? item.id.trim() : ""))
        .filter(Boolean)
    : [];

  return models.sort((left, right) => left.localeCompare(right));
}

function getActiveProviderPreset(): RuntimeProviderPreset | undefined {
  return providerRepository.getActiveProvider();
}

function getProviderPresetForClient(client: ClientRouteKey): RuntimeProviderPreset | undefined {
  return providerRepository.getProviderForClient(client);
}

function requireProviderPresetForClient(client: ClientRouteKey): RuntimeProviderPreset {
  const provider = getProviderPresetForClient(client);
  if (provider) {
    return provider;
  }
  throw new RuntimeProviderError(503, {
    type: "configuration_error",
    code: "NO_PROVIDER_FOR_CLIENT",
    message: `No provider is configured for client ${client}`,
  });
}

function requireActiveProviderPreset(): RuntimeProviderPreset {
  const provider = providerRepository.getActiveProvider();
  if (provider) {
    return provider;
  }
  throw new RuntimeProviderError(503, {
    type: "configuration_error",
    code: "NO_ACTIVE_PROVIDER",
    message: "No provider is configured",
  });
}

function getFallbackProviderPreset(): RuntimeProviderPreset | undefined {
  return providerRepository.getFallbackProvider();
}

function getDefaultProviderApiKey(provider: RuntimeProviderPreset): string | undefined {
  return provider.providerApiKeys[0];
}

async function completeChatGptOAuthCallback(state: string, code: string) {
  const session = chatGptOAuthStore.consumeSession(state);
  const bundle = await exchangeChatGptCodeForTokens(
    config,
    code,
    session.redirectUri,
    session.codeVerifier,
  );
  const storedAccount = chatGptOAuthStore.upsertAccount(bundle);
  const provider = ensureChatGptOAuthProvider();
  return {
    account: redactAccount(storedAccount),
    provider: providerRepository.getProviderForUiOrThrow(provider.id),
  };
}

function ensureAccountBackedProvidersForExistingAccounts(): void {
  if (!config.CHATGPT_OAUTH_ENABLED) {
    return;
  }
  if (!chatGptOAuthStore.listAccountsForUi().length) {
    return;
  }
  ensureChatGptOAuthProvider();
}

function parseChatGptOAuthCallbackInput(input: unknown): {
  code: string;
  state: string;
  errorMessage: string;
} {
  const record =
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const rawUrl =
    stringOrUndefined(record.redirectUrl) ??
    stringOrUndefined(record.redirect_url) ??
    stringOrUndefined(record.callbackUrl) ??
    stringOrUndefined(record.callback_url) ??
    stringOrUndefined(record.url);
  const urlParams = parseUrlSearchParams(rawUrl);
  const code = stringOrUndefined(record.code) ?? urlParams?.get("code")?.trim() ?? "";
  const state = stringOrUndefined(record.state) ?? urlParams?.get("state")?.trim() ?? "";
  const errorMessage =
    stringOrUndefined(record.error_description) ??
    stringOrUndefined(record.errorDescription) ??
    stringOrUndefined(record.error) ??
    urlParams?.get("error_description")?.trim() ??
    urlParams?.get("error")?.trim() ??
    "";
  return { code, state, errorMessage };
}

function parseUrlSearchParams(rawUrl?: string): URLSearchParams | undefined {
  if (!rawUrl) {
    return undefined;
  }
  try {
    return new URL(rawUrl).searchParams;
  } catch {
    const queryStart = rawUrl.indexOf("?");
    if (queryStart === -1) {
      return undefined;
    }
    return new URLSearchParams(rawUrl.slice(queryStart + 1));
  }
}

function ensureChatGptOAuthProvider(): RuntimeProviderPreset {
  const existing = providerRepository.listProviders().find(
    (provider) =>
      provider.id === CHATGPT_OAUTH_PROVIDER_ID ||
      (provider.authMode === "chatgpt_oauth" && !provider.chatgptAccountId),
  );
  if (existing) {
    if (
      existing.capabilities.systemManaged &&
      existing.capabilities.accountPlatform === "openai_codex" &&
      existing.capabilities.accountPoolRequired &&
      existing.capabilities.usageCheckEnabled === true &&
      existing.capabilities.usageCheckUrl === OPENAI_ORGANIZATION_USAGE_COMPLETIONS_URL
    ) {
      return existing;
    }
    return providerRepository.updateProvider(existing.id, {
      name:
        !existing.name || existing.name === "ChatGPT OAuth"
          ? "OpenAI / Codex Account Pool"
          : existing.name,
      baseUrl: existing.baseUrl,
      authMode: "chatgpt_oauth",
      providerApiKeys: existing.providerApiKeys,
      clientApiKeys: existing.clientApiKeys,
      capabilities: {
        ...existing.capabilities,
        ownedBy: existing.capabilities.ownedBy || "account-auth",
        systemManaged: true,
        accountPlatform: "openai_codex",
        accountPoolRequired: true,
        usageCheckEnabled: true,
        usageCheckUrl: OPENAI_ORGANIZATION_USAGE_COMPLETIONS_URL,
      },
    });
  }
  const legacyPerAccountProvider = providerRepository
    .listProviders()
    .find((provider) => provider.authMode === "chatgpt_oauth");
  if (legacyPerAccountProvider) {
    return providerRepository.updateProvider(legacyPerAccountProvider.id, {
      name: "OpenAI / Codex Account Pool",
      baseUrl: config.CHATGPT_CODEX_BASE_URL,
      authMode: "chatgpt_oauth",
      providerApiKeys: [],
      clientApiKeys: legacyPerAccountProvider.clientApiKeys,
      capabilities: {
        ...legacyPerAccountProvider.capabilities,
        ownedBy: "chatgpt-oauth",
        systemManaged: true,
        accountPlatform: "openai_codex",
        accountPoolRequired: true,
        usageCheckEnabled: true,
        usageCheckUrl: OPENAI_ORGANIZATION_USAGE_COMPLETIONS_URL,
      },
    });
  }
  return providerRepository.createProvider({
    id: CHATGPT_OAUTH_PROVIDER_ID,
    name: "OpenAI / Codex Account Pool",
    baseUrl: config.CHATGPT_CODEX_BASE_URL,
    authMode: "chatgpt_oauth",
    providerApiKeys: [],
    clientApiKeys: [],
    capabilities: {
      ownedBy: "chatgpt-oauth",
      systemManaged: true,
      accountPlatform: "openai_codex",
      accountPoolRequired: true,
      usageCheckEnabled: true,
      usageCheckUrl: OPENAI_ORGANIZATION_USAGE_COMPLETIONS_URL,
    },
  });
}

function renderOAuthResultPage(message: string, providerId?: string): string {
  const escapedMessage = escapeHtml(message);
  const providerText = providerId ? `<p>Provider: <code>${escapeHtml(providerId)}</code></p>` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ChatGPT OAuth</title>
</head>
<body>
  <h1>ChatGPT OAuth</h1>
  <p>${escapedMessage}</p>
  ${providerText}
  <p>You can close this window and return to Responses Proxy.</p>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildInflightDedupeKey(
  providerId: string,
  normalized: Record<string, unknown>,
  traceContext: Record<string, unknown>,
): string | undefined {
  const requestKey = stringOrUndefined(traceContext.requestKey);
  const model = typeof normalized.model === "string" ? normalized.model : undefined;
  if (!requestKey || !model) {
    return undefined;
  }

  return `${providerId}:${model}:${requestKey}`;
}

function rewriteBodyForProvider(
  body: Record<string, unknown>,
  provider: RuntimeProviderPreset,
): Record<string, unknown> {
  let nextBody = body;
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (model) {
    const rewrittenModel = rewriteModelForProvider(model, provider);
    if (rewrittenModel !== model) {
      nextBody = {
        ...nextBody,
        model: rewrittenModel,
      };
    }
  }

  return applyProviderRequestParameterPolicy(nextBody, provider.capabilities);
}

function buildQuickApplyClientStatus(
  client: QuickApplyClient,
  proxyBaseUrl: string = localProxyBaseUrl,
) {
  const pathToRead = client === "hermes" ? quickApplyPaths.hermesConfigPath : quickApplyPaths.codexConfigPath;
  const route = providerRepository.getClientRoutesForUi().find((entry) => entry.key === client);
  const routeApiKeys = providerRepository.getClientRouteApiKeys(client);
  const allClientApiKeys = providerRepository
    .getClientRoutesForUi()
    .filter((entry) => entry.key !== "default")
    .flatMap((entry) => entry.apiKeys);
  let routeApiKey = routeApiKeys[0] || "";
  const access = getQuickApplyAccess(client);
  const raw = readQuickConfigFile(pathToRead);
  let status = readQuickApplyStatus(
    raw,
    {
      client,
      proxyBaseUrl,
      routeApiKey,
      model: providerRepository.getModelOverride(client),
    },
    pathToRead,
  );
  const detectedApiKey = typeof status.detected.apiKey === "string" ? status.detected.apiKey : "";
  if (detectedApiKey && allClientApiKeys.includes(detectedApiKey) && detectedApiKey !== routeApiKey) {
    routeApiKey = detectedApiKey;
    status = readQuickApplyStatus(
      raw,
      {
        client,
        proxyBaseUrl,
        routeApiKey,
        model: providerRepository.getModelOverride(client),
      },
      pathToRead,
    );
  }

  return {
    ...status,
    runtime: quickApplyRuntime,
    access,
    backups: listRecentConfigBackups(pathToRead, 1, {
      backupDir: quickApplyPaths.backupDir,
    }),
    route: route
      ? {
          key: route.key,
          providerId: route.providerId,
          providerName: route.providerName,
          modelOverride: route.modelOverride,
          apiKeys: route.apiKeys,
        }
      : null,
  };
}

function normalizeQuickApplyClient(value: unknown): QuickApplyClient | undefined {
  if (value === "hermes" || value === "codex") {
    return value;
  }
  return undefined;
}

function getQuickApplyAccess(client: QuickApplyClient) {
  const overridePath =
    client === "hermes"
      ? process.env.QUICK_APPLY_HERMES_CONFIG_PATH?.trim()
      : process.env.QUICK_APPLY_CODEX_CONFIG_PATH?.trim();

  if (quickApplyRuntime === "native") {
    return {
      canPatch: true,
      usesOverridePath: Boolean(overridePath),
      reason: null,
    };
  }

  if (overridePath) {
    return {
      canPatch: true,
      usesOverridePath: true,
      reason: null,
    };
  }

  return {
    canPatch: false,
    usesOverridePath: false,
    reason:
      `Quick Apply is running inside the container. Bind-mount the host ${client} config file into the container ` +
      `and set ${client === "hermes" ? "QUICK_APPLY_HERMES_CONFIG_PATH" : "QUICK_APPLY_CODEX_CONFIG_PATH"} ` +
      "to that mounted path before using this action.",
  };
}

function normalizeClientApiKeysInput(value: unknown): string[] {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\r?\n|,/g)
      : [];
  return rawValues
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function rewriteModelForProvider(model: string, provider: RuntimeProviderPreset): string {
  const aliasTarget = provider.capabilities.modelAliases?.[model];
  if (typeof aliasTarget === "string" && aliasTarget.trim()) {
    return aliasTarget.trim();
  }

  for (const prefix of provider.capabilities.stripModelPrefixes) {
    if (prefix && model.startsWith(prefix)) {
      return model.slice(prefix.length);
    }
  }

  return model;
}

function sendProviderRepositoryError(
  reply: {
    code(statusCode: number): { send(payload: Record<string, unknown>): unknown };
  },
  error: unknown,
) {
  if (error instanceof RuntimeProviderError) {
    return reply.code(error.statusCode).send({
      error: error.body,
    });
  }
  throw error;
}

function summarizeUsage(usage: {
  allowed?: boolean;
  remaining?: number;
  limit?: number;
  used?: number;
}): Record<string, unknown> {
  return {
    allowed: usage.allowed,
    remaining: usage.remaining,
    limit: usage.limit,
    used: usage.used,
  };
}

async function buildLiveProviderUsageEntry(
  provider: RuntimeProviderPreset,
  requestId: string,
  logger: FastifyBaseLogger,
): Promise<Record<string, unknown>> {
  const base = {
    providerId: provider.id,
    providerName: provider.name,
    authMode: provider.authMode ?? "api_key",
    upstreamKeyCount: provider.providerApiKeys.length,
    usageCheckEnabled: isOpenAiCodexOAuthProvider(provider)
      ? true
      : provider.capabilities.usageCheckEnabled,
    usageCheckUrl: isOpenAiCodexOAuthProvider(provider)
      ? OPENAI_ORGANIZATION_USAGE_COMPLETIONS_URL
      : provider.capabilities.usageCheckUrl ?? null,
    timestamp: new Date().toISOString(),
  };

  if (isOpenAiCodexOAuthProvider(provider)) {
    try {
      const usage = await fetchOpenAiCompletionsUsage({
        accessToken: await resolveChatGptAccessToken({
          provider,
          store: chatGptOAuthStore,
          config,
          rotationMode: chatGptOAuthStore.getRotationMode(),
        }),
        requestId,
        logger,
        timeoutMs: config.REQUEST_TIMEOUT_MS,
        url: OPENAI_ORGANIZATION_USAGE_COMPLETIONS_URL,
      });
      return {
        ...base,
        source: "openai_organization_usage",
        configured: true,
        ok: Boolean(usage) && usage?.allowed !== false,
        usage: usage ? summarizeUsage(usage) : null,
        raw: usage?.raw ?? null,
      };
    } catch (error) {
      return {
        ...base,
        source: "openai_organization_usage",
        configured: true,
        ok: false,
        error: error instanceof Error ? error.message : "Could not fetch OpenAI usage",
      };
    }
  }

  if (!provider.capabilities.usageCheckEnabled || !provider.capabilities.usageCheckUrl) {
    return {
      ...base,
      source: "custom_provider_usage_check",
      configured: false,
      ok: false,
      error: "Usage check is not configured for this provider.",
    };
  }

  const apiKey = getDefaultProviderApiKey(provider);
  if (!apiKey) {
    return {
      ...base,
      source: "custom_provider_usage_check",
      configured: true,
      ok: false,
      error: "No upstream provider API key is configured.",
    };
  }

  const usage = await fetchProviderUsage({
    apiKey,
    requestId,
    logger,
    timeoutMs: config.REQUEST_TIMEOUT_MS,
    url: provider.capabilities.usageCheckUrl,
  });
  return {
    ...base,
    source: "custom_provider_usage_check",
    configured: true,
    ok: Boolean(usage) && usage?.allowed !== false,
    usage: usage ? summarizeUsage(usage) : null,
    raw: usage?.raw ?? null,
  };
}

function isOpenAiCodexOAuthProvider(provider: RuntimeProviderPreset): boolean {
  return provider.authMode === "chatgpt_oauth" && provider.capabilities.accountPlatform === "openai_codex";
}

function readStringField(payload: unknown, key: string): string | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function readResponseUsage(payload: unknown): Record<string, unknown> | undefined {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return undefined;
  }
  const usage = (payload as Record<string, unknown>).usage;
  return typeof usage === "object" && usage !== null && !Array.isArray(usage)
    ? (usage as Record<string, unknown>)
    : undefined;
}

function readResponseInputTokensDetails(payload: unknown): Record<string, unknown> | undefined {
  const usage = readResponseUsage(payload);
  if (!usage) {
    return undefined;
  }
  const inputTokensDetails = usage.input_tokens_details;
  return typeof inputTokensDetails === "object" &&
    inputTokensDetails !== null &&
    !Array.isArray(inputTokensDetails)
    ? (inputTokensDetails as Record<string, unknown>)
    : undefined;
}

function readUsageCachedTokens(payload: unknown): number | undefined {
  const inputTokensDetails = readResponseInputTokensDetails(payload);
  const cachedTokens = inputTokensDetails?.cached_tokens;
  return typeof cachedTokens === "number" && Number.isFinite(cachedTokens)
    ? cachedTokens
    : undefined;
}

function readCacheSavedPercent(payload: unknown): number | undefined {
  const usage = readResponseUsage(payload);
  const inputTokens = usage?.input_tokens;
  const cachedTokens = readUsageCachedTokens(payload);
  if (
    typeof inputTokens !== "number" ||
    !Number.isFinite(inputTokens) ||
    inputTokens <= 0 ||
    cachedTokens === undefined ||
    cachedTokens < 0
  ) {
    return undefined;
  }

  return Math.round((cachedTokens / inputTokens) * 1000) / 10;
}

function updateLatestPromptCacheObservationFromEntry(entry: Record<string, unknown>): void {
  if (!latestPromptCacheObservation) {
    return;
  }

  latestPromptCacheObservation = {
    ...latestPromptCacheObservation,
    cachedTokens:
      typeof entry.cachedTokens === "number" && Number.isFinite(entry.cachedTokens)
        ? entry.cachedTokens
        : latestPromptCacheObservation.cachedTokens,
    cacheSavedPercent:
      typeof entry.cacheSavedPercent === "number" && Number.isFinite(entry.cacheSavedPercent)
        ? entry.cacheSavedPercent
        : latestPromptCacheObservation.cacheSavedPercent,
    cacheHit:
      typeof entry.cacheHit === "boolean" ? entry.cacheHit : latestPromptCacheObservation.cacheHit,
    consecutiveCacheHits:
      typeof entry.consecutiveCacheHits === "number" && Number.isFinite(entry.consecutiveCacheHits)
        ? entry.consecutiveCacheHits
        : latestPromptCacheObservation.consecutiveCacheHits,
    rtkApplied:
      typeof entry.rtkApplied === "boolean" ? entry.rtkApplied : latestPromptCacheObservation.rtkApplied,
    rtkCharsSaved:
      typeof entry.rtkCharsSaved === "number" && Number.isFinite(entry.rtkCharsSaved)
        ? entry.rtkCharsSaved
        : latestPromptCacheObservation.rtkCharsSaved,
    timestamp: new Date().toISOString(),
  };
  setLatestPromptCacheObservation(latestPromptCacheObservation);
}

function setLatestPromptCacheObservation(observation: PromptCacheObservation): void {
  latestPromptCacheObservation = observation;
  promptCacheStateStore.saveLatestObservation(observation);
  if (observation.providerId) {
    latestPromptCacheObservationByProvider.set(observation.providerId, observation);
  }
}

function hydratePromptCacheObservationsFromStore(store: PromptCacheStateStore): void {
  const state = store.loadLatestObservations();
  if (state.latest) {
    latestPromptCacheObservation = state.latest;
  }
  for (const [providerId, observation] of state.byProvider) {
    latestPromptCacheObservationByProvider.set(providerId, observation);
  }
}

async function hydrateLatestPromptCacheObservations(logRoot: string): Promise<void> {
  const latestDir = path.join(logRoot, "latest");
  let files: string[] = [];
  try {
    files = await readdir(latestDir);
  } catch {
    return;
  }

  for (const file of files.filter((entry) => entry.endsWith(".jsonl"))) {
    let raw: string;
    try {
      raw = await readFile(path.join(latestDir, file), "utf8");
    } catch {
      continue;
    }

    const lines = raw
      .trim()
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      continue;
    }

    const lastLine = lines[lines.length - 1];
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(lastLine) as Record<string, unknown>;
    } catch {
      continue;
    }

    const observation = buildPromptCacheObservationFromLogEntry(entry);
    if (!observation) {
      continue;
    }

    if (
      !latestPromptCacheObservation ||
      (typeof observation.timestamp === "string" &&
        typeof latestPromptCacheObservation.timestamp === "string" &&
        observation.timestamp > latestPromptCacheObservation.timestamp)
    ) {
      latestPromptCacheObservation = observation;
    }

    if (observation.providerId) {
      const existing = latestPromptCacheObservationByProvider.get(observation.providerId);
      if (!existing || observation.timestamp > existing.timestamp) {
        latestPromptCacheObservationByProvider.set(observation.providerId, observation);
      }
    }
  }
}

function buildPromptCacheObservationFromLogEntry(
  entry: Record<string, unknown>,
): PromptCacheObservation | undefined {
  const timestamp = readStringField(entry, "ts");
  if (!timestamp) {
    return undefined;
  }

  return {
    requestId: readStringField(entry, "requestId") ?? "unknown-request",
    providerId: readStringField(entry, "providerId"),
    clientRoute: readStringField(entry, "clientRoute") as ClientRouteKey | undefined,
    model: readStringField(entry, "model"),
    familyId: readStringField(entry, "familyId"),
    staticKey: readStringField(entry, "staticKey"),
    requestKey: readStringField(entry, "requestKey"),
    promptCacheKey: readStringField(entry, "promptCacheKey"),
    promptCacheRetention: readStringField(entry, "promptCacheRetention"),
    upstreamTarget: readStringField(entry, "upstreamTarget"),
    truncation: readStringField(entry, "truncation"),
    reasoningEffort: readStringField(entry, "reasoningEffort"),
    reasoningSummary: readStringField(entry, "reasoningSummary"),
    textVerbosity: readStringField(entry, "textVerbosity"),
    cachedTokens: readFiniteNumber(entry.cachedTokens),
    cacheSavedPercent: readFiniteNumber(entry.cacheSavedPercent),
    cacheHit: typeof entry.cacheHit === "boolean" ? entry.cacheHit : undefined,
    consecutiveCacheHits: readFiniteNumber(entry.consecutiveCacheHits),
    rtkApplied: entry.rtkApplied === true,
    rtkCharsSaved: readFiniteNumber(entry.rtkCharsSaved),
    stream: entry.stream === true,
    timestamp,
  };
}

type UsageStatsBucket = {
  requests: number;
  hits: number;
  misses: number;
  hitRate: number;
  unknownTelemetryRequests: number;
  telemetryCoverage: number;
  totalCachedTokens: number;
  totalInputTokens: number;
  avgCacheSavedPercent: number;
  rtkRequests: number;
  rtkAppliedRequests: number;
  rtkAppliedRate: number;
  rtkToolOutputsSeen: number;
  rtkToolOutputsReduced: number;
  rtkCharsBefore: number;
  rtkCharsAfter: number;
  rtkCharsSaved: number;
  rtkAvgCharsSaved: number;
};

type UsageDimensionBucket = UsageStatsBucket & {
  key: string;
  uniqueStaticKeys?: number;
  uniqueRequestKeys?: number;
  fragmentationScore?: number;
};

async function buildUsageStats(): Promise<{
  today: UsageStatsBucket;
  month: UsageStatsBucket;
  daily: Array<{ date: string } & UsageStatsBucket>;
  byProvider: UsageDimensionBucket[];
  byClientRoute: UsageDimensionBucket[];
  byFamily: UsageDimensionBucket[];
  byStaticKey: UsageDimensionBucket[];
  byModel: UsageDimensionBucket[];
  topUncachedFamilies: UsageDimensionBucket[];
}> {
  const now = new Date();
  const todayKey = formatLocalDate(now);
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-`;
  const logRoot = path.resolve(config.SESSION_LOG_DIR);

  let dayDirs: string[] = [];
  try {
    dayDirs = await readdir(logRoot);
  } catch {
    return {
      today: emptyUsageStatsBucket(),
      month: emptyUsageStatsBucket(),
      daily: [],
      byProvider: [],
      byClientRoute: [],
      byFamily: [],
      byStaticKey: [],
      byModel: [],
      topUncachedFamilies: [],
    };
  }

  const relevantDates = dayDirs
    .filter((entry) => DATE_DIR_PATTERN.test(entry))
    .sort()
    .filter((entry) => entry.startsWith(monthPrefix));

  const dailyEntries = await Promise.all(
    relevantDates.map(async (date) => ({
      date,
      stats: await aggregateUsageStatsForDate(path.join(logRoot, date)),
    })),
  );

  const today = dailyEntries.find((entry) => entry.date === todayKey)?.stats ?? emptyUsageStatsBucket();
  const month = dailyEntries.reduce(
    (accumulator, entry) => mergeUsageStatsBuckets(accumulator, entry.stats),
    emptyUsageStatsAccumulator(),
  );
  const monthDetail = await aggregateUsageStatsForDateDetailed(
    relevantDates.map((date) => path.join(logRoot, date)),
  );

  return {
    today,
    month: finalizeUsageStatsAccumulator(month),
    daily: dailyEntries
      .map((entry) => ({
        date: entry.date,
        ...entry.stats,
      }))
      .reverse(),
    byProvider: buildDimensionBuckets(monthDetail.byProvider, false),
    byClientRoute: buildDimensionBuckets(monthDetail.byClientRoute, false),
    byFamily: buildDimensionBuckets(monthDetail.byFamily, true),
    byStaticKey: buildDimensionBuckets(monthDetail.byStaticKey, false),
    byModel: buildDimensionBuckets(monthDetail.byModel, false),
    topUncachedFamilies: buildDimensionBuckets(monthDetail.byFamily, true)
      .filter((entry) => entry.misses > 0)
      .sort((left, right) => right.misses - left.misses || right.requests - left.requests)
      .slice(0, 10),
  };
}

async function aggregateUsageStatsForDate(dirPath: string): Promise<UsageStatsBucket> {
  let files: string[] = [];
  try {
    files = await readdir(dirPath);
  } catch {
    return emptyUsageStatsBucket();
  }

  const accumulators = await Promise.all(
    files
      .filter((entry) => entry.endsWith(".jsonl"))
      .map(async (entry) => aggregateUsageStatsForFile(path.join(dirPath, entry))),
  );

  return finalizeUsageStatsAccumulator(
    accumulators.reduce(
      (accumulator, entry) => mergeUsageStatsBuckets(accumulator, entry),
      emptyUsageStatsAccumulator(),
    ),
  );
}

async function aggregateUsageStatsForFile(filePath: string): Promise<UsageStatsAccumulator> {
  const accumulator = emptyUsageStatsAccumulator();
  let stream: ReturnType<typeof createReadStream>;
  try {
    stream = createReadStream(filePath, { encoding: "utf8" });
  } catch {
    return emptyUsageStatsAccumulator();
  }

  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of lineReader) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const event = typeof entry.event === "string" ? entry.event : "";
    if (event === "upstream_response_usage") {
      accumulator.requests += 1;
      const cachedTokens = readFiniteNumber(entry.cachedTokens);
      const inputTokens = readFiniteNumber(entry.inputTokens);
      const cacheSavedPercent = readFiniteNumber(entry.cacheSavedPercent);

      if (typeof cachedTokens === "number") {
        if (cachedTokens > 0) {
          accumulator.hits += 1;
          accumulator.totalCachedTokens += cachedTokens;
        } else {
          accumulator.misses += 1;
        }
      } else {
        accumulator.unknownTelemetryRequests += 1;
      }
      if (typeof inputTokens === "number") {
        accumulator.totalInputTokens += inputTokens;
      }
      if (typeof cacheSavedPercent === "number") {
        accumulator.cacheSavedPercentTotal += cacheSavedPercent;
        accumulator.cacheSavedPercentCount += 1;
      }
    }

    if (event === "request_started") {
      updateRtkStatsAccumulator(accumulator, entry);
    }
  }

  return accumulator;
}

type UsageStatsAccumulator = {
  requests: number;
  hits: number;
  misses: number;
  unknownTelemetryRequests: number;
  totalCachedTokens: number;
  totalInputTokens: number;
  cacheSavedPercentTotal: number;
  cacheSavedPercentCount: number;
  rtkRequests: number;
  rtkAppliedRequests: number;
  rtkToolOutputsSeen: number;
  rtkToolOutputsReduced: number;
  rtkCharsBefore: number;
  rtkCharsAfter: number;
  rtkCharsSaved: number;
};

type UsageDimensionAccumulator = UsageStatsAccumulator & {
  staticKeys: Set<string>;
  requestKeys: Set<string>;
};

type UsageDetailedAccumulator = {
  byProvider: Map<string, UsageDimensionAccumulator>;
  byClientRoute: Map<string, UsageDimensionAccumulator>;
  byFamily: Map<string, UsageDimensionAccumulator>;
  byStaticKey: Map<string, UsageDimensionAccumulator>;
  byModel: Map<string, UsageDimensionAccumulator>;
};

function emptyUsageStatsAccumulator(): UsageStatsAccumulator {
  return {
    requests: 0,
    hits: 0,
    misses: 0,
    unknownTelemetryRequests: 0,
    totalCachedTokens: 0,
    totalInputTokens: 0,
    cacheSavedPercentTotal: 0,
    cacheSavedPercentCount: 0,
    rtkRequests: 0,
    rtkAppliedRequests: 0,
    rtkToolOutputsSeen: 0,
    rtkToolOutputsReduced: 0,
    rtkCharsBefore: 0,
    rtkCharsAfter: 0,
    rtkCharsSaved: 0,
  };
}

function emptyUsageStatsBucket(): UsageStatsBucket {
  return {
    requests: 0,
    hits: 0,
    misses: 0,
    hitRate: 0,
    unknownTelemetryRequests: 0,
    telemetryCoverage: 0,
    totalCachedTokens: 0,
    totalInputTokens: 0,
    avgCacheSavedPercent: 0,
    rtkRequests: 0,
    rtkAppliedRequests: 0,
    rtkAppliedRate: 0,
    rtkToolOutputsSeen: 0,
    rtkToolOutputsReduced: 0,
    rtkCharsBefore: 0,
    rtkCharsAfter: 0,
    rtkCharsSaved: 0,
    rtkAvgCharsSaved: 0,
  };
}

function emptyUsageDetailedAccumulator(): UsageDetailedAccumulator {
  return {
    byProvider: new Map(),
    byClientRoute: new Map(),
    byFamily: new Map(),
    byStaticKey: new Map(),
    byModel: new Map(),
  };
}

function mergeUsageStatsBuckets(
  left: UsageStatsAccumulator,
  right: UsageStatsAccumulator | UsageStatsBucket,
): UsageStatsAccumulator {
  return {
    requests: left.requests + right.requests,
    hits: left.hits + right.hits,
    misses: left.misses + right.misses,
    unknownTelemetryRequests:
      left.unknownTelemetryRequests +
      ("unknownTelemetryRequests" in right ? right.unknownTelemetryRequests : 0),
    totalCachedTokens: left.totalCachedTokens + right.totalCachedTokens,
    totalInputTokens: left.totalInputTokens + right.totalInputTokens,
    cacheSavedPercentTotal:
      left.cacheSavedPercentTotal +
      ("cacheSavedPercentTotal" in right
        ? right.cacheSavedPercentTotal
        : right.avgCacheSavedPercent * right.requests),
    cacheSavedPercentCount:
      left.cacheSavedPercentCount +
      ("cacheSavedPercentCount" in right ? right.cacheSavedPercentCount : right.requests),
    rtkRequests: left.rtkRequests + ("rtkRequests" in right ? right.rtkRequests : 0),
    rtkAppliedRequests:
      left.rtkAppliedRequests + ("rtkAppliedRequests" in right ? right.rtkAppliedRequests : 0),
    rtkToolOutputsSeen:
      left.rtkToolOutputsSeen + ("rtkToolOutputsSeen" in right ? right.rtkToolOutputsSeen : 0),
    rtkToolOutputsReduced:
      left.rtkToolOutputsReduced +
      ("rtkToolOutputsReduced" in right ? right.rtkToolOutputsReduced : 0),
    rtkCharsBefore:
      left.rtkCharsBefore + ("rtkCharsBefore" in right ? right.rtkCharsBefore : 0),
    rtkCharsAfter: left.rtkCharsAfter + ("rtkCharsAfter" in right ? right.rtkCharsAfter : 0),
    rtkCharsSaved: left.rtkCharsSaved + ("rtkCharsSaved" in right ? right.rtkCharsSaved : 0),
  };
}

function finalizeUsageStatsAccumulator(accumulator: UsageStatsAccumulator): UsageStatsBucket {
  const measuredRequests = accumulator.hits + accumulator.misses;
  return {
    requests: accumulator.requests,
    hits: accumulator.hits,
    misses: accumulator.misses,
    hitRate:
      measuredRequests > 0
        ? roundToSingleDecimal((accumulator.hits / measuredRequests) * 100)
        : 0,
    unknownTelemetryRequests: accumulator.unknownTelemetryRequests,
    telemetryCoverage:
      accumulator.requests > 0
        ? roundToSingleDecimal((measuredRequests / accumulator.requests) * 100)
        : 0,
    totalCachedTokens: accumulator.totalCachedTokens,
    totalInputTokens: accumulator.totalInputTokens,
    avgCacheSavedPercent:
      accumulator.cacheSavedPercentCount > 0
        ? roundToSingleDecimal(accumulator.cacheSavedPercentTotal / accumulator.cacheSavedPercentCount)
        : 0,
    rtkRequests: accumulator.rtkRequests,
    rtkAppliedRequests: accumulator.rtkAppliedRequests,
    rtkAppliedRate:
      accumulator.rtkRequests > 0
        ? roundToSingleDecimal((accumulator.rtkAppliedRequests / accumulator.rtkRequests) * 100)
        : 0,
    rtkToolOutputsSeen: accumulator.rtkToolOutputsSeen,
    rtkToolOutputsReduced: accumulator.rtkToolOutputsReduced,
    rtkCharsBefore: accumulator.rtkCharsBefore,
    rtkCharsAfter: accumulator.rtkCharsAfter,
    rtkCharsSaved: accumulator.rtkCharsSaved,
    rtkAvgCharsSaved:
      accumulator.rtkAppliedRequests > 0
        ? roundToSingleDecimal(accumulator.rtkCharsSaved / accumulator.rtkAppliedRequests)
        : 0,
  };
}

async function aggregateUsageStatsForDateDetailed(dirPaths: string[]): Promise<UsageDetailedAccumulator> {
  const detailed = emptyUsageDetailedAccumulator();
  for (const dirPath of dirPaths) {
    let files: string[] = [];
    try {
      files = await readdir(dirPath);
    } catch {
      continue;
    }

    for (const entry of files.filter((item) => item.endsWith(".jsonl"))) {
      await aggregateDetailedUsageForFile(path.join(dirPath, entry), detailed);
    }
  }
  return detailed;
}

async function aggregateDetailedUsageForFile(
  filePath: string,
  detailed: UsageDetailedAccumulator,
): Promise<void> {
  let stream: ReturnType<typeof createReadStream>;
  try {
    stream = createReadStream(filePath, { encoding: "utf8" });
  } catch {
    return;
  }

  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const line of lineReader) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const event = typeof entry.event === "string" ? entry.event : "";
    if (event !== "request_started" && event !== "request_completed" && event !== "upstream_response_usage") {
      continue;
    }

    const cachedTokens = readFiniteNumber(entry.cachedTokens);
    const inputTokens =
      readFiniteNumber(entry.inputTokens) ??
      readFiniteNumber((entry.usage as Record<string, unknown> | undefined)?.input_tokens);
    const cacheSavedPercent = readFiniteNumber(entry.cacheSavedPercent);
    const providerId = readStringField(entry, "providerId");
    const clientRoute = readStringField(entry, "clientRoute");
    const familyId = readStringField(entry, "familyId");
    const staticKey = readStringField(entry, "staticKey");
    const requestKey = readStringField(entry, "requestKey");
    const model = readStringField(entry, "model");
    const hit = typeof cachedTokens === "number" && cachedTokens > 0;
    const hasCacheTelemetry = typeof cachedTokens === "number";
    const rtkStats = event === "request_started" ? readRtkStatsFromEntry(entry) : undefined;

    if (providerId) {
      updateDimensionAccumulator(detailed.byProvider, providerId, {
        hit,
        hasCacheTelemetry,
        cachedTokens,
        inputTokens,
        cacheSavedPercent,
        staticKey,
        requestKey,
        rtk: rtkStats,
      });
    }
    if (clientRoute) {
      updateDimensionAccumulator(detailed.byClientRoute, clientRoute, {
        hit,
        hasCacheTelemetry,
        cachedTokens,
        inputTokens,
        cacheSavedPercent,
        staticKey,
        requestKey,
        rtk: rtkStats,
      });
    }
    if (familyId) {
      updateDimensionAccumulator(detailed.byFamily, familyId, {
        hit,
        hasCacheTelemetry,
        cachedTokens,
        inputTokens,
        cacheSavedPercent,
        staticKey,
        requestKey,
        rtk: rtkStats,
      });
    }
    if (staticKey) {
      updateDimensionAccumulator(detailed.byStaticKey, staticKey, {
        hit,
        hasCacheTelemetry,
        cachedTokens,
        inputTokens,
        cacheSavedPercent,
        staticKey,
        requestKey,
        rtk: rtkStats,
      });
    }
    if (model) {
      updateDimensionAccumulator(detailed.byModel, model, {
        hit,
        hasCacheTelemetry,
        cachedTokens,
        inputTokens,
        cacheSavedPercent,
        staticKey,
        requestKey,
        rtk: rtkStats,
      });
    }
  }
}

function updateDimensionAccumulator(
  target: Map<string, UsageDimensionAccumulator>,
  key: string,
  entry: {
    hit: boolean;
    hasCacheTelemetry: boolean;
    cachedTokens?: number;
    inputTokens?: number;
    cacheSavedPercent?: number;
    staticKey?: string;
    requestKey?: string;
    rtk?: ReturnType<typeof readRtkStatsFromEntry>;
  },
): void {
  const current = target.get(key) ?? {
    ...emptyUsageStatsAccumulator(),
    staticKeys: new Set<string>(),
    requestKeys: new Set<string>(),
  };
  current.requests += 1;
  if (entry.hasCacheTelemetry) {
    if (entry.hit) {
      current.hits += 1;
    } else {
      current.misses += 1;
    }
  } else {
    current.unknownTelemetryRequests += 1;
  }
  if (typeof entry.cachedTokens === "number" && entry.cachedTokens > 0) {
    current.totalCachedTokens += entry.cachedTokens;
  }
  if (typeof entry.inputTokens === "number") {
    current.totalInputTokens += entry.inputTokens;
  }
  if (typeof entry.cacheSavedPercent === "number") {
    current.cacheSavedPercentTotal += entry.cacheSavedPercent;
    current.cacheSavedPercentCount += 1;
  }
  if (entry.staticKey) {
    current.staticKeys.add(entry.staticKey);
  }
  if (entry.requestKey) {
    current.requestKeys.add(entry.requestKey);
  }
  mergeRtkStatsIntoAccumulator(current, entry.rtk);
  target.set(key, current);
}

function updateRtkStatsAccumulator(
  accumulator: UsageStatsAccumulator,
  entry: Record<string, unknown>,
): void {
  mergeRtkStatsIntoAccumulator(accumulator, readRtkStatsFromEntry(entry));
}

function mergeRtkStatsIntoAccumulator(
  accumulator: UsageStatsAccumulator,
  rtk: ReturnType<typeof readRtkStatsFromEntry> | undefined,
): void {
  if (!rtk) {
    return;
  }
  accumulator.rtkRequests += 1;
  if (rtk.applied) {
    accumulator.rtkAppliedRequests += 1;
  }
  accumulator.rtkToolOutputsSeen += rtk.toolOutputsSeen;
  accumulator.rtkToolOutputsReduced += rtk.toolOutputsReduced;
  accumulator.rtkCharsBefore += rtk.charsBefore;
  accumulator.rtkCharsAfter += rtk.charsAfter;
  accumulator.rtkCharsSaved += rtk.charsSaved;
}

function readRtkStatsFromEntry(entry: Record<string, unknown>):
  | {
      applied: boolean;
      toolOutputsSeen: number;
      toolOutputsReduced: number;
      charsBefore: number;
      charsAfter: number;
      charsSaved: number;
    }
  | undefined {
  const nested = typeof entry.rtk === "object" && entry.rtk !== null && !Array.isArray(entry.rtk)
    ? (entry.rtk as Record<string, unknown>)
    : undefined;
  const enabled = readFiniteBoolean(
    nested?.enabled ?? entry.rtkEnabled,
  );
  if (enabled === false) {
    return undefined;
  }

  const toolOutputsSeen = readFiniteNumber(nested?.toolOutputsSeen ?? entry.rtkToolOutputsSeen) ?? 0;
  const toolOutputsReduced =
    readFiniteNumber(nested?.toolOutputsReduced ?? entry.rtkToolOutputsReduced) ?? 0;
  const charsBefore = readFiniteNumber(nested?.charsBefore ?? entry.rtkCharsBefore) ?? 0;
  const charsAfter = readFiniteNumber(nested?.charsAfter ?? entry.rtkCharsAfter) ?? 0;
  const charsSaved = readFiniteNumber(nested?.charsSaved ?? entry.rtkCharsSaved) ?? 0;
  const applied = (nested?.applied ?? entry.rtkApplied) === true;

  if (
    enabled !== true &&
    !applied &&
    toolOutputsSeen === 0 &&
    toolOutputsReduced === 0 &&
    charsBefore === 0 &&
    charsAfter === 0 &&
    charsSaved === 0
  ) {
    return undefined;
  }

  return {
    applied,
    toolOutputsSeen,
    toolOutputsReduced,
    charsBefore,
    charsAfter,
    charsSaved,
  };
}

function readFiniteBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function buildDimensionBuckets(
  target: Map<string, UsageDimensionAccumulator>,
  includeFragmentation: boolean,
): UsageDimensionBucket[] {
  return [...target.entries()]
    .map(([key, accumulator]) => {
      const base = finalizeUsageStatsAccumulator(accumulator);
      const uniqueStaticKeys = accumulator.staticKeys.size;
      const uniqueRequestKeys = accumulator.requestKeys.size;
      return {
        key,
        ...base,
        uniqueStaticKeys,
        uniqueRequestKeys,
        fragmentationScore: includeFragmentation && base.requests > 0
          ? roundToSingleDecimal((uniqueStaticKeys / base.requests) * 100)
          : undefined,
      };
    })
    .sort((left, right) => right.requests - left.requests || right.hits - left.hits)
    .slice(0, 50);
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function roundToSingleDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatLocalDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

app.setErrorHandler((error, _request, reply) => {
  const statusCode =
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    Number.isInteger((error as { statusCode?: unknown }).statusCode)
      ? Number((error as { statusCode?: unknown }).statusCode)
      : 500;
  const code =
    statusCode >= 500
      ? "PROXY_INTERNAL_ERROR"
      : statusCode === 413
        ? defaultProxyErrorCode(statusCode)
        : "PROXY_BAD_REQUEST";

  const resolvedError = resolveProxyError({
    statusCode,
    message: error instanceof Error ? error.message : "Unknown internal error",
    defaultCode: code,
    errorType: statusCode >= 400 && statusCode < 500 ? "request_error" : "internal_error",
  });
  reply.header("x-proxy-error-code", resolvedError.errorCode);
  reply.header("x-proxy-retryable", resolvedError.retryable ? "1" : "0");
  reply.code(statusCode).send(resolvedError.envelope);
});

async function main(): Promise<void> {
  await app.listen({
    host: config.HOST,
    port: config.PORT,
  });
}

main().catch((error) => {
  app.log.error(error, "failed to start responses proxy");
  process.exit(1);
});
