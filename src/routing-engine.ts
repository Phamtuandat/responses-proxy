import type { RuntimeProviderRepository, RuntimeProviderPreset } from "./runtime-provider-repository.js";
import type { RoutingCombo, RoutingTier, ProviderBinding } from "./routing-combo-repository.js";
import { fetchProviderUsage } from "./provider-usage.js";

// Routing request and result types
export type RoutingRequest = {
  route: string;
  model?: string;
  tokenCount?: number;
  priority?: 'low' | 'normal' | 'high';
  clientRoute?: string;
  startTime: number;
};

export type RoutingResult = {
  success: boolean;
  provider?: RuntimeProviderPreset;
  tier?: string;
  selectionTime: number;
  eligibilityScore?: number;
  error?: string;
  fallbackCount?: number;
  retryCount?: number;
};

export type ProviderHealth = {
  providerId: string;
  isHealthy: boolean;
  averageResponseTime: number;
  errorRate: number;
  quotaUsagePercent: number;
  hasValidAccounts: boolean;
  accountsNearExpiry: boolean;
  lastChecked: number;
};

export type EligibleProvider = {
  binding: ProviderBinding;
  provider: RuntimeProviderPreset;
  health: ProviderHealth;
  eligibilityScore: number;
};

export class RoutingEngine {
  constructor(
    private readonly providerRepository: RuntimeProviderRepository,
    private readonly healthCheckCache = new Map<string, ProviderHealth>(),
    private readonly healthCacheTtl = 30000 // 30 seconds
  ) {}

  /**
   * Select the best provider for a request using multi-tier routing
   */
  async selectProvider(combo: RoutingCombo, request: RoutingRequest): Promise<RoutingResult> {
    const startTime = Date.now();
    let fallbackCount = 0;
    let retryCount = 0;

    // Get enabled tiers sorted by priority
    const enabledTiers = combo.tiers
      .filter(tier => tier.isEnabled)
      .sort((a, b) => a.priority - b.priority);

    if (enabledTiers.length === 0) {
      return {
        success: false,
        error: 'No enabled tiers available',
        selectionTime: Date.now() - startTime,
        fallbackCount,
        retryCount
      };
    }

    // Try each tier in priority order
    for (let tierIndex = 0; tierIndex < enabledTiers.length; tierIndex++) {
      const tier = enabledTiers[tierIndex];

      try {
        // Get eligible providers for this tier
        const eligibleProviders = await this.getEligibleProviders(tier, request);

        if (eligibleProviders.length > 0) {
          // Select provider based on load balancing strategy
          const selectedProvider = await this.selectFromTier(
            eligibleProviders,
            combo.policies.loadBalancing,
            request
          );

          if (selectedProvider) {
            return {
              success: true,
              provider: selectedProvider.provider,
              tier: tier.name,
              selectionTime: Date.now() - startTime,
              eligibilityScore: selectedProvider.eligibilityScore,
              fallbackCount,
              retryCount
            };
          }
        }

        // If this isn't the last tier, wait for fallback delay
        if (tierIndex < enabledTiers.length - 1) {
          fallbackCount++;
          if (tier.fallbackDelay > 0) {
            await new Promise(resolve => setTimeout(resolve, tier.fallbackDelay));
          }
        }
      } catch (error) {
        console.error(`Error selecting from tier ${tier.name}:`, error);
        // Continue to next tier on error
        fallbackCount++;
      }
    }

    return {
      success: false,
      error: 'No eligible providers available in any tier',
      selectionTime: Date.now() - startTime,
      fallbackCount,
      retryCount
    };
  }

  /**
   * Get eligible providers for a tier based on health and configuration
   */
  private async getEligibleProviders(tier: RoutingTier, request: RoutingRequest): Promise<EligibleProvider[]> {
    const eligibleProviders: EligibleProvider[] = [];

    for (const binding of tier.providers) {
      if (!binding.isEnabled) {
        continue;
      }

      try {
        // Get provider from repository
        const provider = this.providerRepository.getProvider(binding.providerId);
        if (!provider) {
          console.warn(`Provider ${binding.providerId} not found`);
          continue;
        }

        // Get provider health
        const health = await this.getProviderHealth(binding.providerId);

        // Calculate eligibility score
        const eligibilityScore = this.calculateEligibilityScore(provider, health, request, tier);

        // Check if provider meets minimum eligibility threshold
        const minThreshold = this.getMinEligibilityThreshold(tier, request);
        if (eligibilityScore >= minThreshold) {
          eligibleProviders.push({
            binding,
            provider,
            health,
            eligibilityScore
          });
        }
      } catch (error) {
        console.error(`Error evaluating provider ${binding.providerId}:`, error);
        // Skip this provider on error
      }
    }

    return eligibleProviders;
  }

