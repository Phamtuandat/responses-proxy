import type { FastifyBaseLogger } from "fastify";
import { setTimeout as delay } from "node:timers/promises";

type ForwardJsonArgs = {
  requestId: string;
  url: string;
  body: Record<string, unknown>;
  apiKey?: string;
  timeoutMs: number;
  logger: FastifyBaseLogger;
  onEvent?: (entry: Record<string, unknown>) => Promise<void> | void;
};

type ForwardSseArgs = ForwardJsonArgs & {
  responseRaw: NodeJS.WritableStream & {
    setHeader(name: string, value: string): void;
    flushHeaders?: () => void;
    end(chunk?: unknown): void;
    destroy(error?: Error): void;
  };
  idleTimeoutMs: number;
};

export async function forwardJson({
  requestId,
  url,
  body,
  apiKey,
  timeoutMs,
  logger,
  onEvent,
}: ForwardJsonArgs): Promise<Response> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    logger.info(
      {
        requestId,
        upstreamStatus: response.status,
        connectMs: Date.now() - startedAt,
      },
      "upstream JSON response received",
    );
    await onEvent?.({
      event: "upstream_json_response",
      requestId,
      upstreamStatus: response.status,
      connectMs: Date.now() - startedAt,
    });
    return response;
  } catch (error) {
    throw wrapFetchError(requestId, error);
  } finally {
    clearTimeout(timeout);
  }
}

export async function forwardSse({
  requestId,
  url,
  body,
  apiKey,
  timeoutMs,
  idleTimeoutMs,
  responseRaw,
  logger,
  onEvent,
}: ForwardSseArgs): Promise<void> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        ...buildHeaders(apiKey),
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    throw wrapFetchError(requestId, error);
  }

  if (!upstream.ok || !upstream.body) {
    clearTimeout(timeout);
    throw await buildUpstreamError(requestId, upstream);
  }

  logger.info(
    {
      requestId,
      upstreamStatus: upstream.status,
      connectMs: Date.now() - startedAt,
    },
    "upstream SSE stream opened",
  );
  await onEvent?.({
    event: "upstream_sse_opened",
    requestId,
    upstreamStatus: upstream.status,
    connectMs: Date.now() - startedAt,
  });

  responseRaw.setHeader("Content-Type", "text/event-stream");
  responseRaw.setHeader("Cache-Control", "no-cache, no-transform");
  responseRaw.setHeader("Connection", "keep-alive");
  responseRaw.setHeader("X-Accel-Buffering", "no");
  responseRaw.flushHeaders?.();

  const reader = upstream.body.getReader();
  let sseBuffer = "";
  let firstForwardedAt: number | undefined;
  let firstEventType: string | undefined;
  let forwardedFrames = 0;
  let forwardedBytes = 0;
  let filteredNullFrames = 0;
  let usageCaptured = false;
  let idleTimer: NodeJS.Timeout | undefined;
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.warn({ requestId }, "upstream SSE idle timeout reached");
      controller.abort();
      responseRaw.destroy(new Error("upstream stream idle timeout"));
    }, idleTimeoutMs);
  };

  resetIdleTimer();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      resetIdleTimer();
      if (value) {
        const chunk = Buffer.from(value).toString("utf8");
        sseBuffer += chunk;
        const frames = extractCompleteSseFrames(sseBuffer);
        sseBuffer = frames.remaining;

        for (const frame of frames.complete) {
          const filtered = filterMalformedSseFrame(frame);
          if (filtered) {
            if (!usageCaptured) {
              const usageEvent = extractSseUsageEvent(filtered, requestId);
              if (usageEvent) {
                usageCaptured = true;
                await onEvent?.(usageEvent);
              }
            }
            if (firstForwardedAt === undefined) {
              firstForwardedAt = Date.now();
              firstEventType = extractSseEventType(filtered);
              logger.info(
                {
                  requestId,
                  firstChunkMs: firstForwardedAt - startedAt,
                  firstEventType,
                },
                "upstream SSE first event forwarded",
              );
              await onEvent?.({
                event: "upstream_sse_first_event",
                requestId,
                firstChunkMs: firstForwardedAt - startedAt,
                firstEventType,
              });
            }
            forwardedFrames += 1;
            forwardedBytes += Buffer.byteLength(filtered);
            responseRaw.write(filtered);
          } else {
            filteredNullFrames += 1;
          }
        }
      } else {
        await delay(0);
      }
    }
    if (sseBuffer.length > 0) {
      const filtered = filterMalformedSseFrame(sseBuffer);
      if (filtered) {
        if (!usageCaptured) {
          const usageEvent = extractSseUsageEvent(filtered, requestId);
          if (usageEvent) {
            usageCaptured = true;
            await onEvent?.(usageEvent);
          }
        }
        if (firstForwardedAt === undefined) {
          firstForwardedAt = Date.now();
          firstEventType = extractSseEventType(filtered);
          logger.info(
            {
              requestId,
              firstChunkMs: firstForwardedAt - startedAt,
              firstEventType,
            },
            "upstream SSE first event forwarded",
          );
          await onEvent?.({
            event: "upstream_sse_first_event",
            requestId,
            firstChunkMs: firstForwardedAt - startedAt,
            firstEventType,
          });
        }
        forwardedFrames += 1;
        forwardedBytes += Buffer.byteLength(filtered);
        responseRaw.write(filtered);
      } else {
        filteredNullFrames += 1;
      }
    }
    logger.info(
      {
        requestId,
        totalMs: Date.now() - startedAt,
        forwardedFrames,
        forwardedBytes,
        filteredNullFrames,
        firstEventType,
      },
      "upstream SSE stream completed",
    );
    await onEvent?.({
      event: "upstream_sse_completed",
      requestId,
      totalMs: Date.now() - startedAt,
      forwardedFrames,
      forwardedBytes,
      filteredNullFrames,
      firstEventType,
    });
    responseRaw.end();
  } catch (error) {
    throw wrapFetchError(requestId, error);
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(timeout);
  }
}

