import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteKiroAccount,
  getKiroAccounts,
  getKiroStatus,
  importKiroAccounts,
  refreshKiroAccount,
  updateKiroAccount,
} from "../api/client";
import type { KiroAccount, KiroStatus } from "../api/types";
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
    await runMutation(
      "kiro:import",
      async () => {
        await importKiroAccounts(importSourcePath ? { sourcePath: importSourcePath } : undefined);
        setShowImportDialog(false);
        setImportSourcePath("");
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
        <div className="modal-backdrop" onClick={() => setShowImportDialog(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Import Kiro Accounts</h3>
              <button className="modal-close" onClick={() => setShowImportDialog(false)}>×</button>
            </div>
            <div className="modal-body">
              <p>Import Kiro accounts from 9router database.</p>
              <div className="form-group">
                <label htmlFor="import-source">Source Database Path (optional)</label>
                <input
                  id="import-source"
                  type="text"
                  value={importSourcePath}
                  onChange={(e) => setImportSourcePath(e.target.value)}
                  placeholder="Leave empty to use default path"
                  className="form-input"
                />
                <small className="form-help">
                  Default: ~/.9router/db/data.sqlite
                </small>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="button button-secondary"
                onClick={() => setShowImportDialog(false)}
              >
                Cancel
              </button>
              <button
                className="button button-primary"
                onClick={handleImportAccounts}
                disabled={pendingAction === "kiro:import"}
              >
                {pendingAction === "kiro:import" ? "Importing..." : "Import"}
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