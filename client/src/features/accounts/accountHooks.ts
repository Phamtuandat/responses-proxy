// React hooks for account management operations
import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  AccountConnection,
  ConnectionFlow,
  AccountTestSuite,
  TestResult
} from "./accountApi";
import type {
  ProviderAccountRoutingMode,
  ProviderTestResult
} from "../providers/providerTypes";
import {
  fetchProviderAccounts,
  testProviderAccount,
  updateAccountRoutingMode,
  refreshProviderAccount,
  deleteProviderAccount,
  startAccountConnection
} from "./accountApi";

// Hook for fetching and managing provider accounts
export function useProviderAccounts(providerId: string | null) {
  const [accounts, setAccounts] = useState<AccountConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadAccounts = useCallback(async () => {
    if (!providerId) {
      setAccounts([]);
      setLoading(false);
      setError(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await fetchProviderAccounts(providerId);
      setAccounts(data);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load accounts');
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const refresh = useCallback(async () => {
    await loadAccounts();
  }, [loadAccounts]);

  // Account statistics
  const stats = useMemo(() => {
    const total = accounts.length;
    const connected = accounts.filter(acc => acc.status === 'connected').length;
    const expired = accounts.filter(acc => acc.status === 'expired').length;
    const expiring = accounts.filter(acc => acc.tokenStatus === 'expiring').length;
    const disabled = accounts.filter(acc => acc.status === 'disabled').length;

    return {
      total,
      connected,
      expired,
      expiring,
      disabled,
      healthy: connected,
      needsAttention: expired + expiring
    };
  }, [accounts]);

  return {
    accounts,
    loading,
    error,
    lastRefresh,
    stats,
    refresh
  };
}

// Hook for account testing operations
export function useAccountTest(providerId: string | null) {
  const [testResults, setTestResults] = useState<Map<string, ProviderTestResult>>(new Map());
  const [testing, setTesting] = useState<Set<string>>(new Set());

  const testAccount = useCallback(async (accountId: string) => {
    if (!providerId || testing.has(accountId)) return;

    try {
      setTesting(prev => new Set(prev).add(accountId));
      const result = await testProviderAccount(providerId, accountId);
      setTestResults(prev => new Map(prev).set(accountId, result));
      return result;
    } catch (err) {
      const errorResult: ProviderTestResult = {
        providerId,
        accountId,
        status: 'failed',
        testedAt: new Date().toISOString(),
        authOk: false,
        quotaOk: false,
        modelOk: false,
        routingOk: false,
        errorMessage: err instanceof Error ? err.message : 'Test failed',
        suggestedFix: 'Check account configuration and try again'
      };
      setTestResults(prev => new Map(prev).set(accountId, errorResult));
      return errorResult;
    } finally {
      setTesting(prev => {
        const newSet = new Set(prev);
        newSet.delete(accountId);
        return newSet;
      });
    }
  }, [providerId, testing]);

  const getTestResult = useCallback((accountId: string) => {
    return testResults.get(accountId);
  }, [testResults]);

  const isTestingAccount = useCallback((accountId: string) => {
    return testing.has(accountId);
  }, [testing]);

  const clearTestResult = useCallback((accountId: string) => {
    setTestResults(prev => {
      const newMap = new Map(prev);
      newMap.delete(accountId);
      return newMap;
    });
  }, []);

  const clearAllTestResults = useCallback(() => {
    setTestResults(new Map());
  }, []);

  return {
    testAccount,
    getTestResult,
    isTestingAccount,
    clearTestResult,
    clearAllTestResults,
    hasTestResults: testResults.size > 0
  };
}

// Hook for account management operations (update, delete, refresh)
export function useAccountOperations(providerId: string | null) {
  const [operationLoading, setOperationLoading] = useState<Map<string, string>>(new Map());
  const [operationError, setOperationError] = useState<string | null>(null);

  const setAccountOperation = useCallback((accountId: string, operation: string) => {
    setOperationLoading(prev => new Map(prev).set(accountId, operation));
    setOperationError(null);
  }, []);

  const clearAccountOperation = useCallback((accountId: string) => {
    setOperationLoading(prev => {
      const newMap = new Map(prev);
      newMap.delete(accountId);
      return newMap;
    });
  }, []);

  const updateRoutingMode = useCallback(async (
    accountId: string,
    mode: ProviderAccountRoutingMode
  ) => {
    if (!providerId) throw new Error('Provider ID is required');

    try {
      setAccountOperation(accountId, 'updating');
      await updateAccountRoutingMode(providerId, accountId, mode);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update routing mode';
      setOperationError(errorMessage);
      throw err;
    } finally {
      clearAccountOperation(accountId);
    }
  }, [providerId, setAccountOperation, clearAccountOperation]);

  const refreshAccount = useCallback(async (accountId: string) => {
    if (!providerId) throw new Error('Provider ID is required');

    try {
      setAccountOperation(accountId, 'refreshing');
      const refreshedAccount = await refreshProviderAccount(providerId, accountId);
      return refreshedAccount;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to refresh account';
      setOperationError(errorMessage);
      throw err;
    } finally {
      clearAccountOperation(accountId);
    }
  }, [providerId, setAccountOperation, clearAccountOperation]);

  const deleteAccount = useCallback(async (accountId: string) => {
    if (!providerId) throw new Error('Provider ID is required');

    try {
      setAccountOperation(accountId, 'deleting');
      await deleteProviderAccount(providerId, accountId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete account';
      setOperationError(errorMessage);
      throw err;
    } finally {
      clearAccountOperation(accountId);
    }
  }, [providerId, setAccountOperation, clearAccountOperation]);

  const isAccountLoading = useCallback((accountId: string) => {
    return operationLoading.has(accountId);
  }, [operationLoading]);

  const getAccountOperation = useCallback((accountId: string) => {
    return operationLoading.get(accountId);
  }, [operationLoading]);

  const clearError = useCallback(() => {
    setOperationError(null);
  }, []);

  return {
    updateRoutingMode,
    refreshAccount,
    deleteAccount,
    isAccountLoading,
    getAccountOperation,
    operationError,
    clearError
  };
}

// Hook for account connection flows (OAuth, API keys, etc.)
export function useAccountConnection(providerId: string | null) {
  const [connectionFlow, setConnectionFlow] = useState<ConnectionFlow | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const startConnection = useCallback(async (authType: 'oauth' | 'api_key') => {
    if (!providerId) throw new Error('Provider ID is required');

    try {
      setConnecting(true);
      setConnectionError(null);
      const flow = await startAccountConnection(providerId, authType);
      setConnectionFlow(flow);
      return flow;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start connection';
      setConnectionError(errorMessage);
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [providerId]);

  const clearConnectionFlow = useCallback(() => {
    setConnectionFlow(null);
    setConnectionError(null);
  }, []);

  const clearError = useCallback(() => {
    setConnectionError(null);
  }, []);

  return {
    connectionFlow,
    connecting,
    connectionError,
    startConnection,
    clearConnectionFlow,
    clearError
  };
}

// Hook for account health monitoring
export function useAccountHealth(accounts: AccountConnection[]) {
  const healthSummary = useMemo(() => {
    const summary = {
      healthy: 0,
      warning: 0,
      critical: 0,
      total: accounts.length
    };

    accounts.forEach(account => {
      switch (account.status) {
        case 'connected':
          if (account.tokenStatus === 'expiring') {
            summary.warning++;
          } else {
            summary.healthy++;
          }
          break;
        case 'expired':
        case 'invalid':
          summary.critical++;
          break;
        case 'disabled':
          // Don't count disabled accounts in health metrics
          break;
        default:
          summary.warning++;
      }
    });

    return summary;
  }, [accounts]);

  const expiringAccounts = useMemo(() => {
    return accounts.filter(account =>
      account.tokenStatus === 'expiring' ||
      (account.expiresAt && new Date(account.expiresAt).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000)
    );
  }, [accounts]);

  const expiredAccounts = useMemo(() => {
    return accounts.filter(account =>
      account.status === 'expired' ||
      account.tokenStatus === 'expired'
    );
  }, [accounts]);

  const needsAttentionAccounts = useMemo(() => {
    return accounts.filter(account =>
      account.status === 'expired' ||
      account.status === 'invalid' ||
      account.status === 'needs_reconnect' ||
      account.tokenStatus === 'expiring' ||
      account.tokenStatus === 'expired'
    );
  }, [accounts]);

  return {
    healthSummary,
    expiringAccounts,
    expiredAccounts,
    needsAttentionAccounts,
    hasHealthIssues: needsAttentionAccounts.length > 0
  };
}

// Hook for account filtering and sorting
export function useAccountFiltering(accounts: AccountConnection[]) {
  const [filters, setFilters] = useState({
    status: [] as string[],
    authType: [] as string[],
    showDisabled: true
  });

  const [sortBy, setSortBy] = useState<'name' | 'status' | 'lastUsed' | 'expires'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const filteredAccounts = useMemo(() => {
    let filtered = accounts.filter(account => {
      // Status filter
      if (filters.status.length > 0 && !filters.status.includes(account.status)) {
        return false;
      }

      // Auth type filter
      if (filters.authType.length > 0 && !filters.authType.includes(account.authType)) {
        return false;
      }

      // Show disabled filter
      if (!filters.showDisabled && account.status === 'disabled') {
        return false;
      }

      return true;
    });

    // Sort accounts
    filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'name':
          comparison = a.label.localeCompare(b.label);
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
        case 'lastUsed':
          const aTime = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
          const bTime = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
          comparison = bTime - aTime; // Most recent first
          break;
        case 'expires':
          const aExpires = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
          const bExpires = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
          comparison = aExpires - bExpires; // Soonest expiry first
          break;
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });

    return filtered;
  }, [accounts, filters, sortBy, sortOrder]);

  const updateFilters = useCallback((newFilters: Partial<typeof filters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({
      status: [],
      authType: [],
      showDisabled: true
    });
  }, []);

  return {
    filteredAccounts,
    filters,
    sortBy,
    sortOrder,
    updateFilters,
    clearFilters,
    setSortBy,
    setSortOrder
  };
}