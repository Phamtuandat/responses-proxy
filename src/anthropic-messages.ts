import { randomUUID } from "node:crypto";
import {
  type CodeWhispererToolResultInput,
  type CodeWhispererToolSpec,
  type CodeWhispererToolUse,
  type StructuredTurn,
  type ToolUseDelta,
  estimateTokens,
} from "./kiro-codewhisperer.js";

/**
 * Translates between the Anthropic Messages API (what Claude Code speaks) and the
 * structured turn/tool model the Kiro/CodeWhisperer forwarder consumes.
 *
 * Anthropic request → { turns, tools } for buildCodeWhispererRequestFromTurns.
 * CodeWhisperer response → Anthropic `message` JSON or the Anthropic SSE event
 * sequence (message_start → content_block_* → message_delta → message_stop).
 */

const ANTHROPIC_MAX_TOKENS_DEFAULT = 32000;

export type ParsedAnthropicRequest = {
  model: string;
  turns: StructuredTurn[];
  tools: CodeWhispererToolSpec[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stream: boolean;
  /** Flattened input text, for token estimation. */
  inputText: string;
};

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Extract plain text from an Anthropic system field (string or text-block array). */
function extractSystemText(system: unknown): string {
  if (typeof system === "string") {
    return system.trim();
  }
  if (!Array.isArray(system)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of system) {
    if (typeof block === "object" && block !== null) {
      const record = block as Record<string, unknown>;
      if (record.type === "text" && typeof record.text === "string") {
        parts.push(record.text);
      }
    }
  }
  return parts.join("\n\n").trim();
}

/** Extract text from a tool_result `content` (string or array of text blocks). */
function extractToolResultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "object" && block !== null) {
      const record = block as Record<string, unknown>;
      if (typeof record.text === "string") {
        parts.push(record.text);
      }
    }
  }
  return parts.join("");
}

type ParsedMessageContent = {
  text: string;
  toolUses: CodeWhispererToolUse[];
  toolResults: CodeWhispererToolResultInput[];
};

/** Parse an Anthropic message `content` (string or block array) into its parts. */
function parseMessageContent(content: unknown): ParsedMessageContent {
  const result: ParsedMessageContent = { text: "", toolUses: [], toolResults: [] };
  if (typeof content === "string") {
    result.text = content;
    return result;
  }
  if (!Array.isArray(content)) {
    return result;
  }
  const textParts: string[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) {
      continue;
    }
    const record = block as Record<string, unknown>;
    switch (record.type) {
      case "text":
        if (typeof record.text === "string") {
          textParts.push(record.text);
        }
        break;
      case "tool_use":
        result.toolUses.push({
          toolUseId: readString(record.id),
          name: readString(record.name),
          input:
            typeof record.input === "object" && record.input !== null
              ? (record.input as Record<string, unknown>)
              : {},
        });
        break;
      case "tool_result":
        result.toolResults.push({
          toolUseId: readString(record.tool_use_id),
          content: extractToolResultText(record.content),
          status: record.is_error === true ? "error" : "success",
        });
        break;
      default:
        // image / other blocks are not translated in v1.
        break;
    }
  }
  result.text = textParts.join("");
  return result;
}

/** Parse Anthropic `tools` into CodeWhisperer tool specs (input_schema → inputSchema). */
function parseTools(tools: unknown): CodeWhispererToolSpec[] {
  if (!Array.isArray(tools)) {
    return [];
  }
  const specs: CodeWhispererToolSpec[] = [];
  for (const tool of tools) {
    if (typeof tool !== "object" || tool === null) {
      continue;
    }
    const record = tool as Record<string, unknown>;
    const name = readString(record.name);
    if (!name) {
      continue;
    }
    const schema =
      typeof record.input_schema === "object" && record.input_schema !== null
        ? (record.input_schema as Record<string, unknown>)
        : {};
    specs.push({
      name,
      description: readString(record.description) || undefined,
      inputSchema: schema,
    });
  }
  return specs;
}

