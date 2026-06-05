// React hooks for provider data management with real-time health monitoring
import { useState, useEffect, useCallback, useMemo } from "react";
import type { Provider, ProviderFilters, ProviderTierSummary } from "./providerTypes";
import { fetchProviders, testProvider, refreshProviderHealth } from "./providerApi";
import { PROVIDER_CATALOG, getProviderById, getTierSummary } from "./providerCatalog";
import { healthWebSocketClient, type HealthMessage, type HealthUpdateMessage, type HealthSummaryMessage } from "../../utils/healthWebSocket";

// Provider health metrics from WebSocket
export type ProviderHealthMetrics = {
  providerId: string;
  isHealthy: boolean;
  healthScore: number;
  responseTime: {
    average: number;
    p95: number;
    p99: number;
  };
  errorRate: {
    rate: number;
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

export type HealthSummary = {
  totalProviders: number;
  healthyProviders: number;
  degradedProviders: number;
  unhealthyProviders: number;
  averageHealthScore: number;
};

// Hook for fetching all providers with real-time health updates
export function useProviders() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [healthMetrics, setHealthMetrics] = useState<Map<string, ProviderHealthMetrics>>(new Map());
  const [healthSummary, setHealthSummary] = useState<HealthSummary | null>(null);

  const loadProviders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchProviders();
      
      const merged = PROVIDER_CATALOG.map(catalogEntry => {
        const backendProvider = data.find(p => p.id === catalogEntry.id || p.name === catalogEntry.name);
        if (backendProvider) {
          return {
            ...backendProvider,
            displayName: catalogEntry.displayName,
            description: catalogEntry.description,
            tier: catalogEntry.tier,
            serviceKinds: catalogEntry.serviceKinds,
            authTypes: catalogEntry.authTypes,
            preferredAuthType: catalogEntry.preferredAuthType,
            riskNotice: catalogEntry.riskNotice
          };
        }
        
        return {
          id: catalogEntry.id,
          name: catalogEntry.name,
          displayName: catalogEntry.displayName,
          description: catalogEntry.description,
          tier: catalogEntry.tier,
          serviceKinds: catalogEntry.serviceKinds,
          authTypes: catalogEntry.authTypes,
          preferredAuthType: catalogEntry.preferredAuthType,
          enabled: true,
          configured: false,
          healthStatus: 'not_configured' as const,
          priority: catalogEntry.popularity || 3,
          fallbackEligible: false,
          accounts: [],
          models: [],
          riskNotice: catalogEntry.riskNotice
        };
      });
      
      const catalogIds = new Set(PROVIDER_CATALOG.map(c => c.id));
      const extraProviders = data.filter(p => !catalogIds.has(p.id));
      
      setProviders([...merged, ...extraProviders]);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  }, []);

  // Handle real-time health updates
  const handleHealthUpdate = useCallback((message: HealthMessage) => {
    if (message.type === 'health_update') {
      const updateMessage = message as HealthUpdateMessage;
      setHealthMetrics(prev => {
        const updated = new Map(prev);
        updated.set(updateMessage.providerId, updateMessage.metrics);
        return updated;
      });

      // Update provider health status based on metrics
      setProviders(prev => prev.map(provider => {
        if (provider.id === updateMessage.providerId) {
          const metrics = updateMessage.metrics;
          let healthStatus = provider.healthStatus;

          if (metrics.healthScore >= 70) {
            healthStatus = 'healthy';
          } else if (metrics.healthScore >= 40) {
            healthStatus = 'degraded';
          } else {
            healthStatus = 'unhealthy';
          }

          // Check for rate limiting
          if (metrics.quotaStatus.usagePercent > 90) {
            healthStatus = 'rate_limited';
          }

          // Check for quota exhaustion
          if (metrics.quotaStatus.usagePercent >= 100) {
            healthStatus = 'quota_exhausted';
          }

          return {
            ...provider,
            healthStatus,
            healthScore: metrics.healthScore,
            lastHealthCheck: new Date(metrics.lastChecked).toISOString()
          };
        }
        return provider;
      }));
    } else if (message.type === 'health_summary') {
      const summaryMessage = message as HealthSummaryMessage;
      setHealthSummary(summaryMessage.summary);
    }
  }, []);

  // Subscribe to health updates
  useEffect(() => {
    const unsubscribe = healthWebSocketClient.subscribe(handleHealthUpdate);
    return unsubscribe;
  }, [handleHealthUpdate]);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const refresh = useCallback(async () => {
    await loadProviders();
  }, [loadProviders]);

  const refreshHealth = useCallback(async () => {
    try {
      await refreshProviderHealth();
      await loadProviders(); // Reload data after health refresh
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh health');
    }
  }, [loadProviders]);

  // Enhanced providers with health metrics
  const enhancedProviders = useMemo(() => {
    return providers.map(provider => {
      const metrics = healthMetrics.get(provider.id);
      return {
        ...provider,
        healthMetrics: metrics
      };
    });
  }, [providers, healthMetrics]);

  return {
    providers: enhancedProviders,
    loading,
    error,
    lastRefresh,
    healthSummary,
    refresh,
    refreshHealth
  };
}

