// React hooks for provider data management
import { useState, useEffect, useCallback, useMemo } from "react";
import type { Provider, ProviderFilters, ProviderTierSummary } from "./providerTypes";
import { fetchProviders, fetchProviderById, testProvider, refreshProviderHealth } from "./providerApi";
import { getProvidersByTier, getTierSummary } from "./providerCatalog";

// Hook for fetching all providers
export function useProviders() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadProviders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchProviders();
      setProviders(data);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  }, []);

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

  return {
    providers,
    loading,
    error,
    lastRefresh,
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

    const loadProvider = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchProviderById(id);
        setProvider(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load provider');
      } finally {
        setLoading(false);
      }
    };

    loadProvider();
  }, [id]);

  const refresh = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);
      const data = await fetchProviderById(id);
      setProvider(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh provider');
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
    return getProvidersByTier(filteredProviders);
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

// Hook for auto-refresh functionality
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