import type { ProxyResponsesRequest } from "./schema.js";
import { createHash } from "node:crypto";
import { buildPromptCacheLayout, type PromptCacheLayout } from "./prompt-cache.js";

type NormalizeRequestOptions = {
  openClawTokenOptimizationEnabled?: boolean;
  defaultReasoningEffort?: "minimal" | "low" | "medium" | "high";
  defaultReasoningSummary?: "auto" | "none" | "concise" | "detailed";
  defaultTextVerbosity?: "low" | "medium" | "high";
  defaultMaxOutputTokens?: number;
  autoPromptCacheKey?: boolean;
  defaultPromptCacheRetention?: string;
  defaultTruncation?: "auto" | "disabled";
  stripMaxOutputTokens?: boolean;
  sanitizeReasoningSummary?: boolean;
  promptCacheRedesignEnabled?: boolean;
  promptCacheStableSummarizationEnabled?: boolean;
  promptCacheSummaryTriggerItems?: number;
  promptCacheSummaryKeepRecentItems?: number;
  promptCacheRetentionByFamilyEnabled?: boolean;
  promptCacheRetentionByFamilyRules?: Array<{ prefix: string; retention: string }>;
};

export type NormalizedResponsesRequestResult = {
  request: Record<string, unknown>;
  cacheLayout: PromptCacheLayout;
};

type ResponsesInputPart = {
  type: "input_text" | "input_image" | "output_text";
  text?: string;
  image_url?: string;
};

type ResponsesMessageInput = {
  role: "user" | "assistant";
  content: string | ResponsesInputPart[];
};

type ResponsesFunctionCallInput = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
};

type ResponsesFunctionCallOutputInput = {
  type: "function_call_output";
  call_id: string;
  output: string;
};

type ResponsesInputItem =
  | ResponsesMessageInput
  | ResponsesFunctionCallInput
  | ResponsesFunctionCallOutputInput
  | Record<string, unknown>;

function normalizeInstructions(instructions: string | undefined): string | undefined {
  const trimmed = instructions
    ?.replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return trimmed ? trimmed : undefined;
}

function normalizeFunctionTool(tool: Record<string, unknown>): Record<string, unknown> {
  if (tool.type !== "function") {
    return sortObjectKeys(tool);
  }

  const nested = isRecord(tool.function) ? tool.function : null;
  const name = typeof tool.name === "string" ? tool.name : nested?.name;
  if (typeof name !== "string" || !name.trim()) {
    return tool;
  }

  const normalized: Record<string, unknown> = {
    type: "function",
    name: name.trim(),
  };

  const description =
    typeof tool.description === "string"
      ? tool.description
      : typeof nested?.description === "string"
        ? nested.description
        : undefined;
  if (description) {
    normalized.description = description;
  }

  const parameters = isRecord(tool.parameters)
    ? tool.parameters
    : isRecord(nested?.parameters)
      ? nested.parameters
      : undefined;
  if (parameters) {
    normalized.parameters = sortObjectKeys(parameters);
  }

  const strict =
    typeof tool.strict === "boolean"
      ? tool.strict
      : typeof nested?.strict === "boolean"
        ? nested.strict
        : undefined;
  if (typeof strict === "boolean") {
    normalized.strict = strict;
  }

  return sortObjectKeys(normalized);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function convertChatPart(part: Record<string, unknown>, role: string): ResponsesInputPart | null {
  if (part.type === "text" && typeof part.text === "string") {
    return {
      type: role === "assistant" ? "output_text" : "input_text",
      text: part.text,
    };
  }

  if (role === "user" && part.type === "image_url") {
    const imageUrlValue = part.image_url;
    const imageUrl =
      typeof imageUrlValue === "string"
        ? imageUrlValue
        : isRecord(imageUrlValue) && typeof imageUrlValue.url === "string"
          ? imageUrlValue.url
          : undefined;

    if (imageUrl) {
      return {
        type: "input_image",
        image_url: imageUrl,
      };
    }
  }

  return null;
}

function convertMessageContent(
  role: "user" | "assistant",
  rawContent: unknown,
): string | ResponsesInputPart[] | null {
  if (typeof rawContent === "string") {
    return rawContent;
  }

  if (!Array.isArray(rawContent)) {
    return null;
  }

  const parts = rawContent
    .map((part) => (isRecord(part) ? convertChatPart(part, role) : null))
    .filter((part): part is ResponsesInputPart => part !== null);

  if (parts.length === 0) {
    return null;
  }

  return parts;
}

function mergeInstructions(parts: string[]): string | undefined {
  const seen = new Set<string>();
  const normalized = parts
    .map((part) => normalizeInstructions(part))
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .filter((part) => {
      if (seen.has(part)) {
        return false;
      }
      seen.add(part);
      return true;
    })
    .join("\n\n");

  return normalized || undefined;
}

function convertMessagesToInput(body: ProxyResponsesRequest): {
  input: ResponsesInputItem[];
  instructions?: string;
} {
  const messages = body.messages ?? [];
  const instructionParts: string[] = [];
  const input: ResponsesInputItem[] = [];

  for (const message of messages) {
    if (message.role === "system" || message.role === "developer") {
      if (typeof message.content === "string" && message.content.trim()) {
        instructionParts.push(message.content);
      } else if (Array.isArray(message.content)) {
        const content = convertMessageContent("user", message.content);
        if (Array.isArray(content)) {
          const text = content
            .filter((part) => part.type === "input_text" && typeof part.text === "string")
            .map((part) => part.text)
            .join("\n");
          if (text.trim()) {
            instructionParts.push(text);
          }
        }
      }
      continue;
    }

    if (message.role === "user" || message.role === "assistant") {
      const content = convertMessageContent(message.role, message.content);
      if (content !== null) {
        input.push({
          role: message.role,
          content,
        });
      }

      if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
        for (const toolCall of message.tool_calls) {
          const functionName = toolCall.function.name.trim();
          if (!functionName) {
            continue;
          }
          input.push({
            type: "function_call",
            call_id: toolCall.id ?? functionName,
            name: functionName,
            arguments: toolCall.function.arguments ?? "{}",
          });
        }
      }
      continue;
    }

    if (message.role === "tool") {
      const output =
        typeof message.content === "string"
          ? message.content
          : Array.isArray(message.content)
            ? message.content
                .map((part) =>
                  isRecord(part) && part.type === "text" && typeof part.text === "string"
                    ? part.text
                    : "",
                )
                .filter(Boolean)
                .join("\n")
            : "";

      if (message.tool_call_id && output) {
        input.push({
          type: "function_call_output",
          call_id: message.tool_call_id,
          output,
        });
      }
    }
  }

  const directInstructions = normalizeInstructions(body.instructions);
  if (directInstructions) {
    instructionParts.push(directInstructions);
  }

  return {
    input,
    instructions: mergeInstructions(instructionParts),
  };
}

