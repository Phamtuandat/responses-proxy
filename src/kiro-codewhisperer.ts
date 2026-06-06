import { randomUUID } from "node:crypto";
import {
  EventStreamParser,
  type EventStreamMessage,
  decodeJsonPayload,
  eventType,
} from "./kiro-eventstream.js";

/**
 * Translates between the OpenAI Responses payloads this proxy speaks and the AWS
 * CodeWhisperer / Amazon Q `generateAssistantResponse` protocol that Kiro tokens
 * authenticate against.
 *
 * The CodeWhisperer wire format is not an officially documented public API; the
 * envelope shape here mirrors the Kiro desktop client and community proxies. The
 * request is plain JSON; the response is an `application/vnd.amazon.eventstream`
 * binary stream of `assistantResponseEvent` frames (see kiro-eventstream.ts).
 */

export const CODEWHISPERER_GENERATE_PATH = "/generateAssistantResponse";

/**
 * Default alias → CodeWhisperer modelId map for the Kiro provider. CodeWhisperer
 * for Kiro uses lowercase model ids (e.g. `claude-sonnet-4`, `auto`), NOT the
 * bedrock-style `CLAUDE_SONNET_4_...` ids. Values mirror 9router's catalog.
 */
export const DEFAULT_KIRO_MODEL_ALIASES: Record<string, string> = {
  // ─── Auto (router) ───
  auto: "auto",
  "kiro-auto": "auto",
  "kr/auto": "auto",

  // ─── Claude Opus series ───
  "claude-opus-4-8": "claude-opus-4-8",
  "claude-opus-4.8": "claude-opus-4-8",
  "kr/claude-opus-4-8": "claude-opus-4-8",
  "kr/claude-opus-4.8": "claude-opus-4-8",
  "claude-opus-4-7": "claude-opus-4-7",
  "claude-opus-4.7": "claude-opus-4-7",
  "kr/claude-opus-4-7": "claude-opus-4-7",
  "kr/claude-opus-4.7": "claude-opus-4-7",
  "claude-opus-4-6": "claude-opus-4-6",
  "claude-opus-4.6": "claude-opus-4-6",
  "kr/claude-opus-4-6": "claude-opus-4-6",
  "kr/claude-opus-4.6": "claude-opus-4-6",
  "claude-opus-4-5": "claude-opus-4-5",
  "claude-opus-4.5": "claude-opus-4-5",
  "kr/claude-opus-4-5": "claude-opus-4-5",
  "kr/claude-opus-4.5": "claude-opus-4-5",

  // ─── Claude Sonnet series ───
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-sonnet-4.6": "claude-sonnet-4-6",
  "kr/claude-sonnet-4-6": "claude-sonnet-4-6",
  "kr/claude-sonnet-4.6": "claude-sonnet-4-6",
  "claude-sonnet-4-5": "claude-sonnet-4-5",
  "claude-sonnet-4.5": "claude-sonnet-4-5",
  "kr/claude-sonnet-4-5": "claude-sonnet-4-5",
  "kr/claude-sonnet-4.5": "claude-sonnet-4-5",
  "claude-sonnet-4": "claude-sonnet-4",
  "claude-sonnet-4-0": "claude-sonnet-4",
  "claude-sonnet-4.0": "claude-sonnet-4",
  "kr/claude-sonnet-4": "claude-sonnet-4",
  "kr/claude-sonnet-4-0": "claude-sonnet-4",

  // ─── Claude Haiku ───
  "claude-haiku-4-5": "claude-haiku-4.5",
  "claude-haiku-4.5": "claude-haiku-4.5",
  "kr/claude-haiku-4-5": "claude-haiku-4.5",
  "kr/claude-haiku-4.5": "claude-haiku-4.5",

  // ─── Non-Claude models (open weight) ───
  "deepseek-3.2": "deepseek-3.2",
  "deepseek-3-2": "deepseek-3.2",
  "kr/deepseek-3.2": "deepseek-3.2",
  "kr/deepseek-3-2": "deepseek-3.2",
  "minimax-m2.5": "MiniMax-M2.5",
  "minimax-m2-5": "MiniMax-M2.5",
  "MiniMax-M2.5": "MiniMax-M2.5",
  "kr/minimax-m2.5": "MiniMax-M2.5",
  "kr/minimax-m2-5": "MiniMax-M2.5",
  "minimax-m2.1": "MiniMax-M2.1",
  "minimax-m2-1": "MiniMax-M2.1",
  "MiniMax-M2.1": "MiniMax-M2.1",
  "kr/minimax-m2.1": "MiniMax-M2.1",
  "kr/minimax-m2-1": "MiniMax-M2.1",
  "glm-5": "glm-5",
  "kr/glm-5": "glm-5",
  "qwen3-coder-next": "qwen3-coder-next",
  "kr/qwen3-coder-next": "qwen3-coder-next",

  // ─── Legacy aliases (kiro- prefix) ───
  "kiro-claude-sonnet-4": "claude-sonnet-4",
  "kiro-claude-sonnet-4-5": "claude-sonnet-4-5",
  "kiro-claude-sonnet-4-6": "claude-sonnet-4-6",
  "kiro-claude-haiku-4-5": "claude-haiku-4.5",
  "kiro-claude-opus-4-5": "claude-opus-4-5",
  "kiro-claude-opus-4-6": "claude-opus-4-6",
  "kiro-claude-opus-4-7": "claude-opus-4-7",
  "kiro-claude-opus-4-8": "claude-opus-4-8",
};

