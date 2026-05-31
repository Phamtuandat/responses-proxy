// Provider Health - Health checking and status computation utilities

import type {
  Provider,
  ProviderHealthStatus,
  ProviderTestResult,
  ProviderAccountSummary,
  ProviderQuota
} from "./providerTypes";

// Health Check Configuration
export interface HealthCheckConfig {
  timeout?: number; // milliseconds
  retries?: number;
  testModel?: string;
  testPrompt?: string;
  checkQuota?: boolean;
  checkModels?: boolean;
  checkAccounts?: boolean;
}

// Default health check configuration
export const DEFAULT_HEALTH_CHECK_CONFIG: HealthCheckConfig = {
  timeout: 10000, // 10 seconds
  retries: 2,
  testModel: "gpt-3.5-turbo", // fallback model
  testPrompt: "Hello, this is a health check. Please respond with 'OK'.",
  checkQuota: true,
  checkModels: true,
  checkAccounts: true
};

// Health Status Definitions
export const HEALTH_STATUS_INFO: Record<ProviderHealthStatus, {
  label: string;
  description: string;
  severity: "success" | "warning" | "error" | "unknown";
  color: string;
  icon: string;
}> = {
  healthy: {
    label: "Healthy",
    description: "Provider is working normally",
    severity: "success",
    color: "#30d158",
    icon: "✅"
  },
  degraded: {
    label: "Degraded",
    description: "Provider is working but with reduced performance",
    severity: "warning",
    color: "#ffd60a",
    icon: "⚠️"
  },
  quota_exhausted: {
    label: "Quota Exhausted",
    description: "Provider has reached its usage quota",
    severity: "error",
    color: "#ff6961",
    icon: "🚫"
  },
  auth_expired: {
    label: "Auth Expired",
    description: "Provider authentication has expired",
    severity: "error",
    color: "#ff6961",
    icon: "🔑"
  },
  rate_limited: {
    label: "Rate Limited",
    description: "Provider is currently rate limited",
    severity: "warning",
    color: "#ffd60a",
    icon: "⏱️"
  },
  disabled: {
    label: "Disabled",
    description: "Provider is manually disabled",
    severity: "error",
    color: "#8e8e93",
    icon: "⏸️"
  },
  not_configured: {
    label: "Not Configured",
    description: "Provider needs configuration",
    severity: "error",
    color: "#ff6961",
    icon: "⚙️"
  },
  unknown: {
    label: "Unknown",
    description: "Provider status is unknown",
    severity: "unknown",
    color: "#8e8e93",
    icon: "❓"
  }
};

/**
 * Compute overall provider health status from various factors
 */
export function computeProviderHealth(provider: Provider): ProviderHealthStatus {
  // If manually disabled, return disabled
  if (!provider.enabled) {
    return "disabled";
  }

  // If not configured, return not_configured
  if (!provider.configured) {
    return "not_configured";
  }

  // Check quota status
  if (provider.quota?.hardLimitReached) {
    return "quota_exhausted";
  }

  // Check account status
  const accounts = provider.accounts || [];
  const activeAccounts = accounts.filter(account =>
    account.status === "connected" && account.routingMode !== "disabled"
  );

  if (activeAccounts.length === 0 && accounts.length > 0) {
    // Has accounts but none are active
    const hasExpiredAuth = accounts.some(account =>
      account.status === "expired" || account.status === "needs_reconnect"
    );
    if (hasExpiredAuth) {
      return "auth_expired";
    }
  }

  // Check if we have enabled models for primary service kinds
  const chatModels = provider.models?.filter(
    model => model.serviceKind === "chat" && model.enabled
  ) || [];

  if (provider.serviceKinds.includes("chat") && chatModels.length === 0) {
    return "not_configured";
  }

  // Check for degraded conditions
  const degradedConditions = [
    provider.quota?.softLimitReached,
    provider.quota?.usagePercent && provider.quota.usagePercent > 85,
    accounts.some(account => account.status === "needs_reconnect"),
    provider.healthMessage && provider.healthMessage.includes("warning")
  ];

  if (degradedConditions.some(condition => condition)) {
    return "degraded";
  }

  // If we have a recent health check result, use it
  if (provider.healthStatus && provider.lastHealthCheckAt) {
    const lastCheck = new Date(provider.lastHealthCheckAt);
    const now = new Date();
    const hoursSinceCheck = (now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60);

    // If health check is recent (< 1 hour), trust it
    if (hoursSinceCheck < 1) {
      return provider.healthStatus;
    }
  }

  // Default to healthy if no issues detected
  return "healthy";
}

