import Fastify from "fastify";
import type { FastifyBaseLogger } from "fastify";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { isIP } from "node:net";
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
  applyCodexAuth,
  applyQuickConfig,
  generateRouteApiKey,
  listRecentConfigBackups,
  normalizeProxyBaseUrl,
  readCodexAuthStatus,
  readQuickApplyStatus,
  readQuickConfigFile,
  resolveQuickApplyPaths,
  writeQuickConfigFile,
  type QuickApplyClient,
} from "./client-config-apply.js";
import {
  buildCodexConfigFiles,
  buildCodexConfigSetupScript,
} from "./codex-setup.js";
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
  type ClientTokenLimitView,
  type ClientTokenWindowType,
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
import { ResponseCacheStore } from "./response-cache.js";
import { buildCostSummary } from "./cost-analytics.js";
import { resolveModelRouting } from "./model-routing.js";
import { InMemoryHttpRateLimiter } from "./http-rate-limit.js";
import { applyRtkLayer, parseRtkLayerPolicyInput, resolveRtkLayerPolicy } from "./rtk-layer.js";
import {
  buildClientTokenLimitError,
  extractUsageTotals,
  getClientTokenLimitStatus,
} from "./client-token-limits.js";
import { BillingRepository } from "./billing.js";
import { CustomerKeyRepository } from "./customer-keys.js";
import { resolveCustomerRoutingAccess } from "./customer-key-access.js";
import { recordCustomerUsageFromPayload } from "./customer-usage.js";
import { CustomerWorkspaceRepository } from "./telegram-bot/customer-workspace-repository.js";
import { DashboardAuthRepository } from "./dashboard-auth.js";
import { AuditLogRepository } from "./audit-log.js";
import { processSepayWebhook, type SepayWebhookPayload } from "./sepay-webhook.js";
import { KiroTokenStore } from "./kiro-token-store.js";
import { DeviceLoginService, DeviceLoginError } from "./kiro-device-login.js";
import {
  KiroAuthError,
  KiroUpstreamError,
  forwardKiroJson,
  forwardKiroSse,
  forwardKiroAnthropicJson,
  forwardKiroAnthropicSse,
} from "./kiro-forward.js";
import {
  buildAnthropicError,
  buildAnthropicModelsList,
  buildCountTokensResponse,
  parseAnthropicRequest,
} from "./anthropic-messages.js";
import { RoutingComboRepository } from "./routing-combo-repository.js";
import { RoutingEngine } from "./routing-engine.js";
import { RoutingSimulationEngine } from "./routing-simulation-engine.js";
import {
  ModelComboRepository,
  ModelComboValidationError,
  ModelComboNotFoundError,
} from "./model-combo-repository.js";
import { ProviderHealthService } from "./provider-health-service.js";
import { HealthWebSocketManager } from "./health-websocket-manager.js";
import {
  resolveProviderWithRouting,
  recordRequestResult,
  type RoutingIntegrationContext,
  type RoutingRequest
} from "./routing-integration.js";

const config = readConfig(process.env);
const CHATGPT_OAUTH_PROVIDER_ID = "account-openai-codex";