/** `auto` lets CodeWhisperer pick the model; safest default matching 9router. */
export const DEFAULT_KIRO_MODEL_ID = "auto";

const CHAT_TRIGGER_TYPE = "MANUAL";
const MESSAGE_ORIGIN = "AI_EDITOR";
const DEFAULT_MAX_TOKENS = 32000;

type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

export type CodeWhispererRequest = {
  conversationState: {
    chatTriggerType: string;
    conversationId: string;
    currentMessage: {
      userInputMessage: {
        content: string;
        modelId: string;
        origin: string;
        userInputMessageContext: Record<string, unknown>;
      };
    };
    history: Array<Record<string, unknown>>;
  };
  profileArn?: string;
  inferenceConfig: {
    maxTokens: number;
    temperature?: number;
    topP?: number;
  };
};

/** A tool definition exposed to CodeWhisperer (mirrors Anthropic/OpenAI tool specs). */
export type CodeWhispererToolSpec = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

/** A prior tool execution result fed back into the conversation context. */
export type CodeWhispererToolResultInput = {
  toolUseId: string;
  content: string;
  status?: "success" | "error";
};

/** A completed assistant tool call parsed from the response stream. */
export type CodeWhispererToolUse = {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
};

/** A structured conversation turn that may carry tool calls / tool results. */
export type StructuredTurn =
  | { role: "user"; content: string; toolResults?: CodeWhispererToolResultInput[] }
  | { role: "assistant"; content: string; toolUses?: CodeWhispererToolUse[] };

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Resolve a client-facing model name to a CodeWhisperer modelId. Lookups are
 * case-insensitive; unknown names fall through to `defaultModelId` so the proxy
 * still issues a request rather than rejecting unfamiliar aliases.
 */
export function mapModelToCodeWhisperer(
  model: string | undefined,
  aliases: Record<string, string> = DEFAULT_KIRO_MODEL_ALIASES,
  defaultModelId: string = DEFAULT_KIRO_MODEL_ID,
): string {
  const normalized = typeof model === "string" ? model.trim() : "";
  if (!normalized) {
    return defaultModelId;
  }
  // Exact match first, then case-insensitive.
  if (aliases[normalized]) {
    return aliases[normalized];
  }
  const lower = normalized.toLowerCase();
  for (const [alias, modelId] of Object.entries(aliases)) {
    if (alias.toLowerCase() === lower) {
      return modelId;
    }
  }
  // Claude Code / the Anthropic SDK send date-suffixed ids (e.g.
  // `claude-sonnet-4-20250514`). CodeWhisperer expects the bare lowercase id, so
  // strip a trailing `-YYYYMMDD` and re-check aliases before falling through.
  const deDated = lower.replace(/-\d{8}$/, "");
  if (deDated !== lower) {
    if (aliases[deDated]) {
      return aliases[deDated];
    }
    if (deDated === "auto" || deDated.startsWith("claude-")) {
      return deDated;
    }
  }
  // Pass a recognized Kiro model id straight through (lowercase `auto`/`claude-*`).
  if (lower === "auto" || lower.startsWith("claude-")) {
    return lower;
  }
  return defaultModelId;
}