/**
 * Check if provider needs a health check
 */
export function needsHealthCheck(provider: Provider): boolean {
  // Always check if status is unknown
  if (provider.healthStatus === "unknown") {
    return true;
  }

  // Check if last health check was too long ago
  if (!provider.lastHealthCheckAt) {
    return true;
  }

  const lastCheck = new Date(provider.lastHealthCheckAt);
  const now = new Date();
  const hoursSinceCheck = (now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60);

  // Check more frequently for unhealthy providers
  const checkInterval = provider.healthStatus === "healthy" ? 4 : 1; // hours

  return hoursSinceCheck >= checkInterval;
}

/**
 * Get health check priority (higher number = higher priority)
 */
export function getHealthCheckPriority(provider: Provider): number {
  let priority = 0;

  // Higher priority for enabled providers
  if (provider.enabled) priority += 10;

  // Higher priority for configured providers
  if (provider.configured) priority += 5;

  // Higher priority for fallback eligible providers
  if (provider.fallbackEligible) priority += 3;

  // Higher priority based on tier
  switch (provider.tier) {
    case "subscription":
      priority += 8;
      break;
    case "cheap":
      priority += 6;
      break;
    case "free":
      priority += 4;
      break;
    case "custom":
      priority += 2;
      break;
  }

  // Higher priority for unhealthy providers
  switch (provider.healthStatus) {
    case "unknown":
      priority += 15;
      break;
    case "auth_expired":
    case "quota_exhausted":
      priority += 12;
      break;
    case "degraded":
    case "rate_limited":
      priority += 8;
      break;
    case "not_configured":
      priority += 5;
      break;
  }

  return priority;
}

/**
 * Create a mock health check result for testing
 */
export function createMockTestResult(
  provider: Provider,
  success: boolean = true,
  options: Partial<ProviderTestResult> = {}
): ProviderTestResult {
  const baseResult: ProviderTestResult = {
    providerId: provider.id,
    status: success ? "success" : "failed",
    testedAt: new Date().toISOString(),
    latencyMs: Math.floor(Math.random() * 2000) + 200, // 200-2200ms
    authOk: success,
    quotaOk: success,
    modelOk: success,
    routingOk: success,
    testedModel: provider.models?.[0]?.id || "default-model",
    ...options
  };

  if (!success) {
    baseResult.errorCode = "TEST_FAILED";
    baseResult.errorMessage = "Health check failed";
    baseResult.suggestedFix = "Check provider configuration and try again";
  }

  return baseResult;
}

/**
 * Analyze provider test result and provide insights
 */
export function analyzeTestResult(testResult: ProviderTestResult): {
  summary: string;
  issues: string[];
  suggestions: string[];
  severity: "success" | "warning" | "error";
} {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let severity: "success" | "warning" | "error" = "success";

  if (testResult.status === "failed") {
    severity = "error";
  } else if (testResult.status === "partial") {
    severity = "warning";
  }

  // Check individual components
  if (!testResult.authOk) {
    issues.push("Authentication failed");
    suggestions.push("Reconnect or refresh authentication credentials");
    severity = "error";
  }

  if (!testResult.quotaOk) {
    issues.push("Quota limit reached");
    suggestions.push("Wait for quota reset or upgrade plan");
    severity = "error";
  }

  if (!testResult.modelOk) {
    issues.push("Model access failed");
    suggestions.push("Check model availability and permissions");
    severity = "error";
  }

  if (!testResult.routingOk) {
    issues.push("Routing configuration failed");
    suggestions.push("Verify provider routing settings");
    severity = "error";
  }

  // Check latency
  if (testResult.latencyMs && testResult.latencyMs > 5000) {
    issues.push("High latency detected");
    suggestions.push("Check network connection and provider performance");
    if (severity === "success") severity = "warning";
  }

  // Generate summary
  let summary: string;
  if (testResult.status === "success") {
    summary = `Health check passed in ${testResult.latencyMs}ms`;
  } else if (testResult.status === "partial") {
    summary = `Health check partially successful with ${issues.length} issue(s)`;
  } else {
    summary = `Health check failed: ${testResult.errorMessage || "Unknown error"}`;
  }

  return {
    summary,
    issues,
    suggestions,
    severity
  };
}

