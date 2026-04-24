import type { ProxyResponsesRequest } from "./schema.js";

export type RtkLayerPolicy = {
  enabled?: boolean;
  toolOutputEnabled?: boolean;
  maxChars?: number;
  maxLines?: number;
  tailLines?: number;
  tailChars?: number;
  detectFormat?: "auto" | "plain" | "json" | "stack" | "command";
};

export type RtkLayerOptions = RtkLayerPolicy;

export type RtkLayerStats = {
  enabled: boolean;
  applied: boolean;
  toolOutputsSeen: number;
  toolOutputsReduced: number;
  charsBefore: number;
  charsAfter: number;
  charsSaved: number;
};

export type RtkLayerResult = {
  body: ProxyResponsesRequest;
  stats: RtkLayerStats;
};

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
const DEFAULT_MAX_CHARS = 4_000;
const DEFAULT_MAX_LINES = 120;
const DEFAULT_DETECT_FORMAT = "auto";

export function cloneRtkLayerPolicy(policy?: RtkLayerPolicy): RtkLayerPolicy | undefined {
  if (!policy) {
    return undefined;
  }
  return {
    enabled: typeof policy.enabled === "boolean" ? policy.enabled : undefined,
    toolOutputEnabled:
      typeof policy.toolOutputEnabled === "boolean" ? policy.toolOutputEnabled : undefined,
    maxChars:
      typeof policy.maxChars === "number" && Number.isFinite(policy.maxChars) && policy.maxChars > 0
        ? Math.round(policy.maxChars)
        : undefined,
    maxLines:
      typeof policy.maxLines === "number" && Number.isFinite(policy.maxLines) && policy.maxLines > 0
        ? Math.round(policy.maxLines)
        : undefined,
    tailLines:
      typeof policy.tailLines === "number" &&
      Number.isFinite(policy.tailLines) &&
      policy.tailLines >= 0
        ? Math.round(policy.tailLines)
        : undefined,
    tailChars:
      typeof policy.tailChars === "number" &&
      Number.isFinite(policy.tailChars) &&
      policy.tailChars >= 0
        ? Math.round(policy.tailChars)
        : undefined,
    detectFormat: normalizeDetectFormat(policy.detectFormat),
  };
}

export function parseRtkLayerPolicyInput(value: unknown): RtkLayerPolicy | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const policy = cloneRtkLayerPolicy({
    enabled: coerceBoolean(record.enabled),
    toolOutputEnabled: coerceBoolean(record.toolOutputEnabled ?? record.tool_output_enabled),
    maxChars: coercePositiveInt(record.maxChars ?? record.max_chars),
    maxLines: coercePositiveInt(record.maxLines ?? record.max_lines),
    tailLines: coerceNonNegativeInt(record.tailLines ?? record.tail_lines),
    tailChars: coerceNonNegativeInt(record.tailChars ?? record.tail_chars),
    detectFormat: normalizeDetectFormat(record.detectFormat ?? record.detect_format),
  });

  if (!policy) {
    return undefined;
  }

  if (
    policy.enabled === undefined &&
    policy.toolOutputEnabled === undefined &&
    policy.maxChars === undefined &&
    policy.maxLines === undefined &&
    policy.tailLines === undefined &&
    policy.tailChars === undefined &&
    policy.detectFormat === undefined
  ) {
    return undefined;
  }

  return policy;
}

export function resolveRtkLayerPolicy(
  base: RtkLayerOptions,
  providerPolicy?: RtkLayerPolicy,
  clientPolicy?: RtkLayerPolicy,
): RtkLayerOptions {
  const merged = {
    ...base,
    ...(cloneRtkLayerPolicy(providerPolicy) ?? {}),
    ...(cloneRtkLayerPolicy(clientPolicy) ?? {}),
  };

  return {
    enabled: merged.enabled,
    toolOutputEnabled: merged.toolOutputEnabled,
    maxChars: merged.maxChars ?? DEFAULT_MAX_CHARS,
    maxLines: merged.maxLines ?? DEFAULT_MAX_LINES,
    tailLines: merged.tailLines ?? 0,
    tailChars: merged.tailChars,
    detectFormat: normalizeDetectFormat(merged.detectFormat) ?? DEFAULT_DETECT_FORMAT,
  };
}

