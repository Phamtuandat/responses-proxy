import React, { useState, useMemo } from "react";
import { PageHeader } from "../components/PageHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { RefreshButton } from "../components/RefreshButton";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { HealthDashboard, HealthStatusIndicator } from "../components/health/HealthDashboard";
import { ProvidersIcon, CheckCircleIcon, AlertIcon, ConfigIcon } from "../components/icons";
import type {
  Provider,
  ProviderTier,
  ProviderHealthStatus,
  ProviderServiceKind,
  ProviderAuthType,
  ProviderFilters,
  ProviderSummary,
  ProviderPrimaryAction
} from "../features/providers/providerTypes";
import {
  PROVIDER_CATALOG,
  getProvidersByTier,
  getTierSummary,
  SERVICE_KINDS,
  AUTH_TYPES
} from "../features/providers/providerCatalog";
import {
  checkProviderEligibility,
  getFallbackOrder
} from "../features/providers/providerEligibility";
import {
  formatHealthStatus,
  getRecommendedAction
} from "../features/providers/providerHealth";
import {
  useProviders,
  useProviderTest,
  useFilteredProviders,
  useProviderStats,
  useAutoRefresh
} from "../features/providers/providerHooks";
import {
  useHealthMonitoring,
  useHealthBasedProviders,
  useAutoHealthMonitoring
} from "../features/health/healthHooks";

// Real API integration - no more mock data

interface ProviderCardProps {
  provider: Provider;
  onConnect: (providerId: string) => void;
  onTest: (providerId: string) => void;
  onManage: (providerId: string) => void;
  onEnable: (providerId: string) => void;
  testResult?: { success: boolean; message: string; latencyMs?: number };
  isTesting?: boolean;
}