const providerRepository = await RuntimeProviderRepository.create({
  dbFile: path.resolve(config.APP_DB_PATH),
  legacyStateFile: path.resolve(config.SESSION_LOG_DIR, "..", "runtime-state.json"),
  baseProviders: buildBuiltinProviderPresets(config),
});
const customerKeyRepository = CustomerKeyRepository.create(path.resolve(config.CUSTOMER_KEY_DB_PATH));
const customerWorkspaceRepository = CustomerWorkspaceRepository.create(
  path.resolve(config.CUSTOMER_KEY_DB_PATH),
);
const billingRepository = BillingRepository.create(path.resolve(config.CUSTOMER_KEY_DB_PATH));
const dashboardAuthRepository = DashboardAuthRepository.create(path.resolve(config.CUSTOMER_KEY_DB_PATH));
const auditLogRepository = AuditLogRepository.create(path.resolve(config.CUSTOMER_KEY_DB_PATH));
const dashboardAdminUserIds = new Set([
  ...config.TELEGRAM_OWNER_USER_IDS,
  ...config.TELEGRAM_ADMIN_USER_IDS,
]);
const chatGptOAuthStore = ChatGptOAuthStore.create(path.resolve(config.APP_DB_PATH));
const promptCacheStateStore = PromptCacheStateStore.create(path.resolve(config.APP_DB_PATH));
const responseCacheStore = ResponseCacheStore.create(path.resolve(config.APP_DB_PATH));
setInterval(() => responseCacheStore.prune(), 10 * 60 * 1000).unref();
// Kiro accounts/tokens live in 9router's own SQLite DB. Open it read/write (for
// token write-back) only when enabled and present; otherwise leave Kiro disabled
// so non-Kiro deployments are unaffected.
const kiroTokenStore: KiroTokenStore | null = (() => {
  if (!config.KIRO_ENABLED) {
    return null;
  }
  if (!existsSync(config.KIRO_DB_PATH)) {
    console.warn(
      `[kiro] KIRO_ENABLED is set but no 9router database was found at ${config.KIRO_DB_PATH}; Kiro provider is disabled`,
    );
    return null;
  }
  try {
    return KiroTokenStore.open(config.KIRO_DB_PATH, {
      writeBack: config.KIRO_WRITE_BACK_ENABLED,
    });
  } catch (error) {
    console.warn(
      `[kiro] failed to open 9router database at ${config.KIRO_DB_PATH}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
})();

// Device login service — handles OAuth Device Authorization Grant flow for Kiro accounts
const deviceLoginService = new DeviceLoginService({
  config,
  appDb: providerRepository.getDatabase(),
  kiroDbPath: config.KIRO_DB_PATH,
});
setInterval(() => deviceLoginService.pruneExpiredSessions(), 60_000).unref();

// Initialize routing services after all stores are available
const routingComboRepository = new RoutingComboRepository(providerRepository.getDatabase());
const modelComboRepository = new ModelComboRepository(providerRepository.getDatabase());
const routingEngine = new RoutingEngine(providerRepository);
const routingSimulationEngine = new RoutingSimulationEngine(routingEngine, providerRepository);
const providerHealthService = new ProviderHealthService(
  providerRepository,
  chatGptOAuthStore,
  kiroTokenStore,
  config.ROUTING_HEALTH_CHECK_INTERVAL, // Use configurable health check interval
  {
    responseTime: {
      good: 2000, // 2s
      degraded: 5000 // 5s
    },
    errorRate: {
      good: 0.02, // 2%
      degraded: 0.1 // 10%
    },
    quotaUsage: {
      warning: 80, // 80%
      critical: 95 // 95%
    }
  }
);
const healthWebSocketManager = new HealthWebSocketManager(
  providerHealthService,
  config.ROUTING_WEBSOCKET_BROADCAST_INTERVAL // Use configurable broadcast interval
);

// Create routing integration context
const routingIntegrationContext: RoutingIntegrationContext = {
  routingComboRepository,
  routingEngine,
  healthService: providerHealthService
};

const httpRateLimiter = new InMemoryHttpRateLimiter();
const reactClientDir = path.resolve(process.cwd(), "dist", "client");
const reactRootStaticAssetFiles = ["favicon.svg", "app-icon.svg"] as const;
const dashboardEntryPaths = [
  "/",
  "/dashboard",
  "/providers",
  "/clients",
  "/accounts",
  "/config",
  "/config-helper",
  "/usage",
  "/rtk",
  "/cache",
  "/oauth",
  "/auth-management",
] as const;
const reactDashboard = loadReactDashboardAssets();
const reactRootStaticAssets = loadReactRootStaticAssets();
const quickApplyPaths = resolveQuickApplyPaths({
  hermesConfigPath: process.env.QUICK_APPLY_HERMES_CONFIG_PATH,
  codexConfigPath: process.env.QUICK_APPLY_CODEX_CONFIG_PATH,
  codexAuthPath: process.env.QUICK_APPLY_CODEX_AUTH_PATH,
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

export const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
  },
  requestTimeout: config.REQUEST_TIMEOUT_MS,
  bodyLimit: config.REQUEST_BODY_LIMIT_BYTES,
  trustProxy: config.HTTP_TRUST_PROXY,
  disableRequestLogging: true,
});

// Activate routing system services after Fastify app is created
(async () => {
  try {
    // Start health monitoring for all providers
    providerHealthService.startHealthMonitoring();
    console.log('✓ Provider health monitoring activated');

    // Initialize WebSocket health broadcasts
    await healthWebSocketManager.initialize(app);
    console.log('✓ Health WebSocket broadcasts activated');

    // Verify routing services are operational
    const stats = await routingComboRepository.getComboStats();
    console.log(`✓ Routing system activated with ${stats.total} combos, ${stats.active} active`);
  } catch (error) {
    console.warn('⚠️ Routing system activation failed, falling back to simple provider selection:', error);
    // System will continue with basic provider selection if routing services fail
  }
})();

app.addHook("onClose", async () => {
  providerHealthService.stopHealthMonitoring();
  healthWebSocketManager.shutdown();
});

const DASHBOARD_SESSION_COOKIE = "responses_proxy_dashboard_session";

app.addHook("onRequest", async (request, reply) => {
  if (!config.HTTP_RATE_LIMIT_ENABLED) {
    return;
  }

  const policy = resolveHttpRateLimitPolicy(request.url, request.headers.authorization);
  if (!policy) {
    return;
  }

  const identifier = buildHttpRateLimitIdentifier(request.headers.authorization, request.ip);
  const result = httpRateLimiter.consume(`${policy.scope}:${identifier}`, {
    windowMs: config.HTTP_RATE_LIMIT_WINDOW_MS,
    maxRequests: policy.maxRequests,
  });
  reply.header("x-ratelimit-limit", String(policy.maxRequests));
  reply.header("x-ratelimit-remaining", String(result.remaining));
  if (result.allowed) {
    return;
  }

  const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  request.log.warn(
    {
      scope: policy.scope,
      retryAfterSeconds,
    },
    "http rate limit exceeded",
  );
  reply.header("retry-after", String(retryAfterSeconds));
  return reply.code(429).send({
    error: {
      type: "rate_limit_error",
      code: "HTTP_RATE_LIMIT_EXCEEDED",
      message: "Too many requests. Retry later.",
      retryable: true,
    },
  });
});

app.addHook("onRequest", async (request, reply) => {
  if (!isDashboardProtectedPath(request.url)) {
    return;
  }

  const sessionToken = readCookie(request.headers.cookie, DASHBOARD_SESSION_COOKIE);
  const session = dashboardAuthRepository.getSessionByToken(sessionToken);
  if (session) {
    return;
  }

  const routingApiKey = readBearerToken(request.headers.authorization);
  if (
    config.RESPONSES_PROXY_CLIENT_API_KEY &&
    routingApiKey === config.RESPONSES_PROXY_CLIENT_API_KEY
  ) {
    return;
  }

  return reply.code(401).send({
    error: {
      code: "DASHBOARD_AUTH_REQUIRED",
      message: "Dashboard login required.",
    },
  });
});

app.get("/api/dashboard-auth/session", async (request) => {
  const session = dashboardAuthRepository.getSessionByToken(readCookie(request.headers.cookie, DASHBOARD_SESSION_COOKIE));
  return {
    authenticated: Boolean(session),
    session: session
      ? {
          telegramUserId: session.telegramUserId,
          role: session.role,
          expiresAt: session.expiresAt,
        }
      : undefined,
  };
});

app.post("/api/dashboard-auth/request-approval", async (_request, reply) => {
  const adminUserIds = Array.from(dashboardAdminUserIds);
  if (adminUserIds.length === 0) {
    return reply.code(503).send({ error: { code: "DASHBOARD_AUTH_NO_ADMINS", message: "No Telegram dashboard admins are configured." } });
  }
  if (!config.TELEGRAM_BOT_TOKEN) {
    return reply.code(503).send({ error: { code: "DASHBOARD_AUTH_BOT_DISABLED", message: "Telegram bot token is not configured for dashboard login." } });
  }

  const challenge = dashboardAuthRepository.createApprovalChallenge({
    telegramUserIds: adminUserIds,
    ttlMs: config.DASHBOARD_AUTH_OTP_TTL_MS,
  });
  const deliveries = await Promise.allSettled(
    adminUserIds.map((telegramUserId) =>
      sendTelegramDashboardApprovalRequest({
        botToken: config.TELEGRAM_BOT_TOKEN as string,
        telegramUserId,
        challengeId: challenge.id,
        displayCode: challenge.displayCode,
        expiresAt: challenge.expiresAt,
      }),
    ),
  );

  if (!deliveries.some((delivery) => delivery.status === "fulfilled")) {
    return reply.code(502).send({
      error: { code: "DASHBOARD_APPROVAL_DELIVERY_FAILED", message: "Could not send approval request to any configured Telegram admin." },
    });
  }

  return {
    ok: true,
    challengeId: challenge.id,
    pollToken: challenge.pollToken,
    displayCode: challenge.displayCode,
    expiresAt: challenge.expiresAt,
    sentCount: deliveries.filter((delivery) => delivery.status === "fulfilled").length,
    debugApprovalCode: config.TELEGRAM_BOT_TOKEN.startsWith("test-") ? challenge.displayCode : undefined,
  };
});

app.post("/api/dashboard-auth/request-otp", async (_request, reply) => {
  const adminUserIds = Array.from(dashboardAdminUserIds);
  if (adminUserIds.length === 0) {
    return reply.code(503).send({ error: { code: "DASHBOARD_AUTH_NO_ADMINS", message: "No Telegram dashboard admins are configured." } });
  }
  if (!config.TELEGRAM_BOT_TOKEN) {
    return reply.code(503).send({ error: { code: "DASHBOARD_AUTH_BOT_DISABLED", message: "Telegram bot token is not configured for dashboard login." } });
  }

  const challenges = adminUserIds.map((telegramUserId) =>
    dashboardAuthRepository.createChallenge({ telegramUserId, ttlMs: config.DASHBOARD_AUTH_OTP_TTL_MS }),
  );
  const deliveries = await Promise.allSettled(
    challenges.map((challenge) =>
      sendTelegramDashboardOtp({
        botToken: config.TELEGRAM_BOT_TOKEN as string,
        telegramUserId: challenge.telegramUserId,
        otp: challenge.otp,
        expiresAt: challenge.expiresAt,
      }),
    ),
  );
  if (!deliveries.some((delivery) => delivery.status === "fulfilled")) {
    return reply.code(502).send({ error: { code: "DASHBOARD_OTP_DELIVERY_FAILED", message: "Could not send OTP to any configured Telegram admin." } });
  }

  return {
    ok: true,
    expiresAt: challenges[0]?.expiresAt,
    sentCount: deliveries.filter((delivery) => delivery.status === "fulfilled").length,
    debugOtp: config.TELEGRAM_BOT_TOKEN.startsWith("test-") ? challenges[0]?.otp : undefined,
  };
});

app.get("/api/dashboard-auth/approval-status", async (request, reply) => {
  const query = request.query as { challengeId?: unknown; pollToken?: unknown } | undefined;
  const challengeId = typeof query?.challengeId === "string" ? query.challengeId.trim() : "";
  const pollToken = typeof query?.pollToken === "string" ? query.pollToken.trim() : "";
  if (!challengeId || !pollToken) {
    return reply.code(400).send({
      error: {
        code: "INVALID_DASHBOARD_APPROVAL_STATUS_REQUEST",
        message: "challengeId and pollToken are required.",
      },
    });
  }

  const status = dashboardAuthRepository.getApprovalChallengeStatus({ challengeId, pollToken });
  if (!status.ok) {
    return reply.code(401).send({
      error: {
        code: "DASHBOARD_APPROVAL_INVALID",
        message: "Approval request not found.",
      },
    });
  }
  if (status.status !== "approved") {
    return {
      ok: true,
      status: status.status,
      challengeId: status.challengeId,
      expiresAt: status.expiresAt,
    };
  }

  const consumed = dashboardAuthRepository.consumeApprovedChallenge({ challengeId, pollToken });
  if (!consumed.ok) {
    if (consumed.reason === "consumed") {
      return {
        ok: true,
        status: "approved",
        challengeId: status.challengeId,
        expiresAt: status.expiresAt,
      };
    }
    if (consumed.reason === "pending") {
      return {
        ok: true,
        status: "pending",
        challengeId: status.challengeId,
        expiresAt: status.expiresAt,
      };
    }
    return reply.code(consumed.reason === "invalid" ? 401 : 410).send({
      error: {
        code: "DASHBOARD_APPROVAL_NOT_READY",
        message: consumed.reason === "expired" ? "Approval request expired." : "Approval request is not ready yet.",
      },
    });
  }

  const { token, session } = dashboardAuthRepository.createSession({
    telegramUserId: consumed.telegramUserId,
    ttlMs: config.DASHBOARD_AUTH_SESSION_TTL_MS,
  });
  reply.header("Set-Cookie", serializeCookie(DASHBOARD_SESSION_COOKIE, token, { maxAgeSeconds: Math.floor(config.DASHBOARD_AUTH_SESSION_TTL_MS / 1000) }));
  return {
    ok: true,
    status: "approved",
    challengeId: status.challengeId,
    expiresAt: status.expiresAt,
    session: {
      telegramUserId: session.telegramUserId,
      role: session.role,
      expiresAt: session.expiresAt,
    },
  };
});

app.post("/api/dashboard-auth/verify", async (request, reply) => {
  const body = request.body as { otp?: unknown } | undefined;
  const otp = typeof body?.otp === "string" ? body.otp.trim() : "";
  if (!/^\d{6}$/.test(otp)) {
    return reply.code(400).send({ error: { code: "INVALID_DASHBOARD_OTP", message: "Enter the 6-digit OTP from Telegram." } });
  }
  const consumed = dashboardAuthRepository.consumeChallengeForUsers({ telegramUserIds: Array.from(dashboardAdminUserIds), otp });
  if (!consumed.ok) {
    return reply.code(401).send({ error: { code: consumed.reason === "expired" ? "DASHBOARD_OTP_EXPIRED" : "DASHBOARD_OTP_INVALID", message: consumed.reason === "expired" ? "OTP expired. Request a new code." : "Invalid OTP." } });
  }
  const { token, session } = dashboardAuthRepository.createSession({ telegramUserId: consumed.telegramUserId, ttlMs: config.DASHBOARD_AUTH_SESSION_TTL_MS });
  reply.header("Set-Cookie", serializeCookie(DASHBOARD_SESSION_COOKIE, token, { maxAgeSeconds: Math.floor(config.DASHBOARD_AUTH_SESSION_TTL_MS / 1000) }));
  return { ok: true, session: { telegramUserId: session.telegramUserId, role: session.role, expiresAt: session.expiresAt } };
});

app.post("/api/dashboard-auth/logout", async (request, reply) => {
  dashboardAuthRepository.revokeSessionByToken(readCookie(request.headers.cookie, DASHBOARD_SESSION_COOKIE));
  reply.header("Set-Cookie", serializeCookie(DASHBOARD_SESSION_COOKIE, "", { maxAgeSeconds: 0 }));
  return { ok: true };
});

app.get("/health", async () => ({
  ok: true,
  service: "responses-proxy",
  upstream: providerRepository.getActiveProvider()?.baseUrl ?? null,
  activeProviderId: providerRepository.getActiveProviderId(),
  fallback: getFallbackProviderPreset("default")?.responsesUrl ?? null,
}));

app.post("/api/sepay/webhook", async (request, reply) => {
  if (!config.SEPAY_WEBHOOK_ENABLED) {
    return reply.code(404).send({ error: { code: "SEPAY_WEBHOOK_DISABLED", message: "Sepay webhook is disabled." } });
  }
  if (config.SEPAY_WEBHOOK_ALLOWED_IPS.length > 0) {
    const callerIp = normalizeIpAddress(request.ip);
    if (!isAllowedWebhookIp(callerIp, config.SEPAY_WEBHOOK_ALLOWED_IPS)) {
      request.log.warn({ callerIp }, "sepay webhook blocked by IP allowlist");
      return reply.code(403).send({ error: { code: "SEPAY_WEBHOOK_IP_FORBIDDEN", message: "Webhook source IP is not allowed." } });
    }
  }
  const expectedSecret = config.SEPAY_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return reply.code(503).send({ error: { code: "SEPAY_WEBHOOK_NOT_CONFIGURED", message: "Webhook secret is not configured." } });
  }
  const authHeader = request.headers["authorization"];
  const headerValue = typeof authHeader === "string" ? authHeader.trim() : "";
  const providedSecret = headerValue.startsWith("Apikey ")
    ? headerValue.slice("Apikey ".length).trim()
    : headerValue.startsWith("Bearer ")
      ? headerValue.slice("Bearer ".length).trim()
      : headerValue;
  if (providedSecret !== expectedSecret) {
    return reply.code(401).send({ error: { code: "SEPAY_WEBHOOK_UNAUTHORIZED", message: "Invalid webhook credentials." } });
  }
  const payload = request.body as SepayWebhookPayload | undefined;
  if (!payload || typeof payload !== "object") {
    return reply.code(400).send({ error: { code: "SEPAY_WEBHOOK_INVALID_BODY", message: "Body must be a JSON object." } });
  }
  const outcome = processSepayWebhook({
    payload,
    billing: billingRepository,
    auditLog: auditLogRepository,
  });
  return reply.code(200).send({
    ok: outcome.status === "confirmed" || outcome.status === "already_processed",
    status: outcome.status,
    requestId: "request" in outcome ? outcome.request.id : undefined,
    requestStatus: "request" in outcome ? outcome.request.status : undefined,
    expectedAmountVnd: outcome.status === "amount_mismatch" ? outcome.expectedAmount : undefined,
    receivedAmountVnd: outcome.status === "amount_mismatch" ? outcome.receivedAmount : undefined,
    reason: outcome.status === "ignored" ? outcome.reason : undefined,
  });
});

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

app.get("/api/debug/audit-logs", async (request, reply) => {
  if (!isOperatorRequest(request)) {
    return reply.code(403).send({ error: "forbidden" });
  }
  const query = request.query as { limit?: string; event?: string; subjectId?: string } | undefined;
  const limit = query?.limit ? parseInt(query.limit, 10) : 100;
  const event = typeof query?.event === "string" && query.event.trim() ? query.event.trim() as any : undefined;
  const subjectId = typeof query?.subjectId === "string" && query.subjectId.trim() ? query.subjectId.trim() : undefined;

  try {
    const logs = auditLogRepository.listEvents({ limit, event, subjectId });
    return reply.send({
      ok: true,
      logs,
    });
  } catch (error) {
    return reply.code(500).send({
      error: "Failed to fetch audit logs",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/analytics/cost-summary", async (request, reply) => {
  if (!isOperatorRequest(request)) {
    return reply.code(403).send({ error: "forbidden" });
  }

  const { latest, byProvider } = promptCacheStateStore.loadLatestObservations();
  const observations = Array.from(
    new Map(
      [latest, ...byProvider.values()]
        .filter((observation): observation is PromptCacheObservation => Boolean(observation))
        .map((observation) => [observation.requestId, observation] as const),
    ).values(),
  );

  return reply.send({
    summary: buildCostSummary(observations),
    latestObservation: latest ?? null,
    byProvider: Object.fromEntries(byProvider),
    responseCacheStats: config.RESPONSE_CACHE_ENABLED ? responseCacheStore.stats() : null,
  });
});

app.post("/api/analytics/response-cache/flush", async (request, reply) => {
  if (!isOperatorRequest(request)) {
    return reply.code(403).send({ error: "forbidden" });
  }

  const deleted = responseCacheStore.flush();
  return reply.send({ deleted });
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

  // Kiro providers: return the static model aliases (no upstream model-list API)
  // Only return kr/ prefixed canonical names to avoid duplication in combos UI
  const isKiroProvider = providerId === "account-kiro" || providerId === "kiro-ide" ||
    providerId === "kiro-free" || providerId?.startsWith("kiro-");
  if (isKiroProvider) {
    const { DEFAULT_KIRO_MODEL_ALIASES } = await import("./kiro-codewhisperer.js");
    const models = Object.keys(DEFAULT_KIRO_MODEL_ALIASES).filter(k => k.startsWith("kr/"));
    return reply.send({
      ok: true,
      providerId,
      models,
    });
  }

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

// Kiro account management API endpoints
app.get("/api/kiro/status", async (_request, reply) => {
  if (!config.KIRO_ENABLED) {
    return reply.send({
      ok: true,
      enabled: false,
      message: "Kiro is disabled. Set KIRO_ENABLED=true to use it.",
    });
  }

  if (!kiroTokenStore) {
    return reply.send({
      ok: true,
      enabled: true,
      available: false,
      message: `Kiro database not found at ${config.KIRO_DB_PATH}`,
    });
  }

  const accounts = kiroTokenStore.listAccounts();
  const activeAccounts = accounts.filter(acc => acc.isActive);
  const now = new Date();
  const healthyAccounts = activeAccounts.filter(acc => {
    if (!acc.expiresAt) return false;
    const expiresAt = new Date(acc.expiresAt);
    return expiresAt > now;
  });

  return reply.send({
    ok: true,
    enabled: true,
    available: true,
    totalAccounts: accounts.length,
    activeAccounts: activeAccounts.length,
    healthyAccounts: healthyAccounts.length,
    refreshLeadSeconds: config.KIRO_REFRESH_LEAD_SECONDS,
    writeBackEnabled: config.KIRO_WRITE_BACK_ENABLED,
    dbPath: config.KIRO_DB_PATH,
    defaultRegion: config.KIRO_DEFAULT_REGION,
  });
});

app.get("/api/kiro/accounts", async (_request, reply) => {
  if (!config.KIRO_ENABLED) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "KIRO_DISABLED",
        message: "Kiro is disabled. Set KIRO_ENABLED=true to use it.",
      },
    });
  }

  if (!kiroTokenStore) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "KIRO_DATABASE_NOT_FOUND",
        message: `Kiro database not found at ${config.KIRO_DB_PATH}`,
      },
    });
  }

  const accounts = kiroTokenStore.listAccounts();
  const now = new Date();

  const accountsForUi = accounts.map(account => {
    const expiresAt = account.expiresAt ? new Date(account.expiresAt) : null;
    const expiresIn = expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)) : null;

    let tokenStatus: 'valid' | 'expired' | 'expiring' | 'missing';
    if (!account.accessToken || account.accessToken === '') {
      tokenStatus = 'missing';
    } else if (!expiresAt) {
      tokenStatus = 'missing';
    } else if (expiresAt <= now) {
      tokenStatus = 'expired';
    } else if (expiresIn !== null && expiresIn < 600) { // Less than 10 minutes
      tokenStatus = 'expiring';
    } else {
      tokenStatus = 'valid';
    }

    return {
      id: account.id,
      name: account.name || account.id,
      priority: account.priority,
      isActive: account.isActive,
      tokenStatus,
      expiresAt: account.expiresAt,
      expiresIn,
      region: account.providerSpecificData?.region || config.KIRO_DEFAULT_REGION,
      authMethod: account.providerSpecificData?.authMethod || 'unknown',
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      hasRefreshToken: !!(account.refreshToken && account.refreshToken !== ''),
    };
  });

  return reply.send({
    ok: true,
    accounts: accountsForUi,
  });
});

app.get("/api/kiro/accounts/:accountId", async (request, reply) => {
  if (!config.KIRO_ENABLED) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "KIRO_DISABLED",
        message: "Kiro is disabled. Set KIRO_ENABLED=true to use it.",
      },
    });
  }

  if (!kiroTokenStore) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "KIRO_DATABASE_NOT_FOUND",
        message: `Kiro database not found at ${config.KIRO_DB_PATH}`,
      },
    });
  }

  const params = request.params as { accountId?: string };
  const accountId = params.accountId ? decodeURIComponent(params.accountId) : "";
  const account = kiroTokenStore.getAccount(accountId);

  if (!account) {
    return reply.code(404).send({
      error: {
        type: "not_found",
        code: "KIRO_ACCOUNT_NOT_FOUND",
        message: "Kiro account was not found",
      },
    });
  }

  const now = new Date();
  const expiresAt = account.expiresAt ? new Date(account.expiresAt) : null;
  const expiresIn = expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)) : null;

  let tokenStatus: 'valid' | 'expired' | 'expiring' | 'missing';
  if (!account.accessToken || account.accessToken === '') {
    tokenStatus = 'missing';
  } else if (!expiresAt) {
    tokenStatus = 'missing';
  } else if (expiresAt <= now) {
    tokenStatus = 'expired';
  } else if (expiresIn !== null && expiresIn < 600) {
    tokenStatus = 'expiring';
  } else {
    tokenStatus = 'valid';
  }

  // Redact sensitive data for UI
  const accountForUi = {
    id: account.id,
    name: account.name || account.id,
    priority: account.priority,
    isActive: account.isActive,
    tokenStatus,
    expiresAt: account.expiresAt,
    expiresIn,
    region: account.providerSpecificData?.region || config.KIRO_DEFAULT_REGION,
    authMethod: account.providerSpecificData?.authMethod || 'unknown',
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
    hasRefreshToken: !!(account.refreshToken && account.refreshToken !== ''),
    hasAccessToken: !!(account.accessToken && account.accessToken !== ''),
    profileArn: account.providerSpecificData?.profileArn || null,
    startUrl: account.providerSpecificData?.startUrl || null,
    // Include raw data but redact sensitive fields
    raw: {
      ...account.raw,
      accessToken: account.raw.accessToken ? '[REDACTED]' : undefined,
      refreshToken: account.raw.refreshToken ? '[REDACTED]' : undefined,
      clientSecret: account.raw.clientSecret ? '[REDACTED]' : undefined,
    },
  };

  return reply.send({
    ok: true,
    account: accountForUi,
  });
});

app.post("/api/kiro/accounts/:accountId/refresh", async (request, reply) => {
  if (!config.KIRO_ENABLED) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "KIRO_DISABLED",
        message: "Kiro is disabled. Set KIRO_ENABLED=true to use it.",
      },
    });
  }

  if (!kiroTokenStore) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "KIRO_DATABASE_NOT_FOUND",
        message: `Kiro database not found at ${config.KIRO_DB_PATH}`,
      },
    });
  }

  const params = request.params as { accountId?: string };
  const accountId = params.accountId ? decodeURIComponent(params.accountId) : "";
  const account = kiroTokenStore.getAccount(accountId);

  if (!account) {
    return reply.code(404).send({
      error: {
        type: "not_found",
        code: "KIRO_ACCOUNT_NOT_FOUND",
        message: "Kiro account was not found",
      },
    });
  }

  try {
    const { refreshKiroToken } = await import("./kiro-auth.js");
    const refreshResult = await refreshKiroToken(account);

    if (config.KIRO_WRITE_BACK_ENABLED) {
      kiroTokenStore.updateTokens(account.id, refreshResult);
    }

    // Get updated account
    const updatedAccount = kiroTokenStore.getAccount(accountId);
    if (!updatedAccount) {
      throw new Error("Account not found after refresh");
    }

    const now = new Date();
    const expiresAt = updatedAccount.expiresAt ? new Date(updatedAccount.expiresAt) : null;
    const expiresIn = expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)) : null;

    return reply.send({
      ok: true,
      account: {
        id: updatedAccount.id,
        name: updatedAccount.name || updatedAccount.id,
        priority: updatedAccount.priority,
        isActive: updatedAccount.isActive,
        tokenStatus: 'valid',
        expiresAt: updatedAccount.expiresAt,
        expiresIn,
        region: updatedAccount.providerSpecificData?.region || config.KIRO_DEFAULT_REGION,
        authMethod: updatedAccount.providerSpecificData?.authMethod || 'unknown',
        createdAt: updatedAccount.createdAt,
        updatedAt: updatedAccount.updatedAt,
        hasRefreshToken: !!(updatedAccount.refreshToken && updatedAccount.refreshToken !== ''),
      },
    });
  } catch (error) {
    return reply.code(500).send({
      error: {
        type: "refresh_error",
        code: "KIRO_TOKEN_REFRESH_FAILED",
        message: error instanceof Error ? error.message : "Token refresh failed",
      },
    });
  }
});

app.patch("/api/kiro/accounts/:accountId", async (request, reply) => {
  if (!config.KIRO_ENABLED) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "KIRO_DISABLED",
        message: "Kiro is disabled. Set KIRO_ENABLED=true to use it.",
      },
    });
  }

  if (!kiroTokenStore) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "KIRO_DATABASE_NOT_FOUND",
        message: `Kiro database not found at ${config.KIRO_DB_PATH}`,
      },
    });
  }

  if (!config.KIRO_WRITE_BACK_ENABLED) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "KIRO_WRITE_BACK_DISABLED",
        message: "Kiro write-back is disabled. Cannot update accounts.",
      },
    });
  }

  const params = request.params as { accountId?: string };
  const accountId = params.accountId ? decodeURIComponent(params.accountId) : "";
  const account = kiroTokenStore.getAccount(accountId);

  if (!account) {
    return reply.code(404).send({
      error: {
        type: "not_found",
        code: "KIRO_ACCOUNT_NOT_FOUND",
        message: "Kiro account was not found",
      },
    });
  }

  const body = request.body as {
    name?: string;
    priority?: number;
    isActive?: boolean;
  } | undefined;

  try {
    // Validate inputs
    const updates: { name?: string; priority?: number; isActive?: boolean } = {};

    if (body?.name !== undefined) {
      if (typeof body.name !== 'string') {
        return reply.code(400).send({
          error: {
            type: "validation_error",
            code: "INVALID_NAME",
            message: "Name must be a string",
          },
        });
      }
      updates.name = body.name;
    }

    if (body?.priority !== undefined) {
      if (typeof body.priority !== 'number' || body.priority < 0) {
        return reply.code(400).send({
          error: {
            type: "validation_error",
            code: "INVALID_PRIORITY",
            message: "Priority must be a non-negative number",
          },
        });
      }
      updates.priority = body.priority;
    }

    if (body?.isActive !== undefined) {
      if (typeof body.isActive !== 'boolean') {
        return reply.code(400).send({
          error: {
            type: "validation_error",
            code: "INVALID_IS_ACTIVE",
            message: "isActive must be a boolean",
          },
        });
      }
      updates.isActive = body.isActive;
    }

    // Apply updates
    const updatedAccount = kiroTokenStore.updateAccount(accountId, updates);
    if (!updatedAccount) {
      return reply.code(404).send({
        error: {
          type: "not_found",
          code: "KIRO_ACCOUNT_NOT_FOUND",
          message: "Kiro account was not found after update",
        },
      });
    }

    const now = new Date();
    const expiresAt = updatedAccount.expiresAt ? new Date(updatedAccount.expiresAt) : null;
    const expiresIn = expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)) : null;

    let tokenStatus: 'valid' | 'expired' | 'expiring' | 'missing';
    if (!updatedAccount.accessToken || updatedAccount.accessToken === '') {
      tokenStatus = 'missing';
    } else if (!expiresAt) {
      tokenStatus = 'missing';
    } else if (expiresAt <= now) {
      tokenStatus = 'expired';
    } else if (expiresIn !== null && expiresIn < 600) {
      tokenStatus = 'expiring';
    } else {
      tokenStatus = 'valid';
    }

    return reply.send({
      ok: true,
      account: {
        id: updatedAccount.id,
        name: updatedAccount.name || updatedAccount.id,
        priority: updatedAccount.priority,
        isActive: updatedAccount.isActive,
        tokenStatus,
        expiresAt: updatedAccount.expiresAt,
        expiresIn,
        region: updatedAccount.providerSpecificData?.region || config.KIRO_DEFAULT_REGION,
        authMethod: updatedAccount.providerSpecificData?.authMethod || 'unknown',
        createdAt: updatedAccount.createdAt,
        updatedAt: updatedAccount.updatedAt,
        hasRefreshToken: !!(updatedAccount.refreshToken && updatedAccount.refreshToken !== ''),
      },
    });
  } catch (error) {
    return reply.code(500).send({
      error: {
        type: "update_error",
        code: "KIRO_ACCOUNT_UPDATE_FAILED",
        message: error instanceof Error ? error.message : "Account update failed",
      },
    });
  }
});

app.delete("/api/kiro/accounts/:accountId", async (request, reply) => {
  if (!config.KIRO_ENABLED) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "KIRO_DISABLED",
        message: "Kiro is disabled. Set KIRO_ENABLED=true to use it.",
      },
    });
  }

  if (!kiroTokenStore) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "KIRO_DATABASE_NOT_FOUND",
        message: `Kiro database not found at ${config.KIRO_DB_PATH}`,
      },
    });
  }

  if (!config.KIRO_WRITE_BACK_ENABLED) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "KIRO_WRITE_BACK_DISABLED",
        message: "Kiro write-back is disabled. Cannot delete accounts.",
      },
    });
  }

  const params = request.params as { accountId?: string };
  const accountId = params.accountId ? decodeURIComponent(params.accountId) : "";
  const account = kiroTokenStore.getAccount(accountId);

  if (!account) {
    return reply.code(404).send({
      error: {
        type: "not_found",
        code: "KIRO_ACCOUNT_NOT_FOUND",
        message: "Kiro account was not found",
      },
    });
  }

  try {
    // Delete the account
    const deleted = kiroTokenStore.deleteAccount(accountId);

    if (!deleted) {
      return reply.code(404).send({
        error: {
          type: "not_found",
          code: "KIRO_ACCOUNT_NOT_FOUND",
          message: "Kiro account was not found or could not be deleted",
        },
      });
    }

    return reply.send({
      ok: true,
      deleted: true,
      accountId,
    });
  } catch (error) {
    return reply.code(500).send({
      error: {
        type: "delete_error",
        code: "KIRO_ACCOUNT_DELETE_FAILED",
        message: error instanceof Error ? error.message : "Account deletion failed",
      },
    });
  }
});

app.get("/api/kiro/model-aliases", async (_request, reply) => {
  const kiroProvider = providerRepository.getProvider("account-kiro");
  const aliases = kiroProvider?.capabilities.modelAliases ?? {};
  return reply.send({ ok: true, aliases });
});

app.put("/api/kiro/model-aliases", async (request, reply) => {
  const body = request.body as { alias?: unknown; target?: unknown } | undefined;
  const alias = typeof body?.alias === "string" ? body.alias.trim() : "";
  const target = typeof body?.target === "string" ? body.target.trim() : "";

  if (!alias) {
    return reply.code(400).send({
      error: { type: "validation_error", code: "INVALID_ALIAS", message: "alias is required" },
    });
  }
  if (!target) {
    return reply.code(400).send({
      error: { type: "validation_error", code: "INVALID_TARGET", message: "target model ID is required" },
    });
  }

  const kiroProvider = providerRepository.getProvider("account-kiro");
  if (!kiroProvider) {
    return reply.code(404).send({
      error: { type: "not_found", code: "KIRO_PROVIDER_NOT_FOUND", message: "Kiro provider not found" },
    });
  }

  const updatedAliases = { ...(kiroProvider.capabilities.modelAliases ?? {}), [alias]: target };
  providerRepository.updateProvider("account-kiro", {
    ...kiroProvider,
    capabilities: { ...kiroProvider.capabilities, modelAliases: updatedAliases },
  });

  return reply.send({ ok: true, aliases: updatedAliases });
});

app.delete("/api/kiro/model-aliases/:alias", async (request, reply) => {
  const params = request.params as { alias?: string };
  const alias = params.alias?.trim() ?? "";

  if (!alias) {
    return reply.code(400).send({
      error: { type: "validation_error", code: "INVALID_ALIAS", message: "alias is required" },
    });
  }

  const kiroProvider = providerRepository.getProvider("account-kiro");
  if (!kiroProvider) {
    return reply.code(404).send({
      error: { type: "not_found", code: "KIRO_PROVIDER_NOT_FOUND", message: "Kiro provider not found" },
    });
  }

  const updatedAliases = { ...(kiroProvider.capabilities.modelAliases ?? {}) };
  delete updatedAliases[alias];
  providerRepository.updateProvider("account-kiro", {
    ...kiroProvider,
    capabilities: { ...kiroProvider.capabilities, modelAliases: updatedAliases },
  });

  return reply.send({ ok: true, aliases: updatedAliases });
});

app.post("/api/kiro/models/test", async (request, reply) => {
  if (!config.KIRO_ENABLED) {
    return reply.code(409).send({
      error: { type: "configuration_error", code: "KIRO_DISABLED", message: "Kiro is disabled." },
    });
  }
  if (!kiroTokenStore) {
    return reply.code(409).send({
      error: { type: "configuration_error", code: "KIRO_UNAVAILABLE", message: "Kiro token store not available." },
    });
  }

  const body = request.body as { model?: unknown } | undefined;
  const model = typeof body?.model === "string" ? body.model.trim() : "";
  if (!model) {
    return reply.code(400).send({
      error: { type: "validation_error", code: "INVALID_MODEL", message: "model is required" },
    });
  }

  try {
    const { resolveKiroCredentials } = await import("./kiro-auth.js");
    const { mapModelToCodeWhisperer } = await import("./kiro-codewhisperer.js");

    const kiroProvider = providerRepository.getProvider("account-kiro");
    const aliases = kiroProvider?.capabilities.modelAliases ?? {};
    const resolvedModel = mapModelToCodeWhisperer(model, aliases);

    // Resolve credentials (ensures at least one account is available + token is fresh)
    const start = Date.now();
    const creds = await resolveKiroCredentials({
      store: kiroTokenStore,
      defaultRegion: config.KIRO_DEFAULT_REGION,
      refreshLeadSeconds: config.KIRO_REFRESH_LEAD_SECONDS,
    });
    const latencyMs = Date.now() - start;

    return reply.send({
      ok: true,
      model,
      resolvedModel,
      accountId: creds.accountId,
      region: creds.region,
      latencyMs,
    });
  } catch (error) {
    return reply.send({
      ok: false,
      model,
      error: error instanceof Error ? error.message : "Model test failed",
    });
  }
});

app.post("/api/kiro/import", async (request, reply) => {
  if (!config.KIRO_ENABLED) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "KIRO_DISABLED",
        message: "Kiro is disabled. Set KIRO_ENABLED=true to use it.",
      },
    });
  }

  const body = request.body as {
    sourcePath?: string;
  } | undefined;

  try {
    const { importKiroAccounts } = await import("./kiro-import.js");
    const sourcePath = body?.sourcePath || process.env.KIRO_SOURCE_DB_PATH || `${process.env.HOME}/.9router/db/data.sqlite`;
    const destPath = config.KIRO_DB_PATH;

    const result = await importKiroAccounts({
      sourceDbPath: sourcePath,
      destDbPath: destPath,
      provider: 'kiro',
    });

    return reply.send({
      ok: true,
      imported: result.imported,
      sourcePath: result.source,
      destPath: result.dest,
    });
  } catch (error) {
    return reply.code(500).send({
      error: {
        type: "import_error",
        code: "KIRO_IMPORT_FAILED",
        message: error instanceof Error ? error.message : "Import failed",
      },
    });
  }
});

app.post("/api/kiro/device/start", async (request, reply) => {
  if (!config.KIRO_ENABLED) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "KIRO_DISABLED",
        message: "Kiro is disabled. Set KIRO_ENABLED=true.",
      },
    });
  }
  if (!config.KIRO_WRITE_BACK_ENABLED) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "KIRO_WRITE_BACK_DISABLED",
        message: "Device login cannot persist accounts when write-back is disabled.",
      },
    });
  }

  const body = request.body as { authMethod?: unknown; startUrl?: unknown; region?: unknown } | undefined;
  const authMethod = body?.authMethod;
  if (authMethod !== "builder_id" && authMethod !== "idc") {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "INVALID_AUTH_METHOD",
        message: "authMethod must be \"builder_id\" or \"idc\".",
      },
    });
  }

  try {
    const result = await deviceLoginService.startDeviceLogin({
      authMethod,
      startUrl: typeof body?.startUrl === "string" ? body.startUrl : undefined,
      region: typeof body?.region === "string" ? body.region : undefined,
    });
    return reply.send({ ok: true, ...result });
  } catch (error) {
    if (error instanceof DeviceLoginError) {
      return reply.code(error.statusCode).send({ error: error.body });
    }
    throw error;
  }
});

app.post("/api/kiro/device/poll", async (request, reply) => {
  if (!config.KIRO_ENABLED) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "KIRO_DISABLED",
        message: "Kiro is disabled. Set KIRO_ENABLED=true.",
      },
    });
  }

  const body = request.body as { sessionId?: unknown } | undefined;
  const sessionId = body?.sessionId;
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "INVALID_SESSION_ID",
        message: "sessionId must be a non-empty string.",
      },
    });
  }

  try {
    const result = await deviceLoginService.pollDeviceLogin(sessionId);
    return reply.send({ ok: true, ...result });
  } catch (error) {
    if (error instanceof DeviceLoginError) {
      return reply.code(error.statusCode).send({ error: error.body });
    }
    throw error;
  }
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

  const requestedBaseUrl = normalizeProxyBaseUrl(
    typeof body?.baseUrl === "string" && body.baseUrl.trim()
      ? body.baseUrl.trim()
      : localProxyBaseUrl,
  );
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
  const writeResult = writeQuickConfigFile(configPath, nextRaw, {
    backupDir: quickApplyPaths.backupDir,
  });
  let authWriteResult = { changed: false, backupCreated: false };
  if (client === "codex") {
    const currentAuthRaw = readQuickConfigFile(quickApplyPaths.codexAuthPath);
    const nextAuthRaw = applyCodexAuth(currentAuthRaw, routeApiKey);
    authWriteResult = writeQuickConfigFile(quickApplyPaths.codexAuthPath, nextAuthRaw, {
      backupDir: quickApplyPaths.backupDir,
    });
  }

  return reply.send({
    ok: true,
    client,
    changed: writeResult.changed || authWriteResult.changed,
    backupCreated: writeResult.backupCreated || authWriteResult.backupCreated,
    configChanged: writeResult.changed,
    authChanged: authWriteResult.changed,
    proxyBaseUrl: requestedBaseUrl,
    status: buildQuickApplyClientStatus(client, requestedBaseUrl),
    clientRoutes: providerRepository.getClientRoutesForUi(),
  });
});

// ─── CLI Tool Auto-Apply: Claude Code settings ──────────────────────────────

app.get("/api/cli-tools/claude-settings", async (_request, reply) => {
  const settingsPath = path.join(process.env.HOME || "", ".claude", "settings.json");
  try {
    if (!existsSync(settingsPath)) {
      return reply.send({ installed: false, path: settingsPath });
    }
    const raw = readFileSync(settingsPath, "utf8");
    const data = JSON.parse(raw);
    const env = data.env || {};
    const has9Router = !!env.ANTHROPIC_BASE_URL && env.ANTHROPIC_BASE_URL.includes(String(config.PORT));
    return reply.send({
      installed: true,
      path: settingsPath,
      has9Router,
      settings: { env },
    });
  } catch (error) {
    return reply.send({ installed: false, path: settingsPath, error: error instanceof Error ? error.message : "read failed" });
  }
});

app.post("/api/cli-tools/claude-settings", async (request, reply) => {
  const body = request.body as { env?: Record<string, string> } | undefined;
  const envVars = body?.env;
  if (!envVars || typeof envVars !== "object") {
    return reply.code(400).send({ error: "env object is required" });
  }

  const settingsPath = path.join(process.env.HOME || "", ".claude", "settings.json");
  const settingsDir = path.dirname(settingsPath);
  const backupDir = quickApplyPaths.backupDir;

  try {
    mkdirSync(settingsDir, { recursive: true });

    let currentData: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      try {
        currentData = JSON.parse(readFileSync(settingsPath, "utf8"));
      } catch { /* start fresh */ }
    }

    // Merge env vars
    const currentEnv = (currentData.env && typeof currentData.env === "object") ? currentData.env as Record<string, string> : {};
    const mergedEnv = { ...currentEnv, ...envVars };
    const nextData = { ...currentData, env: mergedEnv, hasCompletedOnboarding: true };
    const nextRaw = JSON.stringify(nextData, null, 2) + "\n";

    const writeResult = writeQuickConfigFile(settingsPath, nextRaw, { backupDir });

    return reply.send({
      ok: true,
      changed: writeResult.changed,
      backupCreated: writeResult.backupCreated,
    });
  } catch (error) {
    return reply.code(500).send({ error: error instanceof Error ? error.message : "Failed to apply settings" });
  }
});

app.delete("/api/cli-tools/claude-settings", async (_request, reply) => {
  const settingsPath = path.join(process.env.HOME || "", ".claude", "settings.json");
  try {
    if (!existsSync(settingsPath)) {
      return reply.send({ ok: true, changed: false });
    }
    const raw = readFileSync(settingsPath, "utf8");
    const data = JSON.parse(raw);
    const env = data.env || {};
    // Remove 9router-injected keys
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.ANTHROPIC_MODEL;
    delete env.ANTHROPIC_DEFAULT_OPUS_MODEL;
    delete env.ANTHROPIC_DEFAULT_SONNET_MODEL;
    delete env.ANTHROPIC_DEFAULT_HAIKU_MODEL;
    data.env = env;
    const nextRaw = JSON.stringify(data, null, 2) + "\n";
    const writeResult = writeQuickConfigFile(settingsPath, nextRaw, { backupDir: quickApplyPaths.backupDir });
    return reply.send({ ok: true, changed: writeResult.changed, backupCreated: writeResult.backupCreated });
  } catch (error) {
    return reply.code(500).send({ error: error instanceof Error ? error.message : "Failed to reset settings" });
  }
});

app.get("/api/customer/codex/setup.sh", async (request, reply) => {
  const routingApiKey = readBearerToken(request.headers.authorization);
  if (!routingApiKey) {
    return reply.code(401).send({
      error: {
        type: "authentication_error",
        code: "CUSTOMER_API_KEY_REQUIRED",
        message: "Customer API key is required to download the Codex setup script.",
        retryable: false,
      },
    });
  }

  const routingAccess = resolveCustomerRoutingAccess({
    routingApiKey,
    resolvedClientRoute: "default",
    providerRepository,
    customerKeyRepository,
    workspaceRepository: customerWorkspaceRepository,
    billingRepository,
  });
  if ("error" in routingAccess) {
    return reply.code(routingAccess.error.statusCode).send(routingAccess.error.body);
  }
  if (routingAccess.kind !== "customer") {
    return reply.code(403).send({
      error: {
        type: "authentication_error",
        code: "CUSTOMER_API_KEY_REQUIRED",
        message: "Use a customer API key to download the Codex setup script.",
        retryable: false,
      },
    });
  }

  const apiKey = customerKeyRepository.getApiKeySecret(routingAccess.customerKey.id);
  if (!apiKey) {
    return reply.code(409).send({
      error: {
        type: "configuration_error",
        code: "CUSTOMER_API_KEY_SECRET_UNAVAILABLE",
        message: "This customer API key does not have a retrievable secret.",
        retryable: false,
      },
    });
  }

  const query = request.query as { model?: unknown } | undefined;
  const model =
    typeof query?.model === "string" && query.model.trim()
      ? query.model.trim()
      : config.RESPONSES_PROXY_DEFAULT_MODEL.trim();
  const files = buildCodexConfigFiles({
    baseUrl: config.publicResponsesBaseUrl,
    apiKey,
    model,
  });
  const script = buildCodexConfigSetupScript(files);

  reply.header("cache-control", "no-store");
  reply.header("content-disposition", 'attachment; filename="responses-proxy-codex-setup.sh"');
  return reply.type("text/x-shellscript; charset=utf-8").send(script);
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

app.get("/api/client-token-limits", async (_request, reply) => {
  const now = new Date();
  return reply.send({
    ok: true,
    timestamp: now.toISOString(),
    clients: providerRepository
      .listClientTokenLimitsForUi(now)
      .map((entry) => buildClientTokenLimitResponse(entry)),
  });
});

app.get("/api/client-token-limits/:client", async (request, reply) => {
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

  const client = normalizeClientRouteKey(params.client);
  if (!providerRepository.getClientRoutesForUi().some((entry) => entry.key === client)) {
    return reply.code(404).send({
      error: {
        type: "validation_error",
        code: "CLIENT_ROUTE_NOT_FOUND",
        message: "client must match one of the configured client routes",
      },
    });
  }

  const now = new Date();
  const config = providerRepository.getClientTokenLimit(client) ?? null;
  const usage = providerRepository.getClientTokenUsage(client, now);
  return reply.send({
    ok: true,
    timestamp: now.toISOString(),
    client: buildClientTokenLimitResponse({
      clientRoute: client,
      config,
      usage,
    }),
  });
});

app.put("/api/client-token-limits/:client", async (request, reply) => {
  const params = request.params as { client?: string };
  const client = validateClientTokenLimitRoute(params.client, reply);
  if (!client) {
    return;
  }

  const input = parseClientTokenLimitInput(request.body);
  if ("error" in input) {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: input.error.code,
        message: input.error.message,
      },
    });
  }

  const config = providerRepository.setClientTokenLimit(client, input.value);
  const now = new Date();
  const usage = providerRepository.getClientTokenUsage(client, now);
  return reply.send({
    ok: true,
    timestamp: now.toISOString(),
    client: buildClientTokenLimitResponse({
      clientRoute: client,
      config,
      usage,
    }),
  });
});

app.post("/api/client-token-limits/:client/reset", async (request, reply) => {
  const params = request.params as { client?: string };
  const client = validateClientTokenLimitRoute(params.client, reply);
  if (!client) {
    return;
  }

  const now = new Date();
  const usage = providerRepository.resetClientTokenUsage(client, now);
  const config = providerRepository.getClientTokenLimit(client) ?? null;
  return reply.send({
    ok: true,
    timestamp: now.toISOString(),
    client: buildClientTokenLimitResponse({
      clientRoute: client,
      config,
      usage,
    }),
  });
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

app.post("/api/providers/:providerId/toggle-enabled", async (request, reply) => {
  const params = request.params as { providerId?: string };
  const providerId = typeof params.providerId === "string" ? params.providerId.trim() : "";
  const body = request.body as { enabled?: unknown } | undefined;
  const enabled = body?.enabled === true || body?.enabled === "true";

  try {
    const existing = providerRepository.getProviderOrThrow(providerId);
    const updated = providerRepository.updateProvider(providerId, {
      ...existing,
      enabled,
    });
    return reply.send({
      ok: true,
      provider: providerRepository.getProviderForUiOrThrow(updated.id),
    });
  } catch (error) {
    return sendProviderRepositoryError(reply, error);
  }
});

app.post("/api/providers/:providerId/transport-mode", async (request, reply) => {
  const params = request.params as { providerId?: string };
  const providerId = typeof params.providerId === "string" ? params.providerId.trim() : "";
  const body = request.body as { mode?: unknown } | undefined;
  const mode = typeof body?.mode === "string" ? body.mode.trim().toLowerCase() : "";
  if (mode !== "responses" && mode !== "chat_completions") {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "INVALID_TRANSPORT_MODE",
        message: "mode must be either 'responses' or 'chat_completions'",
      },
    });
  }

  try {
    const existing = providerRepository.getProviderOrThrow(providerId);
    const provider = providerRepository.updateProvider(providerId, {
      name: existing.name,
      baseUrl: existing.baseUrl,
      responsesUrl: existing.responsesUrl,
      authMode: existing.authMode,
      chatgptAccountId: existing.chatgptAccountId,
      providerApiKeys: existing.providerApiKeys,
      clientApiKeys: existing.clientApiKeys,
      capabilities: {
        ...existing.capabilities,
        transportMode: mode,
      },
    });
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

// Routing Combos API
app.get("/api/routing/combos", async (request, reply) => {
  try {
    const combos = await routingComboRepository.getAllCombos();
    const stats = await routingComboRepository.getComboStats();
    return reply.send({
      combos,
      stats
    });
  } catch (error) {
    console.error("Failed to fetch routing combos:", error);
    return reply.code(500).send({
      error: "Failed to fetch routing combos",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/routing/combos/:id", async (request, reply) => {
  const params = request.params as { id?: string };
  const id = typeof params.id === "string" ? params.id.trim() : "";

  if (!id) {
    return reply.code(400).send({
      error: "Missing combo ID"
    });
  }

  try {
    const combo = await routingComboRepository.getComboById(id);
    if (!combo) {
      return reply.code(404).send({
        error: "Routing combo not found"
      });
    }
    return reply.send(combo);
  } catch (error) {
    console.error("Failed to fetch routing combo:", error);
    return reply.code(500).send({
      error: "Failed to fetch routing combo",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/routing/combos", async (request, reply) => {
  const body = request.body as any;

  try {
    // Basic validation
    if (!body.name || typeof body.name !== "string") {
      return reply.code(400).send({
        error: "Missing or invalid combo name"
      });
    }

    if (!Array.isArray(body.tiers)) {
      return reply.code(400).send({
        error: "Missing or invalid tiers array"
      });
    }

    if (!body.policies || typeof body.policies !== "object") {
      return reply.code(400).send({
        error: "Missing or invalid policies object"
      });
    }

    const combo = await routingComboRepository.createCombo(body);
    return reply.code(201).send(combo);
  } catch (error) {
    console.error("Failed to create routing combo:", error);
    return reply.code(500).send({
      error: "Failed to create routing combo",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.put("/api/routing/combos/:id", async (request, reply) => {
  const params = request.params as { id?: string };
  const id = typeof params.id === "string" ? params.id.trim() : "";
  const body = request.body as any;

  if (!id) {
    return reply.code(400).send({
      error: "Missing combo ID"
    });
  }

  try {
    // Basic validation
    if (!body.name || typeof body.name !== "string") {
      return reply.code(400).send({
        error: "Missing or invalid combo name"
      });
    }

    if (!Array.isArray(body.tiers)) {
      return reply.code(400).send({
        error: "Missing or invalid tiers array"
      });
    }

    if (!body.policies || typeof body.policies !== "object") {
      return reply.code(400).send({
        error: "Missing or invalid policies object"
      });
    }

    const combo = await routingComboRepository.updateCombo(id, body);
    return reply.send(combo);
  } catch (error) {
    console.error("Failed to update routing combo:", error);
    if (error instanceof Error && error.message.includes("not found")) {
      return reply.code(404).send({
        error: "Routing combo not found"
      });
    }
    return reply.code(500).send({
      error: "Failed to update routing combo",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.delete("/api/routing/combos/:id", async (request, reply) => {
  const params = request.params as { id?: string };
  const id = typeof params.id === "string" ? params.id.trim() : "";

  if (!id) {
    return reply.code(400).send({
      error: "Missing combo ID"
    });
  }

  try {
    await routingComboRepository.deleteCombo(id);
    return reply.send({
      ok: true
    });
  } catch (error) {
    console.error("Failed to delete routing combo:", error);
    if (error instanceof Error) {
      if (error.message.includes("not found")) {
        return reply.code(404).send({
          error: "Routing combo not found"
        });
      }
      if (error.message.includes("Cannot delete active") || error.message.includes("Cannot delete default")) {
        return reply.code(400).send({
          error: error.message
        });
      }
    }
    return reply.code(500).send({
      error: "Failed to delete routing combo",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/routing/combos/:id/simulate", async (request, reply) => {
  const params = request.params as { id?: string };
  const id = typeof params.id === "string" ? params.id.trim() : "";
  const body = request.body as any;

  if (!id) {
    return reply.code(400).send({
      error: "Missing combo ID"
    });
  }

  try {
    const combo = await routingComboRepository.getComboById(id);
    if (!combo) {
      return reply.code(404).send({
        error: "Routing combo not found"
      });
    }

    // Create simulation request with validation
    const simulationRequest = {
      comboId: id,
      route: body.route || 'chat',
      model: body.model || 'claude-3-5-sonnet-20241022',
      tokenCount: body.tokenCount || 1000,
      priority: body.priority || 'normal',
      includeHealthCheck: body.includeHealthCheck !== false,
      simulateFailures: body.simulateFailures || false,
      maxRetries: body.maxRetries || 3
    };

    // Run real simulation using the routing engine
    const simulationResult = await routingSimulationEngine.simulate(combo, simulationRequest);

    return reply.send(simulationResult);
  } catch (error) {
    console.error("Failed to simulate routing combo:", error);
    return reply.code(500).send({
      error: "Failed to simulate routing combo",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/routing/combos/:id/set-default", async (request, reply) => {
  const params = request.params as { id?: string };
  const id = typeof params.id === "string" ? params.id.trim() : "";

  if (!id) {
    return reply.code(400).send({
      error: "Missing combo ID"
    });
  }

  try {
    await routingComboRepository.setDefaultCombo(id);
    return reply.send({
      ok: true
    });
  } catch (error) {
    console.error("Failed to set default routing combo:", error);
    return reply.code(500).send({
      error: "Failed to set default routing combo",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// ─── Model Combos (9Router-style simple combos) ────────────────────────────────

app.get("/api/model-combos", async (request, reply) => {
  try {
    const query = request.query as { kind?: string };
    const kind = query.kind;
    const combos = kind !== undefined
      ? modelComboRepository.getAll(kind || null)
      : modelComboRepository.getLlmCombos();
    return reply.send({ combos });
  } catch (error) {
    console.error("Failed to fetch model combos:", error);
    return reply.code(500).send({ error: { message: "Failed to fetch model combos" } });
  }
});

app.get("/api/model-combos/:id", async (request, reply) => {
  const params = request.params as { id?: string };
  const id = typeof params.id === "string" ? params.id.trim() : "";
  if (!id) {
    return reply.code(400).send({ error: { message: "Missing combo ID" } });
  }
  const combo = modelComboRepository.getById(id);
  if (!combo) {
    return reply.code(404).send({ error: { message: "Model combo not found" } });
  }
  return reply.send({ combo });
});

app.post("/api/model-combos", async (request, reply) => {
  const body = request.body as any;
  try {
    const combo = modelComboRepository.create({
      name: body.name,
      kind: body.kind ?? null,
      models: body.models ?? [],
      roundRobin: body.roundRobin ?? false,
    });
    return reply.code(201).send({ combo });
  } catch (error) {
    if (error instanceof ModelComboValidationError) {
      return reply.code(400).send({ error: { message: error.message } });
    }
    console.error("Failed to create model combo:", error);
    return reply.code(500).send({ error: { message: "Failed to create model combo" } });
  }
});

app.put("/api/model-combos/:id", async (request, reply) => {
  const params = request.params as { id?: string };
  const id = typeof params.id === "string" ? params.id.trim() : "";
  if (!id) {
    return reply.code(400).send({ error: { message: "Missing combo ID" } });
  }
  const body = request.body as any;
  try {
    const combo = modelComboRepository.update(id, {
      name: body.name,
      kind: body.kind,
      models: body.models,
      roundRobin: body.roundRobin,
    });
    return reply.send({ combo });
  } catch (error) {
    if (error instanceof ModelComboValidationError) {
      return reply.code(400).send({ error: { message: error.message } });
    }
    if (error instanceof ModelComboNotFoundError) {
      return reply.code(404).send({ error: { message: "Model combo not found" } });
    }
    console.error("Failed to update model combo:", error);
    return reply.code(500).send({ error: { message: "Failed to update model combo" } });
  }
});

app.delete("/api/model-combos/:id", async (request, reply) => {
  const params = request.params as { id?: string };
  const id = typeof params.id === "string" ? params.id.trim() : "";
  if (!id) {
    return reply.code(400).send({ error: { message: "Missing combo ID" } });
  }
  const deleted = modelComboRepository.delete(id);
  if (!deleted) {
    return reply.code(404).send({ error: { message: "Model combo not found" } });
  }
  return reply.send({ ok: true });
});

// Provider Health API
app.get("/api/health/providers", async (request, reply) => {
  try {
    const allHealth = providerHealthService.getAllProviderHealth();
    const healthArray = Array.from(allHealth.values());

    return reply.send({
      providers: healthArray,
      summary: providerHealthService.getHealthSummary()
    });
  } catch (error) {
    console.error("Failed to fetch provider health:", error);
    return reply.code(500).send({
      error: "Failed to fetch provider health",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/health/providers/:providerId", async (request, reply) => {
  const params = request.params as { providerId?: string };
  const providerId = typeof params.providerId === "string" ? params.providerId.trim() : "";

  if (!providerId) {
    return reply.code(400).send({
      error: "Missing provider ID"
    });
  }

  try {
    const health = providerHealthService.getProviderHealth(providerId);
    if (!health) {
      return reply.code(404).send({
        error: "Provider health data not found"
      });
    }

    return reply.send(health);
  } catch (error) {
    console.error(`Failed to fetch health for provider ${providerId}:`, error);
    return reply.code(500).send({
      error: "Failed to fetch provider health",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/health/providers/:providerId/check", async (request, reply) => {
  const params = request.params as { providerId?: string };
  const providerId = typeof params.providerId === "string" ? params.providerId.trim() : "";

  if (!providerId) {
    return reply.code(400).send({
      error: "Missing provider ID"
    });
  }

  try {
    const result = await providerHealthService.forceHealthCheck(providerId);

    if (!result.success) {
      return reply.code(500).send({
        error: "Health check failed",
        message: result.error
      });
    }

    return reply.send({
      ok: true,
      metrics: result.metrics
    });
  } catch (error) {
    console.error(`Failed to check health for provider ${providerId}:`, error);
    return reply.code(500).send({
      error: "Failed to perform health check",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/health/summary", async (request, reply) => {
  try {
    const summary = providerHealthService.getHealthSummary();
    return reply.send(summary);
  } catch (error) {
    console.error("Failed to fetch health summary:", error);
    return reply.code(500).send({
      error: "Failed to fetch health summary",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/health/record-request", async (request, reply) => {
  const body = request.body as any;

  if (!body.providerId || typeof body.providerId !== "string") {
    return reply.code(400).send({
      error: "Missing or invalid provider ID"
    });
  }

  if (typeof body.responseTime !== "number" || body.responseTime < 0) {
    return reply.code(400).send({
      error: "Missing or invalid response time"
    });
  }

  if (typeof body.isError !== "boolean") {
    return reply.code(400).send({
      error: "Missing or invalid error flag"
    });
  }

  try {
    providerHealthService.recordRequestResult(
      body.providerId,
      body.responseTime,
      body.isError
    );

    return reply.send({
      ok: true
    });
  } catch (error) {
    console.error("Failed to record request result:", error);
    return reply.code(500).send({
      error: "Failed to record request result",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Client Route Assignment API
app.get("/api/routing/client-routes", async (request, reply) => {
  try {
    const assignments = await routingComboRepository.getAllClientRouteAssignments();
    return reply.send({
      assignments
    });
  } catch (error) {
    console.error("Failed to fetch client route assignments:", error);
    return reply.code(500).send({
      error: "Failed to fetch client route assignments",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/routing/client-routes/:clientRoute", async (request, reply) => {
  const params = request.params as { clientRoute?: string };
  const clientRoute = typeof params.clientRoute === "string" ? params.clientRoute.trim() : "";

  if (!clientRoute) {
    return reply.code(400).send({
      error: "Missing client route"
    });
  }

  try {
    const comboId = await routingComboRepository.getClientRouteCombo(clientRoute);

    if (!comboId) {
      return reply.send({
        clientRoute,
        comboId: null,
        combo: null
      });
    }

    const combo = await routingComboRepository.getComboById(comboId);
    return reply.send({
      clientRoute,
      comboId,
      combo
    });
  } catch (error) {
    console.error(`Failed to fetch routing combo for client route ${clientRoute}:`, error);
    return reply.code(500).send({
      error: "Failed to fetch client route assignment",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/routing/client-routes/:clientRoute/assign", async (request, reply) => {
  const params = request.params as { clientRoute?: string };
  const clientRoute = typeof params.clientRoute === "string" ? params.clientRoute.trim() : "";
  const body = request.body as any;

  if (!clientRoute) {
    return reply.code(400).send({
      error: "Missing client route"
    });
  }

  if (!body.comboId || typeof body.comboId !== "string") {
    return reply.code(400).send({
      error: "Missing or invalid combo ID"
    });
  }

  try {
    await routingComboRepository.assignClientRouteCombo(clientRoute, body.comboId);

    return reply.send({
      ok: true,
      clientRoute,
      comboId: body.comboId
    });
  } catch (error) {
    console.error(`Failed to assign routing combo ${body.comboId} to client route ${clientRoute}:`, error);
    return reply.code(500).send({
      error: "Failed to assign routing combo",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.delete("/api/routing/client-routes/:clientRoute/assign", async (request, reply) => {
  const params = request.params as { clientRoute?: string };
  const clientRoute = typeof params.clientRoute === "string" ? params.clientRoute.trim() : "";

  if (!clientRoute) {
    return reply.code(400).send({
      error: "Missing client route"
    });
  }

  try {
    await routingComboRepository.unassignClientRouteCombo(clientRoute);

    return reply.send({
      ok: true,
      clientRoute
    });
  } catch (error) {
    console.error(`Failed to unassign routing combo from client route ${clientRoute}:`, error);
    return reply.code(500).send({
      error: "Failed to unassign routing combo",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/routing/combos/:comboId/client-routes", async (request, reply) => {
  const params = request.params as { comboId?: string };
  const comboId = typeof params.comboId === "string" ? params.comboId.trim() : "";

  if (!comboId) {
    return reply.code(400).send({
      error: "Missing combo ID"
    });
  }

  try {
    const clientRoutes = await routingComboRepository.getComboClientRoutes(comboId);

    return reply.send({
      comboId,
      clientRoutes
    });
  } catch (error) {
    console.error(`Failed to fetch client routes for combo ${comboId}:`, error);
    return reply.code(500).send({
      error: "Failed to fetch combo client routes",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

for (const routePath of dashboardEntryPaths) {
  app.get(routePath, async (_request, reply) => {
    return serveReactDashboard(reply);
  });
}

for (const [fileName, asset] of Object.entries(reactRootStaticAssets)) {
  app.get(`/${fileName}`, async (_request, reply) => {
    return sendFileResponse(reply, asset);
  });
}

app.get("/assets/*", async (request, reply) => {
  const params = request.params as { "*": string };
  return serveReactAsset(params["*"], reply);
});

app.get("/favicon.ico", async (_request, reply) => {
  const favicon = reactRootStaticAssets["favicon.svg"];
  return sendFileResponse(reply, favicon);
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
  const providers = providerRepository.listProviders().filter((provider) =>
    isOpenAiCodexOAuthProvider(provider) ||
    (provider.capabilities.usageCheckEnabled === true && Boolean(provider.capabilities.usageCheckUrl)),
  );
  const entries = (await Promise.all(
    providers.map((provider) => buildLiveProviderUsageEntry(provider, requestId, request.log)),
  )).filter((entry) => {
    if (entry.authMode !== "chatgpt_oauth") {
      return true;
    }

    return entry.ok === true && entry.usage !== null;
  });
  return reply.send({
    ok: true,
    timestamp: new Date().toISOString(),
    providers: entries,
  });
});

app.get("/v1/models", async (request, reply) => {
  const routingApiKey = readBearerToken(request.headers.authorization);
  const routingAccess = resolveCustomerRoutingAccess({
    routingApiKey,
    resolvedClientRoute: "default",
    providerRepository,
    customerKeyRepository,
    workspaceRepository: customerWorkspaceRepository,
    billingRepository,
  });
  if ("error" in routingAccess) {
    return reply.code(routingAccess.error.statusCode).send(routingAccess.error.body);
  }
  const providerHint = readRequestProviderHint(request.headers, undefined);

  // Use routing integration for enhanced provider selection
  const routingRequest: RoutingRequest = {
    clientRoute: "default", // /v1/models uses default client route
    providers: routingAccess.providers,
    providerHint,
    requestId: randomUUID(),
    startedAt: Date.now(),
    headers: request.headers,
    metadata: undefined
  };

  const routingResult = await resolveProviderWithRouting(routingRequest, routingIntegrationContext);

  if ("error" in routingResult) {
    return reply.code(routingResult.error.statusCode).send({
      error: routingResult.error,
    });
  }
  const selectedProvider = routingResult.provider;

  // Kiro provider speaks the Anthropic Messages API for Claude Code, which does a
  // preflight `GET /v1/models` to validate the configured model. Return an
  // Anthropic-format listing of the Kiro aliases + the date-suffixed Anthropic ids
  // Claude Code defaults to, rather than forwarding to the (OpenAI) upstream.
  if (selectedProvider.authMode === "kiro") {
    const aliasMap = selectedProvider.capabilities.modelAliases ?? {};
    const modelIds = [
      ...Object.keys(aliasMap),
      ...Object.values(aliasMap),
      // Well-known Anthropic model ids Claude Code may request by default.
      "claude-sonnet-4-20250514",
      "claude-sonnet-4-5-20250929",
      "claude-3-7-sonnet-20250219",
      "claude-3-5-haiku-20241022",
      "claude-haiku-4-5-20251001",
    ];
    return reply.send(buildAnthropicModelsList(modelIds));
  }

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
  const resolvedClientRoute = resolveClientRoute(request.headers, parsed.data, routingApiKey);
  const routingAccess = resolveCustomerRoutingAccess({
    routingApiKey,
    resolvedClientRoute,
    providerRepository,
    customerKeyRepository,
    workspaceRepository: customerWorkspaceRepository,
    billingRepository,
  });
  if ("error" in routingAccess) {
    reply.header("x-proxy-request-id", requestId);
    reply.header("x-proxy-error-code", routingAccess.error.body.error.code);
    reply.header("x-proxy-retryable", routingAccess.error.body.error.retryable ? "1" : "0");
    return reply.code(routingAccess.error.statusCode).send(routingAccess.error.body);
  }
  const clientRoute = routingAccess.clientRoute;
  const customerUsageAccess =
    routingAccess.kind === "customer"
      ? {
          kind: "customer" as const,
          workspace: { id: routingAccess.workspace.id },
          entitlement: { id: routingAccess.entitlement.id },
          customerKey: { id: routingAccess.customerKey.id },
        }
      : ({ kind: "operator" as const });
  const clientTokenLimitStatus = getClientTokenLimitStatus(
    providerRepository.getClientTokenLimit(clientRoute),
    providerRepository.getClientTokenUsage(clientRoute),
  );
  if (clientTokenLimitStatus.blocked) {
    const limitError = buildClientTokenLimitError(clientRoute, clientTokenLimitStatus);
    reply.header("x-proxy-request-id", requestId);
    reply.header("x-proxy-error-code", limitError.body.error.code);
    reply.header("x-proxy-retryable", "1");
    return reply.code(limitError.statusCode).send(limitError.body);
  }
  const providerHint = readRequestProviderHint(request.headers, parsed.data.metadata);

  // Use routing integration for enhanced provider selection
  const routingRequest: RoutingRequest = {
    clientRoute,
    providers: routingAccess.providers,
    providerHint,
    requestId,
    startedAt,
    headers: request.headers,
    metadata: parsed.data.metadata
  };

  const routingResult = await resolveProviderWithRouting(routingRequest, routingIntegrationContext);

  if ("error" in routingResult) {
    return reply.code(routingResult.error.statusCode).send({
      error: routingResult.error,
    });
  }

  const selectedProvider = routingResult.provider;

  // Add routing headers for debugging and monitoring
  reply.header("x-proxy-routing-method", routingResult.matchReason);
  if (routingResult.routingComboId) {
    reply.header("x-proxy-routing-combo", routingResult.routingComboId);
  }
  if (routingResult.tierName) {
    reply.header("x-proxy-routing-tier", routingResult.tierName);
  }
  if (routingResult.selectionTime !== undefined) {
    reply.header("x-proxy-routing-time-ms", routingResult.selectionTime.toString());
  }
  if (routingResult.fallbackCount !== undefined && routingResult.fallbackCount > 0) {
    reply.header("x-proxy-routing-fallbacks", routingResult.fallbackCount.toString());
  }
  if (selectedProvider.authMode === "kiro") {
    const kiroModelOverride = providerRepository.getModelOverride(clientRoute);
    return handleKiroResponsesRequest({
      reply,
      logger: request.log,
      requestId,
      startedAt,
      clientRoute,
      customerUsageAccess,
      provider: selectedProvider,
      requestBody: kiroModelOverride
        ? { ...parsed.data, model: kiroModelOverride }
        : (parsed.data as Record<string, unknown>),
    });
  }
  const currentModelOverride = providerRepository.getModelOverride(clientRoute);
  const clientRouteRtkPolicy = providerRepository.getClientRouteRtkPolicy(clientRoute);
  const maxOutputTokensRule = resolveMaxOutputTokensRule(selectedProvider.capabilities);
  const requestBody = currentModelOverride
    ? {
        ...parsed.data,
        model: currentModelOverride,
      }
    : parsed.data;
  const preserveRawRequestBody = selectedProvider.capabilities.preserveRawRequestBody === true;
  const resolvedRtkPolicy = preserveRawRequestBody
    ? {
        enabled: false,
        toolOutputEnabled: false,
      }
    : resolveRtkLayerPolicy(
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
  let effectiveRequestBody = rtkLayerResult.body as Record<string, unknown>;
  const modelRoutingDecision = resolveModelRouting(effectiveRequestBody, {
    enabled: config.MODEL_ROUTING_ENABLED ?? false,
    inputTokenThreshold: config.MODEL_ROUTING_INPUT_TOKEN_THRESHOLD,
    cheapModel: config.MODEL_ROUTING_CHEAP_MODEL ?? "gpt-4o-mini",
    skipIfTools: config.MODEL_ROUTING_SKIP_IF_TOOLS,
    skipIfImages: config.MODEL_ROUTING_SKIP_IF_IMAGES,
    skipIfReasoning: config.MODEL_ROUTING_SKIP_IF_REASONING,
  });
  if (modelRoutingDecision.downgraded) {
    effectiveRequestBody = {
      ...effectiveRequestBody,
      model: modelRoutingDecision.resolvedModel,
    };
    request.log.info(
      {
        requestId,
        clientRoute,
        originalModel: modelRoutingDecision.originalModel,
        resolvedModel: modelRoutingDecision.resolvedModel,
        reason: modelRoutingDecision.reason,
      },
      "model downgraded by routing policy",
    );
    reply.header("x-proxy-model-routing", modelRoutingDecision.resolvedModel);
  }
  const normalizedResult = preserveRawRequestBody
    ? { request: effectiveRequestBody, cacheLayout: {} }
    : normalizeResponsesRequestWithCache(effectiveRequestBody as Parameters<
        typeof normalizeResponsesRequestWithCache
      >[0], {
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
        promptCacheRetentionByStaticKeyEnabled:
          config.PROVIDER_PROMPT_CACHE_RETENTION_BY_STATIC_KEY_ENABLED,
        promptCacheRetentionByStaticKeyRules:
          config.PROVIDER_PROMPT_CACHE_RETENTION_BY_STATIC_KEY,
        defaultTruncation:
          maxOutputTokensRule.mode === "strip" ? undefined : config.OPENCLAW_DEFAULT_TRUNCATION,
        maxOutputTokensPolicy: maxOutputTokensRule,
        sanitizeReasoningSummary: selectedProvider.capabilities.sanitizeReasoningSummary,
        preserveMessagesPayload: selectedProvider.capabilities.preserveMessagesPayload === true,
      });
  const normalized = preserveRawRequestBody
    ? (effectiveRequestBody as Record<string, unknown>)
    : sanitizeNormalizedRequestForProvider(normalizedResult.request, selectedProvider);
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

  if (preserveRawRequestBody) {
    request.log.info(
      {
        requestId,
        providerId: activeProviderId,
        forwardMode: "transparent_raw",
        topLevelKeys: Object.keys(normalized).sort(),
      },
      "forwarding raw request body without proxy transforms",
    );
  }

  if (config.LOG_BODY) {
    request.log.debug({ requestId, normalized }, "normalized responses payload");
  }

  try {
    if (isStream) {
      let streamUsagePayload: unknown;
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
        onEvent: (entry) => {
          if (entry.event === "upstream_response_usage") {
            streamUsagePayload = entry.usage;
          }
          updateLatestPromptCacheObservationFromEntry(entry);
        },
      });
      const streamUsage = recordClientTokenUsageFromPayload(clientRoute, streamUsagePayload);
      if (streamUsage) {
        await sessionLog.write({
          event: "client_token_usage_incremented",
          requestId,
          clientRoute,
          mode: "sse",
          usage: streamUsage,
        });
      }
      recordCustomerUsageFromPayload({
        billingRepository,
        usagePayload: streamUsagePayload,
        access: customerUsageAccess,
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

      // Record successful streaming request for health monitoring
      recordRequestResult(
        routingIntegrationContext,
        selectedProvider.id,
        Date.now() - startedAt,
        false // not an error
      );

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

    if (config.RESPONSE_CACHE_ENABLED && traceContext.requestKey && !isStream) {
      const cachedPayload = responseCacheStore.get(String(traceContext.requestKey), activeProviderId);
      if (cachedPayload) {
        request.log.info(
          { requestId, requestKey: traceContext.requestKey },
          "response cache hit",
        );
        await sessionLog.write({
          event: "response_cache_hit",
          requestId,
          clientRoute,
          providerId: activeProviderId,
          ...traceContext,
        });
        reply.header("x-proxy-response-cache", "hit");
        reply.header("x-proxy-request-id", requestId);
        reply.header("x-proxy-provider-id", activeProviderId);
        reply.header("x-proxy-family-id", stringOrUndefined(traceContext.familyId) ?? "");
        reply.header("x-proxy-static-key", stringOrUndefined(traceContext.staticKey) ?? "");
        reply.header("x-proxy-request-key", stringOrUndefined(traceContext.requestKey) ?? "");
        reply.header("x-proxy-prompt-cache-key", stringOrUndefined(traceContext.promptCacheKey) ?? "");
        return reply.send(cachedPayload);
      }
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
        customerUsageAccess,
        body: normalized,
        logger: request.log,
        sessionLog,
      },
      dedupeEnabled,
    );
    if (
      config.RESPONSE_CACHE_ENABLED &&
      traceContext.requestKey &&
      !isStream &&
      upstreamStatus === 200 &&
      payload !== undefined
    ) {
      const payloadStr = JSON.stringify(payload);
      if (payloadStr.length <= config.RESPONSE_CACHE_MAX_PAYLOAD_BYTES) {
        responseCacheStore.set(
          String(traceContext.requestKey),
          activeProviderId,
          payload,
          config.RESPONSE_CACHE_TTL_MS,
        );
      }
    }
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

    // Record successful request for health monitoring
    recordRequestResult(
      routingIntegrationContext,
      selectedProvider.id,
      Date.now() - startedAt,
      false // not an error
    );

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

    // Record failed request for health monitoring
    recordRequestResult(
      routingIntegrationContext,
      selectedProvider.id,
      Date.now() - startedAt,
      true // is an error
    );

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

app.post("/v1/chat/completions", async (request, reply) =>
  handleResponsesRequest(request, reply, "/v1/chat/completions"),
);

app.post("/v1/completions", async (request, reply) =>
  handleResponsesRequest(request, reply, "/v1/completions"),
);

app.post("/v1/messages", async (request, reply) =>
  handleAnthropicMessagesRequest(request, reply, false),
);

app.post("/v1/messages/count_tokens", async (request, reply) =>
  handleAnthropicMessagesRequest(request, reply, true),
);

/**
 * Anthropic Messages API surface so Claude Code can use the Kiro/Claude models.
 * Reuses the routing-key model (accepts `Authorization: Bearer` or `x-api-key`),
 * requires the resolved provider to be a Kiro provider, and dispatches to the
 * Anthropic forward paths. `countOnly` serves `/v1/messages/count_tokens`.
 */
async function handleAnthropicMessagesRequest(
  request: { body: unknown; headers: Record<string, unknown>; log: FastifyBaseLogger },
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
  countOnly: boolean,
): Promise<unknown> {
  const requestId = randomUUID();
  const startedAt = Date.now();

  if (typeof request.body !== "object" || request.body === null) {
    reply.header("x-proxy-request-id", requestId);
    return reply
      .code(400)
      .send(buildAnthropicError("invalid_request_error", "Request body must be a JSON object"));
  }
  const body = request.body as Record<string, unknown>;
  if (!Array.isArray(body.messages)) {
    reply.header("x-proxy-request-id", requestId);
    return reply
      .code(400)
      .send(buildAnthropicError("invalid_request_error", "`messages` must be an array"));
  }

  // Auth: Claude Code sends Authorization: Bearer (ANTHROPIC_AUTH_TOKEN) or
  // x-api-key (ANTHROPIC_API_KEY). Resolve either against the routing-key model.
  const routingApiKey =
    readBearerToken(request.headers.authorization) ?? readHeaderString(request.headers["x-api-key"]);
  const resolvedClientRoute = resolveClientRoute(request.headers, body, routingApiKey);
  const routingAccess = resolveCustomerRoutingAccess({
    routingApiKey,
    resolvedClientRoute,
    providerRepository,
    customerKeyRepository,
    workspaceRepository: customerWorkspaceRepository,
    billingRepository,
  });
  if ("error" in routingAccess) {
    reply.header("x-proxy-request-id", requestId);
    return reply
      .code(routingAccess.error.statusCode)
      .send(buildAnthropicError("authentication_error", routingAccess.error.body.error.message));
  }
  const clientRoute = routingAccess.clientRoute;
  const customerUsageAccess =
    routingAccess.kind === "customer"
      ? {
          kind: "customer" as const,
          workspace: { id: routingAccess.workspace.id },
          entitlement: { id: routingAccess.entitlement.id },
          customerKey: { id: routingAccess.customerKey.id },
        }
      : { kind: "operator" as const };

  const providerHint = readRequestProviderHint(request.headers, undefined);

  // Use routing integration for enhanced provider selection
  const routingRequest: RoutingRequest = {
    clientRoute,
    providers: routingAccess.providers,
    providerHint,
    requestId,
    startedAt,
    headers: request.headers,
    metadata: undefined
  };

  const routingResult = await resolveProviderWithRouting(routingRequest, routingIntegrationContext);

  if ("error" in routingResult) {
    reply.header("x-proxy-request-id", requestId);
    return reply
      .code(routingResult.error.statusCode)
      .send(buildAnthropicError("authentication_error", routingResult.error.message));
  }
  const provider = routingResult.provider;
  if (provider.authMode !== "kiro") {
    reply.header("x-proxy-request-id", requestId);
    return reply
      .code(400)
      .send(
        buildAnthropicError(
          "invalid_request_error",
          "The /v1/messages endpoint is only available for the Kiro provider.",
        ),
      );
  }

  const modelOverride = providerRepository.getModelOverride(clientRoute);
  const parsed = parseAnthropicRequest(modelOverride ? { ...body, model: modelOverride } : body);

  if (countOnly) {
    reply.header("x-proxy-request-id", requestId);
    return reply.send(buildCountTokensResponse(parsed.inputText));
  }

  if (!kiroTokenStore) {
    reply.header("x-proxy-request-id", requestId);
    return reply
      .code(503)
      .send(
        buildAnthropicError(
          "api_error",
          "Kiro provider is not available. Set KIRO_ENABLED=true and point KIRO_DB_PATH at a 9router database.",
        ),
      );
  }

  const isStream = parsed.stream;
  try {
    if (isStream) {
      reply.hijack();
      const usage = await forwardKiroAnthropicSse({
        store: kiroTokenStore,
        provider,
        config,
        requestId,
        parsed,
        logger: request.log,
        responseRaw: reply.raw,
      });
      recordClientTokenUsageFromPayload(clientRoute, usage);
      recordCustomerUsageFromPayload({
        billingRepository,
        usagePayload: usage,
        access: customerUsageAccess,
      });
      request.log.info(
        { requestId, clientRoute, provider: provider.id, totalMs: Date.now() - startedAt },
        "kiro anthropic messages stream completed",
      );
      return reply;
    }

    const { payload, usage } = await forwardKiroAnthropicJson({
      store: kiroTokenStore,
      provider,
      config,
      requestId,
      parsed,
      logger: request.log,
    });
    recordClientTokenUsageFromPayload(clientRoute, usage);
    recordCustomerUsageFromPayload({
      billingRepository,
      usagePayload: usage,
      access: customerUsageAccess,
    });
    request.log.info(
      { requestId, clientRoute, provider: provider.id, totalMs: Date.now() - startedAt },
      "kiro anthropic messages JSON completed",
    );
    reply.header("x-proxy-request-id", requestId);
    reply.header("x-proxy-provider-id", provider.id);
    reply.header("x-proxy-upstream-target", provider.id);
    return reply.send(payload);
  } catch (error) {
    const statusCode =
      error instanceof KiroAuthError
        ? error.statusCode
        : error instanceof KiroUpstreamError
          ? error.statusCode
          : 502;
    const errorType =
      statusCode === 401 || statusCode === 403
        ? "authentication_error"
        : statusCode >= 500
          ? "api_error"
          : "invalid_request_error";
    const message = error instanceof Error ? error.message : "Unknown Kiro proxy error";
    request.log.error(
      { err: error, requestId, clientRoute, provider: provider.id, totalMs: Date.now() - startedAt },
      "kiro anthropic messages request failed",
    );

    if (isStream) {
      // Headers may already be sent; emit an Anthropic SSE error frame then end.
      const raw = reply.raw as NodeJS.WritableStream & {
        headersSent?: boolean;
        writableEnded?: boolean;
        setHeader(name: string, value: string): void;
      };
      if (!raw.writableEnded) {
        if (!raw.headersSent) {
          raw.setHeader("Content-Type", "text/event-stream");
          raw.setHeader("Cache-Control", "no-cache, no-transform");
        }
        raw.write(
          `event: error\ndata: ${JSON.stringify(buildAnthropicError(errorType, message))}\n\n`,
        );
        raw.end();
      }
      return reply;
    }

    reply.header("x-proxy-request-id", requestId);
    return reply.code(statusCode).send(buildAnthropicError(errorType, message));
  }
}

/**
 * Serves a `/v1/responses` request through a Kiro (AWS CodeWhisperer) account from
 * 9router. Translation between the Responses format and CodeWhisperer lives in
 * kiro-forward.ts; this handler owns dispatch, usage accounting, and error shaping.
 */
async function handleKiroResponsesRequest(args: {
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
  };
  logger: FastifyBaseLogger;
  requestId: string;
  startedAt: number;
  clientRoute: ClientRouteKey;
  customerUsageAccess:
    | {
        kind: "customer";
        workspace: { id: string };
        entitlement: { id: string };
        customerKey: { id: string };
      }
    | { kind: "operator" };
  provider: RuntimeProviderPreset;
  requestBody: Record<string, unknown>;
}): Promise<unknown> {
  const { reply, requestId, provider, requestBody } = args;
  const isStream = requestBody.stream === true;

  if (!kiroTokenStore) {
    const message =
      "Kiro provider is not available. Set KIRO_ENABLED=true and point KIRO_DB_PATH at a 9router database.";
    reply.header("x-proxy-request-id", requestId);
    reply.header("x-proxy-error-code", "KIRO_PROVIDER_UNAVAILABLE");
    reply.header("x-proxy-retryable", "0");
    return reply.code(503).send({
      error: { type: "proxy_error", code: "KIRO_PROVIDER_UNAVAILABLE", message },
    });
  }

  try {
    if (isStream) {
      reply.hijack();
      const usage = await forwardKiroSse({
        store: kiroTokenStore,
        provider,
        config,
        requestId,
        body: requestBody,
        logger: args.logger,
        responseRaw: reply.raw,
      });
      recordClientTokenUsageFromPayload(args.clientRoute, usage);
      recordCustomerUsageFromPayload({
        billingRepository,
        usagePayload: usage,
        access: args.customerUsageAccess,
      });
      args.logger.info(
        {
          requestId,
          clientRoute: args.clientRoute,
          provider: provider.id,
          totalMs: Date.now() - args.startedAt,
        },
        "kiro responses proxy stream request completed",
      );
      return reply;
    }

    const { payload, usage } = await forwardKiroJson({
      store: kiroTokenStore,
      provider,
      config,
      requestId,
      body: requestBody,
      logger: args.logger,
    });
    recordClientTokenUsageFromPayload(args.clientRoute, usage);
    recordCustomerUsageFromPayload({
      billingRepository,
      usagePayload: usage,
      access: args.customerUsageAccess,
    });
    args.logger.info(
      {
        requestId,
        clientRoute: args.clientRoute,
        provider: provider.id,
        totalMs: Date.now() - args.startedAt,
      },
      "kiro responses proxy JSON request completed",
    );
    reply.header("x-proxy-request-id", requestId);
    reply.header("x-proxy-provider-id", provider.id);
    reply.header("x-proxy-upstream-target", provider.id);
    return reply.send(payload);
  } catch (error) {
    const statusCode =
      error instanceof KiroAuthError
        ? error.statusCode
        : error instanceof KiroUpstreamError
          ? error.statusCode
          : typeof error === "object" && error !== null && "statusCode" in error
            ? Number((error as { statusCode?: number }).statusCode) || 502
            : 502;
    const upstreamBody = error instanceof KiroUpstreamError ? error.body : undefined;
    const defaultCode =
      error instanceof KiroAuthError
        ? error.body.code
        : statusCode >= 500
          ? "UPSTREAM_REQUEST_FAILED"
          : "UPSTREAM_BAD_REQUEST";
    args.logger.error(
      {
        err: error,
        requestId,
        clientRoute: args.clientRoute,
        provider: provider.id,
        totalMs: Date.now() - args.startedAt,
      },
      "kiro responses proxy request failed",
    );

    if (isStream) {
      sendHijackedStreamError(reply.raw, {
        statusCode,
        message: error instanceof Error ? error.message : "Unknown Kiro proxy error",
        requestId,
        upstreamBody,
        defaultCode,
        providerErrorPolicy: provider.capabilities.errorPolicy,
      });
      return reply;
    }

    const resolvedError = resolveProxyError({
      statusCode,
      message: error instanceof Error ? error.message : "Unknown Kiro proxy error",
      requestId,
      upstreamBody,
      defaultCode,
      errorType: "proxy_error",
      providerErrorPolicy: provider.capabilities.errorPolicy,
    });
    reply.header("x-proxy-request-id", requestId);
    reply.header("x-proxy-error-code", resolvedError.errorCode);
    reply.header("x-proxy-retryable", resolvedError.retryable ? "1" : "0");
    return reply.code(statusCode).send(resolvedError.envelope);
  }
}


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

function resolveDashboardAssetContentType(fileName: string): string {
  if (fileName.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (fileName.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  if (fileName.endsWith(".js")) {
    return "application/javascript; charset=utf-8";
  }
  if (fileName.endsWith(".svg")) {
    return "image/svg+xml; charset=utf-8";
  }
  if (fileName.endsWith(".ico")) {
    return "image/x-icon";
  }
  if (fileName.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  if (fileName.endsWith(".map")) {
    return "application/json; charset=utf-8";
  }
  if (fileName.endsWith(".png")) {
    return "image/png";
  }
  if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (fileName.endsWith(".webp")) {
    return "image/webp";
  }
  if (fileName.endsWith(".woff2")) {
    return "font/woff2";
  }
  if (fileName.endsWith(".woff")) {
    return "font/woff";
  }
  return "application/octet-stream";
}

function isPathInsideDirectory(candidatePath: string, directoryPath: string): boolean {
  return (
    candidatePath === directoryPath || candidatePath.startsWith(`${directoryPath}${path.sep}`)
  );
}

function readTextFileSafe(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function readBufferFileSafe(filePath: string): Buffer | undefined {
  try {
    return readFileSync(filePath);
  } catch {
    return undefined;
  }
}

function loadReactRootStaticAssets() {
  return Object.fromEntries(
    reactRootStaticAssetFiles.map((fileName) => {
      const body = readBufferFileSafe(path.join(reactClientDir, fileName));
      if (!body) {
        throw new Error(`React root asset is missing: dist/client/${fileName}. Run npm run build before starting the server.`);
      }
      return [
        fileName,
        {
          body,
          contentType: resolveDashboardAssetContentType(fileName),
        },
      ] as const;
    }),
  ) as Record<(typeof reactRootStaticAssetFiles)[number], { body: Buffer; contentType: string }>;
}


function isDashboardProtectedPath(url: string): boolean {
  const pathname = url.split("?", 1)[0] || "/";
  if (!pathname.startsWith("/api/")) {
    return false;
  }
  if (pathname.startsWith("/api/dashboard-auth/")) {
    return false;
  }
  if (pathname === "/api/sepay/webhook") {
    return false;
  }
  if (pathname === "/api/customer/codex/setup.sh") {
    return false;
  }
  return true;
}

function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }
  const prefix = `${name}=`;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return undefined;
}

function serializeCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds: number },
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${options.maxAgeSeconds}`,
  ].join("; ");
}

async function sendTelegramDashboardOtp(input: {
  botToken: string;
  telegramUserId: string;
  otp: string;
  expiresAt: string;
}): Promise<void> {
  if (input.botToken.startsWith("test-")) {
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${input.botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: input.telegramUserId,
      text: [
        "Responses Proxy dashboard login",
        `OTP: ${input.otp}`,
        `Expires: ${input.expiresAt}`,
        "If you did not request this, ignore this message.",
      ].join("\n"),
    }),
  });

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed: ${response.status}`);
  }
}

async function sendTelegramDashboardApprovalRequest(input: {
  botToken: string;
  telegramUserId: string;
  challengeId: string;
  displayCode: string;
  expiresAt: string;
}): Promise<void> {
  if (input.botToken.startsWith("test-")) {
    return;
  }

  const choices = buildDashboardApprovalChoices(input.displayCode);
  const response = await fetch(`https://api.telegram.org/bot${input.botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: input.telegramUserId,
      text: [
        "Responses Proxy dashboard approval",
        `Pick code: ${input.displayCode}`,
        `Expires: ${input.expiresAt}`,
        "Choose matching number to approve login.",
      ].join("\n"),
      reply_markup: {
        inline_keyboard: [
          choices.map((choice) => ({
            text: choice,
            callback_data: `v1:dashauth:${input.challengeId}:${choice}`,
          })),
        ],
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed: ${response.status}`);
  }
}

function buildDashboardApprovalChoices(displayCode: string): string[] {
  const choices = new Set<string>([displayCode]);
  while (choices.size < 4) {
    choices.add(randomInt(10, 100).toString().padStart(2, "0"));
  }
  return Array.from(choices).sort(() => Math.random() - 0.5);
}


function loadReactDashboardAssets() {
  const indexPath = path.join(reactClientDir, "index.html");
  const indexHtml = readTextFileSafe(indexPath);
  if (!indexHtml) {
    throw new Error(
      "React dashboard build is missing at dist/client/index.html. Run `npm run build` before starting the server.",
    );
  }
  return {
    indexHtml,
  };
}

const CACHE_CONTROL_NO_CACHE = "no-cache";
const CACHE_CONTROL_IMMUTABLE = "public, max-age=31536000, immutable";

function sendFileResponse(
  reply: {
    header(name: string, value: string): unknown;
    type(contentType: string): { send(payload: Buffer | string): unknown };
  },
  asset: { body: Buffer | string; contentType: string },
  cacheControl: string = CACHE_CONTROL_NO_CACHE,
) {
  reply.header("Cache-Control", cacheControl);
  return reply.type(asset.contentType).send(asset.body);
}

function serveReactDashboard(
  reply: {
    header(name: string, value: string): unknown;
    type(contentType: string): { send(payload: Buffer | string): unknown };
  },
) {
  if (!reactDashboard) {
    throw new Error("React dashboard assets were not loaded");
  }
  reply.header("Cache-Control", CACHE_CONTROL_NO_CACHE);
  return reply.type("text/html; charset=utf-8").send(reactDashboard.indexHtml);
}

async function serveReactAsset(
  assetPath: string,
  reply: {
    code(statusCode: number): { send(payload: Record<string, unknown>): unknown };
    header(name: string, value: string): unknown;
    type(contentType: string): { send(payload: Buffer | string): unknown };
  },
) {
  const normalizedPath = assetPath.replace(/^\/+/, "");
  const fullPath = path.resolve(reactClientDir, "assets", normalizedPath);
  const assetsDir = path.resolve(reactClientDir, "assets");

  if (!isPathInsideDirectory(fullPath, assetsDir)) {
    return reply.code(404).send({
      error: {
        type: "not_found",
        code: "ASSET_NOT_FOUND",
        message: "Asset was not found",
      },
    });
  }

  try {
    const body = await readFile(fullPath);
    reply.header("Cache-Control", CACHE_CONTROL_IMMUTABLE);
    return reply.type(resolveDashboardAssetContentType(fullPath)).send(body);
  } catch {
    return reply.code(404).send({
      error: {
        type: "not_found",
        code: "ASSET_NOT_FOUND",
        message: "Asset was not found",
      },
    });
  }
}

function logDashboardMode() {
  app.log.info(
    `Dashboard UI: react (serving ${reactClientDir})`,
  );
}

function readBearerToken(value: unknown): string | undefined {
  const header = readHeaderString(value);
  if (!header) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || undefined;
}

function resolveHttpRateLimitPolicy(
  url: string,
  authorizationHeader: unknown,
): { scope: string; maxRequests: number } | undefined {
  const pathname = url.split("?", 1)[0] || "/";
  if (
    pathname === "/v1/responses" ||
    pathname === "/v1/chat/completions" ||
    pathname === "/v1/completions" ||
    pathname.startsWith("/v1/messages")
  ) {
    return {
      scope: "responses",
      maxRequests: readBearerToken(authorizationHeader)
        ? config.HTTP_RATE_LIMIT_RESPONSES_MAX_REQUESTS
        : config.HTTP_RATE_LIMIT_UNAUTHENTICATED_MAX_REQUESTS,
    };
  }
  if (pathname.startsWith("/api/dashboard-auth/")) {
    return {
      scope: "dashboard-auth",
      maxRequests: config.HTTP_RATE_LIMIT_AUTH_MAX_REQUESTS,
    };
  }
  if (pathname === "/api/sepay/webhook") {
    return {
      scope: "sepay-webhook",
      maxRequests: config.HTTP_RATE_LIMIT_WEBHOOK_MAX_REQUESTS,
    };
  }
  if (pathname === "/health") {
    return {
      scope: "health",
      maxRequests: config.HTTP_RATE_LIMIT_HEALTH_MAX_REQUESTS,
    };
  }
  return undefined;
}

function buildHttpRateLimitIdentifier(
  authorizationHeader: unknown,
  fallbackIp?: string,
): string {
  const bearerToken = readBearerToken(authorizationHeader);
  if (bearerToken) {
    return `bearer:${hashRateLimitValue(bearerToken)}`;
  }

  return `ip:${hashRateLimitValue(normalizeIpAddress(fallbackIp ?? "unknown"))}`;
}

function hashRateLimitValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function isAllowedWebhookIp(callerIp: string, allowedIps: string[]): boolean {
  const normalizedCallerIp = normalizeIpAddress(callerIp);
  return allowedIps.some((allowedIp) => {
    const normalizedAllowedIp = normalizeIpAddress(allowedIp);
    if (normalizedAllowedIp.includes("/")) {
      return isIpv4InCidr(normalizedCallerIp, normalizedAllowedIp);
    }
    return normalizedCallerIp === normalizedAllowedIp;
  });
}

function isIpv4InCidr(candidateIp: string, cidr: string): boolean {
  const [baseIp, prefixText] = cidr.split("/", 2);
  if (isIP(candidateIp) !== 4 || isIP(baseIp) !== 4) {
    return false;
  }

  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  const candidateValue = ipv4ToNumber(candidateIp);
  const baseValue = ipv4ToNumber(baseIp);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (candidateValue & mask) === (baseValue & mask);
}

function ipv4ToNumber(value: string): number {
  return value.split(".").reduce((accumulator, octet) => {
    const parsed = Number(octet);
    return ((accumulator << 8) >>> 0) + parsed;
  }, 0);
}

function normalizeIpAddress(value: string): string {
  return value.startsWith("::ffff:") ? value.slice("::ffff:".length) : value;
}

function isOperatorRequest(request: { headers: Record<string, unknown> }): boolean {
  const sessionToken = readCookie(readHeaderString(request.headers.cookie), DASHBOARD_SESSION_COOKIE);
  if (dashboardAuthRepository.getSessionByToken(sessionToken)) {
    return true;
  }

  const routingApiKey = readBearerToken(request.headers.authorization);
  return Boolean(
    config.RESPONSES_PROXY_CLIENT_API_KEY &&
      routingApiKey === config.RESPONSES_PROXY_CLIENT_API_KEY,
  );
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
    const fallbackProvider = getFallbackProviderPreset(args.clientRoute, activeProvider.id);
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
  const transportMode = provider.capabilities.transportMode ?? "responses";
  const transportUrl =
    transportMode === "chat_completions"
      ? `${provider.baseUrl.replace(/\/+$/, "")}/chat/completions`
      : provider.responsesUrl;
  if (provider.authMode === "chatgpt_oauth") {
    const accessToken = await resolveChatGptAccessToken({
      provider,
      store: chatGptOAuthStore,
      config,
      rotationMode: chatGptOAuthStore.getRotationMode(),
    });
    return {
      name: provider.id,
      url: transportUrl,
      headers: {
        ...buildChatGptCodexHeaders(),
        Authorization: `Bearer ${accessToken}`,
      },
    };
  }

  return {
    name: provider.id,
    url: transportUrl,
    apiKey: getDefaultProviderApiKey(provider),
  };
}

async function forwardJsonWithFallback(args: {
  requestId: string;
  clientRoute: ClientRouteKey;
  providerId?: string;
  routingApiKey?: string;
  customerUsageAccess:
    | {
        kind: "customer";
        workspace: { id: string };
        entitlement: { id: string };
        customerKey: { id: string };
      }
    | { kind: "operator" };
  body: Record<string, unknown>;
  logger: FastifyBaseLogger;
  sessionLog: ReturnType<typeof createSessionLogContext>;
}): Promise<{ upstream: Response; target: ForwardTarget }> {
  const primaryTarget = await resolveForwardTarget(args);
  const disableFallback =
    providerRepository.getProvider(primaryTarget.name)?.capabilities.preserveRawRequestBody === true;
  const fallbackProvider = getFallbackProviderPreset(args.clientRoute, primaryTarget.name);
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

    if (disableFallback || !shouldFallbackFromStatus(primaryResponse.status) || !fallbackProvider) {
      throw await buildUpstreamError(args.requestId, primaryResponse);
    }

    const primaryError = await buildUpstreamError(args.requestId, primaryResponse);
    await logFallbackAttempt(args, "response", primaryError, primaryResponse.status);
  } else {
    if (disableFallback || !shouldFallbackFromError(primaryResponse) || !fallbackProvider) {
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
    customerUsageAccess:
      | {
          kind: "customer";
          workspace: { id: string };
          entitlement: { id: string };
          customerKey: { id: string };
        }
      | { kind: "operator" };
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
    const payload = await upstream.json();
    if (upstream.ok) {
      const usage = recordClientTokenUsageFromPayload(args.clientRoute, payload);
      if (usage) {
        await args.sessionLog.write({
          event: "client_token_usage_incremented",
          requestId: args.requestId,
          clientRoute: args.clientRoute,
          mode: "json",
          usage,
        });
      }
      recordCustomerUsageFromPayload({
        billingRepository,
        usagePayload: payload,
        access: args.customerUsageAccess,
      });
    }
    return {
      payload,
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
  const fallbackProvider = getFallbackProviderPreset(args.clientRoute);
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
  const disableFallback =
    providerRepository.getProvider(primaryTarget.name)?.capabilities.preserveRawRequestBody === true;
  const fallbackProvider = getFallbackProviderPreset(args.clientRoute, primaryTarget.name);
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
      disableFallback ||
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

function getFallbackProviderPreset(
  client: ClientRouteKey = "default",
  primaryProviderId?: string,
): RuntimeProviderPreset | undefined {
  if (!config.FALLBACK_ENABLED) {
    return undefined;
  }
  return providerRepository.getFallbackProvider(client, primaryProviderId);
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

function resolveChatGptCodexResponsesUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  return `${normalizedBaseUrl}/responses`;
}

function sanitizeNormalizedRequestForProvider(
  request: Record<string, unknown>,
  provider: RuntimeProviderPreset,
): Record<string, unknown> {
  if (provider.capabilities.accountPlatform !== "openai_codex") {
    return request;
  }
  const sanitized = { ...request };
  delete sanitized.prompt_cache_key;
  delete sanitized.prompt_cache_retention;
  return sanitized;
}

function ensureChatGptOAuthProvider(): RuntimeProviderPreset {
  const expectedResponsesUrl = resolveChatGptCodexResponsesUrl(config.CHATGPT_CODEX_BASE_URL);
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
      existing.capabilities.usageCheckUrl === OPENAI_ORGANIZATION_USAGE_COMPLETIONS_URL &&
      existing.responsesUrl === expectedResponsesUrl
    ) {
      return existing;
    }
    return providerRepository.updateProvider(existing.id, {
      name:
        !existing.name || existing.name === "ChatGPT OAuth"
          ? "OpenAI / Codex Account Pool"
          : existing.name,
      baseUrl: existing.baseUrl,
      responsesUrl: resolveChatGptCodexResponsesUrl(existing.baseUrl),
      authMode: "chatgpt_oauth",
      providerApiKeys: existing.providerApiKeys,
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
      responsesUrl: expectedResponsesUrl,
      authMode: "chatgpt_oauth",
      providerApiKeys: [],
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
    responsesUrl: expectedResponsesUrl,
    authMode: "chatgpt_oauth",
    providerApiKeys: [],
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
  const routeApiKey = providerRepository.getClientRouteApiKeys(client)[0] || "";
  const access = getQuickApplyAccess(client);
  const raw = readQuickConfigFile(pathToRead);
  const status = readQuickApplyStatus(
    raw,
    {
      client,
      proxyBaseUrl,
      routeApiKey,
      model: providerRepository.getModelOverride(client),
    },
    pathToRead,
  );

  return {
    ...status,
    runtime: quickApplyRuntime,
    access,
    backups: listRecentConfigBackups(pathToRead, 1, {
      backupDir: quickApplyPaths.backupDir,
    }),
    ...(client === "codex"
      ? {
          auth: readCodexAuthStatus(
            readQuickConfigFile(quickApplyPaths.codexAuthPath),
            routeApiKey,
            quickApplyPaths.codexAuthPath,
            {
              backupDir: quickApplyPaths.backupDir,
            },
          ),
        }
      : {}),
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

function buildClientTokenLimitResponse(entry: ClientTokenLimitView): Record<string, unknown> {
  return {
    clientRoute: entry.clientRoute,
    config: entry.config,
    usage: entry.usage,
    status: getClientTokenLimitStatus(entry.config, entry.usage),
  };
}

function recordClientTokenUsageFromPayload(
  client: ClientRouteKey,
  usagePayload: unknown,
): ReturnType<RuntimeProviderRepository["incrementClientTokenUsage"]> | undefined {
  const usage = extractUsageTotals(usagePayload);
  if (!usage) {
    return undefined;
  }
  return providerRepository.incrementClientTokenUsage(client, usage);
}

function validateClientTokenLimitRoute(
  rawClient: unknown,
  reply: {
    code(statusCode: number): { send(payload: Record<string, unknown>): unknown };
  },
): ClientRouteKey | undefined {
  if (typeof rawClient !== "string" || !rawClient.trim()) {
    reply.code(400).send({
      error: {
        type: "validation_error",
        code: "INVALID_CLIENT",
        message: "client is required",
      },
    });
    return undefined;
  }

  const client = normalizeClientRouteKey(rawClient);
  if (!providerRepository.getClientRoutesForUi().some((entry) => entry.key === client)) {
    reply.code(404).send({
      error: {
        type: "validation_error",
        code: "CLIENT_ROUTE_NOT_FOUND",
        message: "client must match one of the configured client routes",
      },
    });
    return undefined;
  }

  return client;
}

function parseClientTokenLimitInput(input: unknown):
  | {
      value: {
        enabled: boolean;
        tokenLimit: number;
        windowType: ClientTokenWindowType;
        windowSizeSeconds?: number;
        hardBlock: boolean;
      };
    }
  | { error: { code: string; message: string } } {
  const body = isRecord(input) ? input : {};
  const enabled = body.enabled;
  if (typeof enabled !== "boolean") {
    return {
      error: {
        code: "INVALID_CLIENT_TOKEN_LIMIT_ENABLED",
        message: "enabled must be a boolean",
      },
    };
  }

  const tokenLimit = readPositiveInteger(body.tokenLimit) ?? 1;
  if (enabled && readPositiveInteger(body.tokenLimit) === undefined) {
    return {
      error: {
        code: "INVALID_CLIENT_TOKEN_LIMIT",
        message: "tokenLimit must be a positive integer",
      },
    };
  }

  const windowType = parseClientTokenWindowType(body.windowType);
  if (!windowType) {
    return {
      error: {
        code: "INVALID_CLIENT_TOKEN_WINDOW_TYPE",
        message: "windowType must be one of daily, weekly, monthly, or fixed",
      },
    };
  }

  const hardBlock = body.hardBlock;
  if (typeof hardBlock !== "boolean") {
    return {
      error: {
        code: "INVALID_CLIENT_TOKEN_HARD_BLOCK",
        message: "hardBlock must be a boolean",
      },
    };
  }

  if (windowType !== "fixed") {
    return {
      value: {
        enabled,
        tokenLimit,
        windowType,
        hardBlock,
      },
    };
  }

  const windowSizeSeconds = readPositiveInteger(body.windowSizeSeconds) ?? 86400;
  if (enabled && readPositiveInteger(body.windowSizeSeconds) === undefined) {
    return {
      error: {
        code: "INVALID_CLIENT_TOKEN_WINDOW_SIZE",
        message: "windowSizeSeconds must be a positive integer when windowType is fixed",
      },
    };
  }

  return {
    value: {
      enabled,
      tokenLimit,
      windowType,
      windowSizeSeconds,
      hardBlock,
    },
  };
}

function parseClientTokenWindowType(value: unknown): ClientTokenWindowType | undefined {
  switch (value) {
    case "daily":
    case "weekly":
    case "monthly":
    case "fixed":
      return value;
    default:
      return undefined;
  }
}

function readPositiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  logDashboardMode();

  // Initialize WebSocket support for health monitoring
  try {
    await healthWebSocketManager.initialize(app);
    console.log('Health WebSocket manager initialized');
  } catch (error) {
    console.error('Failed to initialize health WebSocket manager:', error);
  }

  // Start provider health monitoring
  try {
    providerHealthService.startHealthMonitoring();
    console.log('Provider health monitoring started');
  } catch (error) {
    console.error('Failed to start provider health monitoring:', error);
  }

  await app.listen({
    host: config.HOST,
    port: config.PORT,
  });

  console.log(`Server started on ${config.HOST}:${config.PORT}`);
  console.log(`Health monitoring active for ${providerRepository.listProviders().length} providers`);
}

if (process.env.RESPONSES_PROXY_DISABLE_LISTEN !== "true") {
  main().catch((error) => {
    app.log.error(error, "failed to start responses proxy");
    process.exit(1);
  });
}

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');

  try {
    // Stop health monitoring
    providerHealthService.stopHealthMonitoring();
    console.log('Provider health monitoring stopped');

    // Shutdown WebSocket manager
    healthWebSocketManager.shutdown();
    console.log('Health WebSocket manager shutdown');

    // Close Fastify server
    await app.close();
    console.log('Server closed');

    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');

  try {
    // Stop health monitoring
    providerHealthService.stopHealthMonitoring();
    console.log('Provider health monitoring stopped');

    // Shutdown WebSocket manager
    healthWebSocketManager.shutdown();
    console.log('Health WebSocket manager shutdown');

    // Close Fastify server
    await app.close();
    console.log('Server closed');

    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});
