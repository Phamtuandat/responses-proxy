import type { FastifyBaseLogger } from "fastify";

export class KRouterUsageLimitError extends Error {
  readonly statusCode = 429;
  readonly code = "KROUTER_TOKEN_LIMIT_REACHED";
  readonly usage: KRouterUsageSnapshot;

  constructor(message: string, usage: KRouterUsageSnapshot) {
    super(message);
    this.name = "KRouterUsageLimitError";
    this.usage = usage;
  }
}

export type KRouterUsageSnapshot = {
  allowed?: boolean;
  remaining?: number;
  limit?: number;
  used?: number;
  raw: unknown;
};

type CheckKRouterUsageArgs = {
  apiKey?: string;
  requestId: string;
  logger: FastifyBaseLogger;
  timeoutMs: number;
  url: string;
  onEvent?: (entry: Record<string, unknown>) => Promise<void> | void;
};

export async function fetchKRouterUsage({
  apiKey,
  requestId,
  logger,
  timeoutMs,
  url,
  onEvent,
}: CheckKRouterUsageArgs): Promise<KRouterUsageSnapshot | undefined> {
  if (!apiKey) {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ apiKey }),
      signal: controller.signal,
    });

    const rawText = await response.text();
    const rawPayload = parseJsonSafely(rawText);

    if (!response.ok) {
      logger.warn(
        {
          requestId,
          usageCheckStatus: response.status,
          usageCheckBody: rawText,
        },
        "krouter usage check request failed",
      );
      await onEvent?.({
        event: "krouter_usage_check_failed",
        requestId,
        usageCheckStatus: response.status,
        usageCheckBody: rawText,
      });
      return undefined;
    }

    const usage = extractUsageSnapshot(rawPayload);
    logger.info(
      {
        requestId,
        usageCheckStatus: response.status,
        usageCheckMs: Date.now() - startedAt,
        usageAllowed: usage.allowed,
        usageRemaining: usage.remaining,
        usageLimit: usage.limit,
        usageUsed: usage.used,
      },
      "krouter usage check completed",
    );
    await onEvent?.({
      event: "krouter_usage_checked",
      requestId,
      usageCheckStatus: response.status,
      usageCheckMs: Date.now() - startedAt,
      usageAllowed: usage.allowed,
      usageRemaining: usage.remaining,
      usageLimit: usage.limit,
      usageUsed: usage.used,
    });

    return usage;
  } catch (error) {
    logger.warn(
      {
        err: error,
        requestId,
      },
      "krouter usage check skipped after request error",
    );
    await onEvent?.({
      event: "krouter_usage_check_error",
      requestId,
      errorMessage: error instanceof Error ? error.message : "Unknown usage check error",
    });
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function ensureKRouterUsageAvailable(
  args: CheckKRouterUsageArgs,
): Promise<KRouterUsageSnapshot | undefined> {
  const usage = await fetchKRouterUsage(args);

  if (!usage) {
    return undefined;
  }

  if (usage.allowed === false) {
    throw new KRouterUsageLimitError("KRouter API key is not allowed to make more requests", usage);
  }

  if (usage.remaining !== undefined && usage.remaining <= 0) {
    throw new KRouterUsageLimitError("KRouter token limit has been reached", usage);
  }

  return usage;
}

function extractUsageSnapshot(raw: unknown): KRouterUsageSnapshot {
  const limit = firstFiniteNumber(raw, [
    ["dailyTokenLimit"],
    ["limit"],
    ["token_limit"],
    ["tokens_limit"],
    ["quota"],
    ["quota_limit"],
    ["data", "dailyTokenLimit"],
    ["data", "limit"],
    ["data", "token_limit"],
    ["data", "tokens_limit"],
    ["data", "quota"],
    ["result", "dailyTokenLimit"],
    ["result", "limit"],
    ["result", "token_limit"],
  ]);
  const used = firstFiniteNumber(raw, [
    ["dailyTokensUsed"],
    ["used"],
    ["used_tokens"],
    ["tokens_used"],
    ["consumed_tokens"],
    ["data", "dailyTokensUsed"],
    ["data", "used"],
    ["data", "used_tokens"],
    ["data", "tokens_used"],
    ["result", "dailyTokensUsed"],
    ["result", "used"],
    ["result", "used_tokens"],
  ]);
  const remaining = firstFiniteNumber(raw, [
    ["remaining_tokens"],
    ["remaining_token"],
    ["tokens_remaining"],
    ["token_remaining"],
    ["remaining"],
    ["quota_remaining"],
    ["remaining_quota"],
    ["dailyTokensRemaining"],
    ["data", "remaining_tokens"],
    ["data", "tokens_remaining"],
    ["data", "remaining"],
    ["data", "quota_remaining"],
    ["data", "dailyTokensRemaining"],
    ["result", "remaining_tokens"],
    ["result", "tokens_remaining"],
    ["result", "remaining"],
    ["result", "dailyTokensRemaining"],
  ]);
  const allowed = firstBoolean(raw, [
    ["allowed"],
    ["isActive"],
    ["isExpired"],
    ["active"],
    ["valid"],
    ["enabled"],
    ["can_use"],
    ["data", "allowed"],
    ["data", "isActive"],
    ["data", "isExpired"],
    ["data", "active"],
    ["data", "valid"],
    ["result", "allowed"],
    ["result", "isActive"],
    ["result", "isExpired"],
    ["result", "active"],
  ]);

  const normalizedAllowed = deriveAllowed(raw, allowed);
  const normalizedRemaining =
    remaining ?? (limit !== undefined && used !== undefined ? Math.max(limit - used, 0) : undefined);

  return {
    allowed: normalizedAllowed,
    remaining: normalizedRemaining,
    limit,
    used,
    raw,
  };
}

function deriveAllowed(raw: unknown, allowed: boolean | undefined): boolean | undefined {
  const isExpired = firstBoolean(raw, [["isExpired"], ["data", "isExpired"], ["result", "isExpired"]]);
  const isActive = firstBoolean(raw, [["isActive"], ["data", "isActive"], ["result", "isActive"]]);

  if (isExpired === true) {
    return false;
  }
  if (isActive !== undefined) {
    return isActive;
  }
  return allowed;
}

function parseJsonSafely(value: string): unknown {
  if (!value.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function firstFiniteNumber(payload: unknown, paths: string[][]): number | undefined {
  for (const path of paths) {
    const value = readPath(payload, path);
    const parsed = toFiniteNumber(value);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return undefined;
}

function firstBoolean(payload: unknown, paths: string[][]): boolean | undefined {
  for (const path of paths) {
    const value = readPath(payload, path);
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") {
        return true;
      }
      if (normalized === "false") {
        return false;
      }
    }
  }

  return undefined;
}

function readPath(payload: unknown, path: string[]): unknown {
  let current = payload;

  for (const key of path) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}