/**
 * Parse an Anthropic Messages request body into structured turns + tools. The
 * system prompt is folded into the first user turn (CodeWhisperer has no system
 * slot), matching how the Responses path handles instructions.
 */
export function parseAnthropicRequest(body: Record<string, unknown>): ParsedAnthropicRequest {
  const systemText = extractSystemText(body.system);
  const rawMessages = Array.isArray(body.messages) ? body.messages : [];

  const turns: StructuredTurn[] = [];
  for (const message of rawMessages) {
    if (typeof message !== "object" || message === null) {
      continue;
    }
    const record = message as Record<string, unknown>;
    const role = record.role === "assistant" ? "assistant" : "user";
    const parsed = parseMessageContent(record.content);
    if (role === "assistant") {
      turns.push({
        role: "assistant",
        content: parsed.text,
        ...(parsed.toolUses.length > 0 ? { toolUses: parsed.toolUses } : {}),
      });
    } else {
      turns.push({
        role: "user",
        content: parsed.text,
        ...(parsed.toolResults.length > 0 ? { toolResults: parsed.toolResults } : {}),
      });
    }
  }

  if (systemText) {
    const firstUserIndex = turns.findIndex((turn) => turn.role === "user");
    if (firstUserIndex >= 0) {
      const existing = turns[firstUserIndex];
      turns[firstUserIndex] = {
        ...existing,
        content: existing.content ? `${systemText}\n\n${existing.content}` : systemText,
      } as StructuredTurn;
    } else {
      turns.unshift({ role: "user", content: systemText });
    }
  }

  const inputText = [systemText, ...turns.map((turn) => turn.content)].filter(Boolean).join("\n");

  return {
    model: readString(body.model),
    turns,
    tools: parseTools(body.tools),
    maxTokens: readNumber(body.max_tokens) ?? ANTHROPIC_MAX_TOKENS_DEFAULT,
    temperature: readNumber(body.temperature),
    topP: readNumber(body.top_p),
    stream: body.stream === true,
    inputText,
  };
}

function newMessageId(): string {
  return `msg_${randomUUID().replace(/-/g, "")}`;
}

/** Build a non-streaming Anthropic `message` response from collected output. */
export function buildAnthropicMessage(args: {
  text: string;
  toolUses: CodeWhispererToolUse[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  messageId?: string;
}): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];
  if (args.text) {
    content.push({ type: "text", text: args.text });
  }
  for (const toolUse of args.toolUses) {
    content.push({
      type: "tool_use",
      id: toolUse.toolUseId,
      name: toolUse.name,
      input: toolUse.input,
    });
  }
  // Anthropic requires at least one content block.
  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }
  return {
    id: args.messageId ?? newMessageId(),
    type: "message",
    role: "assistant",
    model: args.model,
    content,
    stop_reason: args.toolUses.length > 0 ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: args.inputTokens, output_tokens: args.outputTokens },
  };
}

/** Build the `/v1/messages/count_tokens` response body (estimated). */
export function buildCountTokensResponse(inputText: string): Record<string, unknown> {
  return { input_tokens: estimateTokens(inputText) };
}

function sseFrame(event: string, data: Record<string, unknown>): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

type CurrentBlock = { index: number; type: "text" | "tool"; toolUseId?: string };

/**
 * Stateful emitter for the Anthropic Messages SSE sequence. Drives content blocks
 * as text and tool-use deltas arrive from the CodeWhisperer stream, opening/closing
 * indexed blocks per the Anthropic protocol:
 *   message_start → (content_block_start → content_block_delta* → content_block_stop)*
 *   → message_delta → message_stop
 */
export class AnthropicSseEmitter {
  private readonly messageId: string;
  private readonly model: string;
  private readonly inputTokens: number;
  private nextIndex = 0;
  private current: CurrentBlock | null = null;
  private sawToolUse = false;
  private startedToolIds = new Set<string>();

  constructor(args: { model: string; inputTokens: number; messageId?: string }) {
    this.messageId = args.messageId ?? newMessageId();
    this.model = args.model;
    this.inputTokens = args.inputTokens;
  }

