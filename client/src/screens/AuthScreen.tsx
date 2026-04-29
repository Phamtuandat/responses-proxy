import { useCallback, useMemo, useState } from "react";
import {
  deleteAccount,
  disableAccount,
  enableAccount,
  getChatGptOAuthStatus,
  refreshAccount,
} from "../api/client";
import type { ChatGptOAuthAccount, ChatGptOAuthStatusResponse } from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DataTable } from "../components/DataTable";
import { ErrorState } from "../components/ErrorState";
import { InlineAlert } from "../components/InlineAlert";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { RefreshButton } from "../components/RefreshButton";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { SurfaceCard } from "../components/SurfaceCard";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatDateTime, formatUnknown } from "../lib/format";

type MutationFeedback = {
  variant: "success" | "error";
  message: string;
};

function getAccountId(account: ChatGptOAuthAccount): string {
  return account.id || account.accountId || "";
}

function getAccountLabel(account: ChatGptOAuthAccount): string {
  return account.email || account.accountId || account.id || "Connected account";
}

function getAccountState(account: ChatGptOAuthAccount): "enabled" | "disabled" {
  return account.disabled ? "disabled" : "enabled";
}

export function AuthScreen() {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState<ChatGptOAuthAccount | null>(null);
  const [feedback, setFeedback] = useState<MutationFeedback | null>(null);
  const loadAuth = useCallback(() => getChatGptOAuthStatus(), []);
  const { state, retry } = useAsyncResource<ChatGptOAuthStatusResponse>(loadAuth);

  const accounts = useMemo(
    () => (state.status === "success" && Array.isArray(state.data.accounts) ? state.data.accounts : []),
    [state],
  );

  async function runAccountAction(
    account: ChatGptOAuthAccount,
    action: "refresh" | "enable" | "disable" | "delete",
  ) {
    const accountId = getAccountId(account);
    if (!accountId) {
      setFeedback({ variant: "error", message: "Account id is missing." });
      return;
    }

    setPendingAction(`${action}:${accountId}`);
    setFeedback(null);

    try {
      if (action === "refresh") {
        await refreshAccount(accountId);
      } else if (action === "enable") {
        await enableAccount(accountId);
      } else if (action === "disable") {
        await disableAccount(accountId);
      } else {
        await deleteAccount(accountId);
      }

      setFeedback({
        variant: "success",
        message: `${getAccountLabel(account)} ${action === "delete" ? "deleted" : `${action}d`}.`,
      });
      retry();
    } catch (error) {
      setFeedback({
        variant: "error",
        message: error instanceof Error ? error.message : "Account action failed.",
      });
    } finally {
      setPendingAction(null);
      setConfirmDeleteAccount(null);
    }
  }

  if (state.status === "loading" || state.status === "idle") {
    return <LoadingState title="Loading auth accounts" description="Reading connected account auth status." />;
  }

  if (state.status === "error") {
    return <ErrorState title="Auth management unavailable" description={state.error.message} onRetry={retry} />;
  }

  const enabledCount = accounts.filter((account) => !account.disabled).length;
  const disabledCount = accounts.length - enabledCount;

  return (
    <div className="screen-stack">
      <PageHeader
        eyebrow="Auth"
        title="Account auth management"
        description="Manage connected account availability for provider routing. OAuth connect flow remains on the Accounts screen."
        actions={<RefreshButton onClick={retry} />}
      />

      {feedback ? (
        <InlineAlert
          message={feedback.message}
          variant={feedback.variant === "success" ? "success" : "error"}
        />
      ) : null}

      <div className="stat-grid">
        <StatCard label="Connected accounts" value={formatUnknown(accounts.length)} />
        <StatCard label="Enabled" value={formatUnknown(enabledCount)} />
        <StatCard label="Disabled" value={formatUnknown(disabledCount)} />
      </div>

      <SurfaceCard
        title="Connected accounts"
        description="Refresh tokens, enable or disable routing eligibility, and remove accounts."
      >
        <DataTable
          columns={[
            {
              key: "label",
              label: "Account",
              render: (_value, row) => (
                <div className="provider-status-stack">
                  <strong>{String(row.label)}</strong>
                  <StatusBadge variant={row.state === "enabled" ? "success" : "warning"}>
                    {String(row.state)}
                  </StatusBadge>
                </div>
              ),
            },
            { key: "accountId", label: "Account ID" },
            { key: "expiresAt", label: "Expires", render: (value) => formatDateTime(value) },
            { key: "updatedAt", label: "Updated", render: (value) => formatDateTime(value) },
            {
              key: "actions",
              label: "Actions",
              render: (_value, row) => {
                const account = row.account as ChatGptOAuthAccount;
                const accountId = getAccountId(account);
                const isDisabled = Boolean(account.disabled);
                return (
                  <div className="row-actions">
                    <button
                      className="row-action-button"
                      disabled={pendingAction === `refresh:${accountId}`}
                      onClick={() => void runAccountAction(account, "refresh")}
                      type="button"
                    >
                      Refresh
                    </button>
                    <button
                      className="row-action-button"
                      disabled={pendingAction === `${isDisabled ? "enable" : "disable"}:${accountId}`}
                      onClick={() => void runAccountAction(account, isDisabled ? "enable" : "disable")}
                      type="button"
                    >
                      {isDisabled ? "Enable" : "Disable"}
                    </button>
                    <button
                      className="row-action-button button-danger"
                      disabled={pendingAction === `delete:${accountId}`}
                      onClick={() => setConfirmDeleteAccount(account)}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                );
              },
            },
          ]}
          emptyDescription="Connect an account from the Accounts screen before managing auth availability here."
          emptyTitle="No connected accounts"
          rows={accounts.map((account) => ({
            label: getAccountLabel(account),
            accountId: account.accountId || account.id || "Not reported",
            state: getAccountState(account),
            expiresAt: account.expiresAt,
            updatedAt: account.updatedAt,
            actions: getAccountId(account),
            account,
          }))}
        />
      </SurfaceCard>

      {confirmDeleteAccount ? (
        <ConfirmDialog
          confirmLabel="Delete account"
          description={`Delete ${getAccountLabel(confirmDeleteAccount)} from account auth? This cannot be undone.`}
          onCancel={() => setConfirmDeleteAccount(null)}
          onConfirm={() => void runAccountAction(confirmDeleteAccount, "delete")}
          title="Delete connected account"
        />
      ) : null}
    </div>
  );
}
