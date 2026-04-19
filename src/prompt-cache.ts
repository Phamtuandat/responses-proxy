import { createHash } from "node:crypto";

export type PromptCacheRedesignOptions = {
  enabled?: boolean;
  stableSummarizationEnabled?: boolean;
  summaryTriggerItems?: number;
  summaryKeepRecentItems?: number;
  defaultRetention?: string;
  retentionByFamilyEnabled?: boolean;
  familyRetentionRules?: Array<{ prefix: string; retention: string }>;
};

export type PromptCacheLayout = {
  familyId: string;
  staticKey: string;
  requestKey: string;
  stablePrefix: Record<string, unknown>;
  dynamicTail: Record<string, unknown>;
  summaryApplied: boolean;
  summaryItemCount: number;
  promptCacheKey?: string;
  promptCacheRetention?: string;
};

export function buildPromptCacheLayout(
  request: Record<string, unknown>,
  options: PromptCacheRedesignOptions = {},
): PromptCacheLayout {
  const inputItems = Array.isArray(request.input) ? request.input : undefined;
  const split = splitInputForPromptCache(inputItems, options.summaryKeepRecentItems ?? 6);

  const stableInputItems = split.stableItems;
  const dynamicInputItems = split.dynamicItems;
  const shouldSummarize =
    options.stableSummarizationEnabled === true &&
    stableInputItems.length >= (options.summaryTriggerItems ?? 14) &&
    dynamicInputItems.length > 0;

  const summarizedStableItems = shouldSummarize
    ? summarizeStableItems(stableInputItems)
    : stableInputItems;
  const includeStableConversationPrefix = shouldSummarize && summarizedStableItems.length > 0;

  const stablePrefix = omitUndefined({
    model: request.model,
    instructions: mergeStableInstructions(
      typeof request.instructions === "string" ? request.instructions : undefined,
      shouldSummarize ? buildStableSummaryBlock(stableInputItems) : undefined,
    ),
    tools: request.tools,
    tool_choice: request.tool_choice,
    parallel_tool_calls: request.parallel_tool_calls,
    reasoning: request.reasoning,
    text: request.text,
    max_output_tokens: request.max_output_tokens,
    max_tool_calls: request.max_tool_calls,
    temperature: request.temperature,
    top_p: request.top_p,
    metadata: request.metadata,
    user: request.user,
    truncation: request.truncation,
    include: request.include,
    input: includeStableConversationPrefix ? summarizedStableItems : undefined,
  });

  const dynamicTail = omitUndefined({
    input: includeStableConversationPrefix
      ? dynamicInputItems.length > 0
        ? dynamicInputItems
        : request.input
      : request.input,
  });

  const familySignature = stableStringify(
    omitUndefined({
      model: request.model,
      instructions: typeof request.instructions === "string" ? request.instructions : undefined,
      tools: request.tools,
      tool_choice: request.tool_choice,
      parallel_tool_calls: request.parallel_tool_calls,
      reasoning: request.reasoning,
      text: request.text,
      max_output_tokens: request.max_output_tokens,
      max_tool_calls: request.max_tool_calls,
      temperature: request.temperature,
      top_p: request.top_p,
      metadata: request.metadata,
      user: request.user,
      truncation: request.truncation,
      include: request.include,
    }),
  );

  const modelSlug = slugify(typeof request.model === "string" ? request.model : "unknown-model");
  const familyId = `family:${modelSlug}:core:${shortHash(familySignature)}`;
  const staticKey = `static:${familyId}:${shortHash(stableStringify(stablePrefix))}`;
  const requestKey = `request:${staticKey}:${shortHash(stableStringify(dynamicTail))}`;
  const promptCacheRetention = resolvePromptCacheRetention(familyId, options);

  return {
    familyId,
    staticKey,
    requestKey,
    stablePrefix,
    dynamicTail,
    summaryApplied: shouldSummarize,
    summaryItemCount: shouldSummarize ? stableInputItems.length : 0,
    promptCacheKey: options.enabled ? requestKey : undefined,
    promptCacheRetention: options.enabled ? promptCacheRetention : undefined,
  };
}

