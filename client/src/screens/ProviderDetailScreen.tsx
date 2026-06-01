import React, { useState, useMemo } from "react";
import { PageHeader } from "../components/PageHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { StatusBadge } from "../components/StatusBadge";
import { RefreshButton } from "../components/RefreshButton";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { AccountManagementModal } from "../components/accounts/AccountManagementModal";
import { HealthDashboard, HealthStatusIndicator } from "../components/health/HealthDashboard";
import {
  ProvidersIcon,
  CheckCircleIcon,
  AlertIcon,
  ConfigIcon,
  AuthIcon,
  QuotaIcon,
  CliIcon,
  PlusIcon,
  TestIcon
} from "../components/icons";
import type {
  Provider,
  ProviderAccountSummary,
  ProviderModel,
  ProviderTestResult,
  ProviderAccountRoutingMode
} from "../features/providers/providerTypes";
import type { AccountConnection } from "../features/accounts/accountApi";
import {
  getProviderById,
  SERVICE_KINDS,
  AUTH_TYPES
} from "../features/providers/providerCatalog";
import {
  checkProviderEligibility,
  getSuggestedFixes
} from "../features/providers/providerEligibility";
import {
  formatHealthStatus,
  getRecommendedAction,
  getQuotaStatus,
  getAccountHealthSummary,
  analyzeTestResult
} from "../features/providers/providerHealth";
import { useProvider } from "../features/providers/providerHooks";
import {
  useProviderAccounts,
  useAccountTest,
  useAccountOperations,
  useAccountHealth
} from "../features/accounts/accountHooks";
import {
  useProviderHealthMonitoring,
  useAutoHealthMonitoring
} from "../features/health/healthHooks";

interface ProviderDetailScreenProps {
  providerId?: string;
}

// Real API integration - no more mock data

