import React, { useState, useMemo, useEffect, useCallback } from "react";
import { updateProvider, deleteProvider, getProviderModels, addKiroModelAlias, deleteKiroModelAlias, testKiroModel, toggleProviderEnabled } from "../api/client";
import { SurfaceCard } from "../components/SurfaceCard";
import { StatusBadge } from "../components/StatusBadge";
import { RefreshButton } from "../components/RefreshButton";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { AccountManagementModal } from "../components/accounts/AccountManagementModal";
import { HealthDashboard, HealthStatusIndicator } from "../components/health/HealthDashboard";
import {
  ProvidersIcon,
  AlertIcon,
  PlusIcon,
  TestIcon,
  TrashIcon
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

// Inline icons used by the 9router-style detail layout (kept local to this screen).
function ChevronUpMini(props: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M4 10l4-4 4 4" />
    </svg>
  );
}

function ChevronDownMini(props: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function LockMini(props: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

function PencilMini(props: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10z" />
    </svg>
  );
}

function CopyMini(props: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M3.5 10.5h-1A1 1 0 0 1 1.5 9.5v-7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

function ProviderDetailHeader({ provider, onToggleEnabled }: { provider: Provider; onToggleEnabled?: (enabled: boolean) => void }) {
  const catalogEntry = getProviderById(provider.id);
  const connectionCount = provider.accounts?.length || 0;
  const isEnabled = provider.enabled !== false;

  return (
    <div className="pd9-header">
      <button className="pd9-back" onClick={() => (window.location.hash = "#/providers")}>
        ← Back to Providers
      </button>

      <div className="pd9-title-row">
        <div className="pd9-icon-tile">
          <ProvidersIcon />
        </div>
        <div className="pd9-title-main">
          <div className="pd9-title-line">
            <h1 className="pd9-title">{provider.displayName}</h1>
            {onToggleEnabled && (
              <button
                type="button"
                className={`pd9-switch ${isEnabled ? "on" : ""}`}
                role="switch"
                aria-checked={isEnabled}
                onClick={() => onToggleEnabled(!isEnabled)}
                title={isEnabled ? "Disable provider" : "Enable provider"}
              >
                <span className="pd9-switch-knob" />
              </button>
            )}
            {!isEnabled && (
              <StatusBadge variant="neutral" size="sm">Disabled</StatusBadge>
            )}
            {catalogEntry?.signupUrl && (
              <a
                href={catalogEntry.signupUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="pd9-signup-link"
              >
                Sign up / Learn more ↗
              </a>
            )}
          </div>
          <div className="pd9-connection-count">
            {connectionCount} connection{connectionCount !== 1 ? 's' : ''}
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

interface ConnectionsCardProps {
  provider: Provider;
  accounts: any[];
  accountsLoading: boolean;
  accountsError: string | null;
  onAddAccount: () => void;
  onEditAccount: (account: any) => void;
  onTestAccount: (accountId: string) => void;
  onUpdateRoutingMode: (accountId: string, mode: ProviderAccountRoutingMode) => void;
  onReorderAccount?: (index: number, direction: "up" | "down") => void;
  onDeleteAccount: (accountId: string) => void;
  getTestResult: (accountId: string) => any;
  isTestingAccount: (accountId: string) => boolean;
}

function ConnectionsCard({
  provider,
  accounts,
  accountsLoading,
  accountsError,
  onAddAccount,
  onEditAccount,
  onTestAccount,
  onUpdateRoutingMode,
  onReorderAccount,
  onDeleteAccount,
  getTestResult,
  isTestingAccount,
}: ConnectionsCardProps) {
  // Round Robin toggle reflects the routing mode of the connections. When ON,
  // requests are distributed round-robin; when OFF, the proxy sticks to the
  // first available account. Backed by `onUpdateRoutingMode` where supported.
  const initialRoundRobin = accounts.some(acc => acc.routingMode === "round_robin");
  const [roundRobin, setRoundRobin] = useState(initialRoundRobin);
  const [stickyValue, setStickyValue] = useState(1);

  useEffect(() => {
    setRoundRobin(accounts.some(acc => acc.routingMode === "round_robin"));
  }, [accounts]);

  const isTestingAny = accounts.some(acc => isTestingAccount(acc.id));

  const handleTestOneByOne = async () => {
    for (const account of accounts) {
      onTestAccount(account.id);
    }
  };

  const handleToggleRoundRobin = () => {
    const next = !roundRobin;
    setRoundRobin(next);
    const mode: ProviderAccountRoutingMode = next ? "round_robin" : "sticky";
    accounts.forEach(account => onUpdateRoutingMode(account.id, mode));
  };

  const statusLabel = (status: string) => {
    if (status === "connected") return "active";
    return status;
  };

  return (
    <SurfaceCard
      title="Connections"
      actions={
        <div className="pd9-conn-controls">
          <button
            className="pd9-test-onebyone"
            onClick={handleTestOneByOne}
            disabled={isTestingAny || accounts.length === 0}
          >
            <TestIcon className="pd9-btn-icon" />
            {isTestingAny ? "Testing..." : "Test Connection One-by-One"}
          </button>
          <div className="pd9-rotation-control">
            <span className="pd9-rotation-label">Round Robin</span>
            <button
              type="button"
              className={`pd9-switch ${roundRobin ? "on" : ""}`}
              role="switch"
              aria-checked={roundRobin}
              onClick={handleToggleRoundRobin}
              disabled={accounts.length === 0}
              title="Toggle round-robin rotation across connections"
            >
              <span className="pd9-switch-knob" />
            </button>
          </div>
          <div className="pd9-sticky-control" title="Sticky session count (visual only)">
            <span className="pd9-rotation-label">Sticky:</span>
            <input
              type="number"
              min={1}
              className="pd9-sticky-input"
              value={stickyValue}
              onChange={(e) => setStickyValue(Math.max(1, parseInt(e.target.value, 10) || 1))}
              disabled={!roundRobin}
            />
          </div>
        </div>
      }
    >
      {accountsError && (
        <div className="connections-error" style={{ color: "var(--danger)", padding: "var(--space-2) 0" }}>
          Error loading accounts: {accountsError}
        </div>
      )}

      <div className="pd9-conn-list">
        {accounts.map((account, index) => {
          const isTesting = isTestingAccount(account.id);
          const testResult = getTestResult(account.id);
          const enabled = account.status !== "disabled";
          const canReorder = Boolean(onReorderAccount) && accounts.length > 1;

          return (
            <div key={account.id} className={`pd9-conn-row ${enabled ? "" : "is-disabled"}`}>
              <div className="pd9-conn-reorder">
                <button
                  className="pd9-reorder-btn"
                  aria-label="Move up"
                  disabled={!canReorder || index === 0}
                  onClick={() => onReorderAccount && onReorderAccount(index, "up")}
                >
                  <ChevronUpMini />
                </button>
                <button
                  className="pd9-reorder-btn"
                  aria-label="Move down"
                  disabled={!canReorder || index === accounts.length - 1}
                  onClick={() => onReorderAccount && onReorderAccount(index, "down")}
                >
                  <ChevronDownMini />
                </button>
              </div>

              <div className="pd9-conn-lock" title="This connection is managed securely">
                <LockMini />
              </div>

              <div className="pd9-conn-main">
                <div className="pd9-conn-label">{account.label}</div>
                <div className="pd9-conn-badges">
                  <span className={`pd9-status-dot ${account.status === "connected" ? "ok" : "bad"}`} />
                  <span className="pd9-status-text">{statusLabel(account.status)}</span>
                  <span className="pd9-conn-chip">{AUTH_TYPES[account.authType]?.label || account.authType}</span>
                  <span className="pd9-conn-index">#{index + 1}</span>
                </div>
                {testResult && (
                  <div className={`pd9-conn-testresult ${testResult.status === "success" ? "ok" : "bad"}`}>
                    {testResult.status === "success" ? "✓" : "✕"} {analyzeTestResult(testResult).summary}
                    {testResult.latencyMs ? ` • ${testResult.latencyMs}ms` : ""}
                  </div>
                )}
              </div>

              <div className="pd9-conn-actions">
                <button
                  className="pd9-icon-btn"
                  title="Test connection"
                  onClick={() => onTestAccount(account.id)}
                  disabled={isTesting}
                >
                  <TestIcon className="pd9-action-icon" />
                </button>
                <button
                  className="pd9-icon-btn"
                  title="Edit connection"
                  onClick={() => onEditAccount(account)}
                >
                  <PencilMini />
                </button>
                <button
                  className="pd9-icon-btn danger"
                  title="Delete connection"
                  onClick={() => {
                    if (window.confirm(`Are you sure you want to remove account connection "${account.label}"?`)) {
                      onDeleteAccount(account.id);
                    }
                  }}
                >
                  <TrashIcon className="pd9-action-icon" />
                </button>
                <button
                  type="button"
                  className={`pd9-switch sm ${enabled ? "on" : ""}`}
                  role="switch"
                  aria-checked={enabled}
                  title={enabled ? "Disable connection" : "Enable connection"}
                  onClick={() => onUpdateRoutingMode(account.id, enabled ? "disabled" : "round_robin")}
                >
                  <span className="pd9-switch-knob" />
                </button>
              </div>
            </div>
          );
        })}

        {accounts.length === 0 && !accountsLoading && (
          <EmptyState
            title="No accounts connected"
            description="Connect an account to start using this provider."
            actionLabel="Add Account"
            onClick={onAddAccount}
          />
        )}

        <button className="pd9-add-btn" onClick={onAddAccount}>
          <PlusIcon className="pd9-btn-icon" />
          Add
        </button>
      </div>
    </SurfaceCard>
  );
}

function ModelsCard({ models, loading, onRefresh, isKiro }: { models: ProviderModel[]; loading?: boolean; onRefresh?: () => void; isKiro?: boolean }) {
  const enabledModels = models.filter(m => m.enabled);
  const [copiedModel, setCopiedModel] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAlias, setNewAlias] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Map<string, { ok: boolean; latencyMs?: number; error?: string }>>(new Map());

  const copyModelId = (modelId: string) => {
    navigator.clipboard.writeText(modelId);
    setCopiedModel(modelId);
    setTimeout(() => setCopiedModel(null), 1500);
  };

  const handleTestModel = async (modelId: string) => {
    if (testingModel) return;
    setTestingModel(modelId);
    try {
      const result = await testKiroModel(modelId);
      setTestResults(prev => new Map(prev).set(modelId, {
        ok: result.ok,
        latencyMs: result.latencyMs,
        error: result.error
      }));
    } catch (err) {
      setTestResults(prev => new Map(prev).set(modelId, {
        ok: false,
        error: err instanceof Error ? err.message : 'Test failed'
      }));
    } finally {
      setTestingModel(null);
    }
  };

  const handleAddAlias = async () => {
    if (!newAlias.trim() || !newTarget.trim()) return;
    setAddSaving(true);
    setAddError(null);
    try {
      await addKiroModelAlias(newAlias.trim(), newTarget.trim());
      setNewAlias('');
      setNewTarget('');
      setShowAddForm(false);
      if (onRefresh) onRefresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add alias');
    } finally {
      setAddSaving(false);
    }
  };

  const handleDeleteAlias = async (alias: string) => {
    if (!window.confirm(`Remove model alias "${alias}"?`)) return;
    try {
      await deleteKiroModelAlias(alias);
      if (onRefresh) onRefresh();
    } catch (err) {
      console.error('Failed to delete alias:', err);
    }
  };

  return (
    <SurfaceCard
      title="Available Models"
      description={loading ? "Loading models..." : `${enabledModels.length} enabled • ${models.length} total`}
      actions={
        <div className="pd9-models-actions">
          {onRefresh && (
            <button className="pd9-test-onebyone" onClick={onRefresh} disabled={loading}>
              {loading ? "Loading..." : "⟳ Fetch Models"}
            </button>
          )}
        </div>
      }
    >
      {loading ? (
        <div style={{ padding: "var(--space-6)", textAlign: "center", color: "var(--text-secondary)" }}>
          Loading available models...
        </div>
      ) : (
        <div className="pd9-models-grid">
          {models.map(model => {
            const result = testResults.get(model.id);
            const isTesting = testingModel === model.id;
            const borderStyle = result
              ? result.ok ? '2px solid var(--success, #22c55e)' : '2px solid var(--danger, #ef4444)'
              : undefined;

            return (
              <div key={model.id} className="pd9-model-pill" title={model.id} style={borderStyle ? { border: borderStyle } : undefined}>
                <span className="pd9-model-icon">
                  {result ? (result.ok ? "✓" : "✕") : (SERVICE_KINDS[model.serviceKind]?.icon || "🧠")}
                </span>
                <span className="pd9-model-id">{model.id}</span>
                {result?.ok && result.latencyMs && (
                  <span style={{ fontSize: '0.65rem', color: 'var(--success, #22c55e)' }}>{result.latencyMs}ms</span>
                )}
                {result && !result.ok && (
                  <span style={{ fontSize: '0.65rem', color: 'var(--danger)' }} title={result.error}>✕</span>
                )}
                {isKiro && (
                  <button
                    className="pd9-model-copy"
                    onClick={() => handleTestModel(model.id)}
                    title="Test model"
                    disabled={isTesting}
                    style={isTesting ? { animation: 'spin 1s linear infinite' } : undefined}
                  >
                    {isTesting ? "⏳" : "🧪"}
                  </button>
                )}
                <button
                  className="pd9-model-copy"
                  onClick={() => copyModelId(model.id)}
                  title="Copy model ID"
                >
                  {copiedModel === model.id ? "✓" : <CopyMini />}
                </button>
                {isKiro && (
                  <button
                    className="pd9-model-copy"
                    onClick={() => handleDeleteAlias(model.id)}
                    title="Remove alias"
                    style={{ color: 'var(--danger)' }}
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}

          {showAddForm ? (
            <div className="pd9-add-model-form">
              <input
                type="text"
                className="form-input"
                placeholder="Alias (e.g. claude-4)"
                value={newAlias}
                onChange={(e) => setNewAlias(e.target.value)}
                disabled={addSaving}
              />
              <input
                type="text"
                className="form-input"
                placeholder="Target (e.g. claude-sonnet-4)"
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
                disabled={addSaving}
              />
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button className="button-primary" onClick={handleAddAlias} disabled={!newAlias.trim() || !newTarget.trim() || addSaving}>
                  {addSaving ? '...' : 'Add'}
                </button>
                <button className="button-secondary" onClick={() => { setShowAddForm(false); setAddError(null); }}>
                  Cancel
                </button>
              </div>
              {addError && <span style={{ color: 'var(--danger)', fontSize: '0.75rem' }}>{addError}</span>}
            </div>
          ) : (
            <button className="pd9-add-model" onClick={() => setShowAddForm(true)}>
              <PlusIcon className="pd9-btn-icon" />
              Add Model Alias
            </button>
          )}

          {models.length === 0 && !showAddForm && (
            <div className="pd9-models-empty">
              No models available yet.
            </div>
          )}
        </div>
      )}
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

  // Always fetch accounts — fetchProviderAccounts handles missing providers gracefully
  const {
    accounts,
    loading: accountsLoading,
    error: accountsError,
    stats: accountStats,
    refresh: refreshAccounts
  } = useProviderAccounts(providerId || null);

  // Local ordering for the connections list so reorder arrows give immediate
  // feedback (mirrors 9router). Synced whenever the source accounts change.
  const [orderedAccounts, setOrderedAccounts] = useState<any[]>([]);
  useEffect(() => {
    setOrderedAccounts(accounts);
  }, [accounts]);

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

  // Local states for editing custom providers
  const [editName, setEditName] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [editTransportMode, setEditTransportMode] = useState<"responses" | "chat_completions">("chat_completions");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // States for fetching dynamic models list
  const [dynamicModels, setDynamicModels] = useState<ProviderModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  useEffect(() => {
    if (provider && provider.tier === "custom") {
      setEditName(provider.displayName || "");
      setEditBaseUrl(provider.baseUrl || "");
      setEditTransportMode(provider.capabilities?.transportMode === "responses" ? "responses" : "chat_completions");
    }
  }, [provider]);

  const fetchDynamicModels = useCallback(async () => {
    if (!providerId) return;
    try {
      setModelsLoading(true);
      // For Kiro catalog entries, use 'account-kiro' as the backend provider ID
      const isKiro = providerId === 'kiro-ide' || providerId === 'kiro-free' || providerId.startsWith('kiro-');
      const modelProviderId = isKiro ? 'account-kiro' : providerId;
      const res = await getProviderModels(modelProviderId);
      if (res && Array.isArray(res.models)) {
        setDynamicModels(res.models.map((m: any) => {
          const modelId = typeof m === 'string' ? m : m.id || '';
          return {
            id: modelId,
            displayName: modelId.split('/').pop() || modelId,
            enabled: true,
            serviceKind: 'chat',
            supportsStreaming: true,
            supportsTools: true,
            supportsVision: modelId.includes('vision') || modelId.includes('gpt-4o'),
            supportsJsonMode: true,
          };
        }));
      } else {
        setDynamicModels([]);
      }
    } catch (err) {
      setDynamicModels([]);
    } finally {
      setModelsLoading(false);
    }
  }, [providerId]);

  useEffect(() => {
    if (providerId) {
      fetchDynamicModels();
    }
  }, [providerId, fetchDynamicModels]);

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
    refreshProvider();
  };

  const handleReorderAccount = (index: number, direction: "up" | "down") => {
    setOrderedAccounts(prev => {
      const next = [...prev];
      const target = direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleUpdateCustomProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!providerId) return;
    setSaveError(null);
    setSaveSuccess(false);

    if (!editName.trim()) {
      setSaveError("Name is required");
      return;
    }
    if (!editBaseUrl.trim()) {
      setSaveError("Base URL is required");
      return;
    }
    try {
      new URL(editBaseUrl);
    } catch {
      setSaveError("Base URL must be a valid URL");
      return;
    }

    try {
      setIsSaving(true);
      await updateProvider(providerId, {
        name: editName.trim(),
        baseUrl: editBaseUrl.trim(),
        authMode: provider?.preferredAuthType || "api_key",
        providerApiKeys: provider?.providerApiKeys || [],
        capabilities: {
          ...provider?.capabilities,
          transportMode: editTransportMode,
        }
      });
      setSaveSuccess(true);
      await refreshProvider();
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to update provider settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCustomProvider = async () => {
    if (!providerId || !provider) return;
    if (!window.confirm(`Are you sure you want to permanently delete custom provider "${provider.displayName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteProvider(providerId);
      window.location.hash = "#/providers";
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete provider");
    }
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
    <div className="screen-stack pd9-screen">
      <div className="provider-detail-layout pd9-layout">
        <ProviderDetailHeader provider={provider} onToggleEnabled={async (enabled) => {
          try {
            await toggleProviderEnabled(providerId!, enabled);
            await refreshProvider();
          } catch (err) {
            console.error('Failed to toggle provider:', err);
          }
        }} />

        <ProviderRiskNotice provider={provider} />

        <div className="provider-detail-grid pd9-grid">
          <div className="provider-detail-main">
            {provider.tier === "custom" && (
              <SurfaceCard 
                title="Configuration" 
                description="Edit endpoint settings and transport mode for this custom provider"
                actions={
                  <button 
                    className="button-danger" 
                    onClick={handleDeleteCustomProvider}
                    style={{ fontSize: "var(--font-xs)", padding: "4px var(--space-3)" }}
                  >
                    🗑 Delete Provider
                  </button>
                }
              >
                <form onSubmit={handleUpdateCustomProvider} className="custom-provider-config-form" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
                  {saveError && (
                    <div className="modal-error" style={{ color: "var(--danger)", padding: "var(--space-2) 0" }}>
                      ⚠️ {saveError}
                    </div>
                  )}
                  {saveSuccess && (
                    <div className="modal-success" style={{ color: "var(--success)", padding: "var(--space-2) 0", fontWeight: "600" }}>
                      ✓ Configuration updated successfully
                    </div>
                  )}
                  
                  <div className="form-group" style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                    <label htmlFor="custom-name" style={{ fontSize: "var(--font-xs)", fontWeight: "600", color: "var(--text-secondary)" }}>Provider Name</label>
                    <input
                      id="custom-name"
                      type="text"
                      className="search-input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      required
                      style={{
                        padding: "8px 12px",
                        fontSize: "var(--font-sm)",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--line)",
                        background: "var(--surface-input)",
                        color: "var(--text-primary)",
                        width: "100%",
                      }}
                    />
                  </div>

                  <div className="form-group" style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                    <label htmlFor="custom-url" style={{ fontSize: "var(--font-xs)", fontWeight: "600", color: "var(--text-secondary)" }}>Base URL / Endpoint</label>
                    <input
                      id="custom-url"
                      type="url"
                      className="search-input"
                      value={editBaseUrl}
                      onChange={(e) => setEditBaseUrl(e.target.value)}
                      placeholder="https://api.openai.com/v1"
                      required
                      style={{
                        padding: "8px 12px",
                        fontSize: "var(--font-sm)",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--line)",
                        background: "var(--surface-input)",
                        color: "var(--text-primary)",
                        width: "100%",
                      }}
                    />
                  </div>

                  <div className="form-group" style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                    <label htmlFor="custom-transport" style={{ fontSize: "var(--font-xs)", fontWeight: "600", color: "var(--text-secondary)" }}>Transport Mode</label>
                    <select
                      id="custom-transport"
                      className="search-input"
                      value={editTransportMode}
                      onChange={(e) => setEditTransportMode(e.target.value as "responses" | "chat_completions")}
                      style={{
                        padding: "8px 12px",
                        fontSize: "var(--font-sm)",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--line)",
                        background: "var(--surface-input)",
                        color: "var(--text-primary)",
                        width: "100%",
                      }}
                    >
                      <option value="responses">Responses API (/responses)</option>
                      <option value="chat_completions">Chat Completions (/chat/completions)</option>
                    </select>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--space-2)" }}>
                    <button 
                      type="submit" 
                      className="button-primary"
                      disabled={isSaving}
                    >
                      {isSaving ? "Saving..." : "Save Configuration"}
                    </button>
                  </div>
                </form>
              </SurfaceCard>
            )}

            {provider.tier !== "custom" && provider.configured && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-3)' }}>
                <button
                  className="button-danger"
                  onClick={handleDeleteCustomProvider}
                  style={{ fontSize: "var(--font-xs)", padding: "4px var(--space-3)" }}
                >
                  🗑 Remove Provider
                </button>
              </div>
            )}

            <ConnectionsCard
              provider={provider}
              accounts={orderedAccounts}
              accountsLoading={accountsLoading}
              accountsError={accountsError}
              onAddAccount={handleAddAccount}
              onEditAccount={handleEditAccount}
              onTestAccount={handleTestAccount}
              onUpdateRoutingMode={handleUpdateRoutingMode}
              onReorderAccount={handleReorderAccount}
              onDeleteAccount={handleDeleteAccount}
              getTestResult={getTestResult}
              isTestingAccount={isTestingAccount}
            />
            <ModelsCard models={dynamicModels} loading={modelsLoading} onRefresh={fetchDynamicModels} isKiro={providerId === 'kiro-ide' || providerId === 'kiro-free' || providerId?.startsWith('kiro-') || false} />
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