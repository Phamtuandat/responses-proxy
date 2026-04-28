export type HealthResponse = {
  ok: boolean;
  service?: string;
  upstream?: string;
  activeProviderId?: string;
  fallback?: string;
};

export type ProviderSummary = {
  id?: string;
  name?: string;
  baseUrl?: string;
  current?: boolean;
};

export type ProvidersResponse = {
  currentProvider?: ProviderSummary;
  providers?: ProviderSummary[];
  [key: string]: unknown;
};

export type UsageStatsResponse = {
  today?: Record<string, unknown>;
  month?: Record<string, unknown>;
  [key: string]: unknown;
};

export type PromptCacheLatestResponse = {
  requestId?: string;
  model?: string;
  promptCacheKey?: string;
  cachedInputTokens?: number;
  [key: string]: unknown;
};

export type ChatGptOAuthStatusResponse = {
  enabled?: boolean;
  accounts?: unknown[];
  rotationMode?: string;
  [key: string]: unknown;
};

export type ClientConfigsStatusResponse = {
  hermes?: Record<string, unknown>;
  codex?: Record<string, unknown>;
  [key: string]: unknown;
};
