import Fastify from "fastify";
import type { FastifyBaseLogger } from "fastify";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { readConfig } from "./config.js";
import { buildUpstreamError, forwardJson, forwardSse } from "./forward.js";
import {
  KRouterUsageLimitError,
  ensureKRouterUsageAvailable,
  fetchKRouterUsage,
} from "./krouter-usage.js";
import { normalizeResponsesRequest } from "./normalize-request.js";
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

const config = readConfig(process.env);

type PromptCacheObservation = {
  requestId: string;
  providerId?: string;
  clientRoute?: ClientRouteKey;
  model?: string;
  promptCacheKey?: string;
  promptCacheRetention?: string;
  upstreamTarget?: string;
  truncation?: string;
  reasoningEffort?: string;
  reasoningSummary?: string;
  textVerbosity?: string;
  cachedTokens?: number;
  cacheSavedPercent?: number;
  cacheHit?: boolean;
  consecutiveCacheHits?: number;
  stream: boolean;
  timestamp: string;
};

const providerRepository = await RuntimeProviderRepository.create({
  dbFile: path.resolve(config.APP_DB_PATH),
  legacyStateFile: path.resolve(config.SESSION_LOG_DIR, "..", "runtime-state.json"),
  baseProviders: buildBuiltinProviderPresets(config),
});
const publicDir = path.resolve(process.cwd(), "public");
const publicAssets = {
  indexHtml: readFileSync(path.join(publicDir, "index.html"), "utf8"),
  appCss: readFileSync(path.join(publicDir, "app.css"), "utf8"),
  appJs: readFileSync(path.join(publicDir, "app.js"), "utf8"),
};
let latestPromptCacheObservation: PromptCacheObservation | undefined;
const latestPromptCacheObservationByProvider = new Map<string, PromptCacheObservation>();
const DATE_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
  },
  requestTimeout: config.REQUEST_TIMEOUT_MS,
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

app.get("/api/providers", async () => ({
  ok: true,
  activeProviderId: providerRepository.getActiveProviderId(),
  clientRoutes: providerRepository.getClientRoutesForUi(),
  providers: providerRepository.listProvidersForUi(),
}));