function normalizeDirectInput(
  body: ProxyResponsesRequest,
): { input: ProxyResponsesRequest["input"]; instructions?: string } {
  return {
    input: normalizeInputValue(body.input),
    instructions: normalizeInstructions(body.instructions),
  };
}

export function normalizeResponsesRequest(
  body: ProxyResponsesRequest,
  options: NormalizeRequestOptions = {},
): Record<string, unknown> {
  return normalizeResponsesRequestWithCache(body, options).request;
}

export function normalizeResponsesRequestWithCache(
  body: ProxyResponsesRequest,
  options: NormalizeRequestOptions = {},
): NormalizedResponsesRequestResult {
  const normalizedBase =
    body.input !== undefined ? normalizeDirectInput(body) : convertMessagesToInput(body);
  const isOpenClaw = options.openClawTokenOptimizationEnabled
    ? isLikelyHermesPayload(body, normalizedBase.instructions)
    : false;

  const request: Record<string, unknown> = {
    model: body.model,
    input: normalizeInputValue(normalizedBase.input),
    store: false,
    stream: body.stream ?? false,
    parallel_tool_calls: body.parallel_tool_calls ?? true,
  };

  if (normalizedBase.instructions) {
    request.instructions = normalizedBase.instructions;
  }

  if (body.tools?.length) {
    request.tools = body.tools
      .map((tool) => (isRecord(tool) ? normalizeFunctionTool(tool) : tool))
      .sort(compareToolsForCacheStability);
  }

  if (body.tool_choice !== undefined) {
    request.tool_choice = normalizeToolChoice(body.tool_choice);
  }

  if (body.reasoning !== undefined) {
    const reasoning = isOpenClaw
      ? {
          ...body.reasoning,
          ...(body.reasoning.effort === undefined && options.defaultReasoningEffort
            ? { effort: options.defaultReasoningEffort }
            : {}),
          ...(body.reasoning.summary === undefined && options.defaultReasoningSummary
            ? { summary: options.defaultReasoningSummary }
            : {}),
        }
      : body.reasoning;
    request.reasoning = sanitizeReasoning(reasoning, options);
  } else if (isOpenClaw && options.defaultReasoningSummary) {
    request.reasoning = sanitizeReasoning({
      ...(options.defaultReasoningEffort ? { effort: options.defaultReasoningEffort } : {}),
      summary: options.defaultReasoningSummary,
    }, options);
  }

  if (body.text !== undefined) {
    request.text =
      isOpenClaw && body.text.verbosity === undefined && options.defaultTextVerbosity
        ? {
            ...body.text,
            verbosity: options.defaultTextVerbosity,
          }
        : body.text;
    request.text = normalizeTextConfig(request.text);
  } else if (isOpenClaw && options.defaultTextVerbosity) {
    request.text = {
      verbosity: options.defaultTextVerbosity,
    };
  }

  if (body.max_output_tokens !== undefined && !options.stripMaxOutputTokens) {
    request.max_output_tokens = body.max_output_tokens;
  } else if (isOpenClaw && options.defaultMaxOutputTokens !== undefined) {
    request.max_output_tokens = options.defaultMaxOutputTokens;
  }

  if (body.max_tool_calls !== undefined) {
    request.max_tool_calls = body.max_tool_calls;
  }

  if (body.temperature !== undefined) {
    request.temperature = body.temperature;
  }

  if (body.top_p !== undefined) {
    request.top_p = body.top_p;
  }

  if (body.metadata !== undefined) {
    request.metadata = normalizeMetadata(body.metadata, {
      stripVolatileKeys: isOpenClaw || options.promptCacheRedesignEnabled,
    });
  }

  if (body.user !== undefined) {
    request.user = body.user;
  }

  if (body.previous_response_id !== undefined) {
    request.previous_response_id = body.previous_response_id;
  }

  if (body.truncation !== undefined) {
    request.truncation = body.truncation;
  } else if (isOpenClaw && options.defaultTruncation) {
    request.truncation = options.defaultTruncation;
  }

  if (body.include !== undefined) {
    request.include = normalizeInclude(body.include);
  }

  const cacheLayout = buildPromptCacheLayout(request, {
    enabled: options.promptCacheRedesignEnabled,
    stableSummarizationEnabled: options.promptCacheStableSummarizationEnabled,
    summaryTriggerItems: options.promptCacheSummaryTriggerItems,
    summaryKeepRecentItems: options.promptCacheSummaryKeepRecentItems,
    defaultRetention: options.defaultPromptCacheRetention,
    retentionByFamilyEnabled: options.promptCacheRetentionByFamilyEnabled,
    familyRetentionRules: options.promptCacheRetentionByFamilyRules,
  });

  if (body.prompt_cache_key !== undefined) {
    request.prompt_cache_key = body.prompt_cache_key;
  } else if (cacheLayout.promptCacheKey) {
    request.prompt_cache_key = cacheLayout.promptCacheKey;
  } else if (isOpenClaw && options.autoPromptCacheKey) {
    request.prompt_cache_key = buildOpenClawPromptCacheKey(body, request);
  }

  if (body.prompt_cache_retention !== undefined) {
    request.prompt_cache_retention = body.prompt_cache_retention;
  } else if (cacheLayout.promptCacheRetention) {
    request.prompt_cache_retention = cacheLayout.promptCacheRetention;
  } else if (request.prompt_cache_key !== undefined && options.defaultPromptCacheRetention) {
    request.prompt_cache_retention = options.defaultPromptCacheRetention;
  }

  const finalCacheLayout: PromptCacheLayout = {
    ...cacheLayout,
    promptCacheKey:
      typeof request.prompt_cache_key === "string" ? request.prompt_cache_key : cacheLayout.promptCacheKey,
    promptCacheRetention:
      typeof request.prompt_cache_retention === "string"
        ? request.prompt_cache_retention
        : cacheLayout.promptCacheRetention,
  };

  return {
    request,
    cacheLayout: finalCacheLayout,
  };
}

