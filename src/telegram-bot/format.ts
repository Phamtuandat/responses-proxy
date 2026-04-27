type ProxyErrorEnvelope = {
  error?: {
    code?: string;
    message?: string;
    request_id?: string;
    upstream_status?: number;
    retryable?: boolean;
  };
};

export function maskApiKey(value: string | null | undefined): string {
  const raw = value?.trim() || "";
  if (!raw) {
    return "none";
  }
  if (raw.length <= 10) {
    return `${raw.slice(0, 2)}...${raw.slice(-2)}`;
  }
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

export function formatProxyError(error: ProxyErrorEnvelope["error"] | Error): string {
  if (error instanceof Error) {
    return error.message;
  }
  const proxyError = error ?? {};
  const lines = [
    `${proxyError.code ?? "PROXY_REQUEST_FAILED"}: ${proxyError.message ?? "Unknown proxy error"}`,
  ];
  if (proxyError.request_id) {
    lines.push(`request_id: ${proxyError.request_id}`);
  }
  if (typeof proxyError.upstream_status === "number") {
    lines.push(`upstream_status: ${proxyError.upstream_status}`);
  }
  if (typeof proxyError.retryable === "boolean") {
    lines.push(`retryable: ${String(proxyError.retryable)}`);
  }
  return lines.join("\n");
}

export function formatHealthStatus(status: {
  ok?: boolean;
  upstream?: string | null;
  activeProviderId?: string;
  fallback?: string | null;
  latestPromptCache?: {
    providerId?: string;
    cacheKey?: string;
    cacheStatus?: string;
    providerCacheHit?: boolean;
  } | null;
  usageSummary?: string[];
}): string {
  const lines = [
    "Proxy status",
    `ok: ${String(status.ok ?? true)}`,
    `active provider: ${status.activeProviderId ?? "unknown"}`,
    `upstream: ${status.upstream ?? "n/a"}`,
    `fallback: ${status.fallback ?? "n/a"}`,
  ];
  if (status.latestPromptCache) {
    lines.push(
      `prompt cache: ${status.latestPromptCache.cacheStatus ?? "unknown"} ` +
        `provider=${status.latestPromptCache.providerId ?? "n/a"} ` +
        `hit=${String(status.latestPromptCache.providerCacheHit ?? false)}`,
    );
  }
  for (const line of status.usageSummary ?? []) {
    lines.push(line);
  }
  return lines.join("\n");
}

export function formatProviders(payload: {
  activeProviderId?: string;
  providers?: Array<{
    id: string;
    name: string;
    authMode?: string | null;
    hasProviderApiKey?: boolean;
    chatgptAccountId?: string | null;
  }>;
  clientRoutes?: Array<{
    key: string;
    providerId: string | null;
    providerName: string | null;
    modelOverride: string | null;
    apiKeys: string[];
  }>;
}): string {
  const lines = [`Active provider: ${payload.activeProviderId ?? "none"}`, "", "Providers:"];
  for (const provider of payload.providers ?? []) {
    lines.push(
      `- ${provider.name} (${provider.id}) auth=${provider.authMode ?? "api_key"} ` +
        `apiKey=${provider.hasProviderApiKey ? "yes" : "no"} ` +
        `account=${provider.chatgptAccountId ?? "n/a"}`,
    );
  }
  lines.push("", "Client routes:");
  for (const route of payload.clientRoutes ?? []) {
    lines.push(
      `- ${route.key}: ${route.providerName ?? route.providerId ?? "unassigned"} ` +
        `model=${route.modelOverride ?? "default"} keys=${route.apiKeys.map(maskApiKey).join(", ") || "none"}`,
    );
  }
  return lines.join("\n");
}

export function formatProviderDetails(provider: {
  id: string;
  name: string;
  baseUrl: string;
  authMode?: string | null;
  chatgptAccountId?: string | null;
  providerApiKeysCount?: number;
  capabilities?: {
    systemManaged?: boolean;
    accountPlatform?: string;
    accountPoolRequired?: boolean;
  };
}): string {
  return [
    `${provider.name} (${provider.id})`,
    `baseUrl: ${provider.baseUrl}`,
    `authMode: ${provider.authMode ?? "api_key"}`,
    `provider keys: ${provider.providerApiKeysCount ?? 0}`,
    `system managed: ${String(provider.capabilities?.systemManaged ?? false)}`,
    `account platform: ${provider.capabilities?.accountPlatform ?? "n/a"}`,
    `account pool required: ${String(provider.capabilities?.accountPoolRequired ?? false)}`,
    `chatgpt account: ${provider.chatgptAccountId ?? "n/a"}`,
  ].join("\n");
}

export function formatClientConfigs(payload: {
  proxyBaseUrl?: string;
  clients?: Record<
    string,
    {
      path?: string;
      exists?: boolean;
      configured?: boolean;
      routeApiKey?: string;
      detected?: Record<string, string | null>;
      auth?: {
        configured?: boolean;
        detectedApiKey?: string | null;
      };
    }
  >;
}): string {
  const lines = [`Proxy base URL: ${payload.proxyBaseUrl ?? "n/a"}`];
  for (const [client, status] of Object.entries(payload.clients ?? {})) {
    lines.push("");
    lines.push(`${client}:`);
    lines.push(`path: ${status.path ?? "n/a"}`);
    lines.push(`exists: ${String(status.exists ?? false)}`);
    lines.push(`configured: ${String(status.configured ?? false)}`);
    lines.push(`routeApiKey: ${maskApiKey(status.routeApiKey)}`);
    if (status.auth) {
      lines.push(`auth configured: ${String(status.auth.configured ?? false)}`);
      lines.push(`auth apiKey: ${maskApiKey(status.auth.detectedApiKey)}`);
    }
    for (const [key, value] of Object.entries(status.detected ?? {})) {
      lines.push(`${key}: ${value ?? "n/a"}`);
    }
  }
  return lines.join("\n");
}

export function formatOauthStatus(payload: {
  enabled?: boolean;
  rotationMode?: string;
  accounts?: Array<{
    id: string;
    email?: string;
    accountId?: string;
    disabled?: boolean;
    expiresAt?: string;
    lastRefreshAt?: string | null;
  }>;
}): string {
  const lines = [
    `OAuth enabled: ${String(payload.enabled ?? false)}`,
    `Rotation mode: ${payload.rotationMode ?? "unknown"}`,
    "",
    "Accounts:",
  ];
  for (const account of payload.accounts ?? []) {
    lines.push(
      `- ${account.email || account.accountId || account.id} id=${account.id} ` +
        `disabled=${String(account.disabled ?? false)} expires=${account.expiresAt ?? "n/a"} ` +
        `refreshed=${account.lastRefreshAt ?? "never"}`,
    );
  }
  if ((payload.accounts?.length ?? 0) === 0) {
    lines.push("- none");
  }
  return lines.join("\n");
}

export function formatTestResult(payload: { outputText: string; requestId?: string | null }): string {
  const lines = ["Test response", payload.outputText.trim() || "(empty)"];
  if (payload.requestId) {
    lines.push("", `request_id: ${payload.requestId}`);
  }
  return lines.join("\n");
}

export function formatModels(payload: {
  data?: Array<{ id?: string; owned_by?: string }>;
}): string {
  const lines = ["Models:"];
  for (const item of payload.data ?? []) {
    lines.push(`- ${item.id ?? "unknown"} owner=${item.owned_by ?? "n/a"}`);
  }
  if ((payload.data?.length ?? 0) === 0) {
    lines.push("- none");
  }
  return lines.join("\n");
}

export function extractResponseText(body: unknown): string {
  if (!body || typeof body !== "object") {
    return "";
  }
  const candidate = body as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (typeof candidate.output_text === "string") {
    return candidate.output_text;
  }
  const parts =
    candidate.output
      ?.flatMap((item) => item.content ?? [])
      .filter((part) => part?.type === "output_text" && typeof part.text === "string")
      .map((part) => part.text ?? "") ?? [];
  return parts.join("\n").trim();
}