  /** Opening frames: message_start + an initial ping. */
  start(): string[] {
    return [
      sseFrame("message_start", {
        type: "message_start",
        message: {
          id: this.messageId,
          type: "message",
          role: "assistant",
          model: this.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: this.inputTokens, output_tokens: 0 },
        },
      }),
      sseFrame("ping", { type: "ping" }),
    ];
  }

  private closeCurrent(): string[] {
    if (!this.current) {
      return [];
    }
    const frame = sseFrame("content_block_stop", {
      type: "content_block_stop",
      index: this.current.index,
    });
    this.current = null;
    return [frame];
  }

  /** Emit a text delta, opening a text content block if one is not already open. */
  textDelta(text: string): string[] {
    if (!text) {
      return [];
    }
    const frames: string[] = [];
    if (this.current && this.current.type !== "text") {
      frames.push(...this.closeCurrent());
    }
    if (!this.current) {
      const index = this.nextIndex++;
      this.current = { index, type: "text" };
      frames.push(
        sseFrame("content_block_start", {
          type: "content_block_start",
          index,
          content_block: { type: "text", text: "" },
        }),
      );
    }
    frames.push(
      sseFrame("content_block_delta", {
        type: "content_block_delta",
        index: this.current.index,
        delta: { type: "text_delta", text },
      }),
    );
    return frames;
  }

  /** Emit a tool-use delta, managing tool_use content blocks (one per toolUseId). */
  toolUseDelta(delta: ToolUseDelta): string[] {
    this.sawToolUse = true;
    const frames: string[] = [];
    const isNewBlock =
      !this.current ||
      this.current.type !== "tool" ||
      this.current.toolUseId !== delta.toolUseId;

    if (isNewBlock) {
      frames.push(...this.closeCurrent());
      const index = this.nextIndex++;
      this.current = { index, type: "tool", toolUseId: delta.toolUseId };
      this.startedToolIds.add(delta.toolUseId);
      frames.push(
        sseFrame("content_block_start", {
          type: "content_block_start",
          index,
          content_block: {
            type: "tool_use",
            id: delta.toolUseId,
            name: delta.name ?? "",
            input: {},
          },
        }),
      );
    }
    if (delta.inputDelta) {
      frames.push(
        sseFrame("content_block_delta", {
          type: "content_block_delta",
          index: this.current!.index,
          delta: { type: "input_json_delta", partial_json: delta.inputDelta },
        }),
      );
    }
    return frames;
  }

  /** Closing frames: close any open block, message_delta (stop_reason + usage), message_stop. */
  finish(outputTokens: number): string[] {
    const frames: string[] = [];
    frames.push(...this.closeCurrent());
    frames.push(
      sseFrame("message_delta", {
        type: "message_delta",
        delta: {
          stop_reason: this.sawToolUse ? "tool_use" : "end_turn",
          stop_sequence: null,
        },
        usage: { output_tokens: outputTokens },
      }),
    );
    frames.push(sseFrame("message_stop", { type: "message_stop" }));
    return frames;
  }
}

/** Build an Anthropic-shaped error envelope. */
export function buildAnthropicError(type: string, message: string): Record<string, unknown> {
  return { type: "error", error: { type, message } };
}

function humanizeModelId(id: string): string {
  return id
    .split(/[-.]/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

/**
 * Build an Anthropic-format model listing (`GET /v1/models`). Claude Code performs
 * a preflight model lookup against this endpoint and refuses to start if the
 * configured model is absent, so we surface every Kiro model id/alias here.
 */
export function buildAnthropicModelsList(modelIds: string[]): Record<string, unknown> {
  const seen = new Set<string>();
  const data: Array<Record<string, unknown>> = [];
  for (const id of modelIds) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    data.push({
      type: "model",
      id: trimmed,
      display_name: humanizeModelId(trimmed),
      created_at: "2025-01-01T00:00:00Z",
    });
  }
  return {
    data,
    has_more: false,
    first_id: data.length > 0 ? data[0].id : null,
    last_id: data.length > 0 ? data[data.length - 1].id : null,
  };
}
