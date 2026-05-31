// Provider Eligibility - Compute fallback eligibility and routing readiness

import type {
  Provider,
  ProviderHealthStatus,
  ProviderAccountSummary,
  ProviderServiceKind,
  ProviderTestResult
} from "./providerTypes";

// Eligibility Check Result
export interface ProviderEligibilityResult {
  eligible: boolean;
  reasons: string[];
  warnings: string[];
  score: number; // 0-100, higher is better
  lastCheckedAt: string;
}

// Eligibility Requirements
export interface EligibilityRequirements {
  requireEnabled?: boolean;
  requireConfigured?: boolean;
  requireHealthy?: boolean;
  requireQuotaAvailable?: boolean;
  requireActiveAccount?: boolean;
  requireServiceKinds?: ProviderServiceKind[];
  allowDegraded?: boolean;
  minimumScore?: number;
}

// Default eligibility requirements for fallback routing
export const DEFAULT_FALLBACK_REQUIREMENTS: EligibilityRequirements = {
  requireEnabled: true,
  requireConfigured: true,
  requireHealthy: true,
  requireQuotaAvailable: true,
  requireActiveAccount: true,
  requireServiceKinds: ["chat"],
  allowDegraded: true,
  minimumScore: 50
};

// Strict eligibility requirements for primary routing
export const STRICT_ROUTING_REQUIREMENTS: EligibilityRequirements = {
  requireEnabled: true,
  requireConfigured: true,
  requireHealthy: true,
  requireQuotaAvailable: true,
  requireActiveAccount: true,
  requireServiceKinds: ["chat"],
  allowDegraded: false,
  minimumScore: 70
};

/**
 * Check if a provider is eligible for routing based on requirements
 */
export function checkProviderEligibility(
  provider: Provider,
  requirements: EligibilityRequirements = DEFAULT_FALLBACK_REQUIREMENTS
): ProviderEligibilityResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let score = 100;
  let eligible = true;

  // Check if provider is enabled
  if (requirements.requireEnabled && !provider.enabled) {
    eligible = false;
    reasons.push("Provider is disabled");
    score -= 50;
  }

  // Check if provider is configured
  if (requirements.requireConfigured && !provider.configured) {
    eligible = false;
    reasons.push("Provider is not configured");
    score -= 40;
  }

  // Check provider health status
  if (requirements.requireHealthy) {
    const healthScore = getHealthScore(provider.healthStatus);
    score = Math.min(score, healthScore);

    if (provider.healthStatus === "not_configured") {
      eligible = false;
      reasons.push("Provider is not configured");
    } else if (provider.healthStatus === "disabled") {
      eligible = false;
      reasons.push("Provider is disabled");
    } else if (provider.healthStatus === "auth_expired") {
      eligible = false;
      reasons.push("Authentication has expired");
    } else if (provider.healthStatus === "quota_exhausted") {
      if (requirements.requireQuotaAvailable) {
        eligible = false;
        reasons.push("Quota is exhausted");
      } else {
        warnings.push("Quota is exhausted but may recover");
      }
    } else if (provider.healthStatus === "rate_limited") {
      warnings.push("Provider is currently rate limited");
      score -= 20;
    } else if (provider.healthStatus === "degraded") {
      if (!requirements.allowDegraded) {
        eligible = false;
        reasons.push("Provider is degraded and strict health is required");
      } else {
        warnings.push("Provider is degraded but still usable");
        score -= 15;
      }
    } else if (provider.healthStatus === "unknown") {
      warnings.push("Provider health status is unknown");
      score -= 10;
    }
  }

  // Check quota availability
  if (requirements.requireQuotaAvailable && provider.quota) {
    if (provider.quota.hardLimitReached) {
      eligible = false;
      reasons.push("Hard quota limit reached");
    } else if (provider.quota.softLimitReached) {
      warnings.push("Soft quota limit reached");
      score -= 10;
    } else if (provider.quota.usagePercent && provider.quota.usagePercent > 90) {
      warnings.push("Quota usage is very high (>90%)");
      score -= 5;
    }
  }

  // Check active accounts
  if (requirements.requireActiveAccount) {
    const activeAccounts = getActiveAccounts(provider.accounts || []);
    if (activeAccounts.length === 0) {
      eligible = false;
      reasons.push("No active accounts available");
    } else {
      const accountScore = getAccountsScore(activeAccounts);
      score = Math.min(score, accountScore);

      if (accountScore < 50) {
        warnings.push("Account health is poor");
      }
    }
  }

  // Check required service kinds
  if (requirements.requireServiceKinds && requirements.requireServiceKinds.length > 0) {
    const missingServices = requirements.requireServiceKinds.filter(
      service => !provider.serviceKinds.includes(service)
    );

    if (missingServices.length > 0) {
      eligible = false;
      reasons.push(`Missing required services: ${missingServices.join(", ")}`);
    }
  }

  // Check enabled models for chat service
  if (requirements.requireServiceKinds?.includes("chat")) {
    const chatModels = provider.models?.filter(
      model => model.serviceKind === "chat" && model.enabled
    ) || [];

    if (chatModels.length === 0) {
      eligible = false;
      reasons.push("No enabled chat models available");
    }
  }

  // Check minimum score requirement
  if (requirements.minimumScore && score < requirements.minimumScore) {
    eligible = false;
    reasons.push(`Provider score (${score}) below minimum required (${requirements.minimumScore})`);
  }

  // Check fallback eligibility flag
  if (!provider.fallbackEligible) {
    eligible = false;
    reasons.push("Provider is marked as not fallback eligible");
  }

  return {
    eligible,
    reasons,
    warnings,
    score: Math.max(0, score),
    lastCheckedAt: new Date().toISOString()
  };
}