app.post("/api/provider-routes", async (request, reply) => {
  const body = request.body as { client?: unknown; providerId?: unknown } | undefined;
  if (typeof body?.client !== "string" || !body.client.trim()) {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "INVALID_CLIENT_ROUTE",
        message: "client route is required",
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
  const body = request.body as { client?: unknown; providerId?: unknown } | undefined;
  if (typeof body?.client !== "string" || !body.client.trim()) {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "INVALID_CLIENT_ROUTE",
        message: "client route is required",
      },
    });
  }

  try {
    const client = normalizeClientRouteKey(body.client);
    const resolvedProviderId = providerRepository.addClientRoute(
      client,
      typeof body?.providerId === "string" ? body.providerId : undefined,
    );
    return reply.code(201).send({
      ok: true,
      client,
      clientRoutes: providerRepository.getClientRoutesForUi(),
      provider: providerRepository.getProviderForUiOrThrow(resolvedProviderId),
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

app.get("/app.css", async (_request, reply) => {
  reply.type("text/css; charset=utf-8").send(publicAssets.appCss);
});

app.get("/app.js", async (_request, reply) => {
  reply.type("application/javascript; charset=utf-8").send(publicAssets.appJs);
});

app.post("/api/krouter/check-token", async (request, reply) => {
  const requestId = randomUUID();
  const body = request.body as { apiKey?: unknown } | undefined;
  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";

  if (!apiKey) {
    return reply.code(400).send({
      error: {
        type: "validation_error",
        code: "MISSING_API_KEY",
        message: "apiKey is required",
      },
    });
  }

  const usage = await fetchKRouterUsage({
    apiKey,
    requestId,
    logger: request.log,
    timeoutMs: config.REQUEST_TIMEOUT_MS,
    url: config.KROUTER_USAGE_CHECK_URL,
  });

  if (!usage) {
    return reply.code(502).send({
      error: {
        type: "proxy_error",
        code: "KROUTER_USAGE_CHECK_FAILED",
        message: "Could not fetch token usage from KRouter",
      },
    });
  }

  const isExhausted =
    usage.allowed === false || (usage.remaining !== undefined && usage.remaining <= 0);

  return reply.send({
    ok: !isExhausted,
    usage: summarizeUsage(usage),
    raw: usage.raw,
  });
});

app.get("/v1/models", async (request, reply) => {
  const routingApiKey = readBearerToken(request.headers.authorization);
  const selectedProvider = providerRepository.findProviderByApiKey(routingApiKey);

  if (!selectedProvider) {
    return reply.code(401).send({
      error: {
        type: "authentication_error",
        code: "INVALID_ROUTING_API_KEY",
        message: "Authorization Bearer token must match one of the configured provider API keys",
      },
    });
  }

  const data = buildAdvertisedModels(selectedProvider);
  return reply.send({
    object: "list",
    data,
  });
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

  const clientRoute = resolveClientRoute(request.headers, parsed.data);
  const routingApiKey = readBearerToken(request.headers.authorization);
  const selectedProvider = providerRepository.findProviderByApiKey(routingApiKey);
  if (!selectedProvider) {
    return reply.code(401).send({
      error: {
        type: "authentication_error",
        code: "INVALID_ROUTING_API_KEY",
        message: "Authorization Bearer token must match one of the configured provider API keys",
      },
    });
  }
  const currentModelOverride = providerRepository.getModelOverride(clientRoute);
  const requestBody = currentModelOverride
    ? {
        ...parsed.data,
        model: currentModelOverride,
      }
    : parsed.data;

  const isKRouterProvider = shouldCheckKRouterUsage(
    selectedProvider.baseUrl,
    config.KROUTER_USAGE_CHECK_ENABLED,
  );
  const normalized = normalizeResponsesRequest(requestBody, {
    openClawTokenOptimizationEnabled: config.OPENCLAW_TOKEN_OPTIMIZATION_ENABLED,
    defaultReasoningEffort: config.OPENCLAW_DEFAULT_REASONING_EFFORT,
    defaultReasoningSummary: config.OPENCLAW_DEFAULT_REASONING_SUMMARY,
    defaultTextVerbosity: config.OPENCLAW_DEFAULT_TEXT_VERBOSITY,
    defaultMaxOutputTokens: config.OPENCLAW_DEFAULT_MAX_OUTPUT_TOKENS,
    autoPromptCacheKey: config.OPENCLAW_AUTO_PROMPT_CACHE_KEY,
    defaultPromptCacheRetention: config.OPENCLAW_PROMPT_CACHE_RETENTION,
    defaultTruncation: isKRouterProvider ? undefined : config.OPENCLAW_DEFAULT_TRUNCATION,
    stripMaxOutputTokens: config.STRIP_MAX_OUTPUT_TOKENS_FOR_KROUTER && isKRouterProvider,
    sanitizeReasoningSummary: config.SANITIZE_REASONING_SUMMARY_FOR_KROUTER && isKRouterProvider,
  });
  const isStream = normalized.stream === true;
  const traceContext = buildTraceContext(parsed.data, normalized);
  const activeProviderId = selectedProvider.id;
  const sessionLog = createSessionLogContext(
    config.SESSION_LOG_DIR,
    deriveSessionKey(parsed.data, traceContext),
    config.SESSION_LOG_RETENTION_DAYS,
  );
  latestPromptCacheObservation = {
    requestId,
    providerId: activeProviderId,
    clientRoute,
    model: stringOrUndefined(normalized.model),
    promptCacheKey: stringOrUndefined(normalized.prompt_cache_key),
    promptCacheRetention: stringOrUndefined(normalized.prompt_cache_retention),
    truncation: stringOrUndefined(traceContext.truncation),
    reasoningEffort: stringOrUndefined(traceContext.reasoningEffort),
    reasoningSummary: stringOrUndefined(traceContext.reasoningSummary),
    textVerbosity: stringOrUndefined(traceContext.textVerbosity),
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
        promptCacheKey: stringOrUndefined(traceContext.promptCacheKey),
        promptCacheRetention: stringOrUndefined(traceContext.promptCacheRetention),
      });
      reply.hijack();
      const streamTarget = await forwardSseWithFallback({
        requestId,
        clientRoute,
        routingApiKey,
        body: normalized,
        responseRaw: reply.raw,
        logger: request.log,
        sessionLog,
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

    const { upstream, target } = await forwardJsonWithFallback({
      requestId,
      clientRoute,
      routingApiKey,
      body: normalized,
      logger: request.log,
      sessionLog,
    });

    const payload = await upstream.json();
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
        upstreamStatus: upstream.status,
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
      upstreamStatus: upstream.status,
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
    reply.header("x-proxy-upstream-status", String(upstream.status));
    reply.header("x-proxy-prompt-cache-key", stringOrUndefined(traceContext.promptCacheKey) ?? "");
    reply.header(
      "x-proxy-prompt-cache-retention",
      stringOrUndefined(traceContext.promptCacheRetention) ?? "",
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
      error instanceof KRouterUsageLimitError
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

    if (isStream) {
      sendHijackedStreamError(reply.raw, {
        statusCode,
        message: error instanceof Error ? error.message : "Unknown proxy error",
        upstreamBody,
      });
      return reply;
    }

    return reply.code(statusCode).send({
      error: {
        type: "proxy_error",
        code: errorCode,
        message: error instanceof Error ? error.message : "Unknown proxy error",
        upstream_status: statusCode,
        upstream_body: upstreamBody,
        usage:
          error instanceof KRouterUsageLimitError
            ? summarizeUsage(error.usage)
            : undefined,
      },
    });
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
    upstreamBody?: string;
  },
): void {
  if (raw.writableEnded || raw.writableFinished) {
    return;
  }

  if (!raw.headersSent) {
    raw.statusCode = payload.statusCode;
    raw.setHeader?.("Content-Type", "application/json; charset=utf-8");
    raw.end(
      JSON.stringify({
        error: {
          type: "proxy_error",
          code: payload.statusCode >= 500 ? "UPSTREAM_REQUEST_FAILED" : "UPSTREAM_BAD_REQUEST",
          message: payload.message,
          upstream_status: payload.statusCode,
          upstream_body: payload.upstreamBody,
        },
      }),
    );
    return;
  }

  raw.destroy(new Error(payload.message));
}

function buildTraceContext(
  original: Record<string, unknown>,
  normalized: Record<string, unknown>,
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
    promptCacheKey:
      stringOrUndefined(normalized.prompt_cache_key) ?? stringOrUndefined(original.prompt_cache_key),
    promptCacheRetention:
      stringOrUndefined(normalized.prompt_cache_retention) ??
      stringOrUndefined(original.prompt_cache_retention),
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
    promptCacheKey?: string;
    promptCacheRetention?: string;
  },
): void {
  raw.setHeader?.("x-proxy-request-id", headers.requestId);
  if (headers.providerId) {
    raw.setHeader?.("x-proxy-provider-id", headers.providerId);
  }
  if (headers.promptCacheKey) {
    raw.setHeader?.("x-proxy-prompt-cache-key", headers.promptCacheKey);
  }
  if (headers.promptCacheRetention) {
    raw.setHeader?.("x-proxy-prompt-cache-retention", headers.promptCacheRetention);
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
): ClientRouteKey {
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

function readBearerToken(value: unknown): string | undefined {
  const header = readHeaderString(value);
  if (!header) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || undefined;
}

function shouldCheckKRouterUsage(baseUrl: string, enabled: boolean): boolean {
  if (!enabled) {
    return false;
  }

  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname === "api.krouter.net" || hostname === "krouter.net";
  } catch {
    return false;
  }
}

type ForwardTarget = {
  name: string;
  url: string;
  apiKey?: string;
};

async function resolveForwardTarget(args: {
  requestId: string;
  clientRoute: ClientRouteKey;
  routingApiKey?: string;
  logger: FastifyBaseLogger;
  sessionLog: ReturnType<typeof createSessionLogContext>;
}): Promise<ForwardTarget> {
  const activeProvider = requireProviderPresetForClient(args.clientRoute);
  const primaryTarget: ForwardTarget = {
    name: activeProvider.id,
    url: activeProvider.responsesUrl,
    apiKey: args.routingApiKey,
  };

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

    return {
      name: fallbackProvider.id,
      url: fallbackProvider.responsesUrl,
      apiKey: getDefaultProviderApiKey(fallbackProvider),
    };
  }
}

async function forwardJsonWithFallback(args: {
  requestId: string;
  clientRoute: ClientRouteKey;
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
  const primaryResponse = await forwardJson({
    requestId: args.requestId,
    url: primaryTarget.url,
    body: args.body,
    apiKey: primaryTarget.apiKey,
    timeoutMs: config.REQUEST_TIMEOUT_MS,
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

  const fallbackResponse = await forwardJson({
    requestId: args.requestId,
    url: fallbackProvider.responsesUrl,
    body: rewriteBodyForProvider(args.body, fallbackProvider),
    apiKey: getDefaultProviderApiKey(fallbackProvider),
    timeoutMs: config.REQUEST_TIMEOUT_MS,
    logger: args.logger,
    onEvent: (entry) => args.sessionLog.write(entry),
  });

  if (!fallbackResponse.ok) {
    throw await buildUpstreamError(args.requestId, fallbackResponse);
  }

  return {
    upstream: fallbackResponse,
    target: {
      name: fallbackProvider.id,
      url: fallbackProvider.responsesUrl,
      apiKey: getDefaultProviderApiKey(fallbackProvider),
    },
  };
}

async function runPrimaryPreflight(args: {
  requestId: string;
  clientRoute: ClientRouteKey;
  routingApiKey?: string;
  logger: FastifyBaseLogger;
  sessionLog: ReturnType<typeof createSessionLogContext>;
}): Promise<void> {
  const activeProvider = requireProviderPresetForClient(args.clientRoute);
  if (!shouldCheckKRouterUsage(activeProvider.baseUrl, config.KROUTER_USAGE_CHECK_ENABLED)) {
    return;
  }

  await ensureKRouterUsageAvailable({
    apiKey: args.routingApiKey,
    requestId: args.requestId,
    logger: args.logger,
    timeoutMs: config.REQUEST_TIMEOUT_MS,
    url: config.KROUTER_USAGE_CHECK_URL,
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
  if (error instanceof KRouterUsageLimitError) {
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
  onEvent?: (entry: Record<string, unknown>) => void;
}): Promise<ForwardTarget> {
  const primaryTarget = await resolveForwardTarget(args);
  const fallbackProvider = getFallbackProviderPreset();
  const usingFallbackAsPrimary = fallbackProvider
    ? primaryTarget.name === fallbackProvider.id
    : false;

  try {
    await forwardSse({
      requestId: args.requestId,
      url: primaryTarget.url,
      body: args.body,
      apiKey: primaryTarget.apiKey,
      timeoutMs: config.REQUEST_TIMEOUT_MS,
      idleTimeoutMs: config.STREAM_IDLE_TIMEOUT_MS,
      responseRaw: args.responseRaw,
      logger: args.logger,
      onEvent: (entry) => {
        args.onEvent?.(entry);
        return args.sessionLog.write(entry);
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
    await forwardSse({
      requestId: args.requestId,
      url: fallbackProvider.responsesUrl,
      body: rewriteBodyForProvider(args.body, fallbackProvider),
      apiKey: getDefaultProviderApiKey(fallbackProvider),
      timeoutMs: config.REQUEST_TIMEOUT_MS,
      idleTimeoutMs: config.STREAM_IDLE_TIMEOUT_MS,
      responseRaw: args.responseRaw,
      logger: args.logger,
      onEvent: (entry) => {
        args.onEvent?.(entry);
        return args.sessionLog.write(entry);
      },
    });
    return {
      name: fallbackProvider.id,
      url: fallbackProvider.responsesUrl,
      apiKey: getDefaultProviderApiKey(fallbackProvider),
    };
  }
}

async function fetchProviderModels(provider: RuntimeProviderPreset): Promise<string[]> {
  const providerApiKey = getDefaultProviderApiKey(provider);
  const response = await fetch(`${provider.baseUrl.replace(/\/+$/, "")}/models`, {
    headers: providerApiKey
      ? {
          Authorization: `Bearer ${providerApiKey}`,
        }
      : undefined,
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
    message: `No provider is configured for client route ${client}`,
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
  return provider.apiKeys[0];
}

function buildAdvertisedModels(provider: RuntimeProviderPreset): Array<Record<string, unknown>> {
  const configuredModels = Object.keys(config.MODEL_CONTEXT_LENGTH_MAP);
  const models = configuredModels.length > 0
    ? configuredModels
    : ["cx/gpt-5.4", "gpt-5.4", "cx/gpt-5.4-mini", "gpt-5.4-mini"];

  return [...new Set(models)].map((modelId) => buildAdvertisedModel(modelId, provider));
}

function buildAdvertisedModel(
  modelId: string,
  provider: RuntimeProviderPreset,
): Record<string, unknown> {
  const contextLength = resolveAdvertisedContextLength(modelId);
  const ownedBy = shouldCheckKRouterUsage(provider.baseUrl, true) ? "krouter" : provider.name;

  return {
    id: modelId,
    object: "model",
    created: 0,
    owned_by: ownedBy,
    context_length: contextLength,
    max_context_tokens: contextLength,
    max_input_tokens: contextLength,
    input_token_limit: contextLength,
    max_output_tokens: Math.min(128_000, contextLength),
    output_token_limit: Math.min(128_000, contextLength),
  };
}

function resolveAdvertisedContextLength(modelId: string): number {
  return config.MODEL_CONTEXT_LENGTH_MAP[modelId] ?? config.DEFAULT_MODEL_CONTEXT_LENGTH;
}

function rewriteBodyForProvider(
  body: Record<string, unknown>,
  provider: RuntimeProviderPreset,
): Record<string, unknown> {
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) {
    return body;
  }

  const rewrittenModel = rewriteModelForProvider(model, provider);
  if (rewrittenModel === model) {
    return body;
  }

  return {
    ...body,
    model: rewrittenModel,
  };
}

function rewriteModelForProvider(model: string, provider: RuntimeProviderPreset): string {
  if (shouldCheckKRouterUsage(provider.baseUrl, true)) {
    return model;
  }

  if (model.startsWith("cx/")) {
    return model.slice(3);
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
    timestamp: new Date().toISOString(),
  };
  setLatestPromptCacheObservation(latestPromptCacheObservation);
}

function setLatestPromptCacheObservation(observation: PromptCacheObservation): void {
  latestPromptCacheObservation = observation;
  if (observation.providerId) {
    latestPromptCacheObservationByProvider.set(observation.providerId, observation);
  }
}

type UsageStatsBucket = {
  requests: number;
  hits: number;
  hitRate: number;
  totalCachedTokens: number;
  totalInputTokens: number;
  avgCacheSavedPercent: number;
};

async function buildUsageStats(): Promise<{
  today: UsageStatsBucket;
  month: UsageStatsBucket;
  daily: Array<{ date: string } & UsageStatsBucket>;
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

  return {
    today,
    month: finalizeUsageStatsAccumulator(month),
    daily: dailyEntries
      .map((entry) => ({
        date: entry.date,
        ...entry.stats,
      }))
      .reverse(),
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
  let raw = "";
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return emptyUsageStatsAccumulator();
  }

  const accumulator = emptyUsageStatsAccumulator();
  for (const line of raw.split("\n")) {
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

    if (entry.event !== "upstream_response_usage") {
      continue;
    }

    accumulator.requests += 1;
    const cachedTokens = readFiniteNumber(entry.cachedTokens);
    const inputTokens = readFiniteNumber(entry.inputTokens);
    const cacheSavedPercent = readFiniteNumber(entry.cacheSavedPercent);

    if (typeof cachedTokens === "number" && cachedTokens > 0) {
      accumulator.hits += 1;
      accumulator.totalCachedTokens += cachedTokens;
    }
    if (typeof inputTokens === "number") {
      accumulator.totalInputTokens += inputTokens;
    }
    if (typeof cacheSavedPercent === "number") {
      accumulator.cacheSavedPercentTotal += cacheSavedPercent;
      accumulator.cacheSavedPercentCount += 1;
    }
  }

  return accumulator;
}

type UsageStatsAccumulator = {
  requests: number;
  hits: number;
  totalCachedTokens: number;
  totalInputTokens: number;
  cacheSavedPercentTotal: number;
  cacheSavedPercentCount: number;
};

function emptyUsageStatsAccumulator(): UsageStatsAccumulator {
  return {
    requests: 0,
    hits: 0,
    totalCachedTokens: 0,
    totalInputTokens: 0,
    cacheSavedPercentTotal: 0,
    cacheSavedPercentCount: 0,
  };
}

function emptyUsageStatsBucket(): UsageStatsBucket {
  return {
    requests: 0,
    hits: 0,
    hitRate: 0,
    totalCachedTokens: 0,
    totalInputTokens: 0,
    avgCacheSavedPercent: 0,
  };
}

function mergeUsageStatsBuckets(
  left: UsageStatsAccumulator,
  right: UsageStatsAccumulator | UsageStatsBucket,
): UsageStatsAccumulator {
  return {
    requests: left.requests + right.requests,
    hits: left.hits + right.hits,
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
  };
}

function finalizeUsageStatsAccumulator(accumulator: UsageStatsAccumulator): UsageStatsBucket {
  return {
    requests: accumulator.requests,
    hits: accumulator.hits,
    hitRate: accumulator.requests > 0 ? roundToSingleDecimal((accumulator.hits / accumulator.requests) * 100) : 0,
    totalCachedTokens: accumulator.totalCachedTokens,
    totalInputTokens: accumulator.totalInputTokens,
    avgCacheSavedPercent:
      accumulator.cacheSavedPercentCount > 0
        ? roundToSingleDecimal(accumulator.cacheSavedPercentTotal / accumulator.cacheSavedPercentCount)
        : 0,
  };
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
  reply.code(500).send({
    error: {
      type: "internal_error",
      code: "PROXY_INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Unknown internal error",
    },
  });
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
