import type { RuntimeProviderPreset } from "./runtime-provider-repository.js";

export type ProviderRoutingHint = {
  providerId?: string;
  providerName?: string;
};

export type ProviderRoutingError = {
  statusCode: number;
  type: string;
  code: string;
  message: string;
};

export type ProviderRoutingResolution =
  | {
      provider: RuntimeProviderPreset;
      matchReason: "single_match" | "explicit_provider";
    }
  | {
      error: ProviderRoutingError;
    };

type ProviderRoutingCandidate =
  | {
      provider: RuntimeProviderPreset;
      matchReason: "explicit_provider";
    }
  | {
      error: ProviderRoutingError;
    }
  | null;

export function readRequestProviderHint(
  headers: Record<string, unknown>,
  metadata: unknown,
): ProviderRoutingHint {
  const explicitProviderId =
    readHeaderString(headers["x-provider-id"]) ?? readMetadataString(metadata, "provider_id");
  const explicitProviderName =
    readHeaderString(headers["x-provider-name"]) ??
    readMetadataString(metadata, "provider_name") ??
    readMetadataString(metadata, "provider");

  return {
    providerId: explicitProviderId,
    providerName: explicitProviderName,
  };
}

export function resolveProviderForRequest(args: {
  providers: RuntimeProviderPreset[];
  explicitProviderId?: string;
  explicitProviderName?: string;
}): ProviderRoutingResolution {
  const { providers } = args;
  if (!providers.length) {
    return {
      error: {
        statusCode: 401,
        type: "authentication_error",
        code: "INVALID_ROUTING_API_KEY",
        message:
          "Authorization Bearer token must match one of the configured client or provider API keys",
      },
    };
  }

  const explicitMatch = resolveExplicitProviderMatch(
    providers,
    args.explicitProviderId,
    args.explicitProviderName,
  );
  if (explicitMatch && "error" in explicitMatch) {
    return explicitMatch;
  }
  if (explicitMatch?.provider) {
    return explicitMatch;
  }

  if (providers.length === 1) {
    return {
      provider: providers[0],
      matchReason: "single_match",
    };
  }

  return {
    error: {
      statusCode: 409,
      type: "validation_error",
      code: "AMBIGUOUS_PROVIDER_SELECTION",
      message:
        "This API key is assigned to multiple providers. Set metadata.provider_id, metadata.provider, x-provider-id, or x-provider-name.",
    },
  };
}

function resolveExplicitProviderMatch(
  providers: RuntimeProviderPreset[],
  explicitProviderId?: string,
  explicitProviderName?: string,
): ProviderRoutingCandidate {
  const normalizedProviderId = explicitProviderId?.trim();
  if (normalizedProviderId) {
    const matched = providers.find((provider) => provider.id === normalizedProviderId);
    if (!matched) {
      return {
        error: {
          statusCode: 403,
          type: "authentication_error",
          code: "PROVIDER_NOT_ALLOWED_FOR_API_KEY",
          message: "The supplied API key is not allowed to access the requested provider",
        },
      };
    }
    return {
      provider: matched,
      matchReason: "explicit_provider",
    };
  }

  const normalizedProviderName = normalizeProviderName(explicitProviderName);
  if (!normalizedProviderName) {
    return null;
  }

  const matches = providers.filter(
    (provider) =>
      normalizeProviderName(provider.name) === normalizedProviderName ||
      normalizeProviderName(provider.id) === normalizedProviderName,
  );
  if (matches.length === 1) {
    return {
      provider: matches[0],
      matchReason: "explicit_provider",
    };
  }
  if (matches.length > 1) {
    return {
      error: {
        statusCode: 409,
        type: "validation_error",
        code: "AMBIGUOUS_PROVIDER_NAME",
        message: "The supplied provider name matches multiple configured providers",
      },
    };
  }
  return {
    error: {
      statusCode: 403,
      type: "authentication_error",
      code: "PROVIDER_NOT_ALLOWED_FOR_API_KEY",
      message: "The supplied API key is not allowed to access the requested provider",
    },
  };
}

function readHeaderString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === "string" && entry.trim());
    return typeof first === "string" ? first.trim() : undefined;
  }
  return undefined;
}

function readMetadataString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const result = (value as Record<string, unknown>)[key];
  return typeof result === "string" && result.trim() ? result.trim() : undefined;
}

function normalizeProviderName(value?: string): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined;
}
