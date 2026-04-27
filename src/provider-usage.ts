import type { FastifyBaseLogger } from "fastify";

export class ProviderUsageLimitError extends Error {
  readonly statusCode = 429;
  readonly code = "PROVIDER_TOKEN_LIMIT_REACHED";
  readonly usage: ProviderUsageSnapshot;

  constructor(message: string, usage: ProviderUsageSnapshot) {
    super(message);
    this.name = "ProviderUsageLimitError";
    this.usage = usage;
  }
}

export type ProviderUsageSnapshot = {
  allowed?: boolean;
  remaining?: number;
  limit?: number;
  used?: number;
  raw: unknown;
};

export const OPENAI_ORGANIZATION_USAGE_COMPLETIONS_URL =
  "https://api.openai.com/v1/organization/usage/completions";

type CheckProviderUsageArgs = {
  apiKey?: string;
  requestId: string;
  logger: FastifyBaseLogger;
  timeoutMs: number;
  url: string;
  onEvent?: (entry: Record<string, unknown>) => Promise<void> | void;
};

export async function fetchProviderUsage({
  apiKey,
  requestId,
  logger,
  timeoutMs,
  url,
  onEvent,
}: CheckProviderUsageArgs): Promise<ProviderUsageSnapshot | undefined> {
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
        "provider usage check request failed",
      );
      await onEvent?.({
        event: "provider_usage_check_failed",
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
      "provider usage check completed",
    );
    await onEvent?.({
      event: "provider_usage_checked",
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
      "provider usage check skipped after request error",
    );
    await onEvent?.({
      event: "provider_usage_check_error",
      requestId,
      errorMessage: error instanceof Error ? error.message : "Unknown usage check error",
    });
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchOpenAiCompletionsUsage({
  accessToken,
  requestId,
  logger,
  timeoutMs,
  url = OPENAI_ORGANIZATION_USAGE_COMPLETIONS_URL,
  now = new Date(),
}: {
  accessToken?: string;
  requestId: string;
  logger: FastifyBaseLogger;
  timeoutMs: number;
  url?: string;
  now?: Date;
}): Promise<ProviderUsageSnapshot | undefined> {
  if (!accessToken) {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const endTime = Math.floor(now.getTime() / 1000);
  const startTime = endTime - 24 * 60 * 60;
  const usageUrl = new URL(url);
  usageUrl.searchParams.set("start_time", String(startTime));
  usageUrl.searchParams.set("end_time", String(endTime));
  usageUrl.searchParams.set("bucket_width", "1d");
  usageUrl.searchParams.set("group_by", "model");

  try {
    const response = await fetch(usageUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
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
        "openai usage request failed",
      );
      return {
        allowed: false,
        raw: rawPayload,
      };
    }

    const usage = extractOpenAiUsageSnapshot(rawPayload);
    logger.info(
      {
        requestId,
        usageCheckStatus: response.status,
        usageCheckMs: Date.now() - startedAt,
        usageUsed: usage.used,
      },
      "openai usage request completed",
    );
    return usage;
  } catch (error) {
    logger.warn(
      {
        err: error,
        requestId,
      },
      "openai usage request skipped after request error",
    );
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export async function ensureProviderUsageAvailable(
  args: CheckProviderUsageArgs,
): Promise<ProviderUsageSnapshot | undefined> {
  const usage = await fetchProviderUsage(args);

  if (!usage) {
    return undefined;
  }

  if (usage.allowed === false) {
    throw new ProviderUsageLimitError("Provider API key is not allowed to make more requests", usage);
  }

  if (usage.remaining !== undefined && usage.remaining <= 0) {
    throw new ProviderUsageLimitError("Provider token limit has been reached", usage);
  }

  return usage;
}

function extractUsageSnapshot(raw: unknown): ProviderUsageSnapshot {
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

function extractOpenAiUsageSnapshot(raw: unknown): ProviderUsageSnapshot {
  const buckets = isRecord(raw) && Array.isArray(raw.data) ? raw.data : [];
  let used = 0;
  for (const bucket of buckets) {
    if (!isRecord(bucket) || !Array.isArray(bucket.results)) {
      continue;
    }
    for (const result of bucket.results) {
      if (!isRecord(result)) {
        continue;
      }
      used += toFiniteNumber(result.input_tokens) ?? 0;
      used += toFiniteNumber(result.output_tokens) ?? 0;
      used += toFiniteNumber(result.input_audio_tokens) ?? 0;
      used += toFiniteNumber(result.output_audio_tokens) ?? 0;
    }
  }
  return {
    allowed: true,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