/**
 * Get health score based on status (0-100)
 */
function getHealthScore(status: ProviderHealthStatus): number {
  switch (status) {
    case "healthy":
      return 100;
    case "degraded":
      return 75;
    case "rate_limited":
      return 60;
    case "quota_exhausted":
      return 40;
    case "unknown":
      return 50;
    case "auth_expired":
      return 20;
    case "disabled":
      return 0;
    case "not_configured":
      return 0;
    default:
      return 50;
  }
}

/**
 * Get active accounts from account list
 */
function getActiveAccounts(accounts: ProviderAccountSummary[]): ProviderAccountSummary[] {
  return accounts.filter(account =>
    account.status === "connected" &&
    account.routingMode !== "disabled"
  );
}

/**
 * Get accounts health score (0-100)
 */
function getAccountsScore(accounts: ProviderAccountSummary[]): number {
  if (accounts.length === 0) return 0;

  const scores = accounts.map(account => {
    switch (account.status) {
      case "connected":
        return 100;
      case "needs_reconnect":
        return 60;
      case "expired":
        return 30;
      case "invalid":
        return 20;
      case "disabled":
        return 0;
      case "unknown":
        return 50;
      default:
        return 50;
    }
  });

  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

/**
 * Check if provider can handle a specific service kind
 */
export function canProviderHandleService(
  provider: Provider,
  serviceKind: ProviderServiceKind
): boolean {
  if (!provider.serviceKinds.includes(serviceKind)) {
    return false;
  }

  // Check if there are enabled models for this service kind
  const serviceModels = provider.models?.filter(
    model => model.serviceKind === serviceKind && model.enabled
  ) || [];

  return serviceModels.length > 0;
}

/**
 * Get fallback order for a list of providers
 */
export function getFallbackOrder(
  providers: Provider[],
  requirements: EligibilityRequirements = DEFAULT_FALLBACK_REQUIREMENTS
): Provider[] {
  return providers
    .map(provider => ({
      provider,
      eligibility: checkProviderEligibility(provider, requirements)
    }))
    .filter(({ eligibility }) => eligibility.eligible)
    .sort((a, b) => {
      // Sort by tier priority first (subscription > cheap > free > custom)
      const tierPriority = { subscription: 1, cheap: 2, free: 3, custom: 4 };
      const tierDiff = tierPriority[a.provider.tier] - tierPriority[b.provider.tier];
      if (tierDiff !== 0) return tierDiff;

      // Then by provider priority
      const priorityDiff = a.provider.priority - b.provider.priority;
      if (priorityDiff !== 0) return priorityDiff;

      // Finally by eligibility score
      return b.eligibility.score - a.eligibility.score;
    })
    .map(({ provider }) => provider);
}

/**
 * Get providers that are not eligible and why
 */
export function getIneligibleProviders(
  providers: Provider[],
  requirements: EligibilityRequirements = DEFAULT_FALLBACK_REQUIREMENTS
): Array<{ provider: Provider; eligibility: ProviderEligibilityResult }> {
  return providers
    .map(provider => ({
      provider,
      eligibility: checkProviderEligibility(provider, requirements)
    }))
    .filter(({ eligibility }) => !eligibility.eligible);
}

/**
 * Get suggested fixes for ineligible providers
 */
export function getSuggestedFixes(
  provider: Provider,
  eligibility: ProviderEligibilityResult
): string[] {
  const fixes: string[] = [];

  eligibility.reasons.forEach(reason => {
    if (reason.includes("disabled")) {
      fixes.push("Enable the provider in settings");
    } else if (reason.includes("not configured")) {
      fixes.push("Complete provider configuration");
    } else if (reason.includes("Authentication has expired")) {
      fixes.push("Reconnect or refresh authentication");
    } else if (reason.includes("Quota is exhausted")) {
      fixes.push("Wait for quota reset or upgrade plan");
    } else if (reason.includes("No active accounts")) {
      fixes.push("Connect at least one account");
    } else if (reason.includes("No enabled chat models")) {
      fixes.push("Enable at least one chat model");
    } else if (reason.includes("not fallback eligible")) {
      fixes.push("Enable fallback routing for this provider");
    } else if (reason.includes("Missing required services")) {
      fixes.push("Configure provider to support required services");
    } else if (reason.includes("score") && reason.includes("below minimum")) {
      fixes.push("Improve provider health and configuration");
    }
  });

  return [...new Set(fixes)]; // Remove duplicates
}

/**
 * Validate provider test result and update eligibility
 */
export function updateEligibilityFromTestResult(
  provider: Provider,
  testResult: ProviderTestResult
): Partial<Provider> {
  const updates: Partial<Provider> = {
    lastHealthCheckAt: testResult.testedAt
  };

  // Update health status based on test result
  if (testResult.status === "success") {
    updates.healthStatus = "healthy";
    updates.healthMessage = undefined;
  } else if (testResult.status === "partial") {
    updates.healthStatus = "degraded";
    updates.healthMessage = testResult.errorMessage;
  } else {
    // Determine specific health status from test result
    if (!testResult.authOk) {
      updates.healthStatus = "auth_expired";
    } else if (!testResult.quotaOk) {
      updates.healthStatus = "quota_exhausted";
    } else if (!testResult.modelOk) {
      updates.healthStatus = "not_configured";
    } else {
      updates.healthStatus = "unknown";
    }
    updates.healthMessage = testResult.errorMessage;
  }

  return updates;
}