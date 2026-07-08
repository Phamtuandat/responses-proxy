import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteKiroAccount,
  getKiroAccounts,
  getKiroStatus,
  importKiroAccounts,
  refreshKiroAccount,
  updateKiroAccount,
} from "../api/client";
import type { KiroAccount, KiroStatus, KiroImportResponse } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { InlineAlert } from "../components/InlineAlert";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { SurfaceCard } from "../components/SurfaceCard";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatDateTime, formatNumber } from "../lib/format";

type MutationFeedback = {
  variant: "success" | "error";
  message: string;
};

type KiroScreenProps = {
  accountId?: string;
};

type EditAccountData = {
  name: string;
  priority: number;
  isActive: boolean;
};

function getTokenStatusBadge(tokenStatus: KiroAccount['tokenStatus']) {
  switch (tokenStatus) {
    case 'valid':
      return { tone: 'success' as const, label: 'Valid' };
    case 'expiring':
      return { tone: 'warning' as const, label: 'Expiring' };
    case 'expired':
      return { tone: 'danger' as const, label: 'Expired' };
    case 'missing':
      return { tone: 'neutral' as const, label: 'Missing' };
    default:
      return { tone: 'neutral' as const, label: 'Unknown' };
  }
}

function formatTimeRemaining(expiresIn: number | null): string {
  if (expiresIn === null) return 'Unknown';
  if (expiresIn <= 0) return 'Expired';

  const hours = Math.floor(expiresIn / 3600);
  const minutes = Math.floor((expiresIn % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function KiroScreen({ accountId }: KiroScreenProps) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [confirmDeleteAccountId, setConfirmDeleteAccountId] = useState<string | null>(null);
  const [editAccountId, setEditAccountId] = useState<string | null>(null);
  const [editAccountData, setEditAccountData] = useState<EditAccountData | null>(null);
  const [feedback, setFeedback] = useState<MutationFeedback | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importSourcePath, setImportSourcePath] = useState("");
  const [importMethod, setImportMethod] = useState<"json" | "path">("json");
  const [importJsonContent, setImportJsonContent] = useState("");
  const [importShouldRefresh, setImportShouldRefresh] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [importResult, setImportResult] = useState<KiroImportResponse | null>(null);

  const validation = useMemo(() => {
    const val = importJsonContent.trim();
    if (!val) return null;

    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) {
        return {
          type: 'success',
          title: 'Valid JSON Array',
          message: `Detected ${parsed.length} Kiro account(s) in an array.`,
          canBeFormatted: true,
        };
      }
      if (parsed && typeof parsed === 'object') {
        const parsedObj = parsed as Record<string, unknown>;
        if (Array.isArray(parsedObj.providerConnections)) {
          const count = parsedObj.providerConnections.length;
          return {
            type: 'success',
            title: 'Valid 9router Backup JSON',
            message: `Detected 9router backup configuration containing ${count} provider connection(s).`,
            canBeFormatted: true,
          };
        }
        if ('refreshToken' in parsedObj || 'refresh_token' in parsedObj) {
          return {
            type: 'success',
            title: 'Valid Account JSON',
            message: `Detected 1 Kiro account details configuration.`,
            canBeFormatted: true,
          };
        }
        return {
          type: 'success',
          title: 'Valid JSON Object',
          message: `Detected generic JSON object.`,
          canBeFormatted: true,
        };
      }
    } catch (e) {
      if (val.length > 30 && !val.includes('{') && !val.includes('[')) {
        return {
          type: 'info',
          title: 'Plain Text Token',
          message: `Will be imported as a raw Kiro refresh token.`,
          canBeFormatted: false,
        };
      }
      return {
        type: 'error',
        title: 'Invalid JSON format',
        message: `Please paste valid JSON or a plain refresh token. Error: ${(e as Error).message}`,
        canBeFormatted: false,
      };
    }
    return null;
  }, [importJsonContent]);

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(importJsonContent);
      setImportJsonContent(JSON.stringify(parsed, null, 2));
    } catch {
      // ignore
    }
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const file = e.dataTransfer.files[0];
    if (file && (file.type === "application/json" || file.name.endsWith(".json"))) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setImportJsonContent(event.target.result as string);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setImportJsonContent(event.target.result as string);
        }
      };
      reader.readAsText(file);
    }
  };

  const handleCloseImportDialog = () => {
    setShowImportDialog(false);
    setImportResult(null);
  };

  const loadKiroData = useCallback(async () => {
    try {
      const [statusResponse, accountsResponse] = await Promise.all([
        getKiroStatus(),
        getKiroAccounts().catch(() => ({ ok: true as const, accounts: [] }))
      ]);
      return {
        status: statusResponse,
        accounts: accountsResponse.accounts,
      };
    } catch (error) {
      console.error('Kiro data loading error:', error);
      // Return fallback data to prevent crash
      return {
        status: { ok: true as const, enabled: false, message: 'Failed to load Kiro status' },
        accounts: [],
      };
    }
  }, []);

  const { state, retry } = useAsyncResource(loadKiroData);

  const status = useMemo(
    () => (state.status === "success" ? state.data.status : null),
    [state]
  );

  const accounts = useMemo(
    () => (state.status === "success" ? state.data.accounts : []),
    [state]
  );

  const selectedAccount = accountId ? accounts.find((account) => account.id === accountId) ?? null : null;
  const confirmDeleteAccount = accounts.find((account) => account.id === confirmDeleteAccountId) ?? null;
  const editAccount = accounts.find((account) => account.id === editAccountId) ?? null;

  useEffect(() => {
    if (editAccount && !editAccountData) {
      setEditAccountData({
        name: editAccount.name,
        priority: editAccount.priority,
        isActive: editAccount.isActive,
      });
    }
  }, [editAccount, editAccountData]);

  async function runMutation(actionKey: string, task: () => Promise<void>, successMessage: string) {
    setPendingAction(actionKey);
    setFeedback(null);
    try {
      await task();
      setFeedback({ variant: "success", message: successMessage });
      if (selectedAccount?.id && actionKey === `kiro:${selectedAccount.id}:delete`) {
        window.location.hash = "#/kiro";
      }
      retry();
    } catch (error) {
      setFeedback({
        variant: "error",
        message: error instanceof Error ? error.message : "Action failed.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function handleRefreshAccount(account: KiroAccount) {
    await runMutation(
      `kiro:${account.id}:refresh`,
      async () => {
        await refreshKiroAccount(account.id);
      },
      `Refreshed tokens for ${account.name}`,
    );
  }

  async function handleToggleAccount(account: KiroAccount) {
    const newStatus = !account.isActive;
    await runMutation(
      `kiro:${account.id}:toggle`,
      async () => {
        await updateKiroAccount(account.id, { isActive: newStatus });
      },
      `${newStatus ? 'Enabled' : 'Disabled'} ${account.name}`,
    );
  }

  async function handleDeleteAccount() {
    if (!confirmDeleteAccount) return;

    await runMutation(
      `kiro:${confirmDeleteAccount.id}:delete`,
      async () => {
        await deleteKiroAccount(confirmDeleteAccount.id);
        setConfirmDeleteAccountId(null);
      },
      `Deleted ${confirmDeleteAccount.name}`,
    );
  }

  async function handleSaveEdit() {
    if (!editAccount || !editAccountData) return;

    await runMutation(
      `kiro:${editAccount.id}:edit`,
      async () => {
        await updateKiroAccount(editAccount.id, editAccountData);
        setEditAccountId(null);
        setEditAccountData(null);
      },
      `Updated ${editAccount.name}`,
    );
  }

  async function handleImportAccounts() {
    const trimmedContent = importJsonContent.trim();
    await runMutation(
      "kiro:import",
      async () => {
        let result: KiroImportResponse;
        if (importMethod === "json") {
          if (!trimmedContent) {
            throw new Error("Please paste your Kiro JSON or Refresh Token.");
          }
          let parsedJson: unknown = undefined;
          try {
            parsedJson = JSON.parse(trimmedContent);
          } catch {
            // Not JSON, treat as raw refresh token
          }

          if (parsedJson !== undefined) {
            result = await importKiroAccounts({
              json: parsedJson,
              refresh: importShouldRefresh,
            });
          } else {
            result = await importKiroAccounts({
              refreshToken: trimmedContent,
              refresh: importShouldRefresh,
            });
          }
        } else {
          result = await importKiroAccounts(importSourcePath ? { sourcePath: importSourcePath } : undefined);
        }
        setImportResult(result);
        setImportSourcePath("");
        setImportJsonContent("");
      },
      "Successfully imported Kiro accounts",
    );
  }

  // Early return for loading state
  if (state.status === "loading") {
    return <LoadingState />;
  }

  // Early return for error state
  if (state.status === "error") {
    return <ErrorState error={state.error} onRetry={retry} />;
  }

  // Early return if Kiro is not enabled
  if (!status?.enabled) {
    return (
      <div className="screen">
        <PageHeader
          eyebrow="Account Management"
          title="Kiro Accounts"
          description="AWS CodeWhisperer account management"
        />
        <SurfaceCard title="Kiro Disabled" description="Kiro provider is not enabled">
          <div className="empty-state">
            <div className="empty-state-content">
              <h3>Kiro is disabled</h3>
              <p>Set KIRO_ENABLED=true in your environment configuration to enable Kiro account management.</p>
            </div>
          </div>
        </SurfaceCard>
      </div>
    );
  }

  // Early return if database is not available
  if (!status?.available) {
    return (
      <div className="screen">
        <PageHeader
          eyebrow="Account Management"
          title="Kiro Accounts"
          description="AWS CodeWhisperer account management"
        />
        <SurfaceCard title="Database Not Found" description="Kiro database is not available">
          <div className="empty-state">
            <div className="empty-state-content">
              <h3>Database not found</h3>
              <p>{status?.message || 'Kiro database is not available'}</p>
              <button
                className="button button-primary"
                onClick={() => setShowImportDialog(true)}
                disabled={pendingAction === "kiro:import"}
              >
                Import Accounts
              </button>
            </div>
          </div>
        </SurfaceCard>
      </div>
    );
  }

  // Show account detail view
  if (selectedAccount) {
    const tokenBadge = getTokenStatusBadge(selectedAccount.tokenStatus);

    return (
      <div className="screen">
        <PageHeader
          eyebrow="Kiro Account"
          title={selectedAccount.name}
          description={`Account ID: ${selectedAccount.id}`}
        />

        {feedback && (
          <InlineAlert variant={feedback.variant} onDismiss={() => setFeedback(null)}>
            {feedback.message}
          </InlineAlert>
        )}

        <div className="detail-page-grid">
          <div className="detail-page-main">
            <SurfaceCard title="Account Information" description="Basic account details">
              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">Name</span>
                  <span className="detail-value">{selectedAccount.name}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Account ID</span>
                  <span className="detail-value code">{selectedAccount.id}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Priority</span>
                  <span className="detail-value">{selectedAccount.priority}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Status</span>
                  <StatusBadge tone={selectedAccount.isActive ? "success" : "neutral"}>
                    {selectedAccount.isActive ? "Active" : "Disabled"}
                  </StatusBadge>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Region</span>
                  <span className="detail-value">{selectedAccount.region}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Auth Method</span>
                  <span className="detail-value">{selectedAccount.authMethod}</span>
                </div>
              </div>
            </SurfaceCard>

            <SurfaceCard title="Token Status" description="Current token information">
              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">Token Status</span>
                  <StatusBadge tone={tokenBadge.tone}>{tokenBadge.label}</StatusBadge>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Expires At</span>
                  <span className="detail-value">
                    {selectedAccount.expiresAt ? formatDateTime(selectedAccount.expiresAt) : 'Unknown'}
                  </span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Time Remaining</span>
                  <span className="detail-value">{formatTimeRemaining(selectedAccount.expiresIn)}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Has Refresh Token</span>
                  <StatusBadge tone={selectedAccount.hasRefreshToken ? "success" : "danger"}>
                    {selectedAccount.hasRefreshToken ? "Yes" : "No"}
                  </StatusBadge>
                </div>
              </div>
            </SurfaceCard>
          </div>

          <div className="detail-page-sidebar">
            <SurfaceCard title="Actions" description="Account management operations">
              <div className="button-group-vertical">
                <button
                  className="button button-primary"
                  onClick={() => handleRefreshAccount(selectedAccount)}
                  disabled={pendingAction === `kiro:${selectedAccount.id}:refresh`}
                >
                  {pendingAction === `kiro:${selectedAccount.id}:refresh` ? "Refreshing..." : "Refresh Token"}
                </button>

                <button
                  className="button button-secondary"
                  onClick={() => {
                    setEditAccountId(selectedAccount.id);
                    setEditAccountData({
                      name: selectedAccount.name,
                      priority: selectedAccount.priority,
                      isActive: selectedAccount.isActive,
                    });
                  }}
                >
                  Edit Account
                </button>

                <button
                  className={`button ${selectedAccount.isActive ? 'button-warning' : 'button-success'}`}
                  onClick={() => handleToggleAccount(selectedAccount)}
                  disabled={pendingAction === `kiro:${selectedAccount.id}:toggle`}
                >
                  {pendingAction === `kiro:${selectedAccount.id}:toggle`
                    ? "Updating..."
                    : selectedAccount.isActive ? "Disable" : "Enable"}
                </button>

                <button
                  className="button button-danger"
                  onClick={() => setConfirmDeleteAccountId(selectedAccount.id)}
                >
                  Delete Account
                </button>
              </div>
            </SurfaceCard>
          </div>
        </div>

        {/* Edit Account Dialog */}
        {editAccountId && editAccountData && (
          <div className="modal-backdrop" onClick={() => { setEditAccountId(null); setEditAccountData(null); }}>
            <div className="modal-card" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Edit Account</h3>
                <button
                  className="modal-close"
                  onClick={() => { setEditAccountId(null); setEditAccountData(null); }}
                >
                  ×
                </button>
              </div>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="edit-name">Name</label>
                  <input
                    id="edit-name"
                    type="text"
                    value={editAccountData.name}
                    onChange={(e) => setEditAccountData({ ...editAccountData, name: e.target.value })}
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="edit-priority">Priority</label>
                  <input
                    id="edit-priority"
                    type="number"
                    min="0"
                    value={editAccountData.priority}
                    onChange={(e) => setEditAccountData({ ...editAccountData, priority: parseInt(e.target.value) || 0 })}
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={editAccountData.isActive}
                      onChange={(e) => setEditAccountData({ ...editAccountData, isActive: e.target.checked })}
                    />
                    Active
                  </label>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  className="button button-secondary"
                  onClick={() => { setEditAccountId(null); setEditAccountData(null); }}
                >
                  Cancel
                </button>
                <button
                  className="button button-primary"
                  onClick={handleSaveEdit}
                  disabled={pendingAction === `kiro:${editAccountId}:edit`}
                >
                  {pendingAction === `kiro:${editAccountId}:edit` ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        {confirmDeleteAccount && (
          <ConfirmDialog
            title="Delete Account"
            message={`Are you sure you want to delete "${confirmDeleteAccount.name}"? This action cannot be undone.`}
            confirmLabel="Delete"
            confirmTone="danger"
            onConfirm={handleDeleteAccount}
            onCancel={() => setConfirmDeleteAccountId(null)}
            pending={pendingAction === `kiro:${confirmDeleteAccount.id}:delete`}
          />
        )}
      </div>
    );
  }

  // Show accounts list view
  const activeAccounts = accounts.filter(acc => acc.isActive);
  const healthyAccounts = accounts.filter(acc => acc.tokenStatus === 'valid');

  return (
    <div className="screen">
      <PageHeader
        eyebrow="Account Management"
        title="Kiro Accounts"
        description="AWS CodeWhisperer account management"
      >
        <button
          className="button button-primary"
          onClick={() => setShowImportDialog(true)}
          disabled={pendingAction === "kiro:import"}
        >
          {pendingAction === "kiro:import" ? "Importing..." : "Import Accounts"}
        </button>
      </PageHeader>

      {feedback && (
        <InlineAlert variant={feedback.variant} onDismiss={() => setFeedback(null)}>
          {feedback.message}
        </InlineAlert>
      )}

      {/* Status Cards */}
      <div className="stats-grid">
        <StatCard
          title="Total Accounts"
          value={formatNumber(accounts.length)}
          tone="neutral"
        />
        <StatCard
          title="Active Accounts"
          value={formatNumber(activeAccounts.length)}
          tone="success"
        />
        <StatCard
          title="Healthy Tokens"
          value={formatNumber(healthyAccounts.length)}
          tone={healthyAccounts.length === activeAccounts.length ? "success" : "warning"}
        />
        <StatCard
          title="Write-back"
          value={status?.writeBackEnabled ? "Enabled" : "Disabled"}
          tone={status?.writeBackEnabled ? "success" : "neutral"}
        />
      </div>

      {/* Accounts Table */}
      <SurfaceCard title="Accounts" description="Manage your Kiro accounts">
        {accounts.length === 0 ? (
          <EmptyState
            title="No accounts found"
            description="Import accounts from 9router to get started."
            action={
              <button
                className="button button-primary"
                onClick={() => setShowImportDialog(true)}
                disabled={pendingAction === "kiro:import"}
              >
                Import Accounts
              </button>
            }
          />
        ) : (
          <DataTable
            data={accounts}
            columns={[
              {
                key: "name",
                label: "Name",
                render: (account: KiroAccount) => (
                  <a href={`#/kiro/${encodeURIComponent(account.id)}`} className="table-link">
                    {account.name}
                  </a>
                ),
              },
              {
                key: "status",
                label: "Status",
                render: (account: KiroAccount) => (
                  <StatusBadge tone={account.isActive ? "success" : "neutral"}>
                    {account.isActive ? "Active" : "Disabled"}
                  </StatusBadge>
                ),
              },
              {
                key: "tokenStatus",
                label: "Token",
                render: (account: KiroAccount) => {
                  const badge = getTokenStatusBadge(account.tokenStatus);
                  return <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>;
                },
              },
              {
                key: "priority",
                label: "Priority",
                render: (account: KiroAccount) => account.priority.toString(),
              },
              {
                key: "expiresIn",
                label: "Expires In",
                render: (account: KiroAccount) => formatTimeRemaining(account.expiresIn),
              },
              {
                key: "region",
                label: "Region",
                render: (account: KiroAccount) => account.region,
              },
              {
                key: "actions",
                label: "Actions",
                render: (account: KiroAccount) => (
                  <div className="table-actions">
                    <button
                      className="button button-small button-secondary"
                      onClick={() => handleRefreshAccount(account)}
                      disabled={pendingAction === `kiro:${account.id}:refresh`}
                      title="Refresh token"
                    >
                      {pendingAction === `kiro:${account.id}:refresh` ? "..." : "Refresh"}
                    </button>
                    <button
                      className={`button button-small ${account.isActive ? 'button-warning' : 'button-success'}`}
                      onClick={() => handleToggleAccount(account)}
                      disabled={pendingAction === `kiro:${account.id}:toggle`}
                      title={account.isActive ? "Disable account" : "Enable account"}
                    >
                      {pendingAction === `kiro:${account.id}:toggle`
                        ? "..."
                        : account.isActive ? "Disable" : "Enable"}
                    </button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </SurfaceCard>

      {/* Import Dialog */}
      {showImportDialog && (
        <div className="modal-backdrop" onClick={handleCloseImportDialog}>
          <div className="modal-card" style={{ maxWidth: "600px" }} onClick={(e) => e.stopPropagation()}>
            {importResult ? (
              <>
                <div className="modal-header">
                  <h3>Import Completed</h3>
                  <button className="modal-close" onClick={handleCloseImportDialog}>×</button>
                </div>
                <div className="modal-body" style={{ textAlign: 'center', padding: 'var(--space-5) var(--space-4)' }}>
                  <div style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '50%',
                    background: 'var(--success-soft)',
                    color: 'var(--success)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto var(--space-4) auto',
                  }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  
                  <h3 style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-2)' }}>Successfully Imported</h3>
                  <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-5)', fontSize: 'var(--text-sm)' }}>
                    Successfully imported and configured <strong>{importResult.imported}</strong> account{importResult.imported === 1 ? '' : 's'}.
                  </p>

                  {importResult.accounts && importResult.accounts.length > 0 && (
                    <div style={{
                      textAlign: 'left',
                      background: 'var(--surface-muted)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-md)',
                      maxHeight: '220px',
                      overflowY: 'auto',
                      marginBottom: 'var(--space-4)'
                    }}>
                      <div style={{
                        padding: 'var(--space-2) var(--space-3)',
                        borderBottom: '1px solid var(--line)',
                        fontSize: '11px',
                        fontWeight: '600',
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em'
                      }}>
                        Imported Accounts
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {importResult.accounts.map((acc, idx) => (
                          <div key={acc.id} style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: 'var(--space-3)',
                            borderBottom: idx < importResult.accounts!.length - 1 ? '1px solid var(--line)' : 'none'
                          }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                              <span style={{ fontWeight: '500', fontSize: 'var(--text-sm)' }}>{acc.name}</span>
                              {acc.email && (
                                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>{acc.email}</span>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                              <span style={{
                                fontSize: '10px',
                                fontWeight: '600',
                                padding: '2px 6px',
                                borderRadius: 'var(--radius-pill)',
                                background: 'var(--neutral-soft)',
                                color: 'var(--text-secondary)',
                                textTransform: 'uppercase'
                              }}>
                                {acc.authMethod}
                              </span>
                              {acc.refreshed ? (
                                <span style={{
                                  fontSize: '10px',
                                  fontWeight: '600',
                                  padding: '2px 6px',
                                  borderRadius: 'var(--radius-pill)',
                                  background: 'var(--success-soft)',
                                  color: 'var(--success)'
                                }}>
                                  Refreshed
                                </span>
                              ) : (
                                <span style={{
                                  fontSize: '10px',
                                  fontWeight: '600',
                                  padding: '2px 6px',
                                  borderRadius: 'var(--radius-pill)',
                                  background: 'var(--warning-soft)',
                                  color: 'var(--warning)'
                                }}>
                                  Saved
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button
                    className="button button-primary"
                    onClick={handleCloseImportDialog}
                    style={{ width: '100%' }}
                  >
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="modal-header">
                  <h3>Import Kiro Accounts</h3>
                  <button className="modal-close" onClick={handleCloseImportDialog}>×</button>
                </div>
                <div className="modal-body">
                  <div className="tab-navigation" style={{ marginBottom: "var(--space-4)" }}>
                    <div className="tab-list" style={{ display: "flex", gap: "var(--space-2)", borderBottom: "1px solid var(--line)", paddingBottom: "var(--space-2)" }}>
                      <button
                        className={`tab-button ${importMethod === 'json' ? 'tab-button-active' : ''}`}
                        onClick={() => setImportMethod('json')}
                        style={{ background: 'none', border: 'none', padding: 'var(--space-2) var(--space-3)', cursor: 'pointer', borderBottom: importMethod === 'json' ? '2px solid var(--accent)' : 'none', fontWeight: importMethod === 'json' ? '600' : 'normal', color: importMethod === 'json' ? 'var(--accent)' : 'var(--muted)' }}
                      >
                        Paste JSON / Token
                      </button>
                      <button
                        className={`tab-button ${importMethod === 'path' ? 'tab-button-active' : ''}`}
                        onClick={() => setImportMethod('path')}
                        style={{ background: 'none', border: 'none', padding: 'var(--space-2) var(--space-3)', cursor: 'pointer', borderBottom: importMethod === 'path' ? '2px solid var(--accent)' : 'none', fontWeight: importMethod === 'path' ? '600' : 'normal', color: importMethod === 'path' ? 'var(--accent)' : 'var(--muted)' }}
                      >
                        SQLite DB Path
                      </button>
                    </div>
                  </div>

                  {importMethod === 'json' ? (
                    <div>
                      {/* Drag & Drop Area */}
                      <div
                        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileDrop(e); }}
                        onClick={() => document.getElementById('kiro-file-input')?.click()}
                        style={{
                          border: isDragging ? '2px dashed var(--accent)' : '2px dashed var(--line-strong)',
                          borderRadius: 'var(--radius-md)',
                          padding: 'var(--space-4)',
                          textAlign: 'center',
                          background: isDragging ? 'var(--accent-soft)' : 'var(--surface-muted)',
                          cursor: 'pointer',
                          transition: 'all var(--animation-fast) var(--animation-easing)',
                          marginBottom: 'var(--space-4)',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 'var(--space-1)'
                        }}
                      >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: isDragging ? 'var(--accent)' : 'var(--text-secondary)', marginBottom: '4px' }}>
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="17 8 12 3 7 8" />
                          <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        <span style={{ fontWeight: '500', fontSize: 'var(--text-sm)' }}>
                          Drag & drop JSON file here or click to browse
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Supports .json containing Kiro accounts or 9router backups
                        </span>
                        <input
                          id="kiro-file-input"
                          type="file"
                          accept=".json,application/json"
                          onChange={handleFileSelect}
                          style={{ display: 'none' }}
                        />
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                        <div style={{ flex: 1, height: '1px', background: 'var(--line)' }} />
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Or paste content</span>
                        <div style={{ flex: 1, height: '1px', background: 'var(--line)' }} />
                      </div>

                      <div className="form-group" style={{ marginBottom: 'var(--space-3)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                          <label htmlFor="import-json" style={{ fontWeight: '500', fontSize: 'var(--text-sm)' }}>JSON Credentials or Refresh Token</label>
                          {validation?.canBeFormatted && (
                            <button
                              type="button"
                              onClick={handleFormatJson}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--accent)',
                                fontSize: 'var(--text-xs)',
                                cursor: 'pointer',
                                padding: '0',
                                fontWeight: '500'
                              }}
                            >
                              Beautify JSON
                            </button>
                          )}
                        </div>
                        <textarea
                          id="import-json"
                          value={importJsonContent}
                          onChange={(e) => setImportJsonContent(e.target.value)}
                          placeholder='{ "refreshToken": "..." } or raw refresh token string'
                          className="form-input"
                          rows={5}
                          style={{ fontFamily: 'monospace', fontSize: '13px', width: '100%', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', background: 'var(--surface-muted)' }}
                        />
                      </div>

                      {/* Validation Message */}
                      {validation && (
                        <div style={{
                          display: 'flex',
                          gap: 'var(--space-2)',
                          padding: 'var(--space-3)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: 'var(--text-xs)',
                          lineHeight: '1.4',
                          marginBottom: 'var(--space-4)',
                          background: validation.type === 'success' ? 'var(--success-soft)' : validation.type === 'error' ? 'var(--danger-soft)' : 'var(--accent-soft)',
                          color: validation.type === 'success' ? 'var(--success)' : validation.type === 'error' ? 'var(--danger)' : 'var(--accent)',
                          border: `1px solid ${validation.type === 'success' ? 'rgba(52, 211, 153, 0.2)' : validation.type === 'error' ? 'rgba(248, 113, 113, 0.2)' : 'rgba(100, 168, 255, 0.2)'}`
                        }}>
                          <div style={{ fontWeight: 'bold' }}>{validation.title}:</div>
                          <div>{validation.message}</div>
                        </div>
                      )}

                      <div className="form-group" style={{ marginBottom: 'var(--space-2)' }}>
                        <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
                          <input
                            type="checkbox"
                            checked={importShouldRefresh}
                            onChange={(e) => setImportShouldRefresh(e.target.checked)}
                          />
                          Refresh tokens on import (recommended to validate)
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p style={{ marginBottom: 'var(--space-3)', color: 'var(--muted)', fontSize: 'var(--text-sm)' }}>
                        Import Kiro accounts from a local 9router SQLite database copy.
                      </p>
                      <div className="form-group">
                        <label htmlFor="import-source" style={{ fontWeight: '500', fontSize: 'var(--text-sm)' }}>Source Database Path (optional)</label>
                        <input
                          id="import-source"
                          type="text"
                          value={importSourcePath}
                          onChange={(e) => setImportSourcePath(e.target.value)}
                          placeholder="Leave empty to use default path"
                          className="form-input"
                          style={{ background: 'var(--surface-muted)' }}
                        />
                        <small className="form-help">
                          Default: ~/.9router/db/data.sqlite
                        </small>
                      </div>
                    </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button
                    className="button button-secondary"
                    onClick={handleCloseImportDialog}
                  >
                    Cancel
                  </button>
                  <button
                    className="button button-primary"
                    onClick={handleImportAccounts}
                    disabled={pendingAction === "kiro:import" || (importMethod === "json" && !importJsonContent.trim())}
                  >
                    {pendingAction === "kiro:import" ? "Importing..." : "Import"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {confirmDeleteAccount && (
        <ConfirmDialog
          title="Delete Account"
          message={`Are you sure you want to delete "${confirmDeleteAccount.name}"? This action cannot be undone.`}
          confirmLabel="Delete"
          confirmTone="danger"
          onConfirm={handleDeleteAccount}
          onCancel={() => setConfirmDeleteAccountId(null)}
          pending={pendingAction === `kiro:${confirmDeleteAccount.id}:delete`}
        />
      )}
    </div>
  );
}