export function applyRtkLayer(
  body: ProxyResponsesRequest,
  options: RtkLayerOptions = {},
): RtkLayerResult {
  const stats = emptyStats(options.enabled === true);
  if (!options.enabled || !options.toolOutputEnabled) {
    return { body, stats };
  }

  let applied = false;
  const nextBody: ProxyResponsesRequest = {
    ...body,
  };

  if (Array.isArray(body.messages)) {
    nextBody.messages = body.messages.map((message) => {
      if (message.role !== "tool") {
        return message;
      }

      const nextContent = transformMessageToolContent(message.content, stats, options);
      if (nextContent === message.content) {
        return message;
      }
      applied = true;
      return {
        ...message,
        content: nextContent as typeof message.content,
      };
    });
  }

  if (Array.isArray(body.input)) {
    nextBody.input = body.input.map((item) => {
      if (!isFunctionCallOutputItem(item)) {
        return item;
      }

      const transformed = transformToolOutput(item.output, stats, options);
      if (transformed === item.output) {
        return item;
      }
      applied = true;
      return {
        ...item,
        output: transformed,
      };
    });
  }

  stats.applied = applied;
  stats.charsSaved = Math.max(0, stats.charsBefore - stats.charsAfter);
  return {
    body: applied ? nextBody : body,
    stats,
  };
}

function emptyStats(enabled: boolean): RtkLayerStats {
  return {
    enabled,
    applied: false,
    toolOutputsSeen: 0,
    toolOutputsReduced: 0,
    charsBefore: 0,
    charsAfter: 0,
    charsSaved: 0,
  };
}

function transformMessageToolContent(
  content: unknown,
  stats: RtkLayerStats,
  options: RtkLayerOptions,
): unknown {
  if (typeof content === "string") {
    return transformToolOutput(content, stats, options);
  }

  if (!Array.isArray(content)) {
    return content;
  }

  let changed = false;
  const next = content.map((part: unknown) => {
    if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") {
      return part;
    }
    const text = transformToolOutput(part.text, stats, options);
    if (text !== part.text) {
      changed = true;
      return {
        ...part,
        text,
      };
    }
    return part;
  });

  return changed ? next : content;
}

function transformToolOutput(
  raw: string,
  stats: RtkLayerStats,
  options: RtkLayerOptions,
): string {
  stats.toolOutputsSeen += 1;
  stats.charsBefore += raw.length;

  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const normalized = canonicalizeToolOutput(raw);
  const detectedFormat = detectToolOutputFormat(normalized, options.detectFormat);
  const formatReady =
    detectedFormat === "json" ? prettifyJsonToolOutput(normalized) ?? normalized : normalized;
  const reduced = clipToolOutput(
    formatReady,
    maxChars,
    maxLines,
    options.tailLines ?? 0,
    options.tailChars,
    detectedFormat,
  );

  stats.charsAfter += reduced.length;
  if (reduced !== raw) {
    stats.toolOutputsReduced += 1;
  }

  return reduced;
}

