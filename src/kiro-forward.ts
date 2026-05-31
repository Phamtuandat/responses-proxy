import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "./config.js";
import { KiroAuthError, resolveKiroCredentials } from "./kiro-auth.js";
import type { KiroTokenStore } from "./kiro-token-store.js";
import {
  CODEWHISPERER_GENERATE_PATH,
  buildCodeWhispererRequest,
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
 * Resolve a Kiro credential, translate the Responses body to a CodeWhisperer
 * request, and open the `generateAssistantResponse` connection with an overall
 * timeout. The caller is responsible for consuming `response.body` and invoking
 * `cleanup()` (clears the abort timer) when finished.
 */
async function openKiroStream(args: RunKiroArgs): Promise<OpenedKiroStream> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const model = typeof args.body.model === "string" ? args.body.model : "";

  const credentials = await resolveKiroCredentials({
    store: args.store,
    rotationMode: "round_robin",
    defaultRegion: args.config.KIRO_DEFAULT_REGION,
    refreshLeadSeconds: args.config.KIRO_REFRESH_LEAD_SECONDS,
    poolKey: args.provider.id,
    fetchImpl,
  });

  const modelId = mapModelToCodeWhisperer(model, args.provider.capabilities.modelAliases);
  const cwRequest = buildCodeWhispererRequest({
    body: args.body,
    modelId,
    profileArn: credentials.profileArn,
  });
  const inputText = collectInputText(args.body);

  const url = `https://codewhisperer.${credentials.region}.amazonaws.com${CODEWHISPERER_GENERATE_PATH}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.config.REQUEST_TIMEOUT_MS);
  const cleanup = () => clearTimeout(timeout);

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetchImpl(url, {
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
        "Amz-Sdk-Request": "attempt=1; max=3",
        "Amz-Sdk-Invocation-Id": randomUUID(),
      },
      body: JSON.stringify(cwRequest),
      signal: controller.signal,
    });
  } catch (error) {
    cleanup();
    const reason = error instanceof Error ? error.message : String(error);
    throw new KiroUpstreamError(args.requestId, 502, `Kiro upstream request failed: ${reason}`);
  }

  args.logger.info(
    {
      requestId: args.requestId,
      provider: args.provider.id,
      accountId: credentials.accountId,
      upstreamStatus: response.status,
      connectMs: Date.now() - startedAt,
      modelId,
    },
    "kiro codewhisperer response received",
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    cleanup();
    throw new KiroUpstreamError(args.requestId, response.status, errorBody);
  }

  return { response, model: model || modelId, inputText, cleanup };
}

/** Non-streaming Kiro path: buffers the stream, returns a Responses JSON payload + usage. */
export async function forwardKiroJson(
  args: RunKiroArgs,
): Promise<{ payload: Record<string, unknown>; usage: KiroUsage }> {
  const opened = await openKiroStream(args);
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
  const opened = await openKiroStream(args);
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
