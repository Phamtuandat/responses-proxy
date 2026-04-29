export type HealthResponse = {
  ok: boolean;
  service?: string | null;
  upstream?: string | null;
  activeProviderId?: string | null;
  fallback?: string | null;
};

export type ProviderSummary = {
  id: string;
  name: string;
  baseUrl: string;
  hasProviderApiKey?: boolean;
  providerApiKeys?: string[];
  providerApiKeysCount?: number;
  authMode?: string;
  chatgptAccountId?: string | null;
  capabilities?: Record<string, unknown>;
  createdAt?: string | null;
  updatedAt?: string | null;
  current?: boolean;
  [key: string]: unknown;
};

export type ClientRouteSummary = {
  key: string;
  providerId?: string | null;
  providerName?: string | null;
  modelOverride?: string | null;
  rtkPolicy?: unknown;
  apiKeys?: string[];
  [key: string]: unknown;
};

export type ClientTokenWindowType = "daily" | "weekly" | "monthly" | "fixed";

export type ClientTokenLimitConfig = {
  clientRoute: string;
  enabled: boolean;
  tokenLimit: number;
  windowType: ClientTokenWindowType;
  windowSizeSeconds?: number;
  hardBlock: boolean;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

export type ClientTokenUsageSnapshot = {
  clientRoute: string;
  windowStart?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  updatedAt?: string;
  [key: string]: unknown;
};

export type ClientTokenLimitStatus = {
  kind?: string;
  state?: string;
  message?: string;
  limitReached?: boolean;
  [key: string]: unknown;
};

export type ClientTokenLimitSummary = {
  clientRoute: string;
  config?: ClientTokenLimitConfig | null;
  usage?: ClientTokenUsageSnapshot;
  status?: ClientTokenLimitStatus;
  [key: string]: unknown;
};

export type ProvidersResponse = {
  ok?: boolean;
  activeProviderId?: string | null;
  clientRoutes?: ClientRouteSummary[];
  providerOptions?: ProviderSummary[];
  providers?: ProviderSummary[];
  [key: string]: unknown;
};

export type ProviderMutationInput = {
  name: string;
  baseUrl: string;
  authMode: string;
  chatgptAccountId?: string;
  providerApiKeys?: string[];
  capabilities?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ProviderMutationResponse = {
  ok?: boolean;
  activeProviderId?: string | null;
  provider?: ProviderSummary;
  error?: {
    type?: string;
    code?: string;
    message?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type ProviderDeleteResponse = {
  ok?: boolean;
  activeProviderId?: string | null;
  error?: {
    type?: string;
    code?: string;
    message?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type ClientMutationInput = {
  client: string;
  providerId?: string;
  model?: string;
  apiKeys?: string[];
  tokenLimit?: unknown;
};

export type ClientMutationResponse = {
  ok?: boolean;
  client?: string;
  clientRoutes?: ClientRouteSummary[];
  providerOptions?: ProviderSummary[];
  [key: string]: unknown;
};

export type ClientTokenLimitsResponse = {
  ok?: boolean;
  timestamp?: string;
  clients?: ClientTokenLimitSummary[];
  [key: string]: unknown;
};

export type ClientTokenLimitResponse = {
  ok?: boolean;
  timestamp?: string;
  client?: ClientTokenLimitSummary;
  [key: string]: unknown;
};

export type UsageStatsBucket = {
  requests?: number;
  hits?: number;
  misses?: number;
  hitRate?: number;
  unknownTelemetryRequests?: number;
  telemetryCoverage?: number;
  totalCachedTokens?: number;
  totalInputTokens?: number;
  avgCacheSavedPercent?: number;
  rtkRequests?: number;
  rtkAppliedRequests?: number;
  rtkAppliedRate?: number;
  rtkToolOutputsSeen?: number;
  rtkToolOutputsReduced?: number;
  rtkCharsBefore?: number;
  rtkCharsAfter?: number;
  rtkCharsSaved?: number;
  rtkAvgCharsSaved?: number;
  [key: string]: unknown;
};

export type UsageDimensionBucket = UsageStatsBucket & {
  key: string;
  uniqueStaticKeys?: number;
  uniqueRequestKeys?: number;
  fragmentationScore?: number;
};

export type UsageStatsData = {
  today?: UsageStatsBucket;
  month?: UsageStatsBucket;
  daily?: Array<{ date: string } & UsageStatsBucket>;
  byProvider?: UsageDimensionBucket[];
  byClientRoute?: UsageDimensionBucket[];
  byFamily?: UsageDimensionBucket[];
  byStaticKey?: UsageDimensionBucket[];
  byModel?: UsageDimensionBucket[];
  topUncachedFamilies?: UsageDimensionBucket[];
  [key: string]: unknown;
};

export type UsageStatsResponse = {
  ok?: boolean;
  stats?: UsageStatsData;
  [key: string]: unknown;
};

export type RtkPolicyInput = {
  enabled?: boolean;
  toolOutputEnabled?: boolean;
  maxChars?: number;
  maxLines?: number;
  tailLines?: number;
  tailChars?: number;
  detectFormat?: "auto" | "plain" | "json" | "stack" | "command";
};

export type RtkPolicyMutationResponse = {
  ok?: boolean;
  client?: string;
  rtkPolicy?: RtkPolicyInput | null;
  clientRoutes?: ClientRouteSummary[];
  [key: string]: unknown;
};

export type PromptCacheObservation = {
  requestId?: string;
  providerId?: string;
  clientRoute?: string;
  model?: string;
  familyId?: string;
  staticKey?: string;
  requestKey?: string;
  promptCacheKey?: string;
  promptCacheRetention?: string;
  upstreamTarget?: string;
  truncation?: string;
  reasoningEffort?: string;
  reasoningSummary?: string;
  textVerbosity?: string;
  cachedTokens?: number;
  cacheSavedPercent?: number;
  cacheHit?: boolean;
  consecutiveCacheHits?: number;
  rtkApplied?: boolean;
  rtkCharsSaved?: number;
  stream?: boolean;
  timestamp?: string;
  [key: string]: unknown;
};

export type PromptCacheLatestResponse = {
  ok?: boolean;
  latest?: PromptCacheObservation | null;
  [key: string]: unknown;
};

export type ChatGptOAuthAccount = {
  id?: string;
  email?: string;
  accountId?: string;
  expiresAt?: string;
  lastRefreshAt?: string | null;
  disabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

export type ChatGptOAuthStatusResponse = {
  ok?: boolean;
  enabled?: boolean;
  accounts?: ChatGptOAuthAccount[];
  rotationMode?: string;
  [key: string]: unknown;
};

export type ChatGptOAuthStartResponse = {
  ok?: boolean;
  state?: string;
  authUrl?: string;
  [key: string]: unknown;
};

export type ChatGptOAuthCallbackResponse = {
  ok?: boolean;
  account?: ChatGptOAuthAccount;
  accounts?: ChatGptOAuthAccount[];
  providers?: ProviderSummary[];
  provider?: ProviderSummary;
  [key: string]: unknown;
};

export type QuickApplyBackupEntry = {
  path?: string;
  fileName?: string;
  modifiedAt?: string;
  sizeBytes?: number;
  [key: string]: unknown;
};

export type QuickApplyAccess = {
  canPatch?: boolean;
  reason?: string;
  [key: string]: unknown;
};

export type QuickApplyAuthStatus = {
  path?: string;
  exists?: boolean;
  configured?: boolean;
  detectedApiKey?: string | null;
  backups?: QuickApplyBackupEntry[];
  [key: string]: unknown;
};

export type ClientConfigStatus = {
  client?: string;
  path?: string;
  exists?: boolean;
  configured?: boolean;
  routeApiKey?: string;
  detected?: Record<string, string | null>;
  auth?: QuickApplyAuthStatus;
  runtime?: string;
  access?: QuickApplyAccess;
  backups?: QuickApplyBackupEntry[];
  route?: ClientRouteSummary | null;
  [key: string]: unknown;
};

export type ClientConfigsStatusResponse = {
  ok?: boolean;
  runtime?: string;
  proxyBaseUrl?: string;
  providerOptions?: ProviderSummary[];
  clients?: {
    hermes?: ClientConfigStatus;
    codex?: ClientConfigStatus;
  };
  [key: string]: unknown;
};

export type QuickApplyClientKey = "hermes" | "codex";

export type ClientConfigApplyInput = {
  client: QuickApplyClientKey;
  baseUrl?: string;
  routeApiKey?: string;
  clientApiKey?: string;
  model?: string;
};

export type ClientConfigApplyResponse = {
  ok?: boolean;
  client?: QuickApplyClientKey;
  changed?: boolean;
  backupCreated?: boolean;
  configChanged?: boolean;
  authChanged?: boolean;
  proxyBaseUrl?: string;
  status?: ClientConfigStatus;
  clientRoutes?: ClientRouteSummary[];
  error?: unknown;
  [key: string]: unknown;
};

export type ProviderModelsResponse = {
  ok?: boolean;
  providerId?: string;
  models?: string[];
  [key: string]: unknown;
};
