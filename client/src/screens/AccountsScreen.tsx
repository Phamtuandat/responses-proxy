import { useCallback } from "react";
import { getChatGptOAuthStatus } from "../api/client";
import type { ChatGptOAuthAccount, ChatGptOAuthStatusResponse } from "../api/types";
import { DataTable } from "../components/DataTable";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { SurfaceCard } from "../components/SurfaceCard";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatDateTime, formatNumber, formatUnknown } from "../lib/format";

export function AccountsScreen() {
  const loadAccounts = useCallback(() => getChatGptOAuthStatus(), []);
  const { state, retry } = useAsyncResource<ChatGptOAuthStatusResponse>(loadAccounts);

  if (state.status === "loading" || state.status === "idle") {
    return <LoadingState title="Loading accounts" description="Reading read-only OAuth status and account inventory." />;
  }

  if (state.status === "error") {
    return <ErrorState title="Accounts unavailable" description={state.error.message} onRetry={retry} />;
  }

  const accounts = Array.isArray(state.data.accounts) ? (state.data.accounts as ChatGptOAuthAccount[]) : [];

  return (
    <div className="screen-stack">
      <PageHeader
        eyebrow="Accounts"
        title="OAuth account status"
        description="Read-only status only. Connect, refresh, enable, disable, and delete remain out of scope for this phase."
      />

      <div className="stat-grid">
        <StatCard label="OAuth" value={state.data.enabled ? "Enabled" : "Disabled"} />
        <StatCard label="Rotation mode" value={formatUnknown(state.data.rotationMode)} />
        <StatCard label="Account count" value={formatNumber(accounts.length)} />
      </div>

      <SurfaceCard title="Account overview">
        <div className="card-inline-status">
          <StatusBadge variant={state.data.enabled ? "success" : "warning"}>
            {state.data.enabled ? "OAuth enabled" : "OAuth disabled"}
          </StatusBadge>
          <StatusBadge variant="neutral">{formatUnknown(state.data.rotationMode)}</StatusBadge>
        </div>
      </SurfaceCard>

      <SurfaceCard title="Accounts" description="Available read-only account fields from `/api/chatgpt-oauth/status`.">
        <DataTable
          columns={[
            { key: "email", label: "Account" },
            { key: "accountId", label: "Provider/account label" },
            {
              key: "disabled",
              label: "Status",
              render: (value) => (
                <StatusBadge variant={value === true ? "warning" : "success"}>
                  {value === true ? "Disabled" : "Enabled"}
                </StatusBadge>
              ),
            },
            { key: "expiresAt", label: "Expires", render: (value) => formatDateTime(value) },
            { key: "lastRefreshAt", label: "Last refresh", render: (value) => formatDateTime(value) },
          ]}
          emptyDescription="No connected OAuth accounts are currently reported."
          emptyTitle="No accounts connected"
          rows={accounts as Array<Record<string, unknown>>}
        />
      </SurfaceCard>
    </div>
  );
}
