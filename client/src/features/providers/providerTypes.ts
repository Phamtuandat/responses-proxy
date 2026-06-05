// Enhanced Provider Data Models for Router-Focused UI

export type ProviderTier = "subscription" | "cheap" | "free" | "custom";

export type ProviderAuthType =
  | "oauth"
  | "api_key"
  | "browser_cookie"
  | "local_cli"
  | "none";

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

export type ProviderRiskLevel = "none" | "low" | "medium" | "high";

export type ProviderAccountRoutingMode =
  | "priority"
  | "round_robin"
  | "sticky"
  | "failover_only"
  | "disabled";

// Core Provider Entity
export interface Provider {
  id: string;
  name: string;
  displayName: string;
  description?: string;

  tier: ProviderTier;
  serviceKinds: ProviderServiceKind[];

  authTypes: ProviderAuthType[];
  preferredAuthType?: ProviderAuthType;

  enabled: boolean;
  configured: boolean;

  healthStatus: ProviderHealthStatus;
  healthMessage?: string;
  lastHealthCheckAt?: string;

  priority: number;
  fallbackEligible: boolean;

  quota?: ProviderQuota;
  accounts?: ProviderAccountSummary[];
  models?: ProviderModel[];
  providerApiKeys?: string[];

  riskNotice?: ProviderRiskNotice;

  createdAt?: string;
  updatedAt?: string;
}

// Provider Quota Information
export interface ProviderQuota {
  quotaType: "requests" | "tokens" | "credits" | "time_window" | "unknown";

  used?: number;
  limit?: number;
  remaining?: number;

  resetAt?: string;
  resetInSeconds?: number;

  usagePercent?: number;

  softLimitReached?: boolean;
  hardLimitReached?: boolean;

  estimatedCostUsd?: number;
}

// Provider Account Summary
export interface ProviderAccountSummary {
  id: string;
  label: string;

  authType: ProviderAuthType;

  status:
    | "connected"
    | "expired"
    | "invalid"
    | "disabled"
    | "needs_reconnect"
    | "unknown";

  email?: string;
  username?: string;

  routingMode?: ProviderAccountRoutingMode;

  lastUsedAt?: string;
  lastError?: string;

  quota?: ProviderQuota;
}

// Provider Model Information
export interface ProviderModel {
  id: string;
  displayName: string;

  serviceKind: ProviderServiceKind;

  contextWindow?: number;
  inputCostPer1M?: number;
  outputCostPer1M?: number;

  supportsStreaming?: boolean;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsJsonMode?: boolean;

  enabled: boolean;
}

// Provider Risk Notice
export interface ProviderRiskNotice {
  level: ProviderRiskLevel;
  title: string;
  message: string;
  learnMoreUrl?: string;
}

// Provider Test Result
export interface ProviderTestResult {
  providerId: string;
  accountId?: string;
  status: "success" | "failed" | "partial";

  testedAt: string;
  latencyMs?: number;

  authOk: boolean;
  quotaOk: boolean;
  modelOk: boolean;
  routingOk: boolean;

  testedModel?: string;

  errorCode?: string;
  errorMessage?: string;
  suggestedFix?: string;
}

// Provider Summary for List Views
export interface ProviderSummary {
  id: string;
  name: string;
  displayName: string;
  tier: ProviderTier;
  healthStatus: ProviderHealthStatus;
  enabled: boolean;
  configured: boolean;
  fallbackEligible: boolean;
  accountCount: number;
  enabledModelCount: number;
  lastUsedAt?: string;
  quotaUsagePercent?: number;
  primaryAction: ProviderPrimaryAction;
}

export type ProviderPrimaryAction =
  | "connect"
  | "reconnect"
  | "test"
  | "manage"
  | "enable"
  | "configure";

// Provider Filter Options
export interface ProviderFilters {
  tier?: ProviderTier[];
  status?: ProviderHealthStatus[];
  authType?: ProviderAuthType[];
  serviceKind?: ProviderServiceKind[];
  fallbackEligible?: boolean;
  configured?: boolean;
}

// Provider Tier Summary
export interface ProviderTierSummary {
  tier: ProviderTier;
  totalCount: number;
  configuredCount: number;
  healthyCount: number;
  exhaustedCount: number;
  disabledCount: number;
  fallbackReadyCount: number;
}

// Legacy Provider Types (for backward compatibility)
export interface LegacyProvider {
  id: string;
  name: string;
  baseUrl: string;
  responsesUrl: string;
  authMode: "api_key" | "chatgpt_oauth" | "kiro";
  chatgptAccountId?: string;
  providerApiKeys: string[];
  clientApiKeys: string[];
  capabilities: any;
  createdAt?: string;
  updatedAt?: string;
}

// Type Guards
export function isProvider(obj: any): obj is Provider {
  return (
    obj &&
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    typeof obj.tier === "string" &&
    Array.isArray(obj.serviceKinds) &&
    Array.isArray(obj.authTypes)
  );
}

export function isProviderSummary(obj: any): obj is ProviderSummary {
  return (
    obj &&
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    typeof obj.tier === "string" &&
    typeof obj.healthStatus === "string"
  );
}

// Utility Types
export type ProviderUpdatePayload = Partial<Omit<Provider, "id" | "createdAt" | "updatedAt">>;
export type ProviderCreatePayload = Omit<Provider, "id" | "createdAt" | "updatedAt">;