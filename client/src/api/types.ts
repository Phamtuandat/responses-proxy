export type DashboardAuthSession = {
  telegramUserId: string;
  role: "admin";
  expiresAt: string;
};

export type DashboardAuthSessionResponse = {
  authenticated: boolean;
  session?: DashboardAuthSession;
};

export type DashboardAuthRequestOtpResponse = {
  ok: true;
  expiresAt: string;
  sentCount?: number;
};

export type DashboardAuthVerifyResponse = {
  ok: true;
  session: DashboardAuthSession;
};

export type DashboardAuthRequestApprovalResponse = {
  ok: true;
  challengeId: string;
  pollToken: string;
  displayCode: string;
  expiresAt: string;
  sentCount?: number;
};

export type DashboardAuthApprovalStatusResponse = {
  ok: true;
  status: "pending" | "approved" | "rejected" | "expired" | "consumed";
  challengeId: string;
  expiresAt: string;
  session?: DashboardAuthSession;
};

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

export type LiveUsageProvider = {
  providerId?: string;
  providerName?: string;
  authMode?: string;
  source?: string;
  configured?: boolean;
  usageCheckEnabled?: boolean;
  usageCheckUrl?: string | null;
  upstreamKeyCount?: number;
  timestamp?: string;
  ok?: boolean;
  usage?: {
    allowed?: boolean;
    remaining?: number;
    limit?: number;
    used?: number;
    [key: string]: unknown;
  } | null;
  /**
   * Real upstream credit/quota usage. Currently set for Kiro providers (via
   * the CodeWhisperer getUsageLimits API). For other providers, the proxy
   * may also populate a similar shape via custom usage-check endpoints.
   */
  creditUsage?: {
    plan?: string;
    quotas?: Record<string, {
      resourceType?: string;
      used?: number;
      total?: number;
      remaining?: number;
      resetAt?: string | null;
      unlimited?: boolean;
    }>;
    error?: string;
  } | null;
  /** Account-pool counts for providers backed by a connected-account pool (Kiro/OAuth). */
  accounts?: {
    total?: number;
    active?: number;
    healthy?: number;
  };
  error?: string;
  [key: string]: unknown;
};

export type LiveUsageResponse = {
  ok?: boolean;
  providers?: LiveUsageProvider[];
  timestamp?: string;
  updatedAt?: string;
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

// Kiro types
export type KiroAccount = {
  id: string;
  name: string;
  priority: number;
  isActive: boolean;
  tokenStatus: 'valid' | 'expired' | 'expiring' | 'missing';
  expiresAt: string | null;
  expiresIn: number | null;
  region: string;
  authMethod: string;
  createdAt: string;
  updatedAt: string;
  hasRefreshToken: boolean;
  hasAccessToken?: boolean;
  profileArn?: string | null;
  startUrl?: string | null;
  raw?: Record<string, unknown>;
};

export type KiroStatus = {
  ok: true;
  enabled: boolean;
  available?: boolean;
  message?: string;
  totalAccounts?: number;
  activeAccounts?: number;
  healthyAccounts?: number;
  refreshLeadSeconds?: number;
  writeBackEnabled?: boolean;
  dbPath?: string;
  defaultRegion?: string;
};

export type KiroAccountsResponse = {
  ok: true;
  accounts: KiroAccount[];
};

export type KiroAccountResponse = {
  ok: true;
  account: KiroAccount;
};

export type KiroAccountUpdateInput = {
  name?: string;
  priority?: number;
  isActive?: boolean;
};

export type KiroAccountDeleteResponse = {
  ok: true;
  deleted: true;
  accountId: string;
};

export type KiroImportInput = {
  sourcePath?: string;
};

export type KiroImportResponse = {
  ok: true;
  imported: number;
  sourcePath: string;
  destPath: string;
};

// Enhanced Provider Domain Model - 9Router-inspired types

export type ProviderTier = "subscription" | "cheap" | "free" | "custom";

export type ProviderAuthType = "oauth" | "api_key" | "browser_cookie" | "local_cli" | "none";

export type ProviderHealthStatus =
  | "healthy"
  | "degraded"
  | "quota_exhausted"
  | "auth_expired"
  | "rate_limited"
  | "disabled"
  | "not_configured"
  | "unknown";

export type ProviderServiceKind =
  | "chat"
  | "embedding"
  | "tts"
  | "stt"
  | "image"
  | "vision"
  | "video"
  | "web_search"
  | "web_fetch";

export interface ProviderMetadata {
  tier: ProviderTier;
  serviceKinds: ProviderServiceKind[];
  priority: number;
  vendor: string;
  costLevel: "high" | "medium" | "low";
  reliability: "high" | "medium" | "low";
  features: string[];
  description?: string;
}

export interface ProviderHealth {
  status: ProviderHealthStatus;
  lastChecked: string;
  responseTimeMs?: number;
  errorRate?: number;
  quotaUsed?: number;
  quotaLimit?: number;
  message?: string;
  nextCheck?: string;
}

// Enhanced provider summary with tier and health information
export interface EnhancedProviderSummary extends ProviderSummary {
  metadata?: ProviderMetadata;
  health?: ProviderHealth;
}

// Provider health check response
export type ProviderHealthResponse = {
  ok: boolean;
  providerId: string;
  health: ProviderHealth;
  timestamp: string;
};

// All providers health response
export type ProvidersHealthResponse = {
  ok: boolean;
  providers: Record<string, ProviderHealth>;
  timestamp: string;
};

// Provider connection test response
export type ProviderTestResponse = {
  ok: boolean;
  providerId: string;
  status: ProviderHealthStatus;
  responseTimeMs?: number;
  message?: string;
  timestamp: string;
};

// Enhanced client route with tier-based fallback
export interface EnhancedClientRoute {
  route: string;
  primaryTier: ProviderTier;
  fallbackTiers: ProviderTier[];
  healthThreshold: ProviderHealthStatus[];
  budgetLimit?: number;
  preferredProviders?: string[];
  excludedProviders?: string[];
}

export type AuditLogRecord = {
  id: string;
  event: string;
  actorType: string;
  actorId?: string;
  subjectType?: string;
  subjectId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AuditLogsResponse = {
  ok?: boolean;
  logs?: AuditLogRecord[];
  [key: string]: unknown;
};

// Kiro Device Login (AWS SSO-OIDC Device Authorization Grant)
export type KiroDeviceStartInput = {
  authMethod: "builder_id" | "idc";
  startUrl?: string;
  region?: string;
};

export type KiroDeviceStartResponse = {
  ok: true;
  sessionId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

export type KiroDevicePollResponse = {
  ok: true;
  status: "pending" | "completed" | "expired" | "error";
  interval?: number;
  account?: { id: string; name: string };
  error?: { code: string; message: string };
};

// ─── Model Combos (9Router-style) ────────────────────────────────────────────

export type ModelCombo = {
  id: string;
  name: string;
  kind: string | null;
  models: string[];
  roundRobin: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ModelComboInput = {
  name: string;
  kind?: string | null;
  models?: string[];
  roundRobin?: boolean;
};

export type ModelCombosResponse = {
  combos: ModelCombo[];
};

export type ModelComboResponse = {
  combo: ModelCombo;
};

export type ModelComboDeleteResponse = {
  ok: true;
};
