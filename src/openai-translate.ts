/**
 * Translation between the structured turn/tool model (shared with the Anthropic
 * Messages and Kiro paths) and the two OpenAI wire formats — Chat Completions and
 * Responses. Used to serve Anthropic clients (Claude Code) through a generic
 * OpenAI-compatible provider, and to translate an upstream Chat Completions
 * response back into Responses format for `/v1/responses` clients.
 *
 * Request builders: StructuredTurn[] → OpenAI request body.
 * Decoders: OpenAI SSE frames / JSON → the provider-agnostic
 *   { textDelta?, toolUse?: ToolUseDelta } deltas the AnthropicSseEmitter and the
 *   Responses SSE emitters consume, plus a non-streaming collector.
 */

import { randomUUID } from "node:crypto";
import {
  type CodeWhispererToolUse,
  type StructuredTurn,
  type ToolUseDelta,
  estimateTokens,
} from "./kiro-codewhisperer.js";
import type { ParsedAnthropicRequest } from "./anthropic-messages.js";

/** A single decoded delta: incremental assistant text and/or a tool-use fragment. */
export type OpenAiDelta = { textDelta?: string; toolUse?: ToolUseDelta };

/** Collected non-streaming assistant output, ready for buildAnthropicMessage. */
export type CollectedOutput = { text: string; toolUses: CodeWhispererToolUse[] };

type BuildOptions = { model: string; stream: boolean };

function parseArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------------

/**
 * Build an OpenAI Chat Completions request body from parsed Anthropic turns.
 * Assistant `toolUses` → `tool_calls[]`; user `toolResults` → `role:"tool"`
 * messages; the system prompt → a leading `system` message; images → `image_url`
 * content parts.
 */
export function buildChatCompletionsRequestFromTurns(
  parsed: ParsedAnthropicRequest,
  options: BuildOptions,
): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = [];

  if (parsed.system && parsed.system.trim()) {
    messages.push({ role: "system", content: parsed.system });
  }

  for (const turn of parsed.turns) {
    if (turn.role === "assistant") {
      const message: Record<string, unknown> = { role: "assistant" };
      message.content = turn.content || null;
      if (turn.toolUses && turn.toolUses.length > 0) {
        message.tool_calls = turn.toolUses.map((toolUse) => ({
          id: toolUse.toolUseId,
          type: "function",
          function: {
            name: toolUse.name,
            arguments: JSON.stringify(toolUse.input ?? {}),
          },
        }));
      }
      messages.push(message);
      continue;
    }

    // User turn. Tool results become standalone `tool` messages (one per result),
    // which must precede the user's own message content per the OpenAI protocol.
    if (turn.toolResults && turn.toolResults.length > 0) {
      for (const result of turn.toolResults) {
        messages.push({
          role: "tool",
          tool_call_id: result.toolUseId,
          content: result.content,
        });
      }
    }

    const hasImages = turn.images && turn.images.length > 0;
    if (hasImages) {
      const parts: Array<Record<string, unknown>> = [];
      if (turn.content) {
        parts.push({ type: "text", text: turn.content });
      }
      for (const image of turn.images ?? []) {
        parts.push({ type: "image_url", image_url: { url: image.url } });
      }
      messages.push({ role: "user", content: parts });
    } else if (turn.content || !(turn.toolResults && turn.toolResults.length > 0)) {
      // Emit a user message when there is text, or when this turn carried no tool
      // results (so an empty user turn still produces a message).
      messages.push({ role: "user", content: turn.content });
    }
  }

  const body: Record<string, unknown> = {
    model: options.model,
    messages,
    stream: options.stream,
  };
  if (parsed.tools.length > 0) {
    body.tools = parsed.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        parameters: tool.inputSchema,
      },
    }));
  }
  if (typeof parsed.maxTokens === "number") {
    body.max_tokens = parsed.maxTokens;
  }
  if (typeof parsed.temperature === "number") {
    body.temperature = parsed.temperature;
  }
  if (typeof parsed.topP === "number") {
    body.top_p = parsed.topP;
  }
  return body;
}

/**
 * Build an OpenAI Responses request body from parsed Anthropic turns. Assistant
 * `toolUses` → `function_call` items; user `toolResults` → `function_call_output`
 * items; system prompt → `instructions`; images → `input_image` parts.
 */