function ProviderCard({ provider, onConnect, onTest, onManage, onEnable, testResult, isTesting }: ProviderCardProps) {
  const healthInfo = formatHealthStatus(provider.healthStatus);
  const recommendedAction = getRecommendedAction(provider);
  const eligibility = checkProviderEligibility(provider);

  const handlePrimaryAction = () => {
    switch (recommendedAction.action) {
      case "connect":
      case "configure":
        onConnect(provider.id);
        break;
      case "test":
        onTest(provider.id);
        break;
      case "enable":
        onEnable(provider.id);
        break;
      case "reconnect":
        onConnect(provider.id);
        break;
      default:
        onManage(provider.id);
    }
  };

  return (
    <div className="provider-card">
      <div className="provider-card-header">
        <div className="provider-info">
          <div className="provider-name-row">
            <h3 className="provider-name">{provider.displayName}</h3>
            <div className="provider-badges">
              <StatusBadge variant="accent" size="sm">
                {provider.tier}
              </StatusBadge>
              <HealthStatusIndicator providerId={provider.id} />
            </div>
          </div>
          <div className="provider-description">{provider.description}</div>
        </div>

        <div className="provider-status">
          <div className="status-indicator">
            {provider.healthStatus === "healthy" ? (
              <CheckCircleIcon className="status-icon status-healthy" />
            ) : (
              <AlertIcon className="status-icon status-error" />
            )}
          </div>
          <div className="status-details">
            <div className="status-label">{healthInfo.label}</div>
            <div className="status-message">{healthInfo.message}</div>
            {provider.lastHealthCheckAt && (
              <div className="status-timestamp">
                Last checked: {new Date(provider.lastHealthCheckAt).toLocaleString()}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="provider-card-body">
        {/* Service Kinds */}
        <div className="provider-meta-row">
          <div className="meta-label">Services</div>
          <div className="meta-value">
            {provider.serviceKinds.map(kind => (
              <StatusBadge key={kind} variant="neutral" size="xs">
                {kind}
              </StatusBadge>
            ))}
          </div>
        </div>

        {/* Auth Types */}
        <div className="provider-meta-row">
          <div className="meta-label">Auth</div>
          <div className="meta-value">
            {provider.authTypes.map(auth => (
              <StatusBadge key={auth} variant="neutral" size="xs">
                {auth.replace('_', ' ')}
              </StatusBadge>
            ))}
          </div>
        </div>

        {/* Accounts */}
        {provider.accounts && provider.accounts.length > 0 && (
          <div className="provider-meta-row">
            <div className="meta-label">Accounts</div>
            <div className="meta-value">
              {provider.accounts.map(account => (
                <div key={account.id} className="account-summary">
                  <span className="account-label">{account.label}</span>
                  <StatusBadge
                    variant={account.status === "connected" ? "success" : "warning"}
                    size="xs"
                  >
                    {account.status}
                  </StatusBadge>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quota */}
        {provider.quota && (
          <div className="provider-meta-row">
            <div className="meta-label">Quota</div>
            <div className="meta-value">
              {provider.quota.usagePercent !== undefined ? (
                <div className="quota-bar">
                  <div className="quota-progress" style={{ width: `${provider.quota.usagePercent}%` }} />
                  <span className="quota-text">{provider.quota.usagePercent.toFixed(1)}%</span>
                </div>
              ) : (
                <span className="quota-unknown">Unknown</span>
              )}
            </div>
          </div>
        )}

        {/* Risk Notice */}
        {provider.riskNotice && (
          <div className="provider-risk-notice">
            <AlertIcon className="risk-icon" />
            <div className="risk-content">
              <div className="risk-title">{provider.riskNotice.title}</div>
              <div className="risk-message">{provider.riskNotice.message}</div>
            </div>
          </div>
        )}

        {/* Test Result */}
        {testResult && (
          <div className={`test-result ${testResult.success ? 'test-success' : 'test-error'}`}>
            <div className="test-status">
              {testResult.success ? 'Test Passed' : 'Test Failed'}
              {testResult.latencyMs && ` (${testResult.latencyMs}ms)`}
            </div>
            <div className="test-message">{testResult.message}</div>
          </div>
        )}
      </div>

      <div className="provider-card-actions">
        <button
          className="button-primary"
          onClick={handlePrimaryAction}
          disabled={isTesting}
        >
          {isTesting ? 'Testing...' : recommendedAction.label}
        </button>

        <button
          className="button-secondary"
          onClick={() => onTest(provider.id)}
          disabled={isTesting}
        >
          {isTesting ? 'Testing...' : 'Test'}
        </button>

        <button
          className="button-secondary"
          onClick={() => onManage(provider.id)}
        >
          Manage
        </button>
      </div>
    </div>
  );
}

interface TierSectionProps {
  tier: ProviderTier;
  providers: Provider[];
  onConnect: (providerId: string) => void;
  onTest: (providerId: string) => void;
  onManage: (providerId: string) => void;
  onEnable: (providerId: string) => void;
  getTestResult: (providerId: string) => { success: boolean; message: string; latencyMs?: number } | undefined;
  isTestingProvider: (providerId: string) => boolean;
}

function TierSection({ tier, providers, onConnect, onTest, onManage, onEnable, getTestResult, isTestingProvider }: TierSectionProps) {
  const tierInfo = getTierSummary(tier, providers);

  if (providers.length === 0) {
    return null;
  }

  const tierLabels = {
    subscription: "Subscription Tier",
    cheap: "Cost-Effective Tier",
    free: "Free Tier",
    custom: "Custom Tier"
  };

  const tierDescriptions = {
    subscription: "Premium providers with high reliability and features",
    cheap: "Budget-friendly providers with good performance",
    free: "Free providers with usage limitations",
    custom: "Custom configured providers"
  };

  return (
    <SurfaceCard
      title={tierLabels[tier]}
      description={tierDescriptions[tier]}
      badge={`${providers.length} provider${providers.length !== 1 ? 's' : ''}`}
    >
      <div className="tier-summary">
        <div className="tier-stats">
          <div className="tier-stat">
            <span className="stat-value">{tierInfo.healthyCount}</span>
            <span className="stat-label">Healthy</span>
          </div>
          <div className="tier-stat">
            <span className="stat-value">{tierInfo.configuredCount}</span>
            <span className="stat-label">Configured</span>
          </div>
          <div className="tier-stat">
            <span className="stat-value">{tierInfo.fallbackReadyCount}</span>
            <span className="stat-label">Fallback Ready</span>
          </div>
        </div>
      </div>

      <div className="providers-grid">
        {providers.map(provider => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            onConnect={onConnect}
            onTest={onTest}
            onManage={onManage}
            onEnable={onEnable}
            testResult={getTestResult(provider.id)}
            isTesting={isTestingProvider(provider.id)}
          />
        ))}
      </div>
    </SurfaceCard>
  );
}

interface ProviderFiltersCardProps {
  filters: ProviderFilters;
  onFiltersChange: (filters: ProviderFilters) => void;
}

function ProviderFiltersCard({ filters, onFiltersChange }: ProviderFiltersCardProps) {
  const handleTierFilter = (tier: ProviderTier) => {
    const currentTiers = filters.tier || [];
    const newTiers = currentTiers.includes(tier)
      ? currentTiers.filter(t => t !== tier)
      : [...currentTiers, tier];

    onFiltersChange({
      ...filters,
      tier: newTiers.length > 0 ? newTiers : undefined
    });
  };

  const handleStatusFilter = (status: ProviderHealthStatus) => {
    const currentStatuses = filters.status || [];
    const newStatuses = currentStatuses.includes(status)
      ? currentStatuses.filter(s => s !== status)
      : [...currentStatuses, status];

    onFiltersChange({
      ...filters,
      status: newStatuses.length > 0 ? newStatuses : undefined
    });
  };

  const clearFilters = () => {
    onFiltersChange({});
  };

  return (
    <SurfaceCard title="Filters" description="Filter providers by tier, status, and configuration">
      <div className="filters-section">
        <div className="filter-group">
          <div className="filter-label">Tier</div>
          <div className="filter-options">
            {(['subscription', 'cheap', 'free', 'custom'] as ProviderTier[]).map(tier => (
              <button
                key={tier}
                className={`filter-button ${filters.tier?.includes(tier) ? 'active' : ''}`}
                onClick={() => handleTierFilter(tier)}
              >
                {tier}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <div className="filter-label">Status</div>
          <div className="filter-options">
            {(['healthy', 'degraded', 'quota_exhausted', 'not_configured'] as ProviderHealthStatus[]).map(status => (
              <button
                key={status}
                className={`filter-button ${filters.status?.includes(status) ? 'active' : ''}`}
                onClick={() => handleStatusFilter(status)}
              >
                {status.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <div className="filter-label">Configuration</div>
          <div className="filter-options">
            <button
              className={`filter-button ${filters.configured === true ? 'active' : ''}`}
              onClick={() => onFiltersChange({
                ...filters,
                configured: filters.configured === true ? undefined : true
              })}
            >
              Configured Only
            </button>
            <button
              className={`filter-button ${filters.fallbackEligible === true ? 'active' : ''}`}
              onClick={() => onFiltersChange({
                ...filters,
                fallbackEligible: filters.fallbackEligible === true ? undefined : true
              })}
            >
              Fallback Ready
            </button>
          </div>
        </div>

        {(filters.tier || filters.status || filters.configured !== undefined || filters.fallbackEligible !== undefined) && (
          <button className="button-secondary" onClick={clearFilters}>
            Clear All Filters
          </button>
        )}
      </div>
    </SurfaceCard>
  );
}

export function EnhancedProvidersScreen() {
  const [filters, setFilters] = useState<ProviderFilters>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [showHealthDashboard, setShowHealthDashboard] = useState(false);

  // Fetch providers from real API
  const { providers, loading, error, refresh, refreshHealth } = useProviders();
  const { testProvider, getTestResult, isTestingProvider } = useProviderTest();
  const { autoRefreshEnabled, setAutoRefreshEnabled } = useAutoRefresh(refresh, 30000);

  // Auto-start health monitoring
  useAutoHealthMonitoring(true);

  // Get health-enhanced providers with real-time status
  const { enhancedProviders, sortedByHealth, getProvidersNeedingAttention } = useHealthBasedProviders(providers);

  // Health monitoring integration
  const { healthSummary: globalHealthSummary, isMonitoring, refreshAllHealth } = useHealthMonitoring();

  // Filter providers based on current filters and search
  const filteredProviders = useMemo(() => {
    return enhancedProviders.filter(provider => {
      // Search query filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          provider.name.toLowerCase().includes(query) ||
          provider.displayName.toLowerCase().includes(query) ||
          provider.description?.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      // Tier filter
      if (filters.tier && filters.tier.length > 0 && !filters.tier.includes(provider.tier)) {
        return false;
      }

      // Status filter
      if (filters.status && filters.status.length > 0 && !filters.status.includes(provider.healthStatus)) {
        return false;
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
  }, [enhancedProviders, filters, searchQuery]);

  // Use the filtered providers hook for tier organization
  const { providersByTier, tierSummaries } = useFilteredProviders(filteredProviders);
  const stats = useProviderStats(enhancedProviders);

  // Get providers needing attention for health alerts
  const providersNeedingAttention = getProvidersNeedingAttention();

  // Event handlers
  const handleConnect = (providerId: string) => {
    // Navigate to provider detail screen for connection setup
    window.location.hash = `#/providers/${providerId}`;
  };

  const handleTest = async (providerId: string) => {
    try {
      const result = await testProvider(providerId);
      // Test result is stored in the hook state and can be accessed via getTestResult
      console.log(`Test result for ${providerId}:`, result);
    } catch (error) {
      console.error(`Failed to test provider ${providerId}:`, error);
    }
  };

  const handleManage = (providerId: string) => {
    // Navigate to provider detail screen
    window.location.hash = `#/providers/${providerId}`;
  };

  const handleEnable = (providerId: string) => {
    // For now, just navigate to manage - enable/disable will be implemented later
    handleManage(providerId);
  };

  const handleAddProvider = () => {
    // Navigate to add provider flow
    window.location.hash = "#/providers/new";
  };

  const handleRefresh = async () => {
    try {
      await Promise.all([refresh(), refreshAllHealth()]);
    } catch (error) {
      console.error('Failed to refresh providers:', error);
    }
  };

  const handleRefreshHealth = async () => {
    try {
      await Promise.all([refreshHealth(), refreshAllHealth()]);
    } catch (error) {
      console.error('Failed to refresh provider health:', error);
    }
  };

  // Summary stats from real data with health integration
  const summaryStats = {
    total: stats.total,
    configured: stats.configured,
    healthy: globalHealthSummary?.healthy || stats.healthy,
    fallbackReady: stats.fallbackReady,
    needingAttention: providersNeedingAttention.length
  };

  // Loading state
  if (loading) {
    return (
      <div className="screen-stack">
        <PageHeader
          icon={ProvidersIcon}
          title="Providers"
          description="Manage AI provider connections and routing configuration"
        />
        <LoadingState
          title="Loading providers"
          description="Fetching provider data and health status..."
          cards={3}
        />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="screen-stack">
        <PageHeader
          icon={ProvidersIcon}
          title="Providers"
          description="Manage AI provider connections and routing configuration"
        />
        <EmptyState
          title="Failed to load providers"
          description={error}
          actionLabel="Retry"
          onClick={handleRefresh}
        />
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <PageHeader
        icon={ProvidersIcon}
        title="Providers"
        description="Manage AI provider connections and routing"
        actions={
          <div className="page-actions">
            <RefreshButton onClick={handleRefresh} />
            <button
              className="button-secondary"
              onClick={handleRefreshHealth}
              title="Refresh provider health status"
            >
              Refresh Health
            </button>
            <button
              className={`button-secondary ${showHealthDashboard ? 'active' : ''}`}
              onClick={() => setShowHealthDashboard(!showHealthDashboard)}
              title="Toggle health monitoring dashboard"
            >
              Health Monitor
            </button>
            <button className="button-primary" onClick={handleAddProvider}>
              Add Provider
            </button>
          </div>
        }
      />

      <div className="providers-screen-layout">
        {/* Health Dashboard (when enabled) */}
        {showHealthDashboard && (
          <div className="providers-health-section">
            <HealthDashboard autoStart={true} showControls={true} compact={false} />
          </div>
        )}

        {/* Summary Stats */}
        <div className="providers-stats-row">
          <StatCard
            title="Total Providers"
            value={summaryStats.total.toString()}
            caption="All configured providers"
          />
          <StatCard
            title="Configured"
            value={summaryStats.configured.toString()}
            caption="Ready for use"
            trend={summaryStats.configured > 0 ? "up" : "neutral"}
          />
          <StatCard
            title="Healthy"
            value={summaryStats.healthy.toString()}
            caption="Working normally"
            trend={summaryStats.healthy > 0 ? "up" : "neutral"}
          />
          <StatCard
            title="Fallback Ready"
            value={summaryStats.fallbackReady.toString()}
            caption="Available for routing"
            trend={summaryStats.fallbackReady > 0 ? "up" : "neutral"}
          />
          <StatCard
            title="Need Attention"
            value={summaryStats.needingAttention.toString()}
            caption="Health issues detected"
            trend={summaryStats.needingAttention > 0 ? "down" : "up"}
          />
        </div>

        {/* Search and Filters */}
        <div className="providers-controls-row">
          <SurfaceCard title="Search" description="Find providers by name or description">
            <input
              type="text"
              className="search-input"
              placeholder="Search providers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </SurfaceCard>

          <ProviderFiltersCard
            filters={filters}
            onFiltersChange={setFilters}
          />
        </div>

        {/* Provider Tiers */}
        <div className="providers-tiers">
          {(["subscription", "cheap", "free", "custom"] as ProviderTier[]).map(tier => (
            <TierSection
              key={tier}
              tier={tier}
              providers={providersByTier[tier] || []}
              onConnect={handleConnect}
              onTest={handleTest}
              onManage={handleManage}
              onEnable={handleEnable}
              getTestResult={getTestResult}
              isTestingProvider={isTestingProvider}
            />
          ))}
        </div>

        {filteredProviders.length === 0 && !loading && (
          <EmptyState
            title="No providers found"
            description="No providers match your current filters. Try adjusting your search or filter criteria."
            actionLabel="Clear Filters"
            onClick={() => {
              setFilters({});
              setSearchQuery("");
            }}
          />
        )}
      </div>
    </div>
  );
}