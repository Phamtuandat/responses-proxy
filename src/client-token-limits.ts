import type {
  ClientRouteKey,
  ClientTokenLimitConfig,
  ClientTokenUsageDelta,
  ClientTokenUsageSnapshot,
  ClientTokenWindowType,
} from "./runtime-provider-repository.js";

export type ClientTokenLimitStatus = {
  used: number;
  limit: number | null;
  remaining: number | null;
  blocked: boolean;
  windowStart: string;
};

export type ClientTokenLimitErrorBody = {
  error: {
    type: "request_error";
    code: "CLIENT_TOKEN_LIMIT_EXCEEDED";
    message: string;
    client: ClientRouteKey;
    client_route: ClientRouteKey;
    usage: ClientTokenLimitStatus;
  };
};

export function resolveClientTokenWindowStart(
  now: Date,
  config: { windowType: ClientTokenWindowType; windowSizeSeconds?: number },
): string {
  const current = new Date(now);
  switch (config.windowType) {
    case "weekly": {
      const windowStart = new Date(current);
      windowStart.setUTCHours(0, 0, 0, 0);
      const day = windowStart.getUTCDay();
      const offset = (day + 6) % 7;
      windowStart.setUTCDate(windowStart.getUTCDate() - offset);
      return windowStart.toISOString();
    }
    case "monthly": {
      return new Date(
        Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1, 0, 0, 0, 0),
      ).toISOString();
    }
    case "fixed": {
      const sizeSeconds =
        config.windowSizeSeconds && config.windowSizeSeconds > 0
          ? config.windowSizeSeconds
          : 86400;
      const epochSeconds = Math.floor(current.getTime() / 1000);
      const windowStartSeconds = epochSeconds - (epochSeconds % sizeSeconds);
      return new Date(windowStartSeconds * 1000).toISOString();
    }
    case "daily":
    default: {
      const windowStart = new Date(current);
      windowStart.setUTCHours(0, 0, 0, 0);
      return windowStart.toISOString();
    }
  }
}

export function getClientTokenLimitStatus(
  config: ClientTokenLimitConfig | null | undefined,
  usage: Pick<ClientTokenUsageSnapshot, "totalTokens" | "windowStart">,
): ClientTokenLimitStatus {
  const used = normalizeNonNegativeInteger(usage.totalTokens);
  const windowStart = usage.windowStart;

  if (!config?.enabled) {
    return {
      used,
      limit: null,
      remaining: null,
      blocked: false,
      windowStart,
    };
  }

  const limit = normalizeNonNegativeInteger(config.tokenLimit);
  const remaining = Math.max(0, limit - used);
  return {
    used,
    limit,
    remaining,
    blocked: config.hardBlock && limit > 0 && remaining <= 0,
    windowStart,
  };
}

export function buildClientTokenLimitError(
  client: ClientRouteKey,
  status: ClientTokenLimitStatus,
): { statusCode: 429; body: ClientTokenLimitErrorBody } {
  return {
    statusCode: 429,
    body: {
      error: {
        type: "request_error",
        code: "CLIENT_TOKEN_LIMIT_EXCEEDED",
        message: `Client route '${client}' has reached its token limit for the current window.`,
        client,
        client_route: client,
        usage: status,
      },
    },
  };
}

export function extractUsageTotals(usagePayload: unknown): ClientTokenUsageDelta | undefined {
  const usage = resolveUsagePayload(usagePayload);
  if (!usage) {
    return undefined;
  }

  const totalTokens = readNonNegativeInteger(usage.total_tokens);
  if (totalTokens === undefined) {
    return undefined;
  }

  return {
    inputTokens: readNonNegativeInteger(usage.input_tokens) ?? 0,
    outputTokens: readNonNegativeInteger(usage.output_tokens) ?? 0,
    totalTokens,
  };
}

function resolveUsagePayload(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if ("total_tokens" in value) {
    return value;
  }
  if (isRecord(value.usage)) {
    return value.usage;
  }
  const response = value.response;
  if (!isRecord(response)) {
    return undefined;
  }
  return isRecord(response.usage) ? response.usage : undefined;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function normalizeNonNegativeInteger(value: unknown): number {
  return readNonNegativeInteger(value) ?? 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