/** Pull plain text out of a Responses content value (string or content-part array). */
function extractContentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part);
      continue;
    }
    if (typeof part === "object" && part !== null) {
      const record = part as Record<string, unknown>;
      if (typeof record.text === "string") {
        parts.push(record.text);
      }
    }
  }
  return parts.join("");
}

function normalizeRole(role: unknown): "user" | "assistant" | "system" {
  if (role === "assistant") {
    return "assistant";
  }
  if (role === "system" || role === "developer") {
    return "system";
  }
  return "user";
}

/**
 * Flatten a Responses request (instructions + input/messages) into an ordered list
 * of user/assistant turns. System/developer text and top-level `instructions` are
 * folded into the first user turn, since CodeWhisperer has no separate system slot.
 */
export function flattenResponsesConversation(body: Record<string, unknown>): ConversationTurn[] {
  const systemChunks: string[] = [];
  if (typeof body.instructions === "string" && body.instructions.trim()) {
    systemChunks.push(body.instructions.trim());
  }

  const turns: ConversationTurn[] = [];
  const rawInput = body.input ?? body.messages;

  if (typeof rawInput === "string") {
    turns.push({ role: "user", content: rawInput });
  } else if (Array.isArray(rawInput)) {
    for (const item of rawInput) {
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const record = item as Record<string, unknown>;
      const role = normalizeRole(record.role);
      const text = extractContentText(record.content);
      if (!text) {
        continue;
      }
      if (role === "system") {
        systemChunks.push(text);
        continue;
      }
      turns.push({ role, content: text });
    }
  }

  if (systemChunks.length > 0) {
    const systemText = systemChunks.join("\n\n");
    const firstUserIndex = turns.findIndex((turn) => turn.role === "user");
    if (firstUserIndex >= 0) {
      turns[firstUserIndex] = {
        role: "user",
        content: `${systemText}\n\n${turns[firstUserIndex].content}`,
      };
    } else {
      turns.unshift({ role: "user", content: systemText });
    }
  }

  return turns;
}

/**
 * Build the CodeWhisperer `generateAssistantResponse` request body. Mirrors the
 * shape 9router sends: a `[Context: ...]` prefix on the current message, an
 * `inferenceConfig`, and `profileArn` only when non-empty.
 */
export function buildCodeWhispererRequest(args: {
  body: Record<string, unknown>;
  modelId: string;
  profileArn?: string | null;
  conversationId?: string;
  now?: Date;
}): CodeWhispererRequest {
  const turns = flattenResponsesConversation(args.body).map(
    (turn): StructuredTurn => ({ role: turn.role, content: turn.content }),
  );
  return buildCodeWhispererRequestFromTurns({
    turns,
    modelId: args.modelId,
    profileArn: args.profileArn,
    conversationId: args.conversationId,
    now: args.now,
    maxTokens: readNumber(args.body.max_output_tokens),
    temperature: readNumber(args.body.temperature),
    topP: readNumber(args.body.top_p),
  });
}

function normalizeToolSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || Object.keys(schema).length === 0) {
    return { type: "object", properties: {}, required: [] };
  }
  return {
    ...schema,
    required: Array.isArray(schema.required) ? schema.required : [],
  };
}

function toolResultContext(results: CodeWhispererToolResultInput[]): Record<string, unknown> {
  return {
    toolResults: results.map((result) => ({
      toolUseId: result.toolUseId,
      status: result.status ?? "success",
      content: [{ text: result.content }],
    })),
  };
}

/**
 * Lower-level builder shared by the Responses and Anthropic Messages paths. Takes
 * already-structured turns (optionally carrying tool calls / tool results), splits
 * out the final user turn as the current message, and assembles the CodeWhisperer
 * request. Available `tools` and the current turn's `toolResults` are placed in the
 * current message's `userInputMessageContext`, matching 9router's wire format.
 */