function splitInputForPromptCache(
  inputItems: unknown[] | undefined,
  keepRecentItems: number,
): {
  stableItems: unknown[];
  dynamicItems: unknown[];
} {
  if (!inputItems || inputItems.length === 0) {
    return {
      stableItems: [],
      dynamicItems: [],
    };
  }

  const minimumBoundaryIndex = Math.max(0, inputItems.length - keepRecentItems);
  let boundaryIndex = minimumBoundaryIndex;
  for (let index = inputItems.length - 1; index >= minimumBoundaryIndex; index -= 1) {
    const item = inputItems[index];
    if (isRecord(item) && item.role === "user") {
      boundaryIndex = index;
      break;
    }
  }

  return {
    stableItems: inputItems.slice(0, boundaryIndex),
    dynamicItems: inputItems.slice(boundaryIndex),
  };
}

function summarizeStableItems(items: unknown[]): unknown[] {
  const summary = buildStableSummaryBlock(items);
  if (!summary) {
    return items;
  }

  return [
    {
      role: "assistant",
      content: [
        {
          type: "input_text",
          text: summary,
        },
      ],
    },
  ];
}

function buildStableSummaryBlock(items: unknown[]): string | undefined {
  if (items.length === 0) {
    return undefined;
  }

  const lines = items.map((item, index) => summarizeInputItem(item, index + 1)).filter(Boolean);
  if (lines.length === 0) {
    return undefined;
  }

  return [
    "Stable conversation summary generated by responses-proxy.",
    "This summary replaces older conversation history to preserve a reusable upstream prompt prefix.",
    ...lines,
  ].join("\n");
}

function summarizeInputItem(item: unknown, index: number): string | undefined {
  if (!isRecord(item)) {
    return undefined;
  }

  if (typeof item.role === "string") {
    const content = summarizeContent(item.content);
    return content ? `${index}. ${item.role}: ${content}` : `${index}. ${item.role}`;
  }

  if (item.type === "function_call") {
    const name = typeof item.name === "string" ? item.name : "function";
    const args = typeof item.arguments === "string" ? compactText(item.arguments, 160) : "";
    return `${index}. function_call ${name}${args ? ` args=${args}` : ""}`;
  }

  if (item.type === "function_call_output") {
    const output = typeof item.output === "string" ? compactText(item.output, 160) : "";
    return `${index}. function_call_output${output ? ` ${output}` : ""}`;
  }

  return `${index}. ${compactText(stableStringify(item), 160)}`;
}

function summarizeContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return compactText(content, 160);
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const fragments = content
    .map((part) => {
      if (!isRecord(part)) {
        return "";
      }
      if (typeof part.text === "string") {
        return part.text;
      }
      if (typeof part.image_url === "string") {
        return `[image:${compactText(part.image_url, 64)}]`;
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");

  return fragments ? compactText(fragments, 160) : undefined;
}

function mergeStableInstructions(
  baseInstructions: string | undefined,
  summaryBlock: string | undefined,
): string | undefined {
  const parts = [baseInstructions, summaryBlock].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  if (parts.length === 0) {
    return undefined;
  }

  return parts.join("\n\n");
}

function resolvePromptCacheRetention(
  familyId: string,
  options: PromptCacheRedesignOptions,
): string | undefined {
  if (!options.retentionByFamilyEnabled) {
    return options.defaultRetention;
  }

  const bestMatch = [...(options.familyRetentionRules ?? [])]
    .filter((rule) => familyId.startsWith(rule.prefix))
    .sort((left, right) => right.prefix.length - left.prefix.length)[0];

  return bestMatch?.retention ?? options.defaultRetention;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortUnknown(value));
}

function sortUnknown(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortUnknown(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortUnknown(nested)]),
  );
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, nested]) => nested !== undefined),
  ) as T;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function compactText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
