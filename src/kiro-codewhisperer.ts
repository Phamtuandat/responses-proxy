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
  auto: "auto",
  "kiro-auto": "auto",
  "kiro-claude-sonnet-4": "claude-sonnet-4",
  "claude-sonnet-4": "claude-sonnet-4",
  "kiro-claude-sonnet-4-5": "claude-sonnet-4-5",
  "claude-sonnet-4-5": "claude-sonnet-4-5",
  "kiro-claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "kiro-claude-haiku-4-5": "claude-haiku-4.5",
  "claude-haiku-4-5": "claude-haiku-4.5",
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
  // Pass a recognized Kiro model id straight through (lowercase `auto`/`claude-*`).
  const lowered = normalized.toLowerCase();
  if (lowered === "auto" || lowered.startsWith("claude-")) {
    return lowered;
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
  const turns = flattenResponsesConversation(args.body);

  // The final user turn is the "current" message; everything before is history.
  let lastUserIndex = -1;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }

  const rawCurrentContent = lastUserIndex >= 0 ? turns[lastUserIndex].content : "";
  const historyTurns = lastUserIndex >= 0 ? turns.slice(0, lastUserIndex) : turns;

  // 9router prepends a context block to the current message; match it so behavior
  // is consistent with the proven client.
  const nowIso = (args.now ?? new Date()).toISOString();
  const currentContent = `[Context: Current time is ${nowIso}]\n\n${rawCurrentContent}`;

  const history: Array<Record<string, unknown>> = [];
  for (const turn of historyTurns) {
    if (turn.role === "user") {
      history.push({
        userInputMessage: {
          content: turn.content,
          modelId: args.modelId,
          origin: MESSAGE_ORIGIN,
        },
      });
    } else {
      history.push({
        assistantResponseMessage: {
          content: turn.content,
        },
      });
    }
  }

  const maxTokens = readNumber(args.body.max_output_tokens) ?? DEFAULT_MAX_TOKENS;
  const temperature = readNumber(args.body.temperature);
  const topP = readNumber(args.body.top_p);

  const request: CodeWhispererRequest = {
    conversationState: {
      chatTriggerType: CHAT_TRIGGER_TYPE,
      conversationId: args.conversationId ?? randomUUID(),
      currentMessage: {
        userInputMessage: {
          content: currentContent,
          modelId: args.modelId,
          origin: MESSAGE_ORIGIN,
          userInputMessageContext: {},
        },
      },
      history,
    },
    inferenceConfig: {
      maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(topP !== undefined ? { topP } : {}),
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