function isLikelyHermesPayload(
  body: ProxyResponsesRequest,
  instructions: string | undefined,
): boolean {
  if (containsHermesMarker(instructions)) {
    return true;
  }

  if (typeof body.input === "string" && containsHermesMarker(body.input)) {
    return true;
  }

  if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (!isRecord(item)) {
        continue;
      }
      const content = item.content;
      if (typeof content === "string" && containsHermesMarker(content)) {
        return true;
      }
    }
  }

  return Array.isArray(body.messages)
    ? body.messages.some(
        (message) =>
          typeof message.content === "string" && containsHermesMarker(message.content),
      )
    : false;
}

function containsHermesMarker(value: string | undefined): boolean {
  if (typeof value !== "string") {
    return false;
  }

  return value.includes("running inside Hermes") || value.includes("running inside OpenClaw");
}

function sanitizeReasoning(
  reasoning: Record<string, unknown>,
  options: NormalizeRequestOptions,
): Record<string, unknown> {
  const normalized = sortObjectKeys(reasoning);
  if (!options.sanitizeReasoningSummary) {
    return normalized;
  }

  if (normalized.summary !== "none") {
    return normalized;
  }

  return {
    ...normalized,
    summary: "auto",
  };
}

function buildOpenClawPromptCacheKey(
  body: ProxyResponsesRequest,
  normalizedRequest: Record<string, unknown>,
): string {
  const instructions =
    typeof normalizedRequest.instructions === "string" ? normalizedRequest.instructions : "";
  const tools = Array.isArray(normalizedRequest.tools) ? normalizedRequest.tools : [];
  const model = typeof body.model === "string" ? body.model : "unknown-model";
  const toolSignature = JSON.stringify(
    tools.map((tool) => {
      if (!isRecord(tool)) {
        return tool;
      }
      return {
        type: tool.type,
        name:
          typeof tool.name === "string"
            ? tool.name
            : isRecord(tool.function) && typeof tool.function.name === "string"
              ? tool.function.name
              : undefined,
      };
    }),
  );
  const instructionsHash = shortHash(instructions);
  const toolsHash = shortHash(toolSignature);
  return `hermes:${model}:instr:${instructionsHash}:tools:${toolsHash}`;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function normalizeInputValue(
  input: ProxyResponsesRequest["input"] | ResponsesInputItem[] | undefined,
): ProxyResponsesRequest["input"] | ResponsesInputItem[] | undefined {
  if (typeof input === "string" || input === undefined) {
    return input;
  }

  if (!Array.isArray(input)) {
    return input;
  }

  return input.map((item) => normalizeInputItem(item)) as
    | ProxyResponsesRequest["input"]
    | ResponsesInputItem[];
}

function normalizeInputItem(item: unknown): unknown {
  if (!isRecord(item)) {
    return item;
  }

  const normalized = sortObjectKeys(item);
  if (normalized.role === "tool") {
    const output = readToolContent(normalized.content);
    if (typeof normalized.tool_call_id === "string" && normalized.tool_call_id.trim()) {
      return {
        type: "function_call_output",
        call_id: normalized.tool_call_id.trim(),
        output,
      };
    }

    // Never let legacy `role: "tool"` leak upstream. If the call id is missing,
    // downgrade the content into a plain assistant message instead of failing.
    return {
      role: "assistant",
      content: output,
    };
  }

  if (normalized.type === "function_call" && typeof normalized.arguments === "string") {
    return {
      ...normalized,
      arguments: normalizeJsonString(normalized.arguments),
    };
  }

  if (normalized.type === "function_call_output" && typeof normalized.output === "string") {
    return {
      ...normalized,
      output: normalizeJsonString(normalized.output),
    };
  }

  return normalized;
}

function readToolContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) =>
      isRecord(part) && typeof part.text === "string" ? part.text : "",
    )
    .filter(Boolean)
    .join("\n");
}

