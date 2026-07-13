/**
 * Serves Anthropic Messages (`/v1/messages`, what Claude Code speaks) through a
 * generic OpenAI-compatible provider. Mirrors the Kiro Anthropic forwarders
 * (`kiro-forward.ts`) but the upstream is a normal provider reached over HTTP:
 * the request is translated to the provider's transport (`chat_completions` or
 * `responses`), the upstream SSE/JSON is decoded into provider-agnostic deltas,
 * and the Anthropic Messages sequence is emitted via the shared emitter.
 */

import type { FastifyBaseLogger } from "fastify";
import {
  AnthropicSseEmitter,
  type ParsedAnthropicRequest,
  buildAnthropicMessage,
} from "./anthropic-messages.js";
import { estimateTokens } from "./kiro-codewhisperer.js";
import {
  ChatCompletionsDecoder,
  type CollectedOutput,
  type OpenAiDelta,
  ResponsesDecoder,
  buildChatCompletionsRequestFromTurns,
  buildResponsesRequestFromTurns,
} from "./openai-translate.js";

type TransportMode = "responses" | "chat_completions" | "codewhisperer";

type ResponseRaw = NodeJS.WritableStream & {
  setHeader(name: string, value: string): void;
  flushHeaders?: () => void;
  end(chunk?: unknown): void;
  destroy(error?: Error): void;
};

/** Where + how to reach the upstream (produced by the server's buildForwardTarget). */
export type GenericForwardTarget = {
  url: string;
  apiKey?: string;
  headers?: Record<string, string>;
};

export type GenericAnthropicUsage = {
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
};

export class GenericAnthropicUpstreamError extends Error {
  constructor(
    readonly requestId: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "GenericAnthropicUpstreamError";
  }
}

type ForwardArgs = {
  transportMode: TransportMode;
  target: GenericForwardTarget;
  parsed: ParsedAnthropicRequest;
  requestId: string;
  logger: FastifyBaseLogger;
  idleTimeoutMs: number;
  requestTimeoutMs: number;
  fetchImpl?: typeof fetch;
};

function usageFor(parsed: ParsedAnthropicRequest, outputText: string): GenericAnthropicUsage {
  const inputTokens = estimateTokens(parsed.inputText);
  const outputTokens = estimateTokens(outputText);
  return {
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}

/** Build the upstream request body for the provider's transport mode. */
function buildRequestBody(
  transportMode: TransportMode,
  parsed: ParsedAnthropicRequest,
  stream: boolean,
): Record<string, unknown> {
  if (transportMode === "chat_completions") {
    return buildChatCompletionsRequestFromTurns(parsed, { model: parsed.model, stream });
  }
  return buildResponsesRequestFromTurns(parsed, { model: parsed.model, stream });
}

function buildHeaders(target: GenericForwardTarget, extra: Record<string, string>): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extra,
    ...(target.headers ?? {}),
  };
  if (target.apiKey && !headers.Authorization) {
    headers.Authorization = `Bearer ${target.apiKey}`;
  }
  return headers;
}

