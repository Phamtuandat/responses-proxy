import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "./config.js";
import { KiroAuthError, resolveKiroCredentials } from "./kiro-auth.js";
import type { KiroTokenStore } from "./kiro-token-store.js";
import {
  CODEWHISPERER_GENERATE_PATH,
  type CodeWhispererRequest,
  KiroResponseAccumulator,
  buildCodeWhispererRequest,
  buildCodeWhispererRequestFromTurns,
  buildResponsesJson,
  buildSseDeltaFrame,
  buildSseFinaleFrames,
  buildSsePreludeFrames,
  collectInputText,
  estimateTokens,
  extractAssistantDelta,
  extractCodeWhispererError,
  mapModelToCodeWhisperer,
  newSseStreamIds,
} from "./kiro-codewhisperer.js";
import {
  AnthropicSseEmitter,
  type ParsedAnthropicRequest,
  buildAnthropicMessage,
} from "./anthropic-messages.js";
import { EventStreamParser } from "./kiro-eventstream.js";
import type { RuntimeProviderPreset } from "./runtime-provider-repository.js";

type FetchLike = typeof fetch;

type ResponseRaw = NodeJS.WritableStream & {
  setHeader(name: string, value: string): void;
  flushHeaders?: () => void;
  end(chunk?: unknown): void;
  destroy(error?: Error): void;
};

/** Usage totals returned to the caller so client/customer accounting can run. */
export type KiroUsage = {
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
};

