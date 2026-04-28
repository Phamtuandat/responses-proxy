import { useCallback } from "react";
import { getClientConfigsStatus } from "../api/client";
import type { ClientConfigStatus, ClientConfigsStatusResponse } from "../api/types";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { SurfaceCard } from "../components/SurfaceCard";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatDateTime, formatUnknown } from "../lib/format";

function ClientStatusCard({ label, status }: { label: string; status?: ClientConfigStatus }) {
  const access = status?.access;
  const backups = Array.isArray(status?.backups) ? status.backups : [];
  const latestBackup = backups[0];

  return (
    <SurfaceCard title={label} description="Read-only client config status. Apply remains in a later phase.">
      <div className="card-inline-status">
        <StatusBadge variant={status?.configured ? "success" : "warning"}>
          {status?.configured ? "Configured" : "Needs attention"}
        </StatusBadge>
        <StatusBadge variant={access?.canPatch ? "accent" : "neutral"}>
          {access?.canPatch ? "Can patch" : "Read-only"}
        </StatusBadge>
      </div>
      <dl className="detail-list">
        <div><dt>Config path</dt><dd>{formatUnknown(status?.path)}</dd></div>
        <div><dt>Base URL</dt><dd>{formatUnknown(status?.detected?.baseUrl)}</dd></div>
        <div><dt>Selected provider</dt><dd>{formatUnknown(status?.route?.providerName ?? status?.route?.providerId)}</dd></div>
        <div><dt>Selected model</dt><dd>{formatUnknown(status?.route?.modelOverride ?? status?.detected?.model)}</dd></div>
        <div><dt>Route key</dt><dd>{formatUnknown(status?.route?.key)}</dd></div>
        <div><dt>Can patch</dt><dd>{formatUnknown(access?.canPatch)}</dd></div>
        <div><dt>Unavailable reason</dt><dd>{formatUnknown(access?.reason)}</dd></div>
        <div><dt>Latest backup</dt><dd>{formatUnknown(latestBackup?.path)}</dd></div>
        <div><dt>Backup modified</dt><dd>{formatDateTime(latestBackup?.modifiedAt)}</dd></div>
      </dl>
    </SurfaceCard>
  );
}

export function ConfigHelperScreen() {
  const loadConfigStatus = useCallback(() => getClientConfigsStatus(), []);
  const { state, retry } = useAsyncResource<ClientConfigsStatusResponse>(loadConfigStatus);

  if (state.status === "loading" || state.status === "idle") {
    return <LoadingState title="Loading config helper" description="Reading read-only Hermes and Codex status." />;
  }

  if (state.status === "error") {
    return <ErrorState title="Config status unavailable" description={state.error.message} onRetry={retry} />;
  }

  const clients = state.data.clients ?? {};

  return (
    <div className="screen-stack">
      <PageHeader
        eyebrow="Config Helper"
        title="Client config status"
        description="Read-only Hermes and Codex config inspection from `/api/client-configs/status`."
      />

      <SurfaceCard title="Runtime overview">
        <dl className="detail-list">
          <div><dt>Runtime</dt><dd>{formatUnknown(state.data.runtime)}</dd></div>
          <div><dt>Proxy base URL</dt><dd>{formatUnknown(state.data.proxyBaseUrl)}</dd></div>
        </dl>
      </SurfaceCard>

      <div className="two-column-grid">
        <ClientStatusCard label="Hermes" status={clients.hermes} />
        <ClientStatusCard label="Codex" status={clients.codex} />
      </div>
    </div>
  );
}