// Hook for fetching a single provider
export function useProvider(id: string | null) {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setProvider(null);
      setLoading(false);
      setError(null);
      return;
    }

    const buildCatalogFallback = (catalogEntry: ReturnType<typeof getProviderById>): Provider | null => {
      if (!catalogEntry) return null;
      return {
        id: catalogEntry.id,
        name: catalogEntry.name,
        displayName: catalogEntry.displayName,
        description: catalogEntry.description,
        tier: catalogEntry.tier,
        serviceKinds: catalogEntry.serviceKinds,
        authTypes: catalogEntry.authTypes,
        preferredAuthType: catalogEntry.preferredAuthType,
        enabled: true,
        configured: false,
        healthStatus: 'not_configured' as const,
        priority: catalogEntry.popularity || 3,
        fallbackEligible: false,
        accounts: [],
        models: [],
        riskNotice: catalogEntry.riskNotice
      };
    };

    const loadProvider = async () => {
      try {
        setLoading(true);
        setError(null);

        // Use the providers list endpoint to avoid 404s for catalog-only providers
        const allProviders = await fetchProviders();
        const backendProvider = allProviders.find(p => p.id === id || p.name === id);

        if (backendProvider) {
          // Found in backend — merge with catalog metadata
          const catalogEntry = getProviderById(id);
          setProvider({
            ...backendProvider,
            ...(catalogEntry ? {
              displayName: catalogEntry.displayName,
              description: catalogEntry.description,
              tier: catalogEntry.tier,
              serviceKinds: catalogEntry.serviceKinds,
              authTypes: catalogEntry.authTypes,
              preferredAuthType: catalogEntry.preferredAuthType,
              riskNotice: catalogEntry.riskNotice
            } : {})
          });
        } else {
          // Not in backend — use catalog data only
          const fallback = buildCatalogFallback(getProviderById(id));
          if (fallback) {
            setProvider(fallback);
          } else {
            setError('Provider not found');
          }
        }
      } catch (err) {
        const fallback = buildCatalogFallback(getProviderById(id));
        if (fallback) {
          setProvider(fallback);
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load provider');
        }
      } finally {
        setLoading(false);
      }
    };

    loadProvider();
  }, [id]);

  const refresh = useCallback(async () => {
    if (!id) return;

    const buildFallback = (catalogEntry: ReturnType<typeof getProviderById>): Provider | null => {
      if (!catalogEntry) return null;
      return {
        id: catalogEntry.id,
        name: catalogEntry.name,
        displayName: catalogEntry.displayName,
        description: catalogEntry.description,
        tier: catalogEntry.tier,
        serviceKinds: catalogEntry.serviceKinds,
        authTypes: catalogEntry.authTypes,
        preferredAuthType: catalogEntry.preferredAuthType,
        enabled: true,
        configured: false,
        healthStatus: 'not_configured' as const,
        priority: catalogEntry.popularity || 3,
        fallbackEligible: false,
        accounts: [],
        models: [],
        riskNotice: catalogEntry.riskNotice
      };
    };

    try {
      setLoading(true);
      setError(null);
      const allProviders = await fetchProviders();
      const backendProvider = allProviders.find(p => p.id === id || p.name === id);
      if (backendProvider) {
        const catalogEntry = getProviderById(id);
        setProvider({
          ...backendProvider,
          ...(catalogEntry ? {
            displayName: catalogEntry.displayName,
            description: catalogEntry.description,
            tier: catalogEntry.tier,
            serviceKinds: catalogEntry.serviceKinds,
            authTypes: catalogEntry.authTypes,
            preferredAuthType: catalogEntry.preferredAuthType,
            riskNotice: catalogEntry.riskNotice
          } : {})
        });
      } else {
        const fallback = buildFallback(getProviderById(id));
        if (fallback) {
          setProvider(fallback);
        }
      }
    } catch (err) {
      const fallback = buildFallback(getProviderById(id));
      if (fallback) {
        setProvider(fallback);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to refresh provider');
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  return {
    provider,
    loading,
    error,
    refresh
  };
}

// Hook for provider testing
export function useProviderTest() {
  const [testResults, setTestResults] = useState<Map<string, { success: boolean; message: string; latencyMs?: number }>>(new Map());
  const [testing, setTesting] = useState<Set<string>>(new Set());

  const testProviderById = useCallback(async (id: string) => {
    if (testing.has(id)) return; // Already testing

    try {
      setTesting(prev => new Set(prev).add(id));
      const result = await testProvider(id);
      setTestResults(prev => new Map(prev).set(id, result));
      return result;
    } catch (err) {
      const errorResult = {
        success: false,
        message: err instanceof Error ? err.message : 'Test failed'
      };
      setTestResults(prev => new Map(prev).set(id, errorResult));
      return errorResult;
    } finally {
      setTesting(prev => {
        const newSet = new Set(prev);
        newSet.delete(id);
        return newSet;
      });
    }
  }, [testing]);

  const getTestResult = useCallback((id: string) => {
    return testResults.get(id);
  }, [testResults]);

  const isTestingProvider = useCallback((id: string) => {
    return testing.has(id);
  }, [testing]);

  const clearTestResult = useCallback((id: string) => {
    setTestResults(prev => {
      const newMap = new Map(prev);
      newMap.delete(id);
      return newMap;
    });
  }, []);

  return {
    testProvider: testProviderById,
    getTestResult,
    isTestingProvider,
    clearTestResult
  };
}

// Hook for filtered providers with tier organization
export function useFilteredProviders(providers: Provider[], filters?: ProviderFilters) {
  const filteredProviders = useMemo(() => {
    if (!filters) return providers;

    return providers.filter(provider => {
      // Tier filter
      if (filters.tier && filters.tier.length > 0 && !filters.tier.includes(provider.tier)) {
        return false;
      }

      // Status filter
      if (filters.status && filters.status.length > 0 && !filters.status.includes(provider.healthStatus)) {
        return false;
      }

      // Auth type filter
      if (filters.authType && filters.authType.length > 0) {
        const hasMatchingAuth = provider.authTypes.some(authType => filters.authType!.includes(authType));
        if (!hasMatchingAuth) return false;
      }

      // Service kind filter
      if (filters.serviceKind && filters.serviceKind.length > 0) {
        const hasMatchingService = provider.serviceKinds.some(kind => filters.serviceKind!.includes(kind));
        if (!hasMatchingService) return false;
      }

      // Fallback eligible filter
      if (filters.fallbackEligible !== undefined && provider.fallbackEligible !== filters.fallbackEligible) {
        return false;
      }

      // Configured filter
      if (filters.configured !== undefined && provider.configured !== filters.configured) {
        return false;
      }

      return true;
    });
  }, [providers, filters]);

  const providersByTier = useMemo(() => {
    const grouped = {
      subscription: [] as Provider[],
      cheap: [] as Provider[],
      free: [] as Provider[],
      custom: [] as Provider[]
    };

    (filteredProviders || []).forEach(provider => {
      if (provider) {
        const tier = provider.tier;
        if (tier && tier in grouped) {
          grouped[tier as keyof typeof grouped].push(provider);
        } else {
          grouped.custom.push(provider);
        }
      }
    });

    return grouped;
  }, [filteredProviders]);

  const tierSummaries = useMemo(() => {
    const tiers: ProviderTierSummary[] = [];

    for (const [tier, tierProviders] of Object.entries(providersByTier)) {
      tiers.push(getTierSummary(tier as any, tierProviders));
    }

    return tiers;
  }, [providersByTier]);

  return {
    filteredProviders,
    providersByTier,
    tierSummaries
  };
}

// Hook for provider statistics
export function useProviderStats(providers: Provider[]) {
  const stats = useMemo(() => {
    const total = providers.length;
    const configured = providers.filter(p => p.configured).length;
    const healthy = providers.filter(p => p.healthStatus === 'healthy').length;
    const fallbackReady = providers.filter(p => p.fallbackEligible).length;
    const quotaExhausted = providers.filter(p => p.healthStatus === 'quota_exhausted').length;

    return {
      total,
      configured,
      healthy,
      fallbackReady,
      quotaExhausted,
      configuredPercent: total > 0 ? Math.round((configured / total) * 100) : 0,
      healthyPercent: configured > 0 ? Math.round((healthy / configured) * 100) : 0,
      fallbackReadyPercent: configured > 0 ? Math.round((fallbackReady / configured) * 100) : 0
    };
  }, [providers]);

  return stats;
}

// Hook for auto-refresh functionality with health monitoring
export function useAutoRefresh(refreshFn: () => Promise<void>, intervalMs: number = 30000) {
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);

  useEffect(() => {
    if (!autoRefreshEnabled) return;

    const interval = setInterval(() => {
      refreshFn().catch(console.error);
    }, intervalMs);

    return () => clearInterval(interval);
  }, [autoRefreshEnabled, refreshFn, intervalMs]);

  return {
    autoRefreshEnabled,
    setAutoRefreshEnabled
  };
}

// Hook for real-time health monitoring
export function useHealthMonitoring() {
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [healthSummary, setHealthSummary] = useState<HealthSummary | null>(null);
  const [providerHealth, setProviderHealth] = useState<Map<string, ProviderHealthMetrics>>(new Map());

  // Handle health updates
  const handleHealthUpdate = useCallback((message: HealthMessage) => {
    if (message.type === 'health_update') {
      const updateMessage = message as HealthUpdateMessage;
      setProviderHealth(prev => {
        const updated = new Map(prev);
        updated.set(updateMessage.providerId, updateMessage.metrics);
        return updated;
      });
    } else if (message.type === 'health_summary') {
      const summaryMessage = message as HealthSummaryMessage;
      setHealthSummary(summaryMessage.summary);
    }
  }, []);

  // Monitor connection status
  useEffect(() => {
    const checkStatus = () => {
      setConnectionStatus(healthWebSocketClient.getConnectionStatus());
    };

    // Check status immediately and then periodically
    checkStatus();
    const interval = setInterval(checkStatus, 1000);

    return () => clearInterval(interval);
  }, []);

  // Subscribe to health updates
  useEffect(() => {
    const unsubscribe = healthWebSocketClient.subscribe(handleHealthUpdate);
    return unsubscribe;
  }, [handleHealthUpdate]);

  const connect = useCallback(() => {
    healthWebSocketClient.connect();
  }, []);

  const disconnect = useCallback(() => {
    healthWebSocketClient.disconnect();
  }, []);

  return {
    connectionStatus,
    healthSummary,
    providerHealth,
    connect,
    disconnect
  };
}

// Hook for auto health monitoring (starts monitoring when component mounts)
export function useAutoHealthMonitoring(enabled: boolean = true) {
  const { connectionStatus, healthSummary, providerHealth } = useHealthMonitoring();

  useEffect(() => {
    if (enabled) {
      healthWebSocketClient.connect();
    }

    return () => {
      if (enabled) {
        healthWebSocketClient.disconnect();
      }
    };
  }, [enabled]);

  return {
    connectionStatus,
    healthSummary,
    providerHealth,
    isEnabled: enabled
  };
}