function extractCompleteSseFrames(buffer: string): {
  complete: string[];
  remaining: string;
} {
  const complete: string[] = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const lfLfIndex = buffer.indexOf("\n\n", cursor);
    const crlfCrlfIndex = buffer.indexOf("\r\n\r\n", cursor);

    let endIndex = -1;
    let delimiterLength = 0;

    if (lfLfIndex !== -1 && (crlfCrlfIndex === -1 || lfLfIndex < crlfCrlfIndex)) {
      endIndex = lfLfIndex;
      delimiterLength = 2;
    } else if (crlfCrlfIndex !== -1) {
      endIndex = crlfCrlfIndex;
      delimiterLength = 4;
    }

    if (endIndex === -1) {
      break;
    }

    complete.push(buffer.slice(cursor, endIndex + delimiterLength));
    cursor = endIndex + delimiterLength;
  }

  return {
    complete,
    remaining: buffer.slice(cursor),
  };
}

function filterMalformedSseFrame(frame: string): string {
  const normalized = frame.replace(/\r\n/g, "\n");
  const dataLines = normalized
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());

  if (dataLines.length === 1 && dataLines[0] === "null") {
    return "";
  }

  return frame;
}

function extractSseEventType(frame: string): string | undefined {
  const normalized = frame.replace(/\r\n/g, "\n");
  const dataLine = normalized
    .split("\n")
    .find((line) => line.startsWith("data:") && line.slice(5).trim().startsWith("{"));

  if (!dataLine) {
    return normalized.includes("[DONE]") ? "done" : undefined;
  }

  try {
    const payload = JSON.parse(dataLine.slice(5).trim()) as { type?: unknown };
    return typeof payload.type === "string" ? payload.type : undefined;
  } catch {
    return undefined;
  }
}

function extractSseUsageEvent(
  frame: string,
  requestId: string,
): Record<string, unknown> | undefined {
  const payload = extractSsePayload(frame);
  if (!payload || typeof payload.type !== "string") {
    return undefined;
  }

  const response = isRecord(payload.response) ? payload.response : undefined;
  const usage = response && isRecord(response.usage) ? response.usage : undefined;
  if (!usage) {
    return undefined;
  }

  const totalTokens = readNumber(usage.total_tokens);
  const outputTokens = readNumber(usage.output_tokens);
  const inputTokens = readNumber(usage.input_tokens);
  const inputTokensDetails = isRecord(usage.input_tokens_details)
    ? usage.input_tokens_details
    : undefined;
  const cachedTokens =
    inputTokensDetails && readNumber(inputTokensDetails.cached_tokens) !== undefined
      ? readNumber(inputTokensDetails.cached_tokens)
      : undefined;
  const cacheSavedPercent = computeCacheSavedPercent(inputTokens, cachedTokens);

  if (
    payload.type !== "response.completed" &&
    payload.type !== "response.incomplete" &&
    totalTokens === undefined &&
    outputTokens === undefined &&
    inputTokens === undefined &&
    cachedTokens === undefined
  ) {
    return undefined;
  }

  return {
    event: "upstream_response_usage",
    requestId,
    responseEventType: payload.type,
    responseId: typeof response?.id === "string" ? response.id : undefined,
    usage,
    inputTokens,
    outputTokens,
    totalTokens,
    inputTokensDetails,
    cachedTokens,
    cacheSavedPercent,
  };
}

function extractSsePayload(frame: string): Record<string, unknown> | undefined {
  const normalized = frame.replace(/\r\n/g, "\n");
  const dataLine = normalized
    .split("\n")
    .find((line) => line.startsWith("data:") && line.slice(5).trim().startsWith("{"));

  if (!dataLine) {
    return undefined;
  }

  try {
    const payload = JSON.parse(dataLine.slice(5).trim()) as unknown;
    return isRecord(payload) ? payload : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function computeCacheSavedPercent(
  inputTokens: number | undefined,
  cachedTokens: number | undefined,
): number | undefined {
  if (
    inputTokens === undefined ||
    cachedTokens === undefined ||
    inputTokens <= 0 ||
    cachedTokens < 0
  ) {
    return undefined;
  }

  return Math.round((cachedTokens / inputTokens) * 1000) / 10;
}

export async function buildUpstreamError(
  requestId: string,
  upstream: Response,
): Promise<Error & { statusCode?: number; body?: string }> {
  const body = await upstream.text();
  const error = new Error(
    `upstream rejected request (${upstream.status} ${upstream.statusText})`,
  ) as Error & { statusCode?: number; body?: string };
  error.statusCode = upstream.status;
  error.body = body;
  error.message = `[${requestId}] ${error.message}`;
  return error;
}

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

function wrapFetchError(
  requestId: string,
  error: unknown,
): Error & { statusCode?: number } {
  const wrapped = new Error(
    error instanceof Error ? `[${requestId}] ${error.message}` : `[${requestId}] upstream request failed`,
  ) as Error & { statusCode?: number };

  if ((error as { name?: string })?.name === "AbortError") {
    wrapped.statusCode = 504;
  } else {
    wrapped.statusCode = 502;
  }

  return wrapped;
}