export function buildCodeWhispererRequestFromTurns(args: {
  turns: StructuredTurn[];
  modelId: string;
  tools?: CodeWhispererToolSpec[];
  profileArn?: string | null;
  conversationId?: string;
  now?: Date;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}): CodeWhispererRequest {
  const { turns } = args;

  // The final user turn is the "current" message; everything before is history.
  let lastUserIndex = -1;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }

  const currentTurn = lastUserIndex >= 0 ? turns[lastUserIndex] : undefined;
  const historyTurns = lastUserIndex >= 0 ? turns.slice(0, lastUserIndex) : turns;

  const rawCurrentContent = currentTurn ? currentTurn.content : "";
  // 9router prepends a context block to the current message; match it so behavior
  // is consistent with the proven client.
  const nowIso = (args.now ?? new Date()).toISOString();
  const currentContent = `[Context: Current time is ${nowIso}]\n\n${rawCurrentContent}`;

  // Current message context: available tool specs + any tool results answering a
  // previous assistant tool call.
  const currentContext: Record<string, unknown> = {};
  if (args.tools && args.tools.length > 0) {
    currentContext.tools = args.tools.map((tool) => ({
      toolSpecification: {
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: { json: normalizeToolSchema(tool.inputSchema) },
      },
    }));
  }
  const currentToolResults =
    currentTurn && currentTurn.role === "user" ? currentTurn.toolResults : undefined;
  if (currentToolResults && currentToolResults.length > 0) {
    Object.assign(currentContext, toolResultContext(currentToolResults));
  }

  const history: Array<Record<string, unknown>> = [];
  for (const turn of historyTurns) {
    if (turn.role === "user") {
      const userMessage: Record<string, unknown> = {
        content: turn.content,
        modelId: args.modelId,
        origin: MESSAGE_ORIGIN,
      };
      if (turn.toolResults && turn.toolResults.length > 0) {
        userMessage.userInputMessageContext = toolResultContext(turn.toolResults);
      }
      history.push({ userInputMessage: userMessage });
    } else {
      const assistantMessage: Record<string, unknown> = { content: turn.content };
      if (turn.toolUses && turn.toolUses.length > 0) {
        assistantMessage.toolUses = turn.toolUses.map((toolUse) => ({
          toolUseId: toolUse.toolUseId,
          name: toolUse.name,
          input: toolUse.input,
        }));
      }
      history.push({ assistantResponseMessage: assistantMessage });
    }
  }

  const maxTokens = args.maxTokens ?? DEFAULT_MAX_TOKENS;
  const request: CodeWhispererRequest = {
    conversationState: {
      chatTriggerType: CHAT_TRIGGER_TYPE,
      conversationId: args.conversationId ?? randomUUID(),
      currentMessage: {
        userInputMessage: {
          content: currentContent,
          modelId: args.modelId,
          origin: MESSAGE_ORIGIN,
          userInputMessageContext: currentContext,
        },
      },
      history,
    },
    inferenceConfig: {
      maxTokens,
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      ...(args.topP !== undefined ? { topP: args.topP } : {}),
    },
    ...(args.profileArn ? { profileArn: args.profileArn } : {}),
  };
  return request;
}

/** Event types that carry assistant-visible text (per 9router's parser). */
const TEXT_EVENT_TYPES = new Set(["assistantResponseEvent", "codeEvent"]);

/** Extract the assistant text delta from a single parsed CodeWhisperer event. */
export function extractAssistantDelta(message: EventStreamMessage): string {
  const type = eventType(message);
  // Untyped frames (no `:event-type`) still commonly carry `{ content }`.
  if (type && !TEXT_EVENT_TYPES.has(type)) {
    return "";
  }
  const payload = decodeJsonPayload(message);
  if (!payload) {
    return "";
  }
  // CodeWhisperer assistant/code frames carry `{ content: "..." }`; some variants
  // nest the text under `assistantResponseEvent.content`.
  if (typeof payload.content === "string") {
    return payload.content;
  }
  const nested = payload.assistantResponseEvent;
  if (typeof nested === "object" && nested !== null) {
    const nestedContent = (nested as Record<string, unknown>).content;
    if (typeof nestedContent === "string") {
      return nestedContent;
    }
  }
  return "";
}

