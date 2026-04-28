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

export type ProvidersResponse = {
  ok?: boolean;
  activeProviderId?: string | null;
  clientRoutes?: ClientRouteSummary[];
  providerOptions?: ProviderSummary[];
  providers?: ProviderSummary[];
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
