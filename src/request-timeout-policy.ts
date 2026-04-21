const HERMES_SUMMARY_MARKERS = [
  "you are a summarization agent creating a context checkpoint",
  "context checkpoint",
  "generate context summary",
];

export function resolveRequestTimeoutMs(
  body: Record<string, unknown>,
  options: {
    defaultTimeoutMs: number;
    summaryTimeoutMs: number;
    extendHermesSummaryTimeout: boolean;
  },
): number {
  if (!options.extendHermesSummaryTimeout) {
    return options.defaultTimeoutMs;
  }

  if (!isHermesSummaryRequest(body)) {
    return options.defaultTimeoutMs;
  }

  return Math.max(options.defaultTimeoutMs, options.summaryTimeoutMs);
}

export function isHermesSummaryRequest(body: Record<string, unknown>): boolean {
  const input = body.input;
  if (!Array.isArray(input) || input.length === 0) {
    return false;
  }

  const preview = input
    .slice(0, 2)
    .map(extractInputText)
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .toLowerCase();

  return HERMES_SUMMARY_MARKERS.some((marker) => preview.includes(marker));
}

function extractInputText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  if ("text" in value && typeof (value as { text?: unknown }).text === "string") {
    return (value as { text: string }).text;
  }

  if ("content" in value) {
    const content = (value as { content?: unknown }).content;
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .map((entry) => {
          if (typeof entry === "string") {
            return entry;
          }
          if (
            typeof entry === "object" &&
            entry !== null &&
            "text" in entry &&
            typeof (entry as { text?: unknown }).text === "string"
          ) {
            return (entry as { text: string }).text;
          }
          return "";
        })
        .join("\n");
    }
  }

  return undefined;
}