/**
 * Get quota status information
 */
export function getQuotaStatus(quota: ProviderQuota): {
  status: "healthy" | "warning" | "critical" | "exhausted";
  message: string;
  resetInfo?: string;
} {
  if (quota.hardLimitReached) {
    return {
      status: "exhausted",
      message: "Quota exhausted",
      resetInfo: quota.resetAt ? `Resets at ${new Date(quota.resetAt).toLocaleString()}` : undefined
    };
  }

  if (quota.softLimitReached || (quota.usagePercent && quota.usagePercent > 90)) {
    return {
      status: "critical",
      message: `Quota usage: ${quota.usagePercent?.toFixed(1)}%`,
      resetInfo: quota.resetAt ? `Resets at ${new Date(quota.resetAt).toLocaleString()}` : undefined
    };
  }

  if (quota.usagePercent && quota.usagePercent > 75) {
    return {
      status: "warning",
      message: `Quota usage: ${quota.usagePercent.toFixed(1)}%`,
      resetInfo: quota.resetAt ? `Resets at ${new Date(quota.resetAt).toLocaleString()}` : undefined
    };
  }

  return {
    status: "healthy",
    message: quota.usagePercent ? `Quota usage: ${quota.usagePercent.toFixed(1)}%` : "Quota available",
    resetInfo: quota.resetAt ? `Resets at ${new Date(quota.resetAt).toLocaleString()}` : undefined
  };
}

/**
 * Get account health summary
 */
export function getAccountHealthSummary(accounts: ProviderAccountSummary[]): {
  total: number;
  connected: number;
  expired: number;
  disabled: number;
  status: "healthy" | "warning" | "error";
  message: string;
} {
  const total = accounts.length;
  const connected = accounts.filter(a => a.status === "connected").length;
  const expired = accounts.filter(a => a.status === "expired" || a.status === "needs_reconnect").length;
  const disabled = accounts.filter(a => a.status === "disabled").length;

  let status: "healthy" | "warning" | "error";
  let message: string;

  if (connected === 0) {
    status = "error";
    message = "No connected accounts";
  } else if (expired > 0) {
    status = "warning";
    message = `${connected} connected, ${expired} need reconnection`;
  } else {
    status = "healthy";
    message = `${connected} connected account${connected !== 1 ? "s" : ""}`;
  }

  return {
    total,
    connected,
    expired,
    disabled,
    status,
    message
  };
}

/**
 * Format health status for display
 */
export function formatHealthStatus(status: ProviderHealthStatus): {
  label: string;
  description: string;
  color: string;
  icon: string;
  severity: "success" | "warning" | "error" | "unknown";
} {
  return HEALTH_STATUS_INFO[status];
}

/**
 * Get next recommended action for provider health
 */
export function getRecommendedAction(provider: Provider): {
  action: "test" | "reconnect" | "configure" | "enable" | "wait" | "none";
  label: string;
  description: string;
} {
  if (!provider.enabled) {
    return {
      action: "enable",
      label: "Enable Provider",
      description: "Enable this provider to start using it"
    };
  }

  if (!provider.configured) {
    return {
      action: "configure",
      label: "Configure Provider",
      description: "Complete provider setup and configuration"
    };
  }

  if (provider.healthStatus === "auth_expired") {
    return {
      action: "reconnect",
      label: "Reconnect",
      description: "Refresh or reconnect authentication"
    };
  }

  if (provider.healthStatus === "quota_exhausted") {
    return {
      action: "wait",
      label: "Wait for Reset",
      description: "Wait for quota to reset or upgrade plan"
    };
  }

  if (provider.healthStatus === "unknown" || needsHealthCheck(provider)) {
    return {
      action: "test",
      label: "Test Connection",
      description: "Run health check to verify provider status"
    };
  }

  return {
    action: "none",
    label: "No Action Needed",
    description: "Provider is healthy and working normally"
  };
}