  /**
   * Select a provider from eligible providers based on load balancing strategy
   */
  private async selectFromTier(
    eligibleProviders: EligibleProvider[],
    strategy: RoutingCombo['policies']['loadBalancing'],
    request: RoutingRequest
  ): Promise<EligibleProvider | null> {
    if (eligibleProviders.length === 0) {
      return null;
    }

    if (eligibleProviders.length === 1) {
      return eligibleProviders[0];
    }

    switch (strategy) {
      case 'weighted':
        return this.selectByWeight(eligibleProviders);

      case 'health_based':
        return this.selectByHealth(eligibleProviders);

      case 'cost_optimized':
        return this.selectByCost(eligibleProviders);

      case 'round_robin':
        return this.selectRoundRobin(eligibleProviders, request);

      case 'least_connections':
        return this.selectLeastConnections(eligibleProviders);

      case 'random':
        return this.selectRandom(eligibleProviders);

      default:
        // Default to weighted selection
        return this.selectByWeight(eligibleProviders);
    }
  }

  /**
   * Calculate eligibility score for a provider (0-100)
   */
  private calculateEligibilityScore(
    provider: RuntimeProviderPreset,
    health: ProviderHealth,
    request: RoutingRequest,
    tier: RoutingTier
  ): number {
    let score = 100;

    // Response time factor (20% weight)
    if (health.averageResponseTime > 5000) {
      score -= 20;
    } else if (health.averageResponseTime > 2000) {
      score -= 10;
    } else if (health.averageResponseTime > 1000) {
      score -= 5;
    }

    // Error rate factor (30% weight)
    if (health.errorRate > 0.1) {
      score -= 30;
    } else if (health.errorRate > 0.05) {
      score -= 15;
    } else if (health.errorRate > 0.02) {
      score -= 8;
    }

    // Quota availability factor (25% weight)
    if (health.quotaUsagePercent > 95) {
      score -= 25;
    } else if (health.quotaUsagePercent > 80) {
      score -= 10;
    } else if (health.quotaUsagePercent > 60) {
      score -= 5;
    }

    // Account status factor (25% weight)
    if (!health.hasValidAccounts) {
      score -= 25;
    } else if (health.accountsNearExpiry) {
      score -= 10;
    }

    // Health threshold check
    if (tier.healthThreshold && tier.healthThreshold.length > 0) {
      const providerHealthStatus = this.getProviderHealthStatus(health);
      if (!tier.healthThreshold.includes(providerHealthStatus)) {
        score -= 50; // Significant penalty for not meeting health threshold
      }
    }

    // Priority boost for high priority requests
    if (request.priority === 'high' && provider.capabilities.usageCheckEnabled) {
      score += 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Get provider health status category
   */
  private getProviderHealthStatus(health: ProviderHealth): 'healthy' | 'degraded' | 'rate_limited' {
    if (!health.isHealthy || health.errorRate > 0.1 || health.averageResponseTime > 5000) {
      return 'degraded';
    }

    if (health.quotaUsagePercent > 90) {
      return 'rate_limited';
    }

    return 'healthy';
  }

  /**
   * Get minimum eligibility threshold based on tier and request
   */
  private getMinEligibilityThreshold(tier: RoutingTier, request: RoutingRequest): number {
    // Higher tiers have higher standards
    switch (tier.tier) {
      case 'subscription':
        return 70;
      case 'cheap':
        return 50;
      case 'free':
        return 30;
      case 'custom':
        return 40;
      default:
        return 50;
    }
  }

  /**
   * Get cached provider health or fetch fresh data
   */
  private async getProviderHealth(providerId: string): Promise<ProviderHealth> {
    const cached = this.healthCheckCache.get(providerId);
    const now = Date.now();

    if (cached && (now - cached.lastChecked) < this.healthCacheTtl) {
      return cached;
    }

    // Fetch fresh health data
    const health = await this.fetchProviderHealth(providerId);
    this.healthCheckCache.set(providerId, health);
    return health;
  }

  /**
   * Fetch provider health from various sources
   */
  private async fetchProviderHealth(providerId: string): Promise<ProviderHealth> {
    const provider = this.providerRepository.getProvider(providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} not found`);
    }

    let quotaUsagePercent = 0;
    let isHealthy = true;
    let averageResponseTime = 1000; // Default 1s
    let errorRate = 0;

    // Check provider usage if enabled
    if (provider.capabilities.usageCheckEnabled && provider.capabilities.usageCheckUrl) {
      try {
        const usage = await fetchProviderUsage({
          apiKey: provider.providerApiKeys[0],
          requestId: `route-health-${providerId}-${Date.now()}`,
          logger: {
            info: () => {},
            warn: () => {},
            error: () => {},
            debug: () => {},
            trace: () => {},
            fatal: () => {},
            silent: () => {},
          } as any,
          timeoutMs: 5000,
          url: provider.capabilities.usageCheckUrl,
        });
        if (usage && usage.limit !== undefined && usage.used !== undefined) {
          quotaUsagePercent = (usage.used / usage.limit) * 100;
          isHealthy = quotaUsagePercent < 95;
        }
      } catch (error) {
        console.warn(`Failed to check usage for provider ${providerId}:`, error);
        // Assume degraded if we can't check usage
        isHealthy = false;
        errorRate = 0.1;
      }
    }

    // Check account status based on auth mode
    let hasValidAccounts = true;
    let accountsNearExpiry = false;

    if (provider.authMode === 'chatgpt_oauth') {
      // TODO: Check ChatGPT OAuth account status
      // For now, assume valid if provider has chatgptAccountId
      hasValidAccounts = !!provider.chatgptAccountId;
    } else if (provider.authMode === 'kiro') {
      // TODO: Check Kiro account status
      // For now, assume valid
      hasValidAccounts = true;
    } else if (provider.authMode === 'api_key') {
      // Check if provider has API keys
      hasValidAccounts = provider.providerApiKeys.length > 0;
    }

    return {
      providerId,
      isHealthy,
      averageResponseTime,
      errorRate,
      quotaUsagePercent,
      hasValidAccounts,
      accountsNearExpiry,
      lastChecked: Date.now()
    };
  }

  // Load balancing strategy implementations

  private selectByWeight(providers: EligibleProvider[]): EligibleProvider {
    const totalWeight = providers.reduce((sum, p) => sum + p.binding.weight, 0);
    const random = Math.random() * totalWeight;

    let currentWeight = 0;
    for (const provider of providers) {
      currentWeight += provider.binding.weight;
      if (random <= currentWeight) {
        return provider;
      }
    }

    return providers[0]; // Fallback
  }

  private selectByHealth(providers: EligibleProvider[]): EligibleProvider {
    // Sort by eligibility score (highest first)
    const sorted = [...providers].sort((a, b) => b.eligibilityScore - a.eligibilityScore);
    return sorted[0];
  }

  private selectByCost(providers: EligibleProvider[]): EligibleProvider {
    // For now, prefer providers in 'cheap' or 'free' tiers
    // TODO: Implement actual cost calculation based on provider pricing
    const cheapProviders = providers.filter(p =>
      p.provider.name.toLowerCase().includes('free') ||
      p.provider.name.toLowerCase().includes('cheap')
    );

    if (cheapProviders.length > 0) {
      return this.selectByHealth(cheapProviders);
    }

    return this.selectByHealth(providers);
  }

  private selectRoundRobin(providers: EligibleProvider[], request: RoutingRequest): EligibleProvider {
    // Simple round-robin based on request hash
    const hash = this.hashString(request.route + (request.clientRoute || ''));
    const index = hash % providers.length;
    return providers[index];
  }

  private selectLeastConnections(providers: EligibleProvider[]): EligibleProvider {
    // TODO: Implement actual connection tracking
    // For now, fall back to health-based selection
    return this.selectByHealth(providers);
  }

  private selectRandom(providers: EligibleProvider[]): EligibleProvider {
    const index = Math.floor(Math.random() * providers.length);
    return providers[index];
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Clear health cache (useful for testing or forced refresh)
   */
  clearHealthCache(): void {
    this.healthCheckCache.clear();
  }

  /**
   * Get current health cache stats
   */
  getHealthCacheStats(): { size: number; entries: string[] } {
    return {
      size: this.healthCheckCache.size,
      entries: Array.from(this.healthCheckCache.keys())
    };
  }
}