function canonicalizeToolOutput(raw: string): string {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .replace(ANSI_PATTERN, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .filter((line, index, all) => {
      if (line.length > 0) {
        return true;
      }
      return index > 0 && index < all.length - 1;
    });

  const deduped: string[] = [];
  let previous: string | undefined;
  for (const line of lines) {
    if (line === previous && line.trim().length > 0) {
      continue;
    }
    deduped.push(line);
    previous = line;
  }

  return deduped.join("\n").trim();
}

function clipToolOutput(
  value: string,
  maxChars: number,
  maxLines: number,
  tailLines: number,
  tailChars: number | undefined,
  detectedFormat: "plain" | "json" | "stack" | "command",
): string {
  const lines = value ? value.split("\n") : [];
  if (lines.length <= maxLines && value.length <= maxChars) {
    return value;
  }

  const safeTailLines = Math.max(0, Math.min(tailLines, maxLines > 1 ? maxLines - 1 : 0));
  const initialHeadLineBudget = Math.max(1, maxLines - safeTailLines);
  const headLines = lines.slice(0, initialHeadLineBudget);
  const tailStartIndex = Math.max(initialHeadLineBudget, lines.length - safeTailLines);
  const tail = safeTailLines > 0 ? lines.slice(tailStartIndex) : [];
  const importantLines = extractImportantLines(
    lines,
    detectedFormat,
    initialHeadLineBudget,
    tailStartIndex,
    maxLines,
  );
  const marker = formatAwareTruncationMarker(detectedFormat);
  const selectedLines = buildSelectedLines(headLines, importantLines, tail, marker);
  let clipped = selectedLines.join("\n");

  const visibleLines = countVisibleSourceLines(selectedLines, marker);
  const hiddenLineCount = Math.max(0, lines.length - visibleLines);
  const summary = ["", buildTruncationSummary(detectedFormat, hiddenLineCount, Math.max(0, value.length - Math.min(value.length, clipped.length)))].join("\n");
  const summaryBudget = Math.max(0, maxChars - summary.length);
  clipped = applySmartCharBudget(
    clipped,
    headLines.join("\n"),
    importantLines.join("\n"),
    tail.join("\n"),
    marker,
    summaryBudget,
    tailChars,
    detectedFormat,
  );

  const hiddenCharCount = Math.max(0, value.length - clipped.length);
  const finalizedSummary = ["", buildTruncationSummary(detectedFormat, hiddenLineCount, hiddenCharCount)].join("\n");
  const finalBudget = Math.max(0, maxChars - finalizedSummary.length);
  const head = applySmartCharBudget(
    clipped,
    headLines.join("\n"),
    importantLines.join("\n"),
    tail.join("\n"),
    marker,
    finalBudget,
    tailChars,
    detectedFormat,
  );
  return `${head}${finalizedSummary}`.trim();
}

function applySmartCharBudget(
  fallbackClipped: string,
  headText: string,
  importantText: string,
  tailText: string,
  marker: string,
  availableChars: number,
  tailChars: number | undefined,
  detectedFormat: "plain" | "json" | "stack" | "command",
): string {
  if (availableChars <= 0) {
    return "";
  }
  if (!tailText && !importantText) {
    return fallbackClipped.slice(0, availableChars).trimEnd();
  }

  const importantSeparatorBudget = importantText ? marker.length + 1 : 0;
  const tailSeparatorBudget = tailText ? marker.length + 1 : 0;
  const separatorBudget = importantSeparatorBudget + tailSeparatorBudget;
  if (availableChars <= separatorBudget + 8) {
    return fallbackClipped.slice(0, availableChars).trimEnd();
  }

  const autoTailRatio = detectedFormat === "stack"
    ? 0.45
    : detectedFormat === "command"
      ? 0.38
      : detectedFormat === "json"
        ? 0.25
        : 0.3;
  const minTailChars = detectedFormat === "stack" ? 24 : detectedFormat === "json" ? 20 : 16;
  const importantBudget =
    importantText.length > 0
      ? Math.min(
          importantText.length,
          Math.max(24, Math.round(availableChars * (detectedFormat === "command" ? 0.34 : 0.18))),
        )
      : 0;
  const desiredTailChars =
    typeof tailChars === "number" && tailChars >= 0
      ? tailChars
      : Math.round(availableChars * autoTailRatio);
  const boundedTailChars = Math.max(
    0,
    Math.min(
      tailText.length,
      Math.max(minTailChars, desiredTailChars),
      Math.max(0, availableChars - separatorBudget - 16),
    ),
  );
  const headBudget = Math.max(
    0,
    availableChars - separatorBudget - boundedTailChars - importantBudget,
  );
  const boundedHead = clipStartText(headText, headBudget);
  const boundedImportant =
    detectedFormat === "command"
      ? clipStartText(importantText, importantBudget)
      : clipEndText(importantText, importantBudget);
  const boundedTail = clipEndText(tailText, boundedTailChars);
  let finalHead = boundedHead;
  let finalImportant = boundedImportant;
  let composite = buildBudgetComposite(finalHead, finalImportant, boundedTail, marker);

  if (composite.length > availableChars && finalHead.length > 0) {
    const overflow = composite.length - availableChars;
    finalHead = clipStartText(finalHead, Math.max(0, finalHead.length - overflow));
    composite = buildBudgetComposite(finalHead, finalImportant, boundedTail, marker);
  }

  if (composite.length > availableChars && finalImportant.length > 0) {
    const overflow = composite.length - availableChars;
    finalImportant =
      detectedFormat === "command"
        ? clipStartText(finalImportant, Math.max(0, finalImportant.length - overflow))
        : clipEndText(finalImportant, Math.max(0, finalImportant.length - overflow));
    composite = buildBudgetComposite(finalHead, finalImportant, boundedTail, marker);
  }

  return composite.length <= availableChars
    ? composite
    : composite.slice(0, availableChars).trimEnd();
}

function buildBudgetComposite(
  headText: string,
  importantText: string,
  tailText: string,
  marker: string,
): string {
  return [headText, importantText ? marker : "", importantText, tailText ? marker : "", tailText]
    .filter(Boolean)
    .join("\n");
}

function clipStartText(value: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "";
  }
  return value.length <= maxChars ? value : value.slice(0, maxChars).trimEnd();
}

function clipEndText(value: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "";
  }
  return value.length <= maxChars ? value : value.slice(Math.max(0, value.length - maxChars)).trimStart();
}

function extractImportantLines(
  lines: string[],
  detectedFormat: "plain" | "json" | "stack" | "command",
  headEndIndexExclusive: number,
  tailStartIndexInclusive: number,
  maxLines: number,
): string[] {
  if (detectedFormat !== "command" && detectedFormat !== "plain") {
    return [];
  }

  const middle = lines.slice(headEndIndexExclusive, tailStartIndexInclusive);
  if (middle.length === 0) {
    return [];
  }

  const candidates = middle
    .map((line, index) => ({
      line,
      index,
      score: getOperationalLineImportance(line),
    }))
    .filter((entry) => entry.score > 0);
  if (candidates.length === 0) {
    return [];
  }

  const maxImportantLines =
    detectedFormat === "command"
      ? Math.max(1, Math.min(2, Math.floor(maxLines / 2)))
      : Math.max(1, Math.floor(maxLines / 3));

  const highestScore = Math.max(...candidates.map((entry) => entry.score));
  const prioritized =
    highestScore >= 3 ? candidates.filter((entry) => entry.score >= 3) : candidates;
  const selected = prioritized
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, maxImportantLines)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.line);

  return selected;
}

