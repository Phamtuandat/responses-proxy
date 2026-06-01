import type { RuntimeProviderRepository, RuntimeProviderPreset } from "./runtime-provider-repository.js";
import { fetchProviderUsage } from "./provider-usage.js";
import { ChatGptOAuthStore } from "./chatgpt-oauth-store.js";
import { KiroTokenStore } from "./kiro-token-store.js";

export type ProviderHealthMetrics = {
  providerId: string;
  isHealthy: boolean;
  healthScore: number; // 0-100
  responseTime: {
    average: number;
    p95: number;
    p99: number;
  };
  errorRate: {
    rate: number; // 0-1
    recentErrors: number;
    totalRequests: number;
  };
  quotaStatus: {
    usagePercent: number;
    remaining: number;
    limit: number;
    resetTime?: string;
  };
  accountStatus: {
    hasValidAccounts: boolean;
    accountsNearExpiry: boolean;
    activeAccounts: number;
    totalAccounts: number;
  };
  lastChecked: number;
  lastUpdated: number;
};

export type HealthCheckResult = {
  success: boolean;
  metrics?: ProviderHealthMetrics;
  error?: string;
};

export type HealthThresholds = {
  responseTime: {
    good: number; // ms
    degraded: number; // ms
  };
  errorRate: {
    good: number; // 0-1
    degraded: number; // 0-1
  };
  quotaUsage: {
    warning: number; // 0-100
    critical: number; // 0-100
  };
};

const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  responseTime: {
    good: 2000, // 2s
    degraded: 5000 // 5s
  },
  errorRate: {
    good: 0.02, // 2%
    degraded: 0.1 // 10%
  },
  quotaUsage: {
    warning: 80, // 80%
    critical: 95 // 95%
  }
};

export class ProviderHealthService {
  private healthCache = new Map<string, ProviderHealthMetrics>();
  private healthCheckIntervals = new Map<string, NodeJS.Timeout>();
  private responseTimeHistory = new Map<string, number[]>();
  private errorHistory = new Map<string, { timestamp: number; error: boolean }[]>();

  constructor(
    private readonly providerRepository: RuntimeProviderRepository,
    private readonly chatGptOAuthStore?: ChatGptOAuthStore,
    private readonly kiroTokenStore?: KiroTokenStore | null,
    private readonly healthCheckInterval = 30000, // 30 seconds
    private readonly thresholds: HealthThresholds = DEFAULT_HEALTH_THRESHOLDS
  ) {}

  /**
   * Start health monitoring for all providers
   */
  startHealthMonitoring(): void {
    const providers = this.providerRepository.listProviders();

    for (const provider of providers) {
      this.startProviderHealthCheck(provider.id);
    }

    console.log(`Started health monitoring for ${providers.length} providers`);
  }

  /**
   * Stop health monitoring for all providers
   */
  stopHealthMonitoring(): void {
    for (const [providerId, interval] of this.healthCheckIntervals) {
      clearInterval(interval);
    }
    this.healthCheckIntervals.clear();
    console.log('Stopped health monitoring for all providers');
  }

  /**
   * Start health checking for a specific provider
   */
  startProviderHealthCheck(providerId: string): void {
    // Clear existing interval if any
    const existingInterval = this.healthCheckIntervals.get(providerId);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    // Perform initial health check
    this.checkProviderHealth(providerId);

    // Set up recurring health checks
    const interval = setInterval(() => {
      this.checkProviderHealth(providerId);
    }, this.healthCheckInterval);

    this.healthCheckIntervals.set(providerId, interval);
  }

  /**
   * Stop health checking for a specific provider
   */
  stopProviderHealthCheck(providerId: string): void {
    const interval = this.healthCheckIntervals.get(providerId);
    if (interval) {
      clearInterval(interval);
      this.healthCheckIntervals.delete(providerId);
    }
  }

  /**
   * Get current health metrics for a provider
   */
  getProviderHealth(providerId: string): ProviderHealthMetrics | null {
    return this.healthCache.get(providerId) || null;
  }

  /**
   * Get health metrics for all providers
   */
  getAllProviderHealth(): Map<string, ProviderHealthMetrics> {
    return new Map(this.healthCache);
  }

  /**
   * Force a health check for a specific provider
   */
  async forceHealthCheck(providerId: string): Promise<HealthCheckResult> {
    return this.checkProviderHealth(providerId);
  }

  /**
   * Record a request result for health tracking
   */
  recordRequestResult(providerId: string, responseTime: number, isError: boolean): void {
    // Update response time history
    const responseHistory = this.responseTimeHistory.get(providerId) || [];
    responseHistory.push(responseTime);

    // Keep only last 100 response times
    if (responseHistory.length > 100) {
      responseHistory.shift();
    }
    this.responseTimeHistory.set(providerId, responseHistory);

    // Update error history
    const errorHistory = this.errorHistory.get(providerId) || [];
    errorHistory.push({
      timestamp: Date.now(),
      error: isError
    });

    // Keep only last hour of error history
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const recentErrors = errorHistory.filter(e => e.timestamp > oneHourAgo);
    this.errorHistory.set(providerId, recentErrors);

    // Update cached health metrics if they exist
    const cachedHealth = this.healthCache.get(providerId);
    if (cachedHealth) {
      this.updateHealthMetricsFromHistory(providerId, cachedHealth);
    }
  }

