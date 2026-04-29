import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  deleteAccount,
  disableAccount,
  enableAccount,
  getChatGptOAuthStatus,
  refreshAccount,
  startChatGptOAuth,
  submitChatGptOAuthCallback,
  updateChatGptOAuthSettings,
} from "../api/client";
import type { ChatGptOAuthAccount, ChatGptOAuthStatusResponse } from "../api/types";
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
import { formatDateTime, formatNumber, formatUnknown } from "../lib/format";

type MutationFeedback = {
  variant: "success" | "error";
  message: string;
};

type AccountsScreenProps = {
  accountId?: string;
};

const EXPIRING_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isExpiringSoon(account: ChatGptOAuthAccount): boolean {
  if (typeof account.expiresAt !== "string") {
    return false;
  }
  const expiresAt = Date.parse(account.expiresAt);
  if (Number.isNaN(expiresAt)) {
    return false;
  }
  return expiresAt - Date.now() <= EXPIRING_SOON_WINDOW_MS;
}

function getAccountLabel(account: ChatGptOAuthAccount): string {
  return account.email || account.accountId || account.id || "Connected account";
}

export function AccountsScreen({ accountId }: AccountsScreenProps) {
  const [authUrl, setAuthUrl] = useState("");
  const [callbackInput, setCallbackInput] = useState("");
  const [rotationMode, setRotationMode] = useState("round_robin");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [confirmDeleteAccountId, setConfirmDeleteAccountId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<MutationFeedback | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const authUrlInputRef = useRef<HTMLInputElement | null>(null);

  const loadAccounts = useCallback(() => getChatGptOAuthStatus(), []);
  const { state, retry } = useAsyncResource<ChatGptOAuthStatusResponse>(loadAccounts);

  const accounts = useMemo(
    () => (state.status === "success" && Array.isArray(state.data.accounts) ? state.data.accounts : []),
    [state],
  );

  useEffect(() => {
    if (state.status === "success") {
      setRotationMode(state.data.rotationMode || "round_robin");
    }
  }, [state]);

  const selectedAccount = accountId ? accounts.find((account) => account.id === accountId) ?? null : null;
  const confirmDeleteAccount = accounts.find((account) => account.id === confirmDeleteAccountId) ?? null;

  async function runMutation(actionKey: string, task: () => Promise<void>, successMessage: string) {
    setPendingAction(actionKey);
    setFeedback(null);
    try {
      await task();
      setFeedback({ variant: "success", message: successMessage });
      if (selectedAccount?.id && actionKey === `account:${selectedAccount.id}:delete`) {
        window.location.hash = "#/oauth";
      }
      retry();
    } catch (error) {
      setFeedback({
        variant: "error",
        message: error instanceof Error ? error.message : "Account action failed.",
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function handleStartLogin() {
    await runMutation(
      "oauth:start",
      async () => {
        const response = await startChatGptOAuth();
        setAuthUrl(typeof response.authUrl === "string" ? response.authUrl : "");
        setCopyStatus("");
      },
      "Sign-in URL ready. Open it, then paste the redirected callback URL.",
    );
  }

  async function handleSubmitCallback() {
    const redirectUrl = callbackInput.trim();
    if (!redirectUrl) {
      setFeedback({ variant: "error", message: "Paste the callback URL first." });
      return;
    }

    await runMutation(
      "oauth:callback",
      async () => {
        await submitChatGptOAuthCallback({ redirectUrl });
        setCallbackInput("");
        setAuthUrl("");
      },
      "Connected account successfully.",
    );
  }

  async function handleSaveRotationMode() {
    await runMutation(
      "oauth:rotation",
      async () => {
        await updateChatGptOAuthSettings({ rotationMode });
      },
      `Account rotation saved: ${rotationMode}`,
    );
  }

  async function handleCopyAuthUrl() {
    if (!authUrl) {
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(authUrl);
        setCopyStatus("Copied");
        return;
      }
    } catch {
      // Fallback below.
    }

    authUrlInputRef.current?.focus();
    authUrlInputRef.current?.select();
    setCopyStatus("Select to copy");
  }

  async function handleRefreshAccount(targetAccountId: string) {
    await runMutation(
      `account:${targetAccountId}:refresh`,
      async () => {
        await refreshAccount(targetAccountId);
      },
      "Account refreshed.",
    );
  }

  async function handleToggleAccount(account: ChatGptOAuthAccount) {
    const targetAccountId = account.id ?? "";
    const disabled = account.disabled === true;
    await runMutation(
      `account:${targetAccountId}:toggle`,
      async () => {
        if (disabled) {
          await enableAccount(targetAccountId);
        } else {
          await disableAccount(targetAccountId);
        }
      },
      disabled ? "Account enabled." : "Account disabled.",
    );
  }

  async function handleDeleteAccount() {
    if (!confirmDeleteAccount?.id) {
      return;
    }
    const targetAccountId = confirmDeleteAccount.id;
    await runMutation(
      `account:${targetAccountId}:delete`,
      async () => {
        await deleteAccount(targetAccountId);
        setConfirmDeleteAccountId(null);
      },
      "Account deleted.",
    );
  }

  if (state.status === "loading" || state.status === "idle") {
    return <LoadingState title="Loading accounts" description="Reading OAuth status and connected account inventory." />;
  }

  if (state.status === "error") {
    return <ErrorState title="Accounts unavailable" description={state.error.message} onRetry={retry} />;
  }

  const oauthEnabled = state.data.enabled !== false;
  const activeAccounts = accounts.filter((account) => account.disabled !== true).length;
  const disabledAccounts = accounts.filter((account) => account.disabled === true).length;
  const expiringSoonCount = accounts.filter((account) => isExpiringSoon(account) && account.disabled !== true).length;

  return (
    <div className="screen-stack">
      <PageHeader
        eyebrow="Accounts"
        title={accountId ? "Account detail" : "Connected accounts"}
        description={
          accountId
            ? "Inspect account metadata and shared-pool status without exposing any secrets."
            : "OAuth and account pool management for account-backed providers."
        }
        actions={
          accountId ? (
            selectedAccount ? (
              <div className="page-header-actions page-header-actions-group">
                <a className="button-link" href="#/oauth">
                  Back to accounts
                </a>
                <button
                  className="button-link"
                  disabled={!oauthEnabled || pendingAction === `account:${selectedAccount.id}:refresh`}
                  onClick={() => void handleRefreshAccount(selectedAccount.id ?? "")}
                  type="button"
                >
                  {pendingAction === `account:${selectedAccount.id}:refresh` ? "Refreshing..." : "Refresh"}
                </button>
                <button
                  className="button-link"
                  disabled={!oauthEnabled || pendingAction === `account:${selectedAccount.id}:toggle`}
                  onClick={() => void handleToggleAccount(selectedAccount)}
                  type="button"
                >
                  {selectedAccount.disabled === true ? "Enable" : "Disable"}
                </button>
                <button
                  className="button-link button-danger"
                  disabled={!oauthEnabled || pendingAction === `account:${selectedAccount.id}:delete`}
                  onClick={() => setConfirmDeleteAccountId(selectedAccount.id ?? null)}
                  type="button"
                >
                  Delete
                </button>
              </div>
            ) : (
              <a className="button-link" href="#/oauth">
                Back to accounts
              </a>
            )
          ) : (
            <button
              className="button-link button-primary"
              disabled={!oauthEnabled || pendingAction === "oauth:start"}
              onClick={() => void handleStartLogin()}
              type="button"
            >
              {pendingAction === "oauth:start" ? "Starting..." : "Start login"}
            </button>
          )
        }
      />

      {feedback ? (
        <InlineAlert
          message={feedback.message}
          title={feedback.variant === "success" ? "Account action completed" : "Account action failed"}
          variant={feedback.variant}
        />
      ) : null}

      <div className="stat-grid">
        <StatCard label="OAuth" value={oauthEnabled ? "Enabled" : "Disabled"} />
        <StatCard label="Rotation mode" value={formatUnknown(state.data.rotationMode)} />
        <StatCard label="Account count" value={formatNumber(accounts.length)} />
        <StatCard label="Active accounts" value={formatNumber(activeAccounts)} />
        <StatCard label="Disabled accounts" value={formatNumber(disabledAccounts)} />
        <StatCard label="Expiring soon" value={formatNumber(expiringSoonCount)} />
      </div>

      {!oauthEnabled ? (
        <InlineAlert
          message="ChatGPT OAuth is disabled. Enable the backend account platform before starting login or account mutations."
          title="OAuth disabled"
          variant="error"
        />
      ) : null}

      {accountId ? (
        !selectedAccount ? (
          <EmptyState
            title="Account not found"
            description="This account ID is not available in the current runtime snapshot."
            actionHref="#/oauth"
            actionLabel="Back to accounts"
          />
        ) : (
          <div className="detail-page-grid">
            <SurfaceCard title="Overview" description="Account identity, lifecycle, and shared-pool availability.">
              <div className="provider-detail">
                <div className="hero-status">
                  <div>
                    <p className="eyebrow">Account detail</p>
                    <h2>{getAccountLabel(selectedAccount)}</h2>
                    <p className="long-value">{formatUnknown(selectedAccount.accountId)}</p>
                  </div>
                  <div className="card-inline-status">
                    <StatusBadge variant={selectedAccount.disabled === true ? "warning" : "success"}>
                      {selectedAccount.disabled === true ? "Disabled" : "Enabled"}
                    </StatusBadge>
                    {isExpiringSoon(selectedAccount) && selectedAccount.disabled !== true ? (
                      <StatusBadge variant="warning">Expiring soon</StatusBadge>
                    ) : null}
                  </div>
                </div>

                <dl className="detail-list">
                  <div><dt>Email</dt><dd className="long-value">{formatUnknown(selectedAccount.email)}</dd></div>
                  <div><dt>Account ID</dt><dd className="long-value">{formatUnknown(selectedAccount.accountId)}</dd></div>
                  <div><dt>Status</dt><dd>{selectedAccount.disabled === true ? "Disabled" : "Enabled"}</dd></div>
                  <div><dt>Expires at</dt><dd>{formatDateTime(selectedAccount.expiresAt)}</dd></div>
                  <div><dt>Last refresh</dt><dd>{formatDateTime(selectedAccount.lastRefreshAt)}</dd></div>
                  <div><dt>Created</dt><dd>{formatDateTime(selectedAccount.createdAt)}</dd></div>
                  <div><dt>Updated</dt><dd>{formatDateTime(selectedAccount.updatedAt)}</dd></div>
                  <div><dt>Expiring soon</dt><dd>{isExpiringSoon(selectedAccount) ? "Yes" : "No"}</dd></div>
                </dl>
              </div>
            </SurfaceCard>

            <SurfaceCard title="Operational status" description="Safe runtime state without exposing tokens, refresh secrets, or auth codes.">
              <div className="provider-detail-section">
                <dl className="provider-meta-list">
                  <div><dt>Pool status</dt><dd>{selectedAccount.disabled === true ? "Excluded from rotation" : "Eligible for rotation"}</dd></div>
                  <div><dt>Rotation mode</dt><dd>{formatUnknown(state.data.rotationMode)}</dd></div>
                  <div><dt>OAuth platform</dt><dd>{oauthEnabled ? "Enabled" : "Disabled"}</dd></div>
                  <div><dt>Secret visibility</dt><dd>Access tokens, refresh tokens, and callback secrets remain hidden.</dd></div>
                </dl>
              </div>
            </SurfaceCard>
          </div>
        )
      ) : (
        <>
          <div className="accounts-top-layout">
            <SurfaceCard title="Connection flow" description="Generate a sign-in URL, then paste the redirected callback URL to connect an account.">
              <div className="oauth-card">
                <div className="row-actions">
                  <button
                    className="button-link button-primary"
                    disabled={!oauthEnabled || pendingAction === "oauth:start"}
                    onClick={() => void handleStartLogin()}
                    type="button"
                  >
                    {pendingAction === "oauth:start" ? "Starting..." : "Start login"}
                  </button>
                </div>

                <label className="form-field">
                  <span className="field-label">Sign-in URL</span>
                  <div className="row-actions field-inline-actions">
                    <input className="search-input" readOnly ref={authUrlInputRef} value={authUrl} />
                    <button className="button-link" disabled={!authUrl} onClick={() => void handleCopyAuthUrl()} type="button">
                      {copyStatus || "Copy"}
                    </button>
                    <a className="button-link" href={authUrl || "#/oauth"} rel="noreferrer" target="_blank">
                      Open
                    </a>
                  </div>
                </label>

                <label className="form-field">
                  <span className="field-label">Paste callback URL</span>
                  <textarea
                    className="search-input"
                    onChange={(event) => setCallbackInput(event.target.value)}
                    placeholder="https://chat.openai.com/aip/auth/callback?code=..."
                    rows={4}
                    value={callbackInput}
                  />
                </label>

                <div className="row-actions">
                  <button
                    className="button-link"
                    disabled={!oauthEnabled || pendingAction === "oauth:callback" || !callbackInput.trim()}
                    onClick={() => void handleSubmitCallback()}
                    type="button"
                  >
                    {pendingAction === "oauth:callback" ? "Submitting..." : "Submit callback"}
                  </button>
                </div>
              </div>
            </SurfaceCard>

            <SurfaceCard title="Rotation settings" description="Choose how account-backed providers rotate across the shared account pool.">
              <div className="oauth-card">
                <label className="form-field">
                  <span className="field-label">Rotation mode</span>
                  <div className="rotation-settings-row">
                    <select
                      className="search-input"
                      disabled={!oauthEnabled || pendingAction === "oauth:rotation"}
                      onChange={(event) => setRotationMode(event.target.value)}
                      value={rotationMode}
                    >
                      <option value="round_robin">round_robin</option>
                      <option value="random">random</option>
                      <option value="first_available">first_available</option>
                    </select>
                    <button
                      className="button-link"
                      disabled={!oauthEnabled || pendingAction === "oauth:rotation"}
                      onClick={() => void handleSaveRotationMode()}
                      type="button"
                    >
                      {pendingAction === "oauth:rotation" ? "Saving..." : "Save"}
                    </button>
                  </div>
                </label>
              </div>
            </SurfaceCard>
          </div>

          <SurfaceCard className="list-card list-table" title="Accounts" description="Connected accounts used by account-backed providers.">
            <DataTable
              columns={[
                {
                  key: "email",
                  label: "Account",
                  render: (_value, row) => {
                    const account = row as ChatGptOAuthAccount;
                    const encodedId = encodeURIComponent(account.id ?? "");
                    return (
                      <>
                        <button
                          className="item-title-link"
                          onClick={() => {
                            window.location.hash = `#/oauth/${encodedId}`;
                          }}
                          type="button"
                        >
                          {getAccountLabel(account)}
                        </button>
                        <span className="item-meta truncate-value" title={formatUnknown(account.accountId)}>
                          {formatUnknown(account.accountId)}
                        </span>
                      </>
                    );
                  },
                },
                {
                  key: "accountId",
                  label: "Account ID",
                  render: (value) => <span className="long-value">{formatUnknown(value)}</span>,
                },
                {
                  key: "disabled",
                  label: "Status",
                  render: (value, row) => {
                    const account = row as ChatGptOAuthAccount;
                    const expiringSoon = isExpiringSoon(account) && account.disabled !== true;
                    return (
                      <div className="provider-status-stack">
                        <StatusBadge variant={value === true ? "warning" : "success"}>
                          {value === true ? "Disabled" : "Enabled"}
                        </StatusBadge>
                        {expiringSoon ? <StatusBadge variant="warning">Expiring soon</StatusBadge> : null}
                      </div>
                    );
                  },
                },
                { key: "expiresAt", label: "Expires", render: (value) => formatDateTime(value) },
                {
                  key: "id",
                  label: "Actions",
                  render: (value, row) => {
                    const account = row as ChatGptOAuthAccount;
                    const rowAccountId = typeof value === "string" ? value : "";
                    const actionBase = `account:${rowAccountId}`;
                    return (
                      <div className="row-actions account-row-actions">
                        <button
                          className="button-link row-action-button"
                          disabled={!oauthEnabled || pendingAction === `${actionBase}:refresh`}
                          onClick={() => void handleRefreshAccount(rowAccountId)}
                          type="button"
                        >
                          {pendingAction === `${actionBase}:refresh` ? "Syncing..." : "Sync"}
                        </button>
                        <button
                          className="button-link row-action-button"
                          disabled={!oauthEnabled || pendingAction === `${actionBase}:toggle`}
                          onClick={() => void handleToggleAccount(account)}
                          type="button"
                        >
                          {pendingAction === `${actionBase}:toggle`
                            ? account.disabled === true
                              ? "Enabling..."
                              : "Disabling..."
                            : account.disabled === true
                              ? "Enable"
                              : "Disable"}
                        </button>
                        <button
                          className="button-link button-danger row-action-button"
                          disabled={!oauthEnabled || pendingAction === `${actionBase}:delete`}
                          onClick={() => setConfirmDeleteAccountId(rowAccountId)}
                          type="button"
                        >
                          Delete
                        </button>
                      </div>
                    );
                  },
                },
              ]}
              emptyDescription="No connected OAuth accounts are currently reported."
              emptyTitle="No accounts connected"
              rows={accounts as Array<Record<string, unknown>>}
              tableClassName="accounts-table"
            />
          </SurfaceCard>
        </>
      )}

      {confirmDeleteAccount ? (
        <ConfirmDialog
          confirmLabel="Delete account"
          description={`Remove ${getAccountLabel(confirmDeleteAccount)} from the shared OAuth pool? This does not reveal or export any tokens.`}
          isSubmitting={pendingAction === `account:${confirmDeleteAccount.id}:delete`}
          onCancel={() => {
            if (pendingAction !== `account:${confirmDeleteAccount.id}:delete`) {
              setConfirmDeleteAccountId(null);
            }
          }}
          onConfirm={() => void handleDeleteAccount()}
          title="Delete connected account"
        />
      ) : null}
    </div>
  );
}