function buildUsage(inputText: string, outputText: string): KiroUsage {
  const inputTokens = estimateTokens(inputText);
  const outputTokens = estimateTokens(outputText);
  return {
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}

/**
 * Error thrown when the CodeWhisperer upstream rejects a request. Carries the
 * upstream status + body so `server.ts` can fold it into the standard proxy error
 * envelope (it mirrors the `statusCode`/`body` shape `buildUpstreamError` produces).
 */
export class KiroUpstreamError extends Error {
  readonly statusCode: number;
  readonly body?: string;

  constructor(requestId: string, status: number, body?: string) {
    super(`[${requestId}] Kiro upstream rejected request (${status})`);
    this.statusCode = status;
    this.body = body;
  }
}

type RunKiroArgs = {
  store: KiroTokenStore;
  provider: RuntimeProviderPreset;
  config: AppConfig;
  requestId: string;
  body: Record<string, unknown>;
  logger: FastifyBaseLogger;
  fetchImpl?: FetchLike;
};

type OpenedKiroStream = {
  response: Response;
  model: string;
  inputText: string;
  cleanup: () => void;
};

/**
 * Resolve a Kiro credential and open the `generateAssistantResponse` connection
 * with an overall timeout. The CodeWhisperer request is produced by `buildRequest`
 * once credentials are known (so the resolved `profileArn` and mapped `modelId` can
 * be injected), letting the Responses and Anthropic paths share all auth/rotation/
 * timeout/connection logic. The caller consumes `response.body` and invokes
 * `cleanup()` (clears the abort timer) when finished.
 */
async function openKiroStream(
  args: RunKiroArgs & {
    model: string;
    inputText: string;
    buildRequest: (ctx: { profileArn?: string | null; modelId: string }) => CodeWhispererRequest;
  },
): Promise<OpenedKiroStream> {
  const fetchImpl = args.fetchImpl ?? fetch;

  const credentials = await resolveKiroCredentials({
    store: args.store,
    rotationMode: "round_robin",
    defaultRegion: args.config.KIRO_DEFAULT_REGION,
    refreshLeadSeconds: args.config.KIRO_REFRESH_LEAD_SECONDS,
    poolKey: args.provider.id,
    fetchImpl,
  });

  const modelId = mapModelToCodeWhisperer(args.model, args.provider.capabilities.modelAliases);
  const cwRequest = args.buildRequest({ profileArn: credentials.profileArn, modelId });
  const inputText = args.inputText;

  const url = `https://codewhisperer.${credentials.region}.amazonaws.com${CODEWHISPERER_GENERATE_PATH}`;

  // Kiro free tier throttles aggressively (429 "Too many requests"). Retry a few
  // times with backoff (honoring Retry-After) so transient throttles don't fail
  // the whole request — mirrors how the IDE client behaves.
  const maxAttempts = Math.max(1, args.config.KIRO_RETRY_MAX_ATTEMPTS ?? 5);
  const baseDelayMs = Math.max(0, args.config.KIRO_RETRY_BASE_DELAY_MS ?? 1000);
  const maxDelayMs = Math.max(baseDelayMs, args.config.KIRO_RETRY_MAX_DELAY_MS ?? 15000);
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  // Exponential backoff with full jitter, capped at maxDelayMs. Jitter is essential
  // because Kiro free-tier throttling is per-account: concurrent requests that all
  // retry on the same fixed schedule would re-collide on every attempt and stay
  // throttled. Spreading retries across the window lets some get through.
  const backoffMs = (attempt: number) => {
    const exp = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
    return Math.floor(Math.random() * exp);
  };

  let response: Response | undefined;
  let lastError = "";
  let lastStatus = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), args.config.REQUEST_TIMEOUT_MS);
    const startedAt = Date.now();
    let attemptResponse: Response;
    try {
      attemptResponse = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/vnd.amazon.eventstream",
          // CodeWhisperer is an AWS JSON-RPC service; X-Amz-Target selects the
          // operation and the user-agent pair identifies the Kiro IDE client.
          // These mirror the headers 9router sends and are required for routing.
          "X-Amz-Target": "AmazonCodeWhispererStreamingService.GenerateAssistantResponse",
          "User-Agent": "AWS-SDK-JS/3.0.0 kiro-ide/1.0.0",
          "X-Amz-User-Agent": "aws-sdk-js/3.0.0 kiro-ide/1.0.0",
          "Amz-Sdk-Request": `attempt=${attempt}; max=${maxAttempts}`,
          "Amz-Sdk-Invocation-Id": randomUUID(),
        },
        body: JSON.stringify(cwRequest),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      const reason = error instanceof Error ? error.message : String(error);
      // Network failures are retryable too.
      lastError = `Kiro upstream request failed: ${reason}`;
      lastStatus = 502;
      if (attempt < maxAttempts) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new KiroUpstreamError(args.requestId, 502, lastError);
    }

    args.logger.info(
      {
        requestId: args.requestId,
        provider: args.provider.id,
        accountId: credentials.accountId,
        upstreamStatus: attemptResponse.status,
        connectMs: Date.now() - startedAt,
        attempt,
        modelId,
      },
      "kiro codewhisperer response received",
    );

    // Retry on throttling (429) and transient upstream errors (502/503/504).
    const isRetryable = attemptResponse.status === 429 || [502, 503, 504].includes(attemptResponse.status);
    if (!attemptResponse.ok && isRetryable && attempt < maxAttempts) {
      lastError = await attemptResponse.text().catch(() => "");
      lastStatus = attemptResponse.status;
      const retryAfterHeader = attemptResponse.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader && /^\d+$/.test(retryAfterHeader.trim())
        ? Number(retryAfterHeader.trim()) * 1000
        : backoffMs(attempt);
      clearTimeout(timeout);
      await sleep(Math.min(retryAfterMs, maxDelayMs));
      continue;
    }

    if (!attemptResponse.ok) {
      const errorBody = await attemptResponse.text().catch(() => "");
      clearTimeout(timeout);
      throw new KiroUpstreamError(args.requestId, attemptResponse.status, errorBody);
    }

    response = attemptResponse;
    const cleanup = () => clearTimeout(timeout);
    return { response, model: args.model || modelId, inputText, cleanup };
  }

  // Exhausted retries.
  throw new KiroUpstreamError(args.requestId, lastStatus || 429, lastError || "Kiro upstream throttled");
}

/** Non-streaming Kiro path: buffers the stream, returns a Responses JSON payload + usage. */
export async function forwardKiroJson(
  args: RunKiroArgs,
): Promise<{ payload: Record<string, unknown>; usage: KiroUsage }> {
  const opened = await openKiroStream({
    ...args,
    model: typeof args.body.model === "string" ? args.body.model : "",
    inputText: collectInputText(args.body),
    buildRequest: ({ profileArn, modelId }) =>
      buildCodeWhispererRequest({ body: args.body, modelId, profileArn }),
  });
  try {
    const buffer = Buffer.from(await opened.response.arrayBuffer());
    const parser = new EventStreamParser();
    const messages = parser.push(buffer);
    let text = "";
    for (const message of messages) {
      const errText = extractCodeWhispererError(message);
      if (errText) {
        throw new KiroUpstreamError(args.requestId, 502, errText);
      }
      text += extractAssistantDelta(message);
    }
    const usage = buildUsage(opened.inputText, text);
    const payload = buildResponsesJson({
      text,
      model: opened.model,
      inputText: opened.inputText,
    });
    return { payload, usage };
  } finally {
    opened.cleanup();
  }
}

/**
 * Streaming Kiro path: reads the CodeWhisperer event-stream incrementally and
 * writes Responses SSE frames as text arrives, so clients see real token-by-token
 * output. Returns usage totals once the stream completes.
 */