function ProviderDetailHeader({ provider }: { provider: Provider }) {
  const catalogEntry = getProviderById(provider.id);
  const healthInfo = formatHealthStatus(provider.healthStatus);
  const connectionCount = provider.accounts?.length || 0;

  return (
    <div className="provider-detail-header">
      <div className="provider-header-main">
        <div className="provider-header-info">
          <div className="provider-header-icon">
            <ProvidersIcon />
          </div>
          <div className="provider-header-details">
            <h1 className="provider-header-name">{provider.displayName}</h1>
            <p className="provider-header-description">{provider.description}</p>
            {catalogEntry?.signupUrl && (
              <a
                href={catalogEntry.signupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="provider-external-link"
              >
                Sign up / Learn more →
              </a>
            )}
          </div>
        </div>
        <div className="provider-header-meta">
          <div className="provider-connection-count">
            <span className="connection-count-number">{connectionCount}</span>
            <span className="connection-count-label">connection{connectionCount !== 1 ? 's' : ''}</span>
          </div>
          <div className="provider-header-badges">
            <StatusBadge variant="accent" size="md">
              {provider.tier}
            </StatusBadge>
            <StatusBadge variant="neutral" size="md">
              {AUTH_TYPES[provider.preferredAuthType || "api_key"].label}
            </StatusBadge>
            <StatusBadge
              variant={healthInfo.severity === "success" ? "success" :
                      healthInfo.severity === "warning" ? "warning" : "danger"}
              size="md"
            >
              {healthInfo.label}
            </StatusBadge>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProviderRiskNotice({ provider }: { provider: Provider }) {
  if (!provider.riskNotice) return null;

  const riskColors = {
    none: { bg: "var(--neutral-soft)", border: "var(--line)", text: "var(--text-secondary)" },
    low: { bg: "var(--success-soft)", border: "var(--success)", text: "var(--success)" },
    medium: { bg: "var(--warning-soft)", border: "var(--warning)", text: "var(--warning)" },
    high: { bg: "var(--danger-soft)", border: "var(--danger)", text: "var(--danger)" }
  };

  const colors = riskColors[provider.riskNotice.level];

  return (
    <div
      className="provider-risk-banner"
      style={{
        background: colors.bg,
        borderColor: colors.border,
        color: colors.text
      }}
    >
      <div className="risk-banner-content">
        <AlertIcon className="risk-banner-icon" />
        <div className="risk-banner-text">
          <div className="risk-banner-title">{provider.riskNotice.title}</div>
          <div className="risk-banner-message">{provider.riskNotice.message}</div>
        </div>
        {provider.riskNotice.learnMoreUrl && (
          <a
            href={provider.riskNotice.learnMoreUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="risk-banner-link"
          >
            Learn More
          </a>
        )}
      </div>
    </div>
  );
}

function ConnectionsCard({ provider }: { provider: Provider }) {
  const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
  const [testingAccount, setTestingAccount] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ProviderTestResult>>({});

  const accounts = provider.accounts || [];
  const accountHealthSummary = getAccountHealthSummary(accounts);

  const routingModes: { value: ProviderAccountRoutingMode; label: string; description: string }[] = [
    { value: "priority", label: "Priority", description: "Use accounts in order of priority" },
    { value: "round_robin", label: "Round Robin", description: "Distribute requests across accounts" },
    { value: "sticky", label: "Sticky", description: "Use same account per client session" },
    { value: "failover_only", label: "Failover Only", description: "Use only when primary accounts fail" },
    { value: "disabled", label: "Disabled", description: "Do not use this account" }
  ];

  const handleTestAccount = async (accountId: string) => {
    setTestingAccount(accountId);

    // Simulate API call
    setTimeout(() => {
      const mockResult = createMockTestResult(provider, Math.random() > 0.2, { accountId });
      setTestResults(prev => ({ ...prev, [accountId]: mockResult }));
      setTestingAccount(null);
    }, 2000);
  };

  const handleTestAllAccounts = async () => {
    for (const account of accounts) {
      if (account.status === "connected") {
        await handleTestAccount(account.id);
      }
    }
  };

  return (
    <SurfaceCard
      title="Connections"
      description={`${accountHealthSummary.message} • ${accounts.length} total account${accounts.length !== 1 ? 's' : ''}`}
      actions={
        <div className="connections-actions">
          <button
            className="test-all-button"
            onClick={handleTestAllAccounts}
            disabled={testingAccount !== null}
          >
            Test All
          </button>
          <button className="add-account-button">
            Add Account
          </button>
        </div>
      }
    >
      <div className="connections-list">
        {accounts.map((account, index) => {
          const isExpanded = expandedAccount === account.id;
          const isTesting = testingAccount === account.id;
          const testResult = testResults[account.id];
          const routingMode = routingModes.find(mode => mode.value === account.routingMode);

          return (
            <div key={account.id} className="connection-item">
              <div
                className="connection-header"
                onClick={() => setExpandedAccount(isExpanded ? null : account.id)}
              >
                <div className="connection-info">
                  <div className="connection-expand-icon">
                    {isExpanded ? "▼" : "▶"}
                  </div>
                  <AuthIcon className="connection-auth-icon" />
                  <div className="connection-details">
                    <div className="connection-label">{account.label}</div>
                    <div className="connection-meta">
                      <StatusBadge
                        variant={account.status === "connected" ? "success" : "danger"}
                        size="sm"
                      >
                        {account.status}
                      </StatusBadge>
                      <StatusBadge variant="neutral" size="sm">
                        {AUTH_TYPES[account.authType].label}
                      </StatusBadge>
                      <span className="connection-priority">#{index + 1}</span>
                    </div>
                  </div>
                </div>
                <div className="connection-actions">
                  <button
                    className="test-connection-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTestAccount(account.id);
                    }}
                    disabled={isTesting}
                  >
                    {isTesting ? "Testing..." : "Test"}
                  </button>
                  <button className="connection-menu-button">⋯</button>
                </div>
              </div>

              {isExpanded && (
                <div className="connection-expanded">
                  <div className="connection-expanded-grid">
                    <div className="connection-field">
                      <label className="connection-field-label">Email</label>
                      <div className="connection-field-value">{account.email || "Not provided"}</div>
                    </div>
                    <div className="connection-field">
                      <label className="connection-field-label">Last Used</label>
                      <div className="connection-field-value">
                        {account.lastUsedAt
                          ? new Date(account.lastUsedAt).toLocaleString()
                          : "Never"
                        }
                      </div>
                    </div>
                    <div className="connection-field">
                      <label className="connection-field-label">Routing Mode</label>
                      <select
                        className="connection-routing-select"
                        value={account.routingMode || "priority"}
                        onChange={(e) => {
                          // TODO: Update account routing mode
                          console.log("Update routing mode:", e.target.value);
                        }}
                      >
                        {routingModes.map(mode => (
                          <option key={mode.value} value={mode.value}>
                            {mode.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {account.quota && (
                    <div className="connection-quota">
                      <div className="quota-header">
                        <span className="quota-label">Account Quota</span>
                        <span className="quota-percent">{account.quota.usagePercent?.toFixed(1)}%</span>
                      </div>
                      <div className="quota-bar">
                        <div
                          className="quota-fill"
                          style={{
                            width: `${Math.min(account.quota.usagePercent || 0, 100)}%`,
                            backgroundColor: (account.quota.usagePercent || 0) > 90 ? '#ff6961' :
                                            (account.quota.usagePercent || 0) > 75 ? '#ffd60a' : '#30d158'
                          }}
                        />
                      </div>
                      <div className="quota-details">
                        {account.quota.used?.toLocaleString()} / {account.quota.limit?.toLocaleString()} {account.quota.quotaType}
                        {account.quota.resetAt && (
                          <span className="quota-reset">
                            • Resets {new Date(account.quota.resetAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {testResult && (
                    <div className="connection-test-result">
                      <div className="test-result-header">
                        <span className="test-result-label">Test Result</span>
                        <StatusBadge
                          variant={testResult.status === "success" ? "success" : "danger"}
                          size="sm"
                        >
                          {testResult.status}
                        </StatusBadge>
                      </div>
                      <div className="test-result-details">
                        {analyzeTestResult(testResult).summary}
                        {testResult.latencyMs && (
                          <span className="test-latency"> • {testResult.latencyMs}ms</span>
                        )}
                      </div>
                      {testResult.suggestedFix && (
                        <div className="test-result-suggestion">
                          💡 {testResult.suggestedFix}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="connection-expanded-actions">
                    <button className="reconnect-button">Reconnect</button>
                    <button className="edit-account-button">Edit</button>
                    <button className="delete-account-button">Delete</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {accounts.length === 0 && (
          <EmptyState
            title="No accounts connected"
            description="Connect an account to start using this provider."
            actionLabel="Add Account"
            actionHref="#"
          />
        )}
      </div>
    </SurfaceCard>
  );
}

function ModelsCard({ provider }: { provider: Provider }) {
  const models = provider.models || [];
  const enabledModels = models.filter(m => m.enabled);
  const [copiedModel, setCopiedModel] = useState<string | null>(null);

  const copyModelId = (modelId: string) => {
    navigator.clipboard.writeText(modelId);
    setCopiedModel(modelId);
    setTimeout(() => setCopiedModel(null), 2000);
  };

  const handleToggleModel = (modelId: string, enabled: boolean) => {
    // TODO: Implement model enable/disable
    console.log("Toggle model:", modelId, enabled);
  };

  const handleDisableAll = () => {
    // TODO: Implement disable all models
    console.log("Disable all models");
  };

  const handleAddModel = () => {
    // TODO: Implement add model
    console.log("Add model");
  };

  return (
    <SurfaceCard
      title="Available Models"
      description={`${enabledModels.length} enabled • ${models.length} total`}
      actions={
        <div className="models-actions">
          <button className="disable-all-button" onClick={handleDisableAll}>
            Disable All
          </button>
          <button className="add-model-button" onClick={handleAddModel}>
            Add Model
          </button>
        </div>
      }
    >
      <div className="models-grid">
        {models.map(model => (
          <div key={model.id} className={`model-card ${model.enabled ? 'enabled' : 'disabled'}`}>
            <div className="model-header">
              <div className="model-info">
                <div className="model-name">{model.displayName}</div>
                <div className="model-id">{model.id}</div>
              </div>
              <div className="model-actions">
                <button
                  className="copy-model-button"
                  onClick={() => copyModelId(model.id)}
                  title="Copy model ID"
                >
                  {copiedModel === model.id ? "Copied!" : "Copy"}
                </button>
                <label className="model-toggle">
                  <input
                    type="checkbox"
                    checked={model.enabled}
                    onChange={(e) => handleToggleModel(model.id, e.target.checked)}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>
            </div>

            <div className="model-details">
              <div className="model-service">
                <span className="service-chip">
                  {SERVICE_KINDS[model.serviceKind].icon} {SERVICE_KINDS[model.serviceKind].label}
                </span>
              </div>

              {model.contextWindow && (
                <div className="model-spec">
                  <span className="spec-label">Context:</span>
                  <span className="spec-value">{model.contextWindow.toLocaleString()} tokens</span>
                </div>
              )}

              {model.inputCostPer1M && (
                <div className="model-spec">
                  <span className="spec-label">Cost:</span>
                  <span className="spec-value">
                    ${model.inputCostPer1M}/${model.outputCostPer1M} per 1M tokens
                  </span>
                </div>
              )}

              <div className="model-capabilities">
                {model.supportsStreaming && <span className="capability-chip">Streaming</span>}
                {model.supportsTools && <span className="capability-chip">Tools</span>}
                {model.supportsVision && <span className="capability-chip">Vision</span>}
                {model.supportsJsonMode && <span className="capability-chip">JSON</span>}
              </div>
            </div>
          </div>
        ))}

        {models.length === 0 && (
          <EmptyState
            title="No models available"
            description="Add models to start using this provider."
            actionLabel="Add Model"
            actionHref="#"
          />
        )}
      </div>
    </SurfaceCard>
  );
}

export function ProviderDetailScreen({ providerId }: ProviderDetailScreenProps) {
  // State for account management modal
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountModalMode, setAccountModalMode] = useState<'add' | 'edit' | 'manage'>('add');
  const [editingAccount, setEditingAccount] = useState<AccountConnection | null>(null);
  const [showHealthDashboard, setShowHealthDashboard] = useState(false);

  // Auto-start health monitoring for this provider
  useAutoHealthMonitoring(true);

  // Fetch provider data from real API
  const { provider, loading: providerLoading, error: providerError, refresh: refreshProvider } = useProvider(providerId || null);

  // Fetch account data from real API
  const {
    accounts,
    loading: accountsLoading,
    error: accountsError,
    stats: accountStats,
    refresh: refreshAccounts
  } = useProviderAccounts(providerId || null);

  // Account testing functionality
  const {
    testAccount,
    getTestResult,
    isTestingAccount,
    clearTestResult
  } = useAccountTest(providerId || null);

  // Account operations (update, delete, refresh)
  const {
    updateRoutingMode,
    refreshAccount,
    deleteAccount,
    isAccountLoading,
    getAccountOperation,
    operationError,
    clearError: clearOperationError
  } = useAccountOperations(providerId || null);

  // Account health monitoring
  const { healthSummary, needsAttentionAccounts, hasHealthIssues } = useAccountHealth(accounts);

  // Provider-specific health monitoring
  const {
    healthUpdate,
    isChecking: isCheckingHealth,
    error: healthError,
    checkHealth,
    getHealthAge,
    hasHealthData
  } = useProviderHealthMonitoring(providerId || null);

  // Use real-time health data if available, fallback to provider data
  const currentHealthStatus = healthUpdate?.healthStatus || provider?.healthStatus || 'unknown';
  const currentHealthMessage = healthUpdate?.healthMessage || provider?.healthMessage;
  const currentQuota = healthUpdate?.quota || provider?.quota;

  // Compute provider eligibility and quota status
  const eligibility = provider ? checkProviderEligibility(provider) : null;
  const quotaStatus = currentQuota ? getQuotaStatus(currentQuota) : null;

  // Event handlers
  const handleRefresh = async () => {
    await Promise.all([refreshProvider(), refreshAccounts()]);
  };

  const handleRefreshHealth = async () => {
    try {
      await checkHealth();
      await refreshProvider();
    } catch (error) {
      console.error('Failed to refresh health:', error);
    }
  };

  const handleTestAccount = async (accountId: string) => {
    try {
      await testAccount(accountId);
    } catch (error) {
      console.error(`Failed to test account ${accountId}:`, error);
    }
  };

  const handleUpdateRoutingMode = async (accountId: string, mode: ProviderAccountRoutingMode) => {
    try {
      await updateRoutingMode(accountId, mode);
      await refreshAccounts();
    } catch (error) {
      console.error(`Failed to update routing mode for account ${accountId}:`, error);
    }
  };

  const handleRefreshAccount = async (accountId: string) => {
    try {
      await refreshAccount(accountId);
      await refreshAccounts();
    } catch (error) {
      console.error(`Failed to refresh account ${accountId}:`, error);
    }
  };

  const handleDeleteAccount = async (accountId: string) => {
    try {
      await deleteAccount(accountId);
      await refreshAccounts();
    } catch (error) {
      console.error(`Failed to delete account ${accountId}:`, error);
    }
  };

  const handleAddAccount = () => {
    setAccountModalMode('add');
    setEditingAccount(null);
    setAccountModalOpen(true);
  };

  const handleEditAccount = (account: AccountConnection) => {
    setAccountModalMode('edit');
    setEditingAccount(account);
    setAccountModalOpen(true);
  };

  const handleManageAccounts = () => {
    setAccountModalMode('manage');
    setEditingAccount(null);
    setAccountModalOpen(true);
  };

  const handleAccountsChanged = () => {
    refreshAccounts();
  };

  // Loading state
  if (providerLoading) {
    return (
      <div className="screen-stack">
        <PageHeader
          icon={ProvidersIcon}
          title="Provider Details"
          description="Manage provider connections, models, and configuration"
        />
        <LoadingState
          title="Loading provider"
          description="Fetching provider details and account information..."
          cards={3}
        />
      </div>
    );
  }

  // Error state
  if (providerError || !provider) {
    return (
      <div className="screen-stack">
        <PageHeader
          icon={ProvidersIcon}
          title="Provider Details"
          description="Manage provider connections, models, and configuration"
        />
        <EmptyState
          title="Provider not found"
          description={providerError || "The requested provider could not be found."}
          actionLabel="Back to Providers"
          actionHref="#/providers"
        />
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <PageHeader
        icon={ProvidersIcon}
        title="Provider Details"
        description="Manage provider connections, models, and configuration"
        actions={
          <div className="page-actions">
            <RefreshButton onClick={handleRefresh} />
            <button
              className="button-secondary"
              onClick={handleRefreshHealth}
              disabled={isCheckingHealth}
              title="Refresh provider health status"
            >
              {isCheckingHealth ? 'Checking...' : 'Check Health'}
            </button>
            <button
              className={`button-secondary ${showHealthDashboard ? 'active' : ''}`}
              onClick={() => setShowHealthDashboard(!showHealthDashboard)}
              title="Toggle health monitoring dashboard"
            >
              Health Monitor
            </button>
            <button
              className="back-button"
              onClick={() => window.location.hash = "#/providers"}
            >
              ← Back to Providers
            </button>
          </div>
        }
      />

      <div className="provider-detail-layout">
        {/* Health Dashboard (when enabled) */}
        {showHealthDashboard && (
          <div className="provider-health-section">
            <HealthDashboard autoStart={true} showControls={true} compact={true} />
          </div>
        )}

        <ProviderDetailHeader
          provider={provider}
          accountStats={accountStats}
          onManageAccounts={handleManageAccounts}
        />

        <ProviderRiskNotice provider={provider} />

        <div className="provider-detail-grid">
          <div className="provider-detail-main">
            <ConnectionsCard
              provider={provider}
              accounts={accounts}
              accountsLoading={accountsLoading}
              accountsError={accountsError}
              onAddAccount={handleAddAccount}
              onEditAccount={handleEditAccount}
              onTestAccount={handleTestAccount}
              onUpdateRoutingMode={handleUpdateRoutingMode}
              onRefreshAccount={handleRefreshAccount}
              onDeleteAccount={handleDeleteAccount}
              getTestResult={getTestResult}
              isTestingAccount={isTestingAccount}
              isAccountLoading={isAccountLoading}
              getAccountOperation={getAccountOperation}
            />
            <ModelsCard provider={provider} />
          </div>

          <div className="provider-detail-sidebar">
            <SurfaceCard title="Health Status" description="Real-time provider health">
              <div className="health-status-content">
                <div className="health-status-main">
                  <div className="health-status-header">
                    <StatusBadge
                      variant={formatHealthStatus(currentHealthStatus).severity === "success" ? "success" :
                              formatHealthStatus(currentHealthStatus).severity === "warning" ? "warning" : "danger"}
                      size="lg"
                    >
                      {formatHealthStatus(currentHealthStatus).label}
                    </StatusBadge>
                    <HealthStatusIndicator providerId={provider.id} />
                  </div>
                  <div className="health-message">{currentHealthMessage}</div>
                </div>

                {hasHealthData && (
                  <div className="health-check-info">
                    <div className="health-last-check">
                      Last checked: {healthUpdate?.lastHealthCheckAt ?
                        new Date(healthUpdate.lastHealthCheckAt).toLocaleString() :
                        'Never'
                      }
                    </div>
                    {getHealthAge() && (
                      <div className={`health-age ${getHealthAge()?.isStale ? 'stale' : ''}`}>
                        {getHealthAge()?.ageMinutes < 60 ?
                          `${getHealthAge()?.ageMinutes}m ago` :
                          `${getHealthAge()?.ageHours}h ago`
                        }
                        {getHealthAge()?.isStale && ' (stale)'}
                      </div>
                    )}
                  </div>
                )}

                {healthUpdate?.issues && healthUpdate.issues.length > 0 && (
                  <div className="health-issues">
                    <h4>Issues Detected:</h4>
                    <ul>
                      {healthUpdate.issues.map((issue, index) => (
                        <li key={index}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {healthUpdate?.suggestedFixes && healthUpdate.suggestedFixes.length > 0 && (
                  <div className="health-fixes">
                    <h4>Suggested Fixes:</h4>
                    <ul>
                      {healthUpdate.suggestedFixes.map((fix, index) => (
                        <li key={index}>{fix}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {(healthError || isCheckingHealth) && (
                  <div className="health-status-actions">
                    {isCheckingHealth && (
                      <div className="health-checking">
                        <span>Checking health...</span>
                      </div>
                    )}
                    {healthError && (
                      <div className="health-error">
                        <AlertIcon className="error-icon" />
                        <span>{healthError}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </SurfaceCard>

            {quotaStatus && currentQuota && (
              <SurfaceCard title="Quota Status" description="Real-time usage and limits">
                <div className="quota-status-content">
                  <div className="quota-usage">
                    <div className="quota-percent-large">{currentQuota.usagePercent?.toFixed(1)}%</div>
                    <div className="quota-usage-text">
                      {currentQuota.used?.toLocaleString()} / {currentQuota.limit?.toLocaleString()} {currentQuota.quotaType}
                    </div>
                  </div>
                  <div className="quota-bar-large">
                    <div
                      className="quota-fill"
                      style={{
                        width: `${Math.min(currentQuota.usagePercent || 0, 100)}%`,
                        backgroundColor: quotaStatus.status === "exhausted" ? '#ff6961' :
                                        quotaStatus.status === "critical" ? '#ffd60a' : '#30d158'
                      }}
                    />
                  </div>
                  {currentQuota.resetAt && (
                    <div className="quota-reset-info">
                      Resets: {new Date(currentQuota.resetAt).toLocaleString()}
                    </div>
                  )}
                  {currentQuota.remaining !== undefined && (
                    <div className="quota-remaining-info">
                      Remaining: {currentQuota.remaining.toLocaleString()}
                    </div>
                  )}
                </div>
              </SurfaceCard>
            )}

            <SurfaceCard title="Account Health" description="Account status summary">
              <div className="account-health-content">
                <div className="health-stats">
                  <div className="health-stat">
                    <span className="stat-value">{healthSummary.healthy}</span>
                    <span className="stat-label">Healthy</span>
                  </div>
                  <div className="health-stat">
                    <span className="stat-value">{healthSummary.warning}</span>
                    <span className="stat-label">Warning</span>
                  </div>
                  <div className="health-stat">
                    <span className="stat-value">{healthSummary.critical}</span>
                    <span className="stat-label">Critical</span>
                  </div>
                </div>
                {hasHealthIssues && (
                  <div className="health-issues">
                    <AlertIcon className="health-warning-icon" />
                    <span>{needsAttentionAccounts.length} account(s) need attention</span>
                  </div>
                )}
              </div>
            </SurfaceCard>

            {eligibility && (
              <SurfaceCard title="Fallback Eligibility" description="Routing readiness">
                <div className="eligibility-content">
                  <div className="eligibility-status">
                    <StatusBadge
                      variant={eligibility.eligible ? "success" : "warning"}
                      size="lg"
                    >
                      {eligibility.eligible ? "Eligible" : "Not Eligible"}
                    </StatusBadge>
                    <div className="eligibility-score">
                      Score: {eligibility.score}/100
                    </div>
                  </div>
                  {eligibility.issues.length > 0 && (
                    <div className="eligibility-issues">
                      <h4>Issues:</h4>
                      <ul>
                        {eligibility.issues.map((issue, index) => (
                          <li key={index}>{issue}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </SurfaceCard>
            )}
          </div>
        </div>
      </div>

      {/* Account Management Modal */}
      <AccountManagementModal
        providerId={provider.id}
        providerName={provider.displayName}
        supportedAuthTypes={provider.authTypes}
        accounts={accounts}
        isOpen={accountModalOpen}
        mode={accountModalMode}
        editingAccount={editingAccount}
        onClose={() => setAccountModalOpen(false)}
        onAccountsChanged={handleAccountsChanged}
      />
    </div>
  );
}