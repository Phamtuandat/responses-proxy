/**
 * Kiro (AWS CodeWhisperer) credit usage fetcher.
 *
 * Calls the upstream `getUsageLimits` endpoint to retrieve real credit
 * consumption for a Kiro account. Mirrors 9router's `getKiroUsage` in
 * `open-sse/services/usage.js`.
 *
 * Kiro free tier charges per "agentic request credit" (not per token).
 * Each model has a rate multiplier (e.g. opus = 5x, sonnet = 1x) that
 * consumes more credits per request. The `getUsageLimits` API returns
 * used/total credit numbers per resource type.
 */

type FetchLike = typeof fetch;

export type KiroQuotaEntry = {
  resourceType: string;
  used: number;
  total: number;
  remaining: number;
  resetAt: string | null;
  unlimited: boolean;
};

export type KiroUsageResult = {
  ok: true;
  plan: string;
  quotas: Record<string, KiroQuotaEntry>;
} | {
  ok: false;
  message: string;
};

/**
 * Fetch real Kiro credit usage from the upstream CodeWhisperer API.
 *
 * Tries multiple endpoints (matching 9router's fallback strategy):
 * 1. `codewhisperer.us-east-1.amazonaws.com/getUsageLimits` (GET)
 * 2. `codewhisperer.us-east-1.amazonaws.com` (POST, JSON-RPC style)
 * 3. `q.us-east-1.amazonaws.com/getUsageLimits` (GET)
 */
export async function fetchKiroUsage(args: {
  accessToken: string;
  profileArn?: string;
  region?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<KiroUsageResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const region = args.region || "us-east-1";
  const profileArn = args.profileArn || "";
  const timeoutMs = args.timeoutMs ?? 15000;

  const getUsageParams = new URLSearchParams({
    isEmailRequired: "true",
    origin: "AI_EDITOR",
    resourceType: "AGENTIC_REQUEST",
  });

  const attempts: Array<{ name: string; run: () => Promise<Response> }> = [
    {
      name: "codewhisperer-get",
      run: () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        return fetchImpl(
          `https://codewhisperer.${region}.amazonaws.com/getUsageLimits?${getUsageParams.toString()}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${args.accessToken}`,
              Accept: "application/json",
              "X-Amz-User-Agent": "aws-sdk-js/1.0.0 KiroIDE",
              "User-Agent": "aws-sdk-js/1.0.0 KiroIDE",
            },
            signal: controller.signal,
          },
        ).finally(() => clearTimeout(timer));
      },
    },
    {
      name: "codewhisperer-post",
      run: () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        return fetchImpl(
          `https://codewhisperer.${region}.amazonaws.com`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${args.accessToken}`,
              "Content-Type": "application/x-amz-json-1.0",
              "X-Amz-Target": "AmazonCodeWhispererService.GetUsageLimits",
              Accept: "application/json",
            },
            body: JSON.stringify({
              origin: "AI_EDITOR",
              profileArn,
              resourceType: "AGENTIC_REQUEST",
            }),
            signal: controller.signal,
          },
        ).finally(() => clearTimeout(timer));
      },
    },
    {
      name: "q-get",
      run: () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const params = new URLSearchParams({
          origin: "AI_EDITOR",
          profileArn,
          resourceType: "AGENTIC_REQUEST",
        });
        return fetchImpl(
          `https://q.${region}.amazonaws.com/getUsageLimits?${params.toString()}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${args.accessToken}`,
              Accept: "application/json",
            },
            signal: controller.signal,
          },
        ).finally(() => clearTimeout(timer));
      },
    },
  ];

  const errors: string[] = [];
  let sawAuthError = false;

  for (const attempt of attempts) {
    try {
      const response = await attempt.run();
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        if (response.status === 401 || response.status === 403) {
          sawAuthError = true;
        }
        errors.push(`${attempt.name}:${response.status}${errorText ? `:${errorText.slice(0, 200)}` : ""}`);
        continue;
      }

      const data = await response.json();
      return parseKiroQuotaData(data as Record<string, unknown>);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${attempt.name}:${msg}`);
    }
  }

  if (sawAuthError) {
    return {
      ok: false,
      message: "Kiro quota API rejected the current token. Chat may still work.",
    };
  }

  return {
    ok: false,
    message: errors.length > 0
      ? `Unable to fetch Kiro usage. (${errors[errors.length - 1]})`
      : "Unable to fetch Kiro usage.",
  };
}

function parseKiroQuotaData(data: Record<string, unknown>): KiroUsageResult {
  const usageList = Array.isArray(data.usageBreakdownList) ? data.usageBreakdownList : [];
  const quotas: Record<string, KiroQuotaEntry> = {};
  const resetAt = parseResetTime(data.nextDateReset ?? data.resetDate);

  for (const breakdown of usageList) {
    if (typeof breakdown !== "object" || breakdown === null) continue;
    const record = breakdown as Record<string, unknown>;
    const resourceType = (typeof record.resourceType === "string"
      ? record.resourceType
      : "unknown"
    ).toLowerCase();
    const used = toNumber(record.currentUsageWithPrecision);
    const total = toNumber(record.usageLimitWithPrecision);

    quotas[resourceType] = {
      resourceType,
      used,
      total,
      remaining: total - used,
      resetAt,
      unlimited: total <= 0,
    };

    // Free trial sub-quota
    if (typeof record.freeTrialInfo === "object" && record.freeTrialInfo !== null) {
      const ft = record.freeTrialInfo as Record<string, unknown>;
      const ftUsed = toNumber(ft.currentUsageWithPrecision);
      const ftTotal = toNumber(ft.usageLimitWithPrecision);
      quotas[`${resourceType}_freetrial`] = {
        resourceType: `${resourceType}_freetrial`,
        used: ftUsed,
        total: ftTotal,
        remaining: ftTotal - ftUsed,
        resetAt: parseResetTime(ft.freeTrialExpiry ?? resetAt),
        unlimited: false,
      };
    }
  }

  const subscriptionInfo = typeof data.subscriptionInfo === "object" && data.subscriptionInfo !== null
    ? data.subscriptionInfo as Record<string, unknown>
    : {};
  const plan = typeof subscriptionInfo.subscriptionTitle === "string"
    ? subscriptionInfo.subscriptionTitle
    : "Kiro";

  return { ok: true, plan, quotas };
}

function parseResetTime(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) {
      const ts = Number(value);
      return new Date(ts < 1e12 ? ts * 1000 : ts).toISOString();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