  /**
   * Perform health check for a specific provider
   */
  private async checkProviderHealth(providerId: string): Promise<HealthCheckResult> {
    try {
      const provider = this.providerRepository.getProvider(providerId);
      if (!provider) {
        return {
          success: false,
          error: `Provider ${providerId} not found`
        };
      }

      const now = Date.now();

      // Check quota status
      const quotaStatus = await this.checkProviderQuota(provider);

      // Check account status
      const accountStatus = await this.checkAccountStatus(provider);

      // Get response time metrics from history
      const responseTimeMetrics = this.calculateResponseTimeMetrics(providerId);

      // Get error rate metrics from history
      const errorRateMetrics = this.calculateErrorRateMetrics(providerId);

      // Calculate overall health score
      const healthScore = this.calculateHealthScore(
        responseTimeMetrics,
        errorRateMetrics,
        quotaStatus,
        accountStatus
      );

      const metrics: ProviderHealthMetrics = {
        providerId,
        isHealthy: healthScore >= 70, // Healthy if score >= 70
        healthScore,
        responseTime: responseTimeMetrics,
        errorRate: errorRateMetrics,
        quotaStatus,
        accountStatus,
        lastChecked: now,
        lastUpdated: now
      };

      // Cache the metrics
      this.healthCache.set(providerId, metrics);

      return {
        success: true,
        metrics
      };

    } catch (error) {
      console.error(`Health check failed for provider ${providerId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Check provider quota status
   */
  private async checkProviderQuota(provider: RuntimeProviderPreset): Promise<ProviderHealthMetrics['quotaStatus']> {
    if (!provider.capabilities.usageCheckEnabled || !provider.capabilities.usageCheckUrl) {
      return {
        usagePercent: 0,
        remaining: -1,
        limit: -1
      };
    }

    try {
      const usage = await fetchProviderUsage({
        apiKey: provider.providerApiKeys[0],
        requestId: `health-${provider.id}-${Date.now()}`,
        logger: {
          info: (...args: any[]) => console.log(...args),
          warn: (...args: any[]) => console.warn(...args),
          error: (...args: any[]) => console.error(...args),
          debug: (...args: any[]) => console.debug(...args),
          trace: (...args: any[]) => console.trace(...args),
          fatal: (...args: any[]) => console.error(...args),
          silent: () => {},
        } as any,
        timeoutMs: 5000,
        url: provider.capabilities.usageCheckUrl,
      });
      if (usage) {
        const limit = usage.limit ?? -1;
        const used = usage.used ?? 0;
        const remaining = usage.remaining ?? (limit !== -1 ? limit - used : -1);
        const usagePercent = limit > 0 ? (used / limit) * 100 : 0;
        const resetTime = typeof (usage.raw as any)?.resetTime === 'string' ? (usage.raw as any).resetTime : undefined;
        return {
          usagePercent,
          remaining,
          limit,
          resetTime
        };
      }
    } catch (error) {
      console.warn(`Failed to check quota for provider ${provider.id}:`, error);
    }

    return {
      usagePercent: 0,
      remaining: -1,
      limit: -1
    };
  }

  /**
   * Check account status for the provider
   */
  private async checkAccountStatus(provider: RuntimeProviderPreset): Promise<ProviderHealthMetrics['accountStatus']> {
    let hasValidAccounts = true;
    let accountsNearExpiry = false;
    let activeAccounts = 0;
    let totalAccounts = 0;

    try {
      if (provider.authMode === 'chatgpt_oauth' && this.chatGptOAuthStore) {
        const accounts = this.chatGptOAuthStore.listAccounts();
        totalAccounts = accounts.length;

        for (const account of accounts) {
          if (account.accessToken && account.refreshToken) {
            activeAccounts++;

            // Check if token is near expiry (within 24 hours)
            if (account.expiresAt) {
              const expiryTime = new Date(account.expiresAt).getTime();
              const twentyFourHours = 24 * 60 * 60 * 1000;
              if (expiryTime - Date.now() < twentyFourHours) {
                accountsNearExpiry = true;
              }
            }
          }
        }

        hasValidAccounts = activeAccounts > 0;

      } else if (provider.authMode === 'kiro' && this.kiroTokenStore) {
        const accounts = this.kiroTokenStore.listAccounts();
        totalAccounts = accounts.length;

        for (const account of accounts) {
          if (account.isActive && account.accessToken) {
            activeAccounts++;

            // Check if Kiro token is near expiry
            if (account.expiresAt) {
              const expiryTime = new Date(account.expiresAt).getTime();
              const twentyFourHours = 24 * 60 * 60 * 1000;
              if (expiryTime - Date.now() < twentyFourHours) {
                accountsNearExpiry = true;
              }
            }
          }
        }

        hasValidAccounts = activeAccounts > 0;

      } else if (provider.authMode === 'api_key') {
        // For API key providers, check if they have keys configured
        totalAccounts = provider.providerApiKeys.length;
        activeAccounts = provider.providerApiKeys.length;
        hasValidAccounts = provider.providerApiKeys.length > 0;
      }
    } catch (error) {
      console.warn(`Failed to check account status for provider ${provider.id}:`, error);
      hasValidAccounts = false;
    }

    return {
      hasValidAccounts,
      accountsNearExpiry,
      activeAccounts,
      totalAccounts
    };
  }

  /**
   * Calculate response time metrics from history
   */
  private calculateResponseTimeMetrics(providerId: string): ProviderHealthMetrics['responseTime'] {
    const history = this.responseTimeHistory.get(providerId) || [];

    if (history.length === 0) {
      return {
        average: 1000, // Default 1s
        p95: 1000,
        p99: 1000
      };
    }

    const sorted = [...history].sort((a, b) => a - b);
    const average = history.reduce((sum, time) => sum + time, 0) / history.length;
    const p95Index = Math.floor(sorted.length * 0.95);
    const p99Index = Math.floor(sorted.length * 0.99);

    return {
      average,
      p95: sorted[p95Index] || average,
      p99: sorted[p99Index] || average
    };
  }

  /**
   * Calculate error rate metrics from history
   */
  private calculateErrorRateMetrics(providerId: string): ProviderHealthMetrics['errorRate'] {
    const history = this.errorHistory.get(providerId) || [];

    if (history.length === 0) {
      return {
        rate: 0,
        recentErrors: 0,
        totalRequests: 0
      };
    }

    const recentErrors = history.filter(e => e.error).length;
    const totalRequests = history.length;
    const rate = totalRequests > 0 ? recentErrors / totalRequests : 0;

    return {
      rate,
      recentErrors,
      totalRequests
    };
  }

  /**
   * Calculate overall health score (0-100)
   */
  private calculateHealthScore(
    responseTime: ProviderHealthMetrics['responseTime'],
    errorRate: ProviderHealthMetrics['errorRate'],
    quotaStatus: ProviderHealthMetrics['quotaStatus'],
    accountStatus: ProviderHealthMetrics['accountStatus']
  ): number {
    let score = 100;

    // Response time factor (25% weight)
    if (responseTime.average > this.thresholds.responseTime.degraded) {
      score -= 25;
    } else if (responseTime.average > this.thresholds.responseTime.good) {
      score -= 12;
    }

    // Error rate factor (30% weight)
    if (errorRate.rate > this.thresholds.errorRate.degraded) {
      score -= 30;
    } else if (errorRate.rate > this.thresholds.errorRate.good) {
      score -= 15;
    }

    // Quota status factor (25% weight)
    if (quotaStatus.usagePercent > this.thresholds.quotaUsage.critical) {
      score -= 25;
    } else if (quotaStatus.usagePercent > this.thresholds.quotaUsage.warning) {
      score -= 12;
    }

    // Account status factor (20% weight)
    if (!accountStatus.hasValidAccounts) {
      score -= 20;
    } else if (accountStatus.accountsNearExpiry) {
      score -= 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Update health metrics from request history
   */
  private updateHealthMetricsFromHistory(providerId: string, metrics: ProviderHealthMetrics): void {
    metrics.responseTime = this.calculateResponseTimeMetrics(providerId);
    metrics.errorRate = this.calculateErrorRateMetrics(providerId);
    metrics.healthScore = this.calculateHealthScore(
      metrics.responseTime,
      metrics.errorRate,
      metrics.quotaStatus,
      metrics.accountStatus
    );
    metrics.isHealthy = metrics.healthScore >= 70;
    metrics.lastUpdated = Date.now();
  }

  /**
   * Get health summary for all providers
   */
  getHealthSummary(): {
    totalProviders: number;
    healthyProviders: number;
    degradedProviders: number;
    unhealthyProviders: number;
    averageHealthScore: number;
  } {
    const allHealth = Array.from(this.healthCache.values());
    const totalProviders = allHealth.length;

    if (totalProviders === 0) {
      return {
        totalProviders: 0,
        healthyProviders: 0,
        degradedProviders: 0,
        unhealthyProviders: 0,
        averageHealthScore: 0
      };
    }

    const healthyProviders = allHealth.filter(h => h.healthScore >= 70).length;
    const degradedProviders = allHealth.filter(h => h.healthScore >= 40 && h.healthScore < 70).length;
    const unhealthyProviders = allHealth.filter(h => h.healthScore < 40).length;
    const averageHealthScore = allHealth.reduce((sum, h) => sum + h.healthScore, 0) / totalProviders;

    return {
      totalProviders,
      healthyProviders,
      degradedProviders,
      unhealthyProviders,
      averageHealthScore: Math.round(averageHealthScore)
    };
  }
}