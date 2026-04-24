import { ProviderUsageLimitError, type ProviderUsageSnapshot } from "./provider-usage.js";
import type { ProviderErrorPolicy } from "./runtime-provider-repository.js";

export type ParsedUpstreamError = {
  message?: string;
  type?: string;
  code?: string;
  param?: string;
};

export type ProxyErrorEnvelope = {
  error: {
    type: "proxy_error" | "request_error" | "internal_error";
    code: string;
    message: string;
    request_id?: string;
    upstream_status?: number;
    upstream_body?: string;
    upstream_error?: ParsedUpstreamError;
    retryable?: boolean;
    usage?: ProviderUsageSnapshot | ReturnType<typeof summarizeUsageLike>;
  };
};

export type ResolvedProxyError = {
  envelope: ProxyErrorEnvelope;
  errorCode: string;
  retryable: boolean;
};

type BuildProxyErrorEnvelopeArgs = {
  statusCode: number;
  message: string;
  requestId?: string;
  upstreamBody?: string;
  usage?: ProviderUsageSnapshot;
  defaultCode?: string;
  errorType?: "proxy_error" | "request_error" | "internal_error";
  providerErrorPolicy?: ProviderErrorPolicy;
};

const MAX_UPSTREAM_ERROR_BODY_CHARS = 4_096;

export function resolveProxyError(args: BuildProxyErrorEnvelopeArgs): ResolvedProxyError {
  const parsedUpstream = parseUpstreamErrorBody(args.upstreamBody);
  const mapped = applyProviderErrorPolicy(
    {
      statusCode: args.statusCode,
      message: args.message,
      parsedUpstream,
      upstreamBody: args.upstreamBody,
      defaultCode: args.defaultCode ?? defaultProxyErrorCode(args.statusCode),
      retryable: isRetryableStatusCode(args.statusCode),
    },
    args.providerErrorPolicy,
  );
  return {
    errorCode: mapped.code,
    retryable: mapped.retryable,
    envelope: {
      error: {
        type:
          args.errorType ??
          (args.statusCode >= 400 && args.statusCode < 500 ? "request_error" : "internal_error"),
        code: mapped.code,
        message: resolveProxyErrorMessage(mapped.message, parsedUpstream),
        request_id: args.requestId,
        upstream_status: args.statusCode,
        upstream_body: truncateUpstreamErrorBody(args.upstreamBody),
        upstream_error: parsedUpstream,
        retryable: mapped.retryable,
        usage:
          args.usage instanceof ProviderUsageLimitError
            ? args.usage.usage
            : args.usage
              ? summarizeUsageLike(args.usage)
              : undefined,
      },
    },
  };
}

export function buildProxyErrorEnvelope(args: BuildProxyErrorEnvelopeArgs): ProxyErrorEnvelope {
  return resolveProxyError(args).envelope;
}

export function defaultProxyErrorCode(statusCode: number): string {
  if (statusCode === 413) {
    return "REQUEST_BODY_TOO_LARGE";
  }
  return statusCode >= 500 ? "UPSTREAM_REQUEST_FAILED" : "UPSTREAM_BAD_REQUEST";
}

export function isRetryableStatusCode(statusCode: number): boolean {
  return statusCode === 408 || statusCode === 409 || statusCode === 429 || statusCode >= 500;
}

export function parseUpstreamErrorBody(body?: string): ParsedUpstreamError | undefined {
  if (typeof body !== "string" || !body.trim()) {
    return undefined;
  }

  const parsed = parseJsonLike(body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }

  const root = parsed as Record<string, unknown>;
  const errorRecord = isRecord(root.error) ? root.error : root;
  const message = readString(errorRecord.message) ?? readString(root.message);
  const type = readString(errorRecord.type) ?? readString(root.type);
  const code = readString(errorRecord.code) ?? readString(root.code);
  const param = readString(errorRecord.param) ?? readString(root.param);

  if (!message && !type && !code && !param) {
    return undefined;
  }

  return {
    message,
    type,
    code,
    param,
  };
}

export function truncateUpstreamErrorBody(body?: string): string | undefined {
  if (typeof body !== "string") {
    return undefined;
  }
  const trimmed = body.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length <= MAX_UPSTREAM_ERROR_BODY_CHARS) {
    return trimmed;
  }

  const headBudget = Math.max(256, Math.floor(MAX_UPSTREAM_ERROR_BODY_CHARS * 0.75));
  const tailBudget = Math.max(128, MAX_UPSTREAM_ERROR_BODY_CHARS - headBudget - 32);
  return `${trimmed.slice(0, headBudget)}\n... upstream error body truncated ...\n${trimmed.slice(
    Math.max(0, trimmed.length - tailBudget),
  )}`.trim();
}

function resolveProxyErrorMessage(message: string, parsedUpstream?: ParsedUpstreamError): string {
  if (!parsedUpstream?.message) {
    return message;
  }
  if (
    message.includes("upstream rejected request") ||
    message.includes("upstream request failed") ||
    message.includes("Unknown proxy error")
  ) {
    return message.includes(parsedUpstream.message)
      ? message
      : `${message}: ${parsedUpstream.message}`;
  }
  return message;
}

function parseJsonLike(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeUsageLike(usage: ProviderUsageSnapshot): ProviderUsageSnapshot {
  return {
    allowed: usage.allowed,
    remaining: usage.remaining,
    limit: usage.limit,
    used: usage.used,
    raw: usage.raw,
  };
}

function applyProviderErrorPolicy(
  base: {
    statusCode: number;
    message: string;
    parsedUpstream?: ParsedUpstreamError;
    upstreamBody?: string;
    defaultCode: string;
    retryable: boolean;
  },
  policy?: ProviderErrorPolicy,
): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (!policy?.rules?.length) {
    return {
      code: base.defaultCode,
      message: base.message,
      retryable: base.retryable,
    };
  }

  const upstreamCode = base.parsedUpstream?.code?.toLowerCase();
  const upstreamType = base.parsedUpstream?.type?.toLowerCase();
  const message = base.message.toLowerCase();
  const body = base.upstreamBody?.toLowerCase() ?? "";

  for (const rule of policy.rules) {
    if (rule.statusCodes?.length && !rule.statusCodes.includes(base.statusCode)) {
      continue;
    }
    if (rule.upstreamCodes?.length) {
      const allowed = rule.upstreamCodes.map((item) => item.toLowerCase());
      if (!upstreamCode || !allowed.includes(upstreamCode)) {
        continue;
      }
    }
    if (rule.upstreamTypes?.length) {
      const allowed = rule.upstreamTypes.map((item) => item.toLowerCase());
      if (!upstreamType || !allowed.includes(upstreamType)) {
        continue;
      }
    }
    if (rule.messageIncludes?.length) {
      const matched = rule.messageIncludes.some((item) => message.includes(item.toLowerCase()));
      if (!matched) {
        continue;
      }
    }
    if (rule.bodyIncludes?.length) {
      const matched = rule.bodyIncludes.some((item) => body.includes(item.toLowerCase()));
      if (!matched) {
        continue;
      }
    }

    return {
      code: rule.code?.trim() || base.defaultCode,
      message: rule.message?.trim() || base.message,
      retryable: typeof rule.retryable === "boolean" ? rule.retryable : base.retryable,
    };
  }

  return {
    code: base.defaultCode,
    message: base.message,
    retryable: base.retryable,
  };
}
