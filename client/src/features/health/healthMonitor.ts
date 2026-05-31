// Real-time Provider Health Monitoring Service
// Integrates with existing provider-usage.ts and health checking APIs

import { apiGet, apiSend } from "../../api/client";
import type {
  Provider,
  ProviderHealthStatus,
  ProviderQuota,
  ProviderTestResult
} from "../providers/providerTypes";
import {
  computeProviderHealth,
  needsHealthCheck,
  getHealthCheckPriority,
  analyzeTestResult
} from "../providers/providerHealth";

// Health monitoring configuration
export interface HealthMonitorConfig {
  pollInterval: number; // milliseconds
  maxRetries: number;
  retryDelay: number;
  batchSize: number;
  priorityThreshold: number;
}

export const DEFAULT_HEALTH_CONFIG: HealthMonitorConfig = {
  pollInterval: 30000, // 30 seconds
  maxRetries: 3,
  retryDelay: 5000, // 5 seconds
  batchSize: 5, // Check 5 providers at once
  priorityThreshold: 50 // Only check providers with priority >= 50
};

// Health update event types
export interface ProviderHealthUpdate {
  providerId: string;
  healthStatus: ProviderHealthStatus;
  healthMessage?: string;
  lastHealthCheckAt: string;
  quota?: ProviderQuota;
  testResult?: ProviderTestResult;
  eligibilityScore?: number;
  issues?: string[];
  suggestedFixes?: string[];
}

export interface HealthMonitorStats {
  totalProviders: number;
  healthyProviders: number;
  unhealthyProviders: number;
  lastUpdateAt: string;
  checksPerformed: number;
  errorsEncountered: number;
  averageCheckTime: number;
}

// Health monitoring service
export class ProviderHealthMonitor {
  private config: HealthMonitorConfig;
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private subscribers = new Set<(update: ProviderHealthUpdate) => void>();
  private statsSubscribers = new Set<(stats: HealthMonitorStats) => void>();
  private providerHealthCache = new Map<string, ProviderHealthUpdate>();
  private stats: HealthMonitorStats = {
    totalProviders: 0,
    healthyProviders: 0,
    unhealthyProviders: 0,
    lastUpdateAt: new Date().toISOString(),
    checksPerformed: 0,
    errorsEncountered: 0,
    averageCheckTime: 0
  };
  private checkTimes: number[] = [];

  constructor(config: Partial<HealthMonitorConfig> = {}) {
    this.config = { ...DEFAULT_HEALTH_CONFIG, ...config };
  }