/** Check whether a parsed CodeWhisperer event signals an upstream error. */
export function extractCodeWhispererError(message: EventStreamMessage): string | undefined {
  const type = eventType(message);
  if (!type || !/error|exception/i.test(type)) {
    return undefined;
  }
  const payload = decodeJsonPayload(message);
  const messageText =
    payload && typeof payload.message === "string" ? payload.message : `CodeWhisperer ${type}`;
  return messageText;
}

/** Concatenate all assistant text from a fully buffered event-stream response. */
export function collectAssistantText(buffer: Buffer): {
  text: string;
  error?: string;
} {
  const parser = new EventStreamParser();
  const messages = parser.push(buffer);
  let text = "";
  let error: string | undefined;
  for (const message of messages) {
    const errText = extractCodeWhispererError(message);
    if (errText) {
      error = errText;
      continue;
    }
    text += extractAssistantDelta(message);
  }
  return { text, error };
}

/** A partial tool-use signal parsed from a single `toolUseEvent` frame. */
export type ToolUseDelta = {
  toolUseId: string;
  name?: string;
  inputDelta?: string;
  stop?: boolean;
};

/** Parse a `toolUseEvent` frame into a partial tool-use delta, if present. */
export function extractToolUseDelta(message: EventStreamMessage): ToolUseDelta | undefined {
  if (eventType(message) !== "toolUseEvent") {
    return undefined;
  }
  const payload = decodeJsonPayload(message);
  if (!payload) {
    return undefined;
  }
  const toolUseId = typeof payload.toolUseId === "string" ? payload.toolUseId : "";
  if (!toolUseId) {
    return undefined;
  }
  return {
    toolUseId,
    name: typeof payload.name === "string" ? payload.name : undefined,
    inputDelta: typeof payload.input === "string" ? payload.input : undefined,
    stop: payload.stop === true,
  };
}

function parseJsonObject(raw: string): Record<string, unknown> {
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

/**
 * Accumulates assistant text and tool-use calls across CodeWhisperer event frames.
 * A tool call's `input` arrives as a partial JSON string spread over multiple
 * `toolUseEvent` frames keyed by `toolUseId`, so we concatenate per id and parse
 * once the stream completes. `push` returns the per-frame delta so the streaming
 * path can forward incremental text / tool-input deltas to the client.
 */
export class KiroResponseAccumulator {
  text = "";
  error?: string;
  private readonly toolOrder: string[] = [];
  private readonly toolNames = new Map<string, string>();
  private readonly toolInputs = new Map<string, string>();

  push(message: EventStreamMessage): { textDelta?: string; toolUse?: ToolUseDelta } {
    const errText = extractCodeWhispererError(message);
    if (errText) {
      this.error = errText;
      return {};
    }
    const toolDelta = extractToolUseDelta(message);
    if (toolDelta) {
      if (!this.toolNames.has(toolDelta.toolUseId)) {
        this.toolOrder.push(toolDelta.toolUseId);
        this.toolNames.set(toolDelta.toolUseId, toolDelta.name ?? "");
      } else if (toolDelta.name) {
        this.toolNames.set(toolDelta.toolUseId, toolDelta.name);
      }
      if (toolDelta.inputDelta) {
        this.toolInputs.set(
          toolDelta.toolUseId,
          (this.toolInputs.get(toolDelta.toolUseId) ?? "") + toolDelta.inputDelta,
        );
      }
      return { toolUse: toolDelta };
    }
    const delta = extractAssistantDelta(message);
    if (delta) {
      this.text += delta;
      return { textDelta: delta };
    }
    return {};
  }

  hasToolUses(): boolean {
    return this.toolOrder.length > 0;
  }

  toolUses(): CodeWhispererToolUse[] {
    return this.toolOrder.map((id) => ({
      toolUseId: id,
      name: this.toolNames.get(id) ?? "",
      input: parseJsonObject(this.toolInputs.get(id) ?? ""),
    }));
  }
}

/** Rough token estimate (~4 chars/token) used for usage accounting; CW omits usage. */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Assemble a non-streaming Responses API JSON body from collected assistant text. */
export function buildResponsesJson(args: {
  text: string;
  model: string;
  inputText: string;
  createdAt?: number;
  responseId?: string;
}): Record<string, unknown> {
  const inputTokens = estimateTokens(args.inputText);
  const outputTokens = estimateTokens(args.text);
  const responseId = args.responseId ?? `resp_${randomUUID().replace(/-/g, "")}`;
  const messageId = `msg_${randomUUID().replace(/-/g, "")}`;
  return {
    id: responseId,
    object: "response",
    created_at: args.createdAt ?? Math.floor(Date.now() / 1000),
    status: "completed",
    model: args.model,
    output: [
      {
        type: "message",
        id: messageId,
        status: "completed",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: args.text,
            annotations: [],
          },
        ],
      },
    ],
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
    },
  };
}