export function buildResponsesRequestFromTurns(
  parsed: ParsedAnthropicRequest,
  options: BuildOptions,
): Record<string, unknown> {
  const input: Array<Record<string, unknown>> = [];

  for (const turn of parsed.turns) {
    if (turn.role === "assistant") {
      if (turn.content) {
        input.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: turn.content }],
        });
      }
      for (const toolUse of turn.toolUses ?? []) {
        input.push({
          type: "function_call",
          call_id: toolUse.toolUseId,
          name: toolUse.name,
          arguments: JSON.stringify(toolUse.input ?? {}),
        });
      }
      continue;
    }

    for (const result of turn.toolResults ?? []) {
      input.push({
        type: "function_call_output",
        call_id: result.toolUseId,
        output: result.content,
      });
    }

    const parts: Array<Record<string, unknown>> = [];
    if (turn.content) {
      parts.push({ type: "input_text", text: turn.content });
    }
    for (const image of turn.images ?? []) {
      parts.push({ type: "input_image", image_url: image.url });
    }
    if (parts.length > 0) {
      input.push({ type: "message", role: "user", content: parts });
    }
  }

  const body: Record<string, unknown> = {
    model: options.model,
    input,
    stream: options.stream,
  };
  if (parsed.system && parsed.system.trim()) {
    body.instructions = parsed.system;
  }
  if (parsed.tools.length > 0) {
    body.tools = parsed.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      parameters: tool.inputSchema,
    }));
  }
  if (typeof parsed.maxTokens === "number") {
    body.max_output_tokens = parsed.maxTokens;
  }
  if (typeof parsed.temperature === "number") {
    body.temperature = parsed.temperature;
  }
  if (typeof parsed.topP === "number") {
    body.top_p = parsed.topP;
  }
  return body;
}

// ---------------------------------------------------------------------------
// SSE frame parsing
// ---------------------------------------------------------------------------

/**
 * Extract the JSON `data:` payload from a single SSE frame. Returns `"[DONE]"`
 * for the terminal sentinel, `undefined` when there is no parseable data line.
 * Concatenates multiple `data:` lines per the SSE spec.
 */
