// React hooks for real-time provider health monitoring
import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  ProviderHealthUpdate,
  HealthMonitorStats,
  HealthMonitorConfig
} from "./healthMonitor";
import { getHealthMonitor } from "./healthMonitor";
import type { Provider, ProviderHealthStatus } from "../providers/providerTypes";

// Hook for real-time health monitoring of all providers
export function useHealthMonitoring(config?: Partial<HealthMonitorConfig>) {
  const [healthUpdates, setHealthUpdates] = useState<Map<string, ProviderHealthUpdate>>(new Map());
  const [stats, setStats] = useState<HealthMonitorStats | null>(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const healthMonitor = useMemo(() => getHealthMonitor(config), [config]);

  useEffect(() => {
    // Subscribe to health updates
    const unsubscribeHealth = healthMonitor.subscribe((update) => {
      setHealthUpdates(prev => new Map(prev).set(update.providerId, update));
      setError(null);
    });

    // Subscribe to stats updates
    const unsubscribeStats = healthMonitor.subscribeToStats((newStats) => {
      setStats(newStats);
    });

    // Initialize with current data
    setHealthUpdates(healthMonitor.getAllProviderHealth());
    setStats(healthMonitor.getStats());

    return () => {
      unsubscribeHealth();
      unsubscribeStats();
    };
  }, [healthMonitor]);

  const startMonitoring = useCallback(() => {
    try {
      healthMonitor.start();
      setIsMonitoring(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start monitoring');
    }
  }, [healthMonitor]);

  const stopMonitoring = useCallback(() => {
    try {
      healthMonitor.stop();
      setIsMonitoring(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop monitoring');
    }
  }, [healthMonitor]);

  const refreshAllHealth = useCallback(async () => {
    try {
      setError(null);
      await healthMonitor.refreshAllProviders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh health data');
    }
  }, [healthMonitor]);

  const checkProviderHealth = useCallback(async (providerId: string) => {
    try {
      setError(null);
      await healthMonitor.checkProviderHealth(providerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to check health for provider ${providerId}`);
    }
  }, [healthMonitor]);

  // Compute summary statistics
  const healthSummary = useMemo(() => {
    const updates = Array.from(healthUpdates.values());
    const summary = {
      total: updates.length,
      healthy: 0,
      degraded: 0,
      critical: 0,
      unknown: 0,
      lastUpdateAt: stats?.lastUpdateAt || null
    };

    updates.forEach(update => {
      switch (update.healthStatus) {
        case 'healthy':
          summary.healthy++;
          break;
        case 'degraded':
        case 'rate_limited':
          summary.degraded++;
          break;
        case 'quota_exhausted':
        case 'auth_expired':
        case 'disabled':
        case 'not_configured':
          summary.critical++;
          break;
        default:
          summary.unknown++;
      }
    });

    return summary;
  }, [healthUpdates, stats]);

  return {
    healthUpdates,
    stats,
    healthSummary,
    isMonitoring,
    error,
    startMonitoring,
    stopMonitoring,
    refreshAllHealth,
    checkProviderHealth
  };
}

// Hook for monitoring a specific provider's health
export function useProviderHealthMonitoring(providerId: string | null) {
  const [healthUpdate, setHealthUpdate] = useState<ProviderHealthUpdate | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const healthMonitor = useMemo(() => getHealthMonitor(), []);

  useEffect(() => {
    if (!providerId) {
      setHealthUpdate(null);
      return;
    }

    // Get initial health data
    const initialHealth = healthMonitor.getProviderHealth(providerId);
    setHealthUpdate(initialHealth);

    // Subscribe to updates for this provider
    const unsubscribe = healthMonitor.subscribe((update) => {
      if (update.providerId === providerId) {
        setHealthUpdate(update);
        setError(null);
      }
    });

    return unsubscribe;
  }, [providerId, healthMonitor]);

  const checkHealth = useCallback(async () => {
    if (!providerId) return;

    try {
      setIsChecking(true);
      setError(null);
      await healthMonitor.checkProviderHealth(providerId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Health check failed');
    } finally {
      setIsChecking(false);
    }
  }, [providerId, healthMonitor]);

  const getHealthAge = useCallback(() => {
    if (!healthUpdate?.lastHealthCheckAt) return null;

    const checkTime = new Date(healthUpdate.lastHealthCheckAt);
    const now = new Date();
    const ageMs = now.getTime() - checkTime.getTime();

    return {
      ageMs,
      ageMinutes: Math.floor(ageMs / (1000 * 60)),
      ageHours: Math.floor(ageMs / (1000 * 60 * 60)),
      isStale: ageMs > 4 * 60 * 60 * 1000 // 4 hours
    };
  }, [healthUpdate]);

  return {
    healthUpdate,
    isChecking,
    error,
    checkHealth,
    getHealthAge,
    hasHealthData: !!healthUpdate
  };
}

// Hook for health-based provider filtering and sorting
export function useHealthBasedProviders(providers: Provider[]) {
  const { healthUpdates } = useHealthMonitoring();

  const enhancedProviders = useMemo(() => {
    return providers.map(provider => {
      const healthUpdate = healthUpdates.get(provider.id);
      return {
        ...provider,
        healthStatus: healthUpdate?.healthStatus || provider.healthStatus,
        healthMessage: healthUpdate?.healthMessage || provider.healthMessage,
        lastHealthCheckAt: healthUpdate?.lastHealthCheckAt || provider.lastHealthCheckAt,
        quota: healthUpdate?.quota || provider.quota,
        realtimeHealth: healthUpdate
      };
    });
  }, [providers, healthUpdates]);

  const sortedByHealth = useMemo(() => {
    return [...enhancedProviders].sort((a, b) => {
      // Sort by health status priority
      const healthPriority = {
        'healthy': 0,
        'degraded': 1,
        'rate_limited': 2,
        'quota_exhausted': 3,
        'auth_expired': 4,
        'not_configured': 5,
        'disabled': 6,
        'unknown': 7
      };

      const aPriority = healthPriority[a.healthStatus] ?? 7;
      const bPriority = healthPriority[b.healthStatus] ?? 7;

      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }

      // Secondary sort by provider tier and priority
      const tierPriority = { 'subscription': 0, 'cheap': 1, 'free': 2, 'custom': 3 };
      const aTier = tierPriority[a.tier] ?? 3;
      const bTier = tierPriority[b.tier] ?? 3;

      if (aTier !== bTier) {
        return aTier - bTier;
      }

      return a.priority - b.priority;
    });
  }, [enhancedProviders]);

  const filterByHealth = useCallback((statuses: ProviderHealthStatus[]) => {
    return enhancedProviders.filter(provider =>
      statuses.includes(provider.healthStatus)
    );
  }, [enhancedProviders]);

  const getProvidersNeedingAttention = useCallback(() => {
    return enhancedProviders.filter(provider => {
      const update = healthUpdates.get(provider.id);
      return update && (
        update.issues && update.issues.length > 0 ||
        ['quota_exhausted', 'auth_expired', 'not_configured', 'disabled'].includes(update.healthStatus)
      );
    });
  }, [enhancedProviders, healthUpdates]);

  return {
    enhancedProviders,
    sortedByHealth,
    filterByHealth,
    getProvidersNeedingAttention
  };
}

// Hook for health alerts and notifications
export function useHealthAlerts() {
  const { healthUpdates, stats } = useHealthMonitoring();
  const [alerts, setAlerts] = useState<HealthAlert[]>([]);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());

  interface HealthAlert {
    id: string;
    type: 'critical' | 'warning' | 'info';
    title: string;
    message: string;
    providerId?: string;
    timestamp: string;
    dismissible: boolean;
  }

  useEffect(() => {
    const newAlerts: HealthAlert[] = [];

    // Check for critical provider issues
    healthUpdates.forEach((update, providerId) => {
      const alertId = `provider-${providerId}-${update.healthStatus}`;

      if (dismissedAlerts.has(alertId)) return;

      switch (update.healthStatus) {
        case 'quota_exhausted':
          newAlerts.push({
            id: alertId,
            type: 'critical',
            title: 'Quota Exhausted',
            message: `Provider ${providerId} has exhausted its quota`,
            providerId,
            timestamp: update.lastHealthCheckAt,
            dismissible: true
          });
          break;

        case 'auth_expired':
          newAlerts.push({
            id: alertId,
            type: 'critical',
            title: 'Authentication Expired',
            message: `Provider ${providerId} authentication has expired`,
            providerId,
            timestamp: update.lastHealthCheckAt,
            dismissible: true
          });
          break;

        case 'not_configured':
          newAlerts.push({
            id: alertId,
            type: 'warning',
            title: 'Provider Not Configured',
            message: `Provider ${providerId} is not properly configured`,
            providerId,
            timestamp: update.lastHealthCheckAt,
            dismissible: true
          });
          break;
      }
    });

    // Check for system-wide issues
    if (stats) {
      const errorRate = stats.checksPerformed > 0 ? stats.errorsEncountered / stats.checksPerformed : 0;

      if (errorRate > 0.5) {
        const alertId = 'system-high-error-rate';
        if (!dismissedAlerts.has(alertId)) {
          newAlerts.push({
            id: alertId,
            type: 'warning',
            title: 'High Error Rate',
            message: `Health monitoring is experiencing a high error rate (${(errorRate * 100).toFixed(1)}%)`,
            timestamp: stats.lastUpdateAt,
            dismissible: true
          });
        }
      }
    }

    setAlerts(newAlerts);
  }, [healthUpdates, stats, dismissedAlerts]);

  const dismissAlert = useCallback((alertId: string) => {
    setDismissedAlerts(prev => new Set(prev).add(alertId));
    setAlerts(prev => prev.filter(alert => alert.id !== alertId));
  }, []);

  const clearAllAlerts = useCallback(() => {
    const allAlertIds = alerts.map(alert => alert.id);
    setDismissedAlerts(prev => {
      const newSet = new Set(prev);
      allAlertIds.forEach(id => newSet.add(id));
      return newSet;
    });
    setAlerts([]);
  }, [alerts]);

  const criticalAlerts = useMemo(() => alerts.filter(alert => alert.type === 'critical'), [alerts]);
  const warningAlerts = useMemo(() => alerts.filter(alert => alert.type === 'warning'), [alerts]);

  return {
    alerts,
    criticalAlerts,
    warningAlerts,
    dismissAlert,
    clearAllAlerts,
    hasCriticalAlerts: criticalAlerts.length > 0,
    hasWarningAlerts: warningAlerts.length > 0
  };
}

// Hook for auto-starting health monitoring
export function useAutoHealthMonitoring(enabled: boolean = true, config?: Partial<HealthMonitorConfig>) {
  const { isMonitoring, startMonitoring, stopMonitoring } = useHealthMonitoring(config);

  useEffect(() => {
    if (enabled && !isMonitoring) {
      startMonitoring();
    } else if (!enabled && isMonitoring) {
      stopMonitoring();
    }
  }, [enabled, isMonitoring, startMonitoring, stopMonitoring]);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (isMonitoring) {
        stopMonitoring();
      }
    };
  }, [isMonitoring, stopMonitoring]);

  return { isMonitoring };
}