function sseFrame(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Identifiers + timestamp shared across the SSE frames of a single response. */
export type SseStreamIds = {
  responseId: string;
  messageId: string;
  model: string;
  createdAt: number;
};

/** Allocate fresh response/message ids for a streaming turn. */
export function newSseStreamIds(model: string): SseStreamIds {
  return {
    responseId: `resp_${randomUUID().replace(/-/g, "")}`,
    messageId: `msg_${randomUUID().replace(/-/g, "")}`,
    model,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

/** Opening SSE frames sent before any assistant text (response/item/part created). */
export function buildSsePreludeFrames(ids: SseStreamIds): string[] {
  const baseResponse = {
    id: ids.responseId,
    object: "response",
    created_at: ids.createdAt,
    model: ids.model,
  };
  return [
    sseFrame("response.created", {
      type: "response.created",
      response: { ...baseResponse, status: "in_progress" },
    }),
    sseFrame("response.output_item.added", {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "message", id: ids.messageId, status: "in_progress", role: "assistant", content: [] },
    }),
    sseFrame("response.content_part.added", {
      type: "response.content_part.added",
      item_id: ids.messageId,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    }),
  ];
}

/** A single incremental `response.output_text.delta` frame. */
export function buildSseDeltaFrame(ids: SseStreamIds, delta: string): string {
  return sseFrame("response.output_text.delta", {
    type: "response.output_text.delta",
    item_id: ids.messageId,
    output_index: 0,
    content_index: 0,
    delta,
  });
}

/** Closing SSE frames once all deltas are sent (text/part/item done, completed, [DONE]). */
export function buildSseFinaleFrames(
  ids: SseStreamIds,
  args: { text: string; inputTokens: number; outputTokens: number },
): string[] {
  const completedResponse = {
    id: ids.responseId,
    object: "response",
    created_at: ids.createdAt,
    model: ids.model,
    status: "completed",
    output: [
      {
        type: "message",
        id: ids.messageId,
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: args.text, annotations: [] }],
      },
    ],
    usage: {
      input_tokens: args.inputTokens,
      output_tokens: args.outputTokens,
      total_tokens: args.inputTokens + args.outputTokens,
    },
  };

  return [
    sseFrame("response.output_text.done", {
      type: "response.output_text.done",
      item_id: ids.messageId,
      output_index: 0,
      content_index: 0,
      text: args.text,
    }),
    sseFrame("response.content_part.done", {
      type: "response.content_part.done",
      item_id: ids.messageId,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: args.text, annotations: [] },
    }),
    sseFrame("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "message",
        id: ids.messageId,
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: args.text, annotations: [] }],
      },
    }),
    sseFrame("response.completed", { type: "response.completed", response: completedResponse }),
    "data: [DONE]\n\n",
  ];
}

/**
 * Build the full ordered list of Responses SSE frames for an already-collected
 * assistant turn (prelude + one delta + finale). Used for tests and as a fallback;
 * the live streaming path emits the same frames incrementally via the helpers above.
 */
export function buildResponsesSseFrames(args: {
  text: string;
  model: string;
  inputText: string;
  responseId?: string;
}): string[] {
  const ids = newSseStreamIds(args.model);
  if (args.responseId) {
    ids.responseId = args.responseId;
  }
  return [
    ...buildSsePreludeFrames(ids),
    buildSseDeltaFrame(ids, args.text),
    ...buildSseFinaleFrames(ids, {
      text: args.text,
      inputTokens: estimateTokens(args.inputText),
      outputTokens: estimateTokens(args.text),
    }),
  ];
}

/** The flattened input text, used for token estimation on the request side. */
export function collectInputText(body: Record<string, unknown>): string {
  return flattenResponsesConversation(body)
    .map((turn) => turn.content)
    .join("\n");
}