export function parseSseData(frame: string): unknown | "[DONE]" | undefined {
  const dataLines: string[] = [];
  for (const rawLine of frame.split(/\r?\n/)) {
    if (rawLine.startsWith("data:")) {
      dataLines.push(rawLine.slice("data:".length).trimStart());
    }
  }
  if (dataLines.length === 0) {
    return undefined;
  }
  const data = dataLines.join("\n");
  if (data === "[DONE]") {
    return "[DONE]";
  }
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Chat Completions decoder
// ---------------------------------------------------------------------------

/**
 * Decodes an OpenAI Chat Completions response (streaming chunks or a full JSON
 * body) into provider-agnostic { textDelta, toolUse } deltas. Streaming tool
 * calls arrive as index-keyed fragments: the first fragment carries `id`+`name`,
 * later fragments only carry an `index` with an `arguments` fragment, so we map
 * `index → toolUseId` to keep the emitted `toolUseId` stable.
 */
export class ChatCompletionsDecoder {
  private readonly indexToId = new Map<number, string>();
  private syntheticCounter = 0;

  /** Feed one streaming SSE frame; returns the deltas it produced (possibly none). */
  pushFrame(frame: string): OpenAiDelta[] {
    const data = parseSseData(frame);
    if (data === "[DONE]" || data === undefined) {
      return [];
    }
    return this.pushChunk(data);
  }

  /** Feed one parsed streaming chunk object (`chat.completion.chunk`). */
  pushChunk(chunk: unknown): OpenAiDelta[] {
    if (typeof chunk !== "object" || chunk === null) {
      return [];
    }
    const choices = (chunk as Record<string, unknown>).choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      return [];
    }
    const first = choices[0];
    if (typeof first !== "object" || first === null) {
      return [];
    }
    const delta = (first as Record<string, unknown>).delta;
    if (typeof delta !== "object" || delta === null) {
      return [];
    }
    const record = delta as Record<string, unknown>;
    const out: OpenAiDelta[] = [];

    if (typeof record.content === "string" && record.content) {
      out.push({ textDelta: record.content });
    }

    if (Array.isArray(record.tool_calls)) {
      for (const call of record.tool_calls) {
        if (typeof call !== "object" || call === null) {
          continue;
        }
        const callRecord = call as Record<string, unknown>;
        const index = typeof callRecord.index === "number" ? callRecord.index : 0;
        const fn =
          typeof callRecord.function === "object" && callRecord.function !== null
            ? (callRecord.function as Record<string, unknown>)
            : {};
        const providedId = typeof callRecord.id === "string" ? callRecord.id : undefined;
        const name = typeof fn.name === "string" ? fn.name : undefined;
        const argsDelta = typeof fn.arguments === "string" ? fn.arguments : undefined;

        let toolUseId = this.indexToId.get(index);
        if (!toolUseId) {
          toolUseId = providedId ?? `call_${this.syntheticCounter++}`;
          this.indexToId.set(index, toolUseId);
        }
        out.push({
          toolUse: {
            toolUseId,
            ...(name ? { name } : {}),
            ...(argsDelta ? { inputDelta: argsDelta } : {}),
          },
        });
      }
    }

    return out;
  }

  /** Parse a non-streaming Chat Completions JSON body into collected output. */
  static parseMessage(body: unknown): CollectedOutput {
    const result: CollectedOutput = { text: "", toolUses: [] };
    if (typeof body !== "object" || body === null) {
      return result;
    }
    const choices = (body as Record<string, unknown>).choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      return result;
    }
    const first = choices[0];
    const message =
      typeof first === "object" && first !== null
        ? (first as Record<string, unknown>).message
        : undefined;
    if (typeof message !== "object" || message === null) {
      return result;
    }
    const record = message as Record<string, unknown>;
    if (typeof record.content === "string") {
      result.text = record.content;
    }
    if (Array.isArray(record.tool_calls)) {
      for (const call of record.tool_calls) {
        if (typeof call !== "object" || call === null) {
          continue;
        }
        const callRecord = call as Record<string, unknown>;
        const fn =
          typeof callRecord.function === "object" && callRecord.function !== null
            ? (callRecord.function as Record<string, unknown>)
            : {};
        result.toolUses.push({
          toolUseId: typeof callRecord.id === "string" ? callRecord.id : "",
          name: typeof fn.name === "string" ? fn.name : "",
          input: parseArguments(typeof fn.arguments === "string" ? fn.arguments : ""),
        });
      }
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Responses decoder
// ---------------------------------------------------------------------------

/**
 * Decodes an OpenAI Responses API response (streaming SSE or a full JSON body)
 * into provider-agnostic { textDelta, toolUse } deltas. Function calls arrive as
 * a `response.output_item.added` (carrying call_id + name) followed by
 * `response.function_call_arguments.delta` fragments keyed by `item_id`.
 */
export class ResponsesDecoder {
  private readonly itemToCallId = new Map<string, string>();

  /** Feed one streaming SSE frame; returns the deltas it produced (possibly none). */
  pushFrame(frame: string): OpenAiDelta[] {
    const data = parseSseData(frame);
    if (data === "[DONE]" || data === undefined) {
      return [];
    }
    return this.pushEvent(data);
  }

  /** Feed one parsed Responses SSE event object. */
  pushEvent(event: unknown): OpenAiDelta[] {
    if (typeof event !== "object" || event === null) {
      return [];
    }
    const record = event as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type : "";

    if (type === "response.output_text.delta") {
      const delta = typeof record.delta === "string" ? record.delta : "";
      return delta ? [{ textDelta: delta }] : [];
    }

    if (type === "response.output_item.added") {
      const item =
        typeof record.item === "object" && record.item !== null
          ? (record.item as Record<string, unknown>)
          : undefined;
      if (item && item.type === "function_call") {
        const itemId = typeof item.id === "string" ? item.id : "";
        const callId =
          typeof item.call_id === "string" && item.call_id ? item.call_id : itemId;
        const name = typeof item.name === "string" ? item.name : undefined;
        if (itemId) {
          this.itemToCallId.set(itemId, callId);
        }
        if (callId) {
          return [{ toolUse: { toolUseId: callId, ...(name ? { name } : {}) } }];
        }
      }
      return [];
    }

    if (type === "response.function_call_arguments.delta") {
      const itemId = typeof record.item_id === "string" ? record.item_id : "";
      const delta = typeof record.delta === "string" ? record.delta : "";
      const callId = this.itemToCallId.get(itemId) ?? itemId;
      if (callId && delta) {
        return [{ toolUse: { toolUseId: callId, inputDelta: delta } }];
      }
      return [];
    }

    return [];
  }

  /** Parse a non-streaming Responses JSON body into collected output. */
  static parseMessage(body: unknown): CollectedOutput {
    const result: CollectedOutput = { text: "", toolUses: [] };
    if (typeof body !== "object" || body === null) {
      return result;
    }
    const output = (body as Record<string, unknown>).output;
    if (!Array.isArray(output)) {
      return result;
    }
    const textParts: string[] = [];
    for (const item of output) {
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const record = item as Record<string, unknown>;
      if (record.type === "message" && Array.isArray(record.content)) {
        for (const part of record.content) {
          if (
            typeof part === "object" &&
            part !== null &&
            (part as Record<string, unknown>).type === "output_text" &&
            typeof (part as Record<string, unknown>).text === "string"
          ) {
            textParts.push((part as Record<string, unknown>).text as string);
          }
        }
      } else if (record.type === "function_call") {
        result.toolUses.push({
          toolUseId:
            typeof record.call_id === "string" && record.call_id
              ? record.call_id
              : typeof record.id === "string"
                ? record.id
                : "",
          name: typeof record.name === "string" ? record.name : "",
          input: parseArguments(typeof record.arguments === "string" ? record.arguments : ""),
        });
      }
    }
    result.text = textParts.join("");
    return result;
  }
}

// ---------------------------------------------------------------------------
// Responses SSE emitter (text + function_call)
// ---------------------------------------------------------------------------

function sseFrame(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

type EmitterToolState = {
  outputIndex: number;
  itemId: string;
  callId: string;
  name: string;
  args: string;
};

/**
 * Stateful emitter for the OpenAI Responses SSE sequence, supporting both text
 * (`output_text`) and function-call output items. Consumes the same
 * { textDelta, toolUse } deltas the decoders produce so an upstream Chat
 * Completions stream can be re-emitted as Responses events. The text message
 * occupies output_index 0; each tool call gets its own subsequent output item.
 *
 *   response.created
 *   (text): output_item.added(message) → content_part.added →
 *           output_text.delta* → output_text.done → content_part.done → output_item.done
 *   (tool): output_item.added(function_call) →
 *           function_call_arguments.delta* → function_call_arguments.done → output_item.done
 *   response.completed → [DONE]
 */
export class ResponsesSseEmitter {
  private readonly responseId: string;
  private readonly messageId: string;
  private readonly createdAt: number;
  private nextOutputIndex = 0;

  private textIndex: number | null = null;
  private textStarted = false;
  private text = "";

  private readonly toolByCallId = new Map<string, EmitterToolState>();
  private readonly toolOrder: string[] = [];

  constructor(
    private readonly model: string,
    private readonly inputTokens: number,
    createdAt: number,
  ) {
    this.responseId = `resp_${randomUUID().replace(/-/g, "")}`;
    this.messageId = `msg_${randomUUID().replace(/-/g, "")}`;
    this.createdAt = createdAt;
  }

  /** Opening `response.created` frame. */
  start(): string[] {
    return [
      sseFrame("response.created", {
        type: "response.created",
        response: {
          id: this.responseId,
          object: "response",
          created_at: this.createdAt,
          model: this.model,
          status: "in_progress",
        },
      }),
    ];
  }

  private startTextIfNeeded(): string[] {
    if (this.textStarted) {
      return [];
    }
    this.textStarted = true;
    this.textIndex = this.nextOutputIndex++;
    return [
      sseFrame("response.output_item.added", {
        type: "response.output_item.added",
        output_index: this.textIndex,
        item: { type: "message", id: this.messageId, status: "in_progress", role: "assistant", content: [] },
      }),
      sseFrame("response.content_part.added", {
        type: "response.content_part.added",
        item_id: this.messageId,
        output_index: this.textIndex,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      }),
    ];
  }

  textDelta(delta: string): string[] {
    if (!delta) {
      return [];
    }
    const frames = this.startTextIfNeeded();
    this.text += delta;
    frames.push(
      sseFrame("response.output_text.delta", {
        type: "response.output_text.delta",
        item_id: this.messageId,
        output_index: this.textIndex,
        content_index: 0,
        delta,
      }),
    );
    return frames;
  }

  toolUseDelta(delta: ToolUseDelta): string[] {
    const frames: string[] = [];
    let state = this.toolByCallId.get(delta.toolUseId);
    if (!state) {
      state = {
        outputIndex: this.nextOutputIndex++,
        itemId: `fc_${randomUUID().replace(/-/g, "")}`,
        callId: delta.toolUseId,
        name: delta.name ?? "",
        args: "",
      };
      this.toolByCallId.set(delta.toolUseId, state);
      this.toolOrder.push(delta.toolUseId);
      frames.push(
        sseFrame("response.output_item.added", {
          type: "response.output_item.added",
          output_index: state.outputIndex,
          item: {
            type: "function_call",
            id: state.itemId,
            status: "in_progress",
            call_id: state.callId,
            name: state.name,
            arguments: "",
          },
        }),
      );
    } else if (delta.name && !state.name) {
      state.name = delta.name;
    }
    if (delta.inputDelta) {
      state.args += delta.inputDelta;
      frames.push(
        sseFrame("response.function_call_arguments.delta", {
          type: "response.function_call_arguments.delta",
          item_id: state.itemId,
          output_index: state.outputIndex,
          delta: delta.inputDelta,
        }),
      );
    }
    return frames;
  }

  /** Closing frames: finish text + each tool item, then `response.completed` + [DONE]. */
  finish(outputTokens: number): string[] {
    const frames: string[] = [];
    const outputItems: Array<Record<string, unknown>> = [];

    if (this.textStarted) {
      frames.push(
        sseFrame("response.output_text.done", {
          type: "response.output_text.done",
          item_id: this.messageId,
          output_index: this.textIndex,
          content_index: 0,
          text: this.text,
        }),
        sseFrame("response.content_part.done", {
          type: "response.content_part.done",
          item_id: this.messageId,
          output_index: this.textIndex,
          content_index: 0,
          part: { type: "output_text", text: this.text, annotations: [] },
        }),
        sseFrame("response.output_item.done", {
          type: "response.output_item.done",
          output_index: this.textIndex,
          item: {
            type: "message",
            id: this.messageId,
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: this.text, annotations: [] }],
          },
        }),
      );
      outputItems.push({
        type: "message",
        id: this.messageId,
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: this.text, annotations: [] }],
      });
    }

    for (const callId of this.toolOrder) {
      const state = this.toolByCallId.get(callId)!;
      frames.push(
        sseFrame("response.function_call_arguments.done", {
          type: "response.function_call_arguments.done",
          item_id: state.itemId,
          output_index: state.outputIndex,
          arguments: state.args,
        }),
        sseFrame("response.output_item.done", {
          type: "response.output_item.done",
          output_index: state.outputIndex,
          item: {
            type: "function_call",
            id: state.itemId,
            status: "completed",
            call_id: state.callId,
            name: state.name,
            arguments: state.args,
          },
        }),
      );
      outputItems.push({
        type: "function_call",
        id: state.itemId,
        status: "completed",
        call_id: state.callId,
        name: state.name,
        arguments: state.args,
      });
    }

    frames.push(
      sseFrame("response.completed", {
        type: "response.completed",
        response: {
          id: this.responseId,
          object: "response",
          created_at: this.createdAt,
          model: this.model,
          status: "completed",
          output: outputItems,
          usage: {
            input_tokens: this.inputTokens,
            output_tokens: outputTokens,
            total_tokens: this.inputTokens + outputTokens,
          },
        },
      }),
      "data: [DONE]\n\n",
    );
    return frames;
  }
}