export async function forwardKiroSse(
  args: RunKiroArgs & { responseRaw: ResponseRaw },
): Promise<KiroUsage> {
  const opened = await openKiroStream({
    ...args,
    model: typeof args.body.model === "string" ? args.body.model : "",
    inputText: collectInputText(args.body),
    buildRequest: ({ profileArn, modelId }) =>
      buildCodeWhispererRequest({ body: args.body, modelId, profileArn }),
  });
  const { response } = opened;

  if (!response.body) {
    opened.cleanup();
    throw new KiroUpstreamError(args.requestId, 502, "Kiro upstream returned an empty body");
  }

  const ids = newSseStreamIds(opened.model);
  const parser = new EventStreamParser();
  const reader = response.body.getReader();

  let headersSent = false;
  let fullText = "";
  let streamError: string | undefined;

  const ensureHeaders = () => {
    if (headersSent) {
      return;
    }
    args.responseRaw.setHeader("Content-Type", "text/event-stream");
    args.responseRaw.setHeader("Cache-Control", "no-cache, no-transform");
    args.responseRaw.setHeader("Connection", "keep-alive");
    args.responseRaw.setHeader("X-Accel-Buffering", "no");
    args.responseRaw.flushHeaders?.();
    for (const frame of buildSsePreludeFrames(ids)) {
      args.responseRaw.write(frame);
    }
    headersSent = true;
  };

  let idleTimer: NodeJS.Timeout | undefined;
  const resetIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      args.logger.warn({ requestId: args.requestId }, "kiro upstream stream idle timeout reached");
      void reader.cancel().catch(() => undefined);
    }, args.config.STREAM_IDLE_TIMEOUT_MS);
  };

  try {
    resetIdleTimer();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      resetIdleTimer();
      if (!value) {
        continue;
      }
      const messages = parser.push(value);
      for (const message of messages) {
        const errText = extractCodeWhispererError(message);
        if (errText) {
          streamError = errText;
          // If we have not emitted anything yet, surface a clean error envelope.
          if (!headersSent) {
            throw new KiroUpstreamError(args.requestId, 502, errText);
          }
          continue;
        }
        const delta = extractAssistantDelta(message);
        if (delta) {
          ensureHeaders();
          fullText += delta;
          args.responseRaw.write(buildSseDeltaFrame(ids, delta));
        }
      }
    }
  } catch (error) {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    opened.cleanup();
    // Headers already sent: we cannot change status, so propagate for the caller
    // to destroy the socket. Otherwise rethrow so a JSON error envelope is sent.
    if (error instanceof KiroUpstreamError) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new KiroUpstreamError(args.requestId, 502, `Kiro stream read failed: ${reason}`);
  }

  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  opened.cleanup();

  // Ensure the client always receives a well-formed completion, even for an empty
  // response or one whose only signal was a (post-output) error frame.
  ensureHeaders();
  const usage = buildUsage(opened.inputText, fullText);
  for (const frame of buildSseFinaleFrames(ids, {
    text: fullText,
    inputTokens: usage.usage.input_tokens,
    outputTokens: usage.usage.output_tokens,
  })) {
    args.responseRaw.write(frame);
  }
  args.responseRaw.end();

  if (streamError) {
    args.logger.warn(
      { requestId: args.requestId, streamError },
      "kiro stream completed with a post-output error frame",
    );
  }

  return usage;
}

export { KiroAuthError };

/** Args for the Anthropic Messages forward paths (parsed request instead of raw body). */
type RunKiroAnthropicArgs = {
  store: KiroTokenStore;
  provider: RuntimeProviderPreset;
  config: AppConfig;
  requestId: string;
  parsed: ParsedAnthropicRequest;
  logger: FastifyBaseLogger;
  fetchImpl?: FetchLike;
};

function anthropicUsage(parsed: ParsedAnthropicRequest, outputText: string): KiroUsage {
  return buildUsage(parsed.inputText, outputText);
}

function openAnthropicStream(args: RunKiroAnthropicArgs): Promise<OpenedKiroStream> {
  return openKiroStream({
    store: args.store,
    provider: args.provider,
    config: args.config,
    requestId: args.requestId,
    body: {},
    logger: args.logger,
    fetchImpl: args.fetchImpl,
    model: args.parsed.model,
    inputText: args.parsed.inputText,
    buildRequest: ({ profileArn, modelId }) =>
      buildCodeWhispererRequestFromTurns({
        turns: args.parsed.turns,
        modelId,
        tools: args.parsed.tools,
        profileArn,
        maxTokens: args.parsed.maxTokens,
        temperature: args.parsed.temperature,
        topP: args.parsed.topP,
      }),
  });
}