function normalizeMetadata(
  metadata: Record<string, string>,
  options: {
    stripVolatileKeys?: boolean;
  } = {},
): Record<string, string> {
  const volatileKeys = options.stripVolatileKeys ? OPENCLAW_VOLATILE_METADATA_KEYS : undefined;
  const entries = Object.entries(metadata).filter(
    ([key, value]) =>
      key.trim().length > 0 &&
      value.trim().length > 0 &&
      !volatileKeys?.has(key.trim().toLowerCase()),
  );

  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeToolChoice(value: unknown): unknown {
  if (typeof value === "string") {
    return value;
  }

  if (!isRecord(value)) {
    return value;
  }

  return sortObjectKeys(value);
}

function normalizeTextConfig(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const normalized = sortObjectKeys(value);
  if (!isRecord(normalized.format)) {
    return normalized;
  }

  return {
    ...normalized,
    format: sortObjectKeys(normalized.format),
  };
}

function normalizeInclude(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  return [...new Set(value.filter((entry): entry is string => typeof entry === "string"))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function compareToolsForCacheStability(left: unknown, right: unknown): number {
  return JSON.stringify(sortObjectKeys(left)).localeCompare(JSON.stringify(sortObjectKeys(right)));
}

function sortObjectKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectKeys(item)) as T;
  }

  if (!isRecord(value)) {
    return value;
  }

  const sortedEntries = Object.entries(value)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, sortObjectKeys(nested)]);

  return Object.fromEntries(sortedEntries) as T;
}

function normalizeJsonString(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    return JSON.stringify(sortObjectKeys(parsed));
  } catch {
    return value;
  }
}

const OPENCLAW_VOLATILE_METADATA_KEYS = new Set([
  "request_id",
  "trace_id",
  "span_id",
  "session_id",
  "conversation_id",
  "turn_id",
  "message_id",
  "event_id",
  "client_request_id",
  "requestid",
  "traceparent",
  "tracestate",
]);