// ---------------------------------------------------------------------------
// Chat Completions → Responses translation
// ---------------------------------------------------------------------------

/**
 * Build a non-streaming Responses JSON body from an upstream Chat Completions
 * JSON body, so `/v1/responses` clients get Responses-shaped output from a
 * `chat_completions` provider.
 */
export function translateChatCompletionToResponsesJson(
  body: unknown,
  args: { model: string; inputText: string },
): Record<string, unknown> {
  const collected = ChatCompletionsDecoder.parseMessage(body);
  const output: Array<Record<string, unknown>> = [];
  const messageId = `msg_${randomUUID().replace(/-/g, "")}`;
  if (collected.text) {
    output.push({
      type: "message",
      id: messageId,
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text: collected.text, annotations: [] }],
    });
  }
  for (const toolUse of collected.toolUses) {
    output.push({
      type: "function_call",
      id: `fc_${randomUUID().replace(/-/g, "")}`,
      status: "completed",
      call_id: toolUse.toolUseId,
      name: toolUse.name,
      arguments: JSON.stringify(toolUse.input ?? {}),
    });
  }

  const inputTokens = estimateTokens(args.inputText);
  const outputTokens = estimateTokens(
    collected.text + collected.toolUses.map((t) => JSON.stringify(t.input)).join(""),
  );
  const usageSource = readChatUsage(body);
  return {
    id: `resp_${randomUUID().replace(/-/g, "")}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: args.model,
    output,
    usage: {
      input_tokens: usageSource?.input_tokens ?? inputTokens,
      output_tokens: usageSource?.output_tokens ?? outputTokens,
      total_tokens:
        usageSource?.total_tokens ??
        (usageSource?.input_tokens ?? inputTokens) + (usageSource?.output_tokens ?? outputTokens),
    },
  };
}

function readChatUsage(
  body: unknown,
): { input_tokens?: number; output_tokens?: number; total_tokens?: number } | undefined {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  const usage = (body as Record<string, unknown>).usage;
  if (typeof usage !== "object" || usage === null) {
    return undefined;
  }
  const record = usage as Record<string, unknown>;
  const prompt = typeof record.prompt_tokens === "number" ? record.prompt_tokens : undefined;
  const completion =
    typeof record.completion_tokens === "number" ? record.completion_tokens : undefined;
  const total = typeof record.total_tokens === "number" ? record.total_tokens : undefined;
  if (prompt === undefined && completion === undefined && total === undefined) {
    return undefined;
  }
  return { input_tokens: prompt, output_tokens: completion, total_tokens: total };
}

/**
 * Stateful translator that converts an upstream Chat Completions SSE stream into
 * Responses SSE frames on the fly. Feed complete upstream frames to `pushFrame`;
 * it returns Responses frames to write to the client. Call `finish` at stream end.
 */
export class ChatToResponsesStreamTranslator {
  private readonly decoder = new ChatCompletionsDecoder();
  private readonly emitter: ResponsesSseEmitter;
  private started = false;
  private text = "";
  private readonly toolArgs = new Map<string, string>();
  private readonly toolOrder: string[] = [];

  constructor(model: string, inputText: string, createdAt: number) {
    this.emitter = new ResponsesSseEmitter(model, estimateTokens(inputText), createdAt);
  }

  private ensureStarted(): string[] {
    if (this.started) {
      return [];
    }
    this.started = true;
    return this.emitter.start();
  }

  pushFrame(frame: string): string[] {
    const out: string[] = [];
    for (const delta of this.decoder.pushFrame(frame)) {
      if (delta.textDelta) {
        out.push(...this.ensureStarted());
        this.text += delta.textDelta;
        out.push(...this.emitter.textDelta(delta.textDelta));
      }
      if (delta.toolUse) {
        out.push(...this.ensureStarted());
        if (!this.toolArgs.has(delta.toolUse.toolUseId)) {
          this.toolArgs.set(delta.toolUse.toolUseId, "");
          this.toolOrder.push(delta.toolUse.toolUseId);
        }
        if (delta.toolUse.inputDelta) {
          this.toolArgs.set(
            delta.toolUse.toolUseId,
            (this.toolArgs.get(delta.toolUse.toolUseId) ?? "") + delta.toolUse.inputDelta,
          );
        }
        out.push(...this.emitter.toolUseDelta(delta.toolUse));
      }
    }
    return out;
  }

  finish(): string[] {
    const out = this.ensureStarted();
    const outputText =
      this.text + this.toolOrder.map((id) => this.toolArgs.get(id) ?? "").join("");
    out.push(...this.emitter.finish(estimateTokens(outputText)));
    return out;
  }
}