/** Non-streaming Anthropic path: buffers the stream, returns an Anthropic message + usage. */
export async function forwardKiroAnthropicJson(
  args: RunKiroAnthropicArgs,
): Promise<{ payload: Record<string, unknown>; usage: KiroUsage }> {
  const opened = await openAnthropicStream(args);
  try {
    const buffer = Buffer.from(await opened.response.arrayBuffer());
    const parser = new EventStreamParser();
    const accumulator = new KiroResponseAccumulator();
    for (const message of parser.push(buffer)) {
      accumulator.push(message);
    }
    if (accumulator.error) {
      throw new KiroUpstreamError(args.requestId, 502, accumulator.error);
    }
    const toolUses = accumulator.toolUses();
    const outputText = accumulator.text + toolUses.map((t) => JSON.stringify(t.input)).join("");
    const usage = anthropicUsage(args.parsed, outputText);
    const payload = buildAnthropicMessage({
      text: accumulator.text,
      toolUses,
      model: opened.model,
      inputTokens: usage.usage.input_tokens,
      outputTokens: usage.usage.output_tokens,
    });
    return { payload, usage };
  } finally {
    opened.cleanup();
  }
}

/**
 * Streaming Anthropic path: reads the CodeWhisperer event-stream incrementally and
 * writes the Anthropic Messages SSE sequence (message_start → content_block_* →
 * message_delta → message_stop) as text and tool-use deltas arrive.
 */
export async function forwardKiroAnthropicSse(
  args: RunKiroAnthropicArgs & { responseRaw: ResponseRaw },
): Promise<KiroUsage> {
  const opened = await openAnthropicStream(args);
  const { response } = opened;

  if (!response.body) {
    opened.cleanup();
    throw new KiroUpstreamError(args.requestId, 502, "Kiro upstream returned an empty body");
  }

  const inputTokens = estimateTokens(args.parsed.inputText);
  const emitter = new AnthropicSseEmitter({ model: opened.model, inputTokens });
  const parser = new EventStreamParser();
  const accumulator = new KiroResponseAccumulator();
  const reader = response.body.getReader();

  let headersSent = false;
  const ensureHeaders = () => {
    if (headersSent) {
      return;
    }
    args.responseRaw.setHeader("Content-Type", "text/event-stream");
    args.responseRaw.setHeader("Cache-Control", "no-cache, no-transform");
    args.responseRaw.setHeader("Connection", "keep-alive");
    args.responseRaw.setHeader("X-Accel-Buffering", "no");
    args.responseRaw.flushHeaders?.();
    for (const frame of emitter.start()) {
      args.responseRaw.write(frame);
    }
    headersSent = true;
  };

  let idleTimer: NodeJS.Timeout | undefined;
  const resetIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      args.logger.warn({ requestId: args.requestId }, "kiro upstream stream idle timeout reached");
      void reader.cancel().catch(() => undefined);
    }, args.config.STREAM_IDLE_TIMEOUT_MS);
  };

  try {
    resetIdleTimer();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      resetIdleTimer();
      if (!value) {
        continue;
      }
      for (const message of parser.push(value)) {
        const errText = extractCodeWhispererError(message);
        if (errText) {
          if (!headersSent) {
            throw new KiroUpstreamError(args.requestId, 502, errText);
          }
          continue;
        }
        const result = accumulator.push(message);
        if (result.textDelta) {
          ensureHeaders();
          for (const frame of emitter.textDelta(result.textDelta)) {
            args.responseRaw.write(frame);
          }
        }
        if (result.toolUse) {
          ensureHeaders();
          for (const frame of emitter.toolUseDelta(result.toolUse)) {
            args.responseRaw.write(frame);
          }
        }
      }
    }
  } catch (error) {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    opened.cleanup();
    if (error instanceof KiroUpstreamError) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new KiroUpstreamError(args.requestId, 502, `Kiro stream read failed: ${reason}`);
  }

  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  opened.cleanup();

  ensureHeaders();
  const toolUses = accumulator.toolUses();
  const outputText = accumulator.text + toolUses.map((t) => JSON.stringify(t.input)).join("");
  const usage = anthropicUsage(args.parsed, outputText);
  for (const frame of emitter.finish(usage.usage.output_tokens)) {
    args.responseRaw.write(frame);
  }
  args.responseRaw.end();

  if (accumulator.error) {
    args.logger.warn(
      { requestId: args.requestId, streamError: accumulator.error },
      "kiro anthropic stream completed with a post-output error frame",
    );
  }

  return usage;
}
