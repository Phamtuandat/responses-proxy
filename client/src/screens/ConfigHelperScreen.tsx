import { useCallback, useMemo, useState } from "react";
import {
  applyClientConfig,
  getClientConfigsStatus,
  getProviderModels,
  getProviders,
} from "../api/client";
import type {
  ClientConfigApplyInput,
  ClientConfigStatus,
  ClientConfigsStatusResponse,
  ClientRouteSummary,
  ProviderSummary,
  QuickApplyClientKey,
} from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { QuickApplyCard } from "../components/QuickApplyCard";
import { RefreshButton } from "../components/RefreshButton";
import { SurfaceCard } from "../components/SurfaceCard";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatDateTime, formatUnknown } from "../lib/format";

type ConfigHelperData = {
  configStatus: ClientConfigsStatusResponse;
  clientRoutes: ClientRouteSummary[];
  providerOptions: ProviderSummary[];
};

type ApplyDraft = {
  client: QuickApplyClientKey;
  baseUrl: string;
  routeApiKey: string;
  model: string;
};

type ApplyFeedback = {
  variant: "success" | "error";
  message: string;
};

function buildApplyMessage(result: {
  changed?: boolean;
  backupCreated?: boolean;
  configChanged?: boolean;
  authChanged?: boolean;
  proxyBaseUrl?: string;
}) {
  const parts = [
    result.changed ? "files updated" : "no file changes",
    result.backupCreated ? "backup created" : "no backup needed",
    result.configChanged ? "config changed" : null,
    result.authChanged ? "auth changed" : null,
    result.proxyBaseUrl ? `base URL ${result.proxyBaseUrl}` : null,
  ].filter((value): value is string => Boolean(value));

  return parts.join(" • ");
}

