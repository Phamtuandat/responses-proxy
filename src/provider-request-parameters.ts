export type RequestParameterMode = "forward" | "strip" | "rename";

export type RequestParameterRule = {
  mode: RequestParameterMode;
  target?: string;
};

export type ProviderRequestParameterPolicy = {
  maxOutputTokens?: RequestParameterRule;
};

type LegacyCompatibleCapabilities = {
  stripMaxOutputTokens?: boolean;
  requestParameterPolicy?: ProviderRequestParameterPolicy;
};

export function resolveMaxOutputTokensRule(
  capabilities?: LegacyCompatibleCapabilities,
): RequestParameterRule {
  const configured = capabilities?.requestParameterPolicy?.maxOutputTokens;
  if (configured) {
    return normalizeRequestParameterRule(configured, "max_output_tokens");
  }

  if (capabilities?.stripMaxOutputTokens) {
    return { mode: "strip" };
  }

  return { mode: "forward" };
}

export function shouldForwardMaxOutputTokens(
  capabilities?: LegacyCompatibleCapabilities,
): boolean {
  return resolveMaxOutputTokensRule(capabilities).mode !== "strip";
}

export function applyProviderRequestParameterPolicy(
  body: Record<string, unknown>,
  capabilities?: LegacyCompatibleCapabilities,
): Record<string, unknown> {
  const rule = resolveMaxOutputTokensRule(capabilities);
  if (!Object.prototype.hasOwnProperty.call(body, "max_output_tokens")) {
    return body;
  }

  if (rule.mode === "forward") {
    return body;
  }

  const { max_output_tokens: maxOutputTokens, ...rest } = body;
  if (rule.mode === "strip") {
    return rest;
  }

  const target = rule.target?.trim();
  if (!target || target === "max_output_tokens") {
    return body;
  }

  return {
    ...rest,
    [target]: maxOutputTokens,
  };
}

export function parseProviderRequestParameterPolicyInput(
  value: unknown,
): ProviderRequestParameterPolicy {
  if (!isRecord(value)) {
    return {};
  }

  const maxOutputTokensValue =
    value.maxOutputTokens ??
    value.max_output_tokens ??
    value.maxOutputTokensRule ??
    value.max_output_tokens_rule;

  if (maxOutputTokensValue === undefined) {
    return {};
  }

  return {
    maxOutputTokens: normalizeRequestParameterRule(maxOutputTokensValue, "max_output_tokens"),
  };
}

export function cloneProviderRequestParameterPolicy(
  policy?: ProviderRequestParameterPolicy,
): ProviderRequestParameterPolicy {
  return policy?.maxOutputTokens
    ? {
        maxOutputTokens: {
          mode: policy.maxOutputTokens.mode,
          ...(policy.maxOutputTokens.target ? { target: policy.maxOutputTokens.target } : {}),
        },
      }
    : {};
}

function normalizeRequestParameterRule(
  value: unknown,
  fallbackTarget: string,
): RequestParameterRule {
  if (typeof value === "string") {
    return {
      mode: normalizeRequestParameterMode(value),
    };
  }

  if (!isRecord(value)) {
    return { mode: "forward" };
  }

  const rawMode =
    typeof value.mode === "string"
      ? value.mode
      : typeof value.action === "string"
        ? value.action
        : "forward";
  const mode = normalizeRequestParameterMode(rawMode);
  const rawTarget =
    typeof value.target === "string"
      ? value.target
      : typeof value.renameTo === "string"
        ? value.renameTo
        : typeof value.rename_to === "string"
          ? value.rename_to
          : undefined;
  const target = rawTarget?.trim() || undefined;

  if (mode !== "rename") {
    return { mode };
  }

  return {
    mode,
    target: normalizeParameterName(target || fallbackTarget),
  };
}

function normalizeRequestParameterMode(value: string): RequestParameterMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === "forward" || normalized === "strip" || normalized === "rename") {
    return normalized;
  }
  return "forward";
}

function normalizeParameterName(value: string): string {
  const normalized = value.trim();
  if (!/^[a-z][a-z0-9_]*$/i.test(normalized)) {
    return "max_output_tokens";
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