async function openUpstream(
  args: ForwardArgs,
  stream: boolean,
): Promise<Response> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const body = buildRequestBody(args.transportMode, args.parsed, stream);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.requestTimeoutMs);
  try {
    const response = await fetchImpl(args.target.url, {
      method: "POST",
      headers: buildHeaders(args.target, stream ? { Accept: "text/event-stream" } : {}),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new GenericAnthropicUpstreamError(
        args.requestId,
        response.status,
        text || `Upstream returned ${response.status}`,
      );
    }
    return response;
  } catch (error) {
    if (error instanceof GenericAnthropicUpstreamError) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new GenericAnthropicUpstreamError(args.requestId, 502, `Upstream request failed: ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
}

function makeDecoder(transportMode: TransportMode): {
  pushFrame(frame: string): OpenAiDelta[];
} {
  return transportMode === "chat_completions"
    ? new ChatCompletionsDecoder()
    : new ResponsesDecoder();
}

function parseMessage(transportMode: TransportMode, body: unknown): CollectedOutput {
  return transportMode === "chat_completions"
    ? ChatCompletionsDecoder.parseMessage(body)
    : ResponsesDecoder.parseMessage(body);
}

/** Split a rolling SSE buffer into complete frames (on blank-line boundaries). */
function extractFrames(buffer: string): { complete: string[]; remaining: string } {
  const complete: string[] = [];
  let working = buffer;
  while (true) {
    const match = /\r?\n\r?\n/.exec(working);
    if (!match) {
      break;
    }
    const end = match.index + match[0].length;
    complete.push(working.slice(0, end));
    working = working.slice(end);
  }
  return { complete, remaining: working };
}

/**
 * Non-streaming Anthropic path: buffers the upstream JSON, decodes it, and returns
 * an Anthropic `message` payload plus usage.
 */
export async function forwardGenericAnthropicJson(
  args: ForwardArgs,
): Promise<{ payload: Record<string, unknown>; usage: GenericAnthropicUsage }> {
  const response = await openUpstream(args, false);
  const json = (await response.json().catch(() => ({}))) as unknown;
  const collected = parseMessage(args.transportMode, json);
  const outputText =
    collected.text + collected.toolUses.map((t) => JSON.stringify(t.input)).join("");
  const usage = usageFor(args.parsed, outputText);
  const payload = buildAnthropicMessage({
    text: collected.text,
    toolUses: collected.toolUses,
    model: args.parsed.model,
    inputTokens: usage.usage.input_tokens,
    outputTokens: usage.usage.output_tokens,
  });
  return { payload, usage };
}

/**
 * Streaming Anthropic path: reads the upstream SSE incrementally, decodes each
 * frame into { textDelta, toolUse } deltas, and writes the Anthropic Messages SSE
 * sequence (message_start → content_block_* → message_delta → message_stop).
 */
export async function forwardGenericAnthropicSse(
  args: ForwardArgs & { responseRaw: ResponseRaw },
): Promise<GenericAnthropicUsage> {
  const response = await openUpstream(args, true);
  if (!response.body) {
    throw new GenericAnthropicUpstreamError(args.requestId, 502, "Upstream returned an empty body");
  }

  const inputTokens = estimateTokens(args.parsed.inputText);
  const emitter = new AnthropicSseEmitter({ model: args.parsed.model, inputTokens });
  const decoder = makeDecoder(args.transportMode);
  const reader = response.body.getReader();
  const collected: CollectedOutput = { text: "", toolUses: [] };
  const toolInputs = new Map<string, string>();
  const toolNames = new Map<string, string>();
  const toolOrder: string[] = [];

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

  const applyDelta = (delta: OpenAiDelta) => {
    if (delta.textDelta) {
      collected.text += delta.textDelta;
      ensureHeaders();
      for (const frame of emitter.textDelta(delta.textDelta)) {
        args.responseRaw.write(frame);
      }
    }
    if (delta.toolUse) {
      const { toolUseId, name, inputDelta } = delta.toolUse;
      if (!toolNames.has(toolUseId)) {
        toolOrder.push(toolUseId);
        toolNames.set(toolUseId, name ?? "");
      } else if (name) {
        toolNames.set(toolUseId, name);
      }
      if (inputDelta) {
        toolInputs.set(toolUseId, (toolInputs.get(toolUseId) ?? "") + inputDelta);
      }
      ensureHeaders();
      for (const frame of emitter.toolUseDelta(delta.toolUse)) {
        args.responseRaw.write(frame);
      }
    }
  };

  let idleTimer: NodeJS.Timeout | undefined;
  const resetIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      args.logger.warn({ requestId: args.requestId }, "generic anthropic upstream idle timeout");
      void reader.cancel().catch(() => undefined);
    }, args.idleTimeoutMs);
  };

  let sseBuffer = "";
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
      sseBuffer += Buffer.from(value).toString("utf8");
      const frames = extractFrames(sseBuffer);
      sseBuffer = frames.remaining;
      for (const frame of frames.complete) {
        for (const delta of decoder.pushFrame(frame)) {
          applyDelta(delta);
        }
      }
    }
    if (sseBuffer.trim()) {
      for (const delta of decoder.pushFrame(sseBuffer)) {
        applyDelta(delta);
      }
    }
  } catch (error) {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    if (error instanceof GenericAnthropicUpstreamError) {
      throw error;
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new GenericAnthropicUpstreamError(args.requestId, 502, `Stream read failed: ${reason}`);
  }

  if (idleTimer) {
    clearTimeout(idleTimer);
  }

  ensureHeaders();
  const outputText =
    collected.text +
    toolOrder.map((id) => toolInputs.get(id) ?? "").join("");
  const usage = usageFor(args.parsed, outputText);
  for (const frame of emitter.finish(usage.usage.output_tokens)) {
    args.responseRaw.write(frame);
  }
  args.responseRaw.end();
  return usage;
}