export function ConfigHelperScreen() {
  const [pendingApply, setPendingApply] = useState<ApplyDraft | null>(null);
  const [submittingClient, setSubmittingClient] = useState<QuickApplyClientKey | null>(null);
  const [applyErrors, setApplyErrors] = useState<Partial<Record<QuickApplyClientKey, string | null>>>({});
  const [applySuccess, setApplySuccess] = useState<Partial<Record<QuickApplyClientKey, string | null>>>({});
  const [selectedApiKeys, setSelectedApiKeys] = useState<Partial<Record<QuickApplyClientKey, string>>>({});

  const handleHermesApiKeyChange = useCallback((routeApiKey: string) => {
    setSelectedApiKeys((current) =>
      current.hermes === routeApiKey ? current : { ...current, hermes: routeApiKey },
    );
  }, []);

  const handleCodexApiKeyChange = useCallback((routeApiKey: string) => {
    setSelectedApiKeys((current) =>
      current.codex === routeApiKey ? current : { ...current, codex: routeApiKey },
    );
  }, []);

  const loadConfigStatus = useCallback(async (): Promise<ConfigHelperData> => {
    const [configStatus, providers] = await Promise.all([getClientConfigsStatus(), getProviders()]);
    return {
      configStatus,
      clientRoutes: Array.isArray(providers.clientRoutes) ? providers.clientRoutes : [],
      providerOptions: Array.isArray(configStatus.providerOptions)
        ? configStatus.providerOptions
        : Array.isArray(providers.providerOptions)
          ? providers.providerOptions
          : [],
    };
  }, []);

  const { state, retry } = useAsyncResource<ConfigHelperData>(loadConfigStatus);

  const loadHermesModels = useCallback(async () => {
    const apiKey = selectedApiKeys.hermes || "";
    const route = state.status === "success"
      ? state.data.clientRoutes.find((entry) => Array.isArray(entry.apiKeys) && entry.apiKeys.includes(apiKey))
      : undefined;
    if (!route?.providerId) {
      return [];
    }
    const response = await getProviderModels(route.providerId);
    return Array.isArray(response.models) ? response.models : [];
  }, [selectedApiKeys.hermes, state]);

  const loadCodexModels = useCallback(async () => {
    const apiKey = selectedApiKeys.codex || "";
    const route = state.status === "success"
      ? state.data.clientRoutes.find((entry) => Array.isArray(entry.apiKeys) && entry.apiKeys.includes(apiKey))
      : undefined;
    if (!route?.providerId) {
      return [];
    }
    const response = await getProviderModels(route.providerId);
    return Array.isArray(response.models) ? response.models : [];
  }, [selectedApiKeys.codex, state]);

  const hermesModels = useAsyncResource<string[]>(loadHermesModels);
  const codexModels = useAsyncResource<string[]>(loadCodexModels);

  const clients = state.status === "success" ? state.data.configStatus.clients ?? {} : {};
  const runtime = state.status === "success" ? state.data.configStatus.runtime : undefined;
  const proxyBaseUrl = state.status === "success" ? state.data.configStatus.proxyBaseUrl ?? "" : "";
  const providerOptions = state.status === "success" ? state.data.providerOptions : [];
  const clientRoutes = state.status === "success" ? state.data.clientRoutes : [];

  const runtimeReasons = useMemo(() => {
    const entries = [clients.hermes, clients.codex].filter(Boolean);
    return entries
      .map((entry) => entry?.access?.reason)
      .filter((value): value is string => typeof value === "string" && value.trim());
  }, [clients.codex, clients.hermes]);

  async function handleConfirmApply() {
    if (!pendingApply) {
      return;
    }

    const client = pendingApply.client;
    setSubmittingClient(client);
    setApplyErrors((current) => ({ ...current, [client]: null }));
    setApplySuccess((current) => ({ ...current, [client]: null }));

    try {
      const input: ClientConfigApplyInput = {
        client,
        baseUrl: pendingApply.baseUrl,
        routeApiKey: pendingApply.routeApiKey,
        model: pendingApply.model,
      };
      const response = await applyClientConfig(input);
      setApplySuccess((current) => ({
        ...current,
        [client]: buildApplyMessage(response),
      }));
      setPendingApply(null);
      retry();
    } catch (error) {
      setApplyErrors((current) => ({
        ...current,
        [client]: error instanceof Error ? error.message : "Could not apply client config.",
      }));
    } finally {
      setSubmittingClient(null);
    }
  }

  const pendingStatus =
    pendingApply?.client === "hermes"
      ? clients.hermes
      : pendingApply?.client === "codex"
        ? clients.codex
        : undefined;

  if (state.status === "loading" || state.status === "idle") {
    return <LoadingState title="Loading config helper" description="Reading Hermes and Codex quick apply status." />;
  }

  if (state.status === "error") {
    return <ErrorState title="Config status unavailable" description={state.error.message} onRetry={retry} />;
  }

  return (
    <div className="screen-stack">
      <PageHeader
        eyebrow="Config Helper"
        title="Patch local client configs"
        description="Apply Hermes and Codex config files using the existing backend quick apply behavior."
        actions={<RefreshButton onClick={retry} />}
      />

      <SurfaceCard title="Runtime overview" description="Current quick apply runtime and patch availability.">
        <dl className="detail-list">
          <div><dt>Runtime</dt><dd>{formatUnknown(runtime)}</dd></div>
          <div><dt>Proxy base URL</dt><dd>{formatUnknown(proxyBaseUrl)}</dd></div>
          <div><dt>Hermes can patch</dt><dd>{formatUnknown(clients.hermes?.access?.canPatch)}</dd></div>
          <div><dt>Codex can patch</dt><dd>{formatUnknown(clients.codex?.access?.canPatch)}</dd></div>
          <div><dt>Access status</dt><dd>{runtimeReasons[0] || "Available"}</dd></div>
          <div><dt>Latest Hermes backup</dt><dd>{formatUnknown(clients.hermes?.backups?.[0]?.path)}</dd></div>
          <div><dt>Latest Codex backup</dt><dd>{formatUnknown(clients.codex?.backups?.[0]?.path)}</dd></div>
          <div><dt>Latest backup modified</dt><dd>{formatDateTime(clients.codex?.backups?.[0]?.modifiedAt || clients.hermes?.backups?.[0]?.modifiedAt)}</dd></div>
        </dl>
      </SurfaceCard>

      <div className="quick-apply-layout">
        <QuickApplyCard
          client="hermes"
          clientRoutes={clientRoutes}
          error={applyErrors.hermes ?? null}
          isSubmitting={submittingClient === "hermes"}
          label="Hermes"
          modelOptions={hermesModels.state.status === "success" ? hermesModels.state.data : []}
          modelsError={hermesModels.state.status === "error" ? hermesModels.state.error.message : null}
          modelsLoading={hermesModels.state.status === "loading"}
          onApiKeyChange={handleHermesApiKeyChange}
          onApply={(draft) => setPendingApply(draft)}
          providerOptions={providerOptions}
          proxyBaseUrl={proxyBaseUrl}
          status={clients.hermes}
          successMessage={applySuccess.hermes ?? null}
        />

        <QuickApplyCard
          client="codex"
          clientRoutes={clientRoutes}
          error={applyErrors.codex ?? null}
          isSubmitting={submittingClient === "codex"}
          label="Codex"
          modelOptions={codexModels.state.status === "success" ? codexModels.state.data : []}
          modelsError={codexModels.state.status === "error" ? codexModels.state.error.message : null}
          modelsLoading={codexModels.state.status === "loading"}
          onApiKeyChange={handleCodexApiKeyChange}
          onApply={(draft) => setPendingApply(draft)}
          providerOptions={providerOptions}
          proxyBaseUrl={proxyBaseUrl}
          status={clients.codex}
          successMessage={applySuccess.codex ?? null}
        />
      </div>

      {pendingApply ? (
        <ConfirmDialog
          confirmLabel={`Apply ${pendingApply.client}`}
          description={`Apply ${pendingApply.client} config patch at ${pendingStatus?.path || "the configured path"} for ${pendingApply.baseUrl} using model ${pendingApply.model}. A backup may be created before files are written.`}
          isSubmitting={submittingClient === pendingApply.client}
          onCancel={() => {
            if (submittingClient !== pendingApply.client) {
              setPendingApply(null);
            }
          }}
          onConfirm={() => void handleConfirmApply()}
          title={`Apply ${pendingApply.client} config`}
        />
      ) : null}
    </div>
  );
}