  // Start health monitoring
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.scheduleNextCheck();
    console.log('Provider health monitoring started');
  }

  // Stop health monitoring
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
    console.log('Provider health monitoring stopped');
  }

  // Subscribe to health updates
  subscribe(callback: (update: ProviderHealthUpdate) => void): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  // Subscribe to stats updates
  subscribeToStats(callback: (stats: HealthMonitorStats) => void): () => void {
    this.statsSubscribers.add(callback);
    return () => this.statsSubscribers.delete(callback);
  }

  // Get current health status for a provider
  getProviderHealth(providerId: string): ProviderHealthUpdate | null {
    return this.providerHealthCache.get(providerId) || null;
  }

  // Get all cached health data
  getAllProviderHealth(): Map<string, ProviderHealthUpdate> {
    return new Map(this.providerHealthCache);
  }

  // Get current monitoring stats
  getStats(): HealthMonitorStats {
    return { ...this.stats };
  }

  // Force health check for specific provider
  async checkProviderHealth(providerId: string): Promise<ProviderHealthUpdate> {
    const startTime = Date.now();

    try {
      // Fetch provider data and usage info
      const [providerResponse, usageResponse] = await Promise.all([
        apiGet(`/api/providers/${providerId}`),
        this.fetchProviderUsage(providerId)
      ]);

      const provider = providerResponse.provider;
      if (!provider) {
        throw new Error('Provider not found');
      }

      // Compute health status
      const healthData = this.computeProviderHealthFromData(provider, usageResponse);

      // Update cache and notify subscribers
      this.providerHealthCache.set(providerId, healthData);
      this.notifySubscribers(healthData);

      // Update stats
      const checkTime = Date.now() - startTime;
      this.updateStats(checkTime, false);

      return healthData;
    } catch (error) {
      console.error(`Health check failed for provider ${providerId}:`, error);

      // Create error health update
      const errorUpdate: ProviderHealthUpdate = {
        providerId,
        healthStatus: 'unknown',
        healthMessage: error instanceof Error ? error.message : 'Health check failed',
        lastHealthCheckAt: new Date().toISOString(),
        issues: ['Health check failed'],
        suggestedFixes: ['Check provider configuration and network connectivity']
      };

      this.providerHealthCache.set(providerId, errorUpdate);
      this.notifySubscribers(errorUpdate);

      // Update stats with error
      const checkTime = Date.now() - startTime;
      this.updateStats(checkTime, true);

      throw error;
    }
  }

  // Bulk health check for multiple providers
  async checkMultipleProviders(providerIds: string[]): Promise<ProviderHealthUpdate[]> {
    const results: ProviderHealthUpdate[] = [];
    const batches = this.chunkArray(providerIds, this.config.batchSize);

    for (const batch of batches) {
      const batchPromises = batch.map(id =>
        this.checkProviderHealth(id).catch(error => {
          console.error(`Batch health check failed for provider ${id}:`, error);
          return null;
        })
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.filter(result => result !== null) as ProviderHealthUpdate[]);

      // Small delay between batches to avoid overwhelming the backend
      if (batches.length > 1) {
        await this.delay(1000);
      }
    }

    return results;
  }

  // Refresh all provider health data
  async refreshAllProviders(): Promise<void> {
    try {
      // Fetch all providers
      const response = await apiGet('/api/providers');
      const providers = response.providers || [];

      // Determine which providers need health checks
      const providersToCheck = providers
        .filter((provider: any) => this.shouldCheckProvider(provider))
        .sort((a: any, b: any) => {
          const priorityA = getHealthCheckPriority(this.mapToProvider(a));
          const priorityB = getHealthCheckPriority(this.mapToProvider(b));
          return priorityB - priorityA; // Higher priority first
        })
        .slice(0, 20); // Limit to top 20 providers

      console.log(`Refreshing health for ${providersToCheck.length} providers`);

      // Check providers in batches
      await this.checkMultipleProviders(providersToCheck.map((p: any) => p.id));

      // Update overall stats
      this.updateOverallStats(providers);
    } catch (error) {
      console.error('Failed to refresh all provider health:', error);
    }
  }

  // Private methods

  private scheduleNextCheck(): void {
    if (!this.isRunning) return;

    this.intervalId = setTimeout(async () => {
      try {
        await this.refreshAllProviders();
      } catch (error) {
        console.error('Scheduled health check failed:', error);
      } finally {
        this.scheduleNextCheck();
      }
    }, this.config.pollInterval);
  }

  private async fetchProviderUsage(providerId: string): Promise<any> {
    try {
      // Try to get live usage data
      const response = await apiGet('/api/providers/live-usage');
      const providerUsage = response.providers?.find((p: any) => p.id === providerId);
      return providerUsage?.usage || null;
    } catch (error) {
      console.warn(`Failed to fetch usage for provider ${providerId}:`, error);
      return null;
    }
  }

  private computeProviderHealthFromData(provider: any, usageData: any): ProviderHealthUpdate {
    // Map backend provider to frontend Provider type
    const mappedProvider = this.mapToProvider(provider);

    // Add usage data to quota if available
    if (usageData && mappedProvider.quota) {
      mappedProvider.quota.used = usageData.used || mappedProvider.quota.used;
      mappedProvider.quota.limit = usageData.limit || mappedProvider.quota.limit;
      mappedProvider.quota.remaining = usageData.remaining;
      if (mappedProvider.quota.used && mappedProvider.quota.limit) {
        mappedProvider.quota.usagePercent = (mappedProvider.quota.used / mappedProvider.quota.limit) * 100;
      }
    }

    // Compute health status
    const healthStatus = computeProviderHealth(mappedProvider);

    // Create health update
    const healthUpdate: ProviderHealthUpdate = {
      providerId: provider.id,
      healthStatus: healthStatus.status,
      healthMessage: healthStatus.message,
      lastHealthCheckAt: new Date().toISOString(),
      quota: mappedProvider.quota,
      issues: healthStatus.issues || [],
      suggestedFixes: healthStatus.suggestedFixes || []
    };

    return healthUpdate;
  }

  private shouldCheckProvider(provider: any): boolean {
    const mappedProvider = this.mapToProvider(provider);

    // Skip disabled providers
    if (!mappedProvider.enabled) return false;

    // Check if provider needs health check based on priority and last check time
    const needsCheck = needsHealthCheck(mappedProvider);
    const priority = getHealthCheckPriority(mappedProvider);

    return needsCheck && priority >= this.config.priorityThreshold;
  }

  private mapToProvider(backendProvider: any): Provider {
    // Basic mapping - this would use the same logic as providerApi.ts
    return {
      id: backendProvider.id,
      name: backendProvider.name,
      displayName: backendProvider.name,
      tier: 'custom', // Would be computed based on provider characteristics
      serviceKinds: ['chat'],
      authTypes: [backendProvider.authMode || 'api_key'],
      enabled: true,
      configured: (backendProvider.providerApiKeys?.length > 0) || !!backendProvider.chatgptAccountId,
      healthStatus: 'unknown',
      priority: 1,
      fallbackEligible: false,
      accounts: [],
      models: []
    } as Provider;
  }

  private notifySubscribers(update: ProviderHealthUpdate): void {
    this.subscribers.forEach(callback => {
      try {
        callback(update);
      } catch (error) {
        console.error('Error in health update subscriber:', error);
      }
    });
  }

  private notifyStatsSubscribers(): void {
    this.statsSubscribers.forEach(callback => {
      try {
        callback(this.stats);
      } catch (error) {
        console.error('Error in stats subscriber:', error);
      }
    });
  }

  private updateStats(checkTime: number, isError: boolean): void {
    this.stats.checksPerformed++;
    if (isError) {
      this.stats.errorsEncountered++;
    }

    // Track check times for average calculation
    this.checkTimes.push(checkTime);
    if (this.checkTimes.length > 100) {
      this.checkTimes.shift(); // Keep only last 100 check times
    }

    this.stats.averageCheckTime = this.checkTimes.reduce((a, b) => a + b, 0) / this.checkTimes.length;
    this.stats.lastUpdateAt = new Date().toISOString();

    this.notifyStatsSubscribers();
  }

  private updateOverallStats(providers: any[]): void {
    this.stats.totalProviders = providers.length;

    let healthy = 0;
    let unhealthy = 0;

    this.providerHealthCache.forEach(health => {
      if (health.healthStatus === 'healthy') {
        healthy++;
      } else if (health.healthStatus !== 'unknown') {
        unhealthy++;
      }
    });

    this.stats.healthyProviders = healthy;
    this.stats.unhealthyProviders = unhealthy;
    this.stats.lastUpdateAt = new Date().toISOString();

    this.notifyStatsSubscribers();
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Global health monitor instance
let globalHealthMonitor: ProviderHealthMonitor | null = null;

export function getHealthMonitor(config?: Partial<HealthMonitorConfig>): ProviderHealthMonitor {
  if (!globalHealthMonitor) {
    globalHealthMonitor = new ProviderHealthMonitor(config);
  }
  return globalHealthMonitor;
}

export function startGlobalHealthMonitoring(config?: Partial<HealthMonitorConfig>): void {
  const monitor = getHealthMonitor(config);
  monitor.start();
}

export function stopGlobalHealthMonitoring(): void {
  if (globalHealthMonitor) {
    globalHealthMonitor.stop();
  }
}