function isImportantOperationalLine(line: string): boolean {
  return getOperationalLineImportance(line) > 0;
}

function getOperationalLineImportance(line: string): number {
  const normalized = line.trim().toLowerCase();
  if (!normalized) {
    return 0;
  }

  if (
    normalized.includes("fatal") ||
    normalized.includes("error") ||
    normalized.includes("exception") ||
    normalized.includes("failed") ||
    normalized.includes("failure")
  ) {
    return 3;
  }

  if (
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("exit code") ||
    normalized.includes("status=") ||
    normalized.includes("status code")
  ) {
    return 2;
  }

  if (normalized.includes("warn")) {
    return 1;
  }

  return 0;
}

function buildSelectedLines(
  headLines: string[],
  importantLines: string[],
  tailLines: string[],
  marker: string,
): string[] {
  const combined = [...headLines];
  if (importantLines.length > 0) {
    combined.push(marker, ...importantLines);
  }
  if (tailLines.length > 0) {
    combined.push(marker, ...tailLines);
  }

  const deduped: string[] = [];
  for (const line of combined) {
    if (deduped[deduped.length - 1] === line) {
      continue;
    }
    deduped.push(line);
  }
  return deduped;
}

function countVisibleSourceLines(selectedLines: string[], marker: string): number {
  let markers = 0;
  for (const line of selectedLines) {
    if (line === marker) {
      markers += 1;
    }
  }
  return Math.max(0, selectedLines.length - markers);
}

function detectToolOutputFormat(
  value: string,
  detectFormat: RtkLayerPolicy["detectFormat"],
): "plain" | "json" | "stack" | "command" {
  const forced = normalizeDetectFormat(detectFormat);
  if (forced && forced !== "auto") {
    return forced;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "plain";
  }
  if (prettifyJsonToolOutput(trimmed)) {
    return "json";
  }

  const lines = trimmed.split("\n");
  const stackMatches = lines.filter((line) =>
    /^\s*at\s+/.test(line) ||
    /(Error|Exception|Traceback)/.test(line) ||
    /:\d+:\d+/.test(line)
  ).length;
  if (stackMatches >= 2 || /^(?:\w*Error|\w*Exception|Traceback)/.test(lines[0] || "")) {
    return "stack";
  }

  const commandMatches = lines.filter((line) =>
    /^\s*(?:\$|>|\+|#)\s+/.test(line) ||
    /^\s*(?:INFO|WARN|ERROR|DEBUG|TRACE)\b/.test(line) ||
    /^\s*\[[A-Z]+\]/.test(line) ||
    /^\s*\d{2}:\d{2}:\d{2}/.test(line) ||
    /^\s*\d{4}-\d{2}-\d{2}[ T]/.test(line)
  ).length;
  if (commandMatches >= Math.max(2, Math.ceil(lines.length / 3))) {
    return "command";
  }

  return "plain";
}

function prettifyJsonToolOutput(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return undefined;
  }
}

function formatAwareTruncationMarker(
  detectedFormat: "plain" | "json" | "stack" | "command",
): string {
  switch (detectedFormat) {
    case "json":
      return '"... truncated json ..."';
    case "stack":
      return "... stack frames truncated ...";
    case "command":
      return "... log lines truncated ...";
    default:
      return "...";
  }
}

function buildTruncationSummary(
  detectedFormat: "plain" | "json" | "stack" | "command",
  hiddenLineCount: number,
  hiddenCharCount: number,
): string {
  return `[rtk trunc fmt=${detectedFormat} lines=${hiddenLineCount} chars=${hiddenCharCount}]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFunctionCallOutputItem(
  value: unknown,
): value is { type: "function_call_output"; output: string } & Record<string, unknown> {
  return isRecord(value) && value.type === "function_call_output" && typeof value.output === "string";
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (value === true || value === "true" || value === 1 || value === "1") {
    return true;
  }
  if (value === false || value === "false" || value === 0 || value === "0") {
    return false;
  }
  return undefined;
}

function coercePositiveInt(value: unknown): number | undefined {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function coerceNonNegativeInt(value: unknown): number | undefined {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : undefined;
}

function normalizeDetectFormat(value: unknown): RtkLayerPolicy["detectFormat"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "auto" ||
    normalized === "plain" ||
    normalized === "json" ||
    normalized === "stack" ||
    normalized === "command"
    ? normalized
    : undefined;
}
