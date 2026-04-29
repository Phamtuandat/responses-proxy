import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createClient,
  deleteClient,
  getClientTokenLimits,
  getProviders,
  updateClient,
  updateClientTokenLimit,
} from "../api/client";
import type {
  ClientFormData,
  ClientFormSubmitValue,
} from "../components/ClientForm";
import { ClientForm } from "../components/ClientForm";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { InlineAlert } from "../components/InlineAlert";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { RefreshButton } from "../components/RefreshButton";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { SurfaceCard } from "../components/SurfaceCard";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatNumber, formatUnknown, isRecord } from "../lib/format";
import type {
  ClientRouteSummary,
  ClientTokenLimitSummary,
  ProviderSummary,
  ProvidersResponse,
} from "../api/types";

type ClientsScreenData = {
  providers: ProvidersResponse;
  tokenLimits: ClientTokenLimitSummary[];
  tokenLimitsWarning?: string;
};

type MutationFeedback = {
  variant: "success" | "error";
  message: string;
};

function getRouteApiKeyCount(route: ClientRouteSummary): number {
  return Array.isArray(route.apiKeys) ? route.apiKeys.length : 0;
}

function getTokenLimitEntry(map: Map<string, ClientTokenLimitSummary>, clientKey: string) {
  return map.get(clientKey) ?? null;
}

function summarizeTokenLimit(entry: ClientTokenLimitSummary | null): string {
  const config = entry && isRecord(entry.config) ? entry.config : null;
  if (!config || config.enabled !== true) {
    return "Disabled";
  }

  const tokenLimit = typeof config.tokenLimit === "number" ? config.tokenLimit.toLocaleString() : "Configured";
  const windowType = typeof config.windowType === "string" ? config.windowType : "window";
  const windowSize =
    windowType === "fixed" && typeof config.windowSizeSeconds === "number"
      ? ` • ${config.windowSizeSeconds.toLocaleString()}s`
      : "";

  return `${tokenLimit} • ${windowType}${windowSize}`;
}

function summarizeTokenStatus(entry: ClientTokenLimitSummary | null): string {
  const status = entry && isRecord(entry.status) ? entry.status : null;
  if (typeof status?.message === "string" && status.message.trim()) {
    return status.message;
  }
  if (typeof status?.state === "string" && status.state.trim()) {
    return status.state;
  }
  return entry ? summarizeTokenLimit(entry) : "Unavailable";
}

function summarizeRouteRtkPolicy(route: ClientRouteSummary): string {
  const policy = isRecord(route.rtkPolicy) ? route.rtkPolicy : null;
  if (!policy) {
    return "Not reported";
  }

  const parts = [
    typeof policy.mode === "string" ? policy.mode : null,
    typeof policy.maxChars === "number" ? `max ${policy.maxChars} chars` : null,
    typeof policy.keepLastMessages === "number" ? `keep ${policy.keepLastMessages}` : null,
  ].filter((value): value is string => Boolean(value));

  return parts.length ? parts.join(" • ") : "Configured";
}

function getProviderLabel(route: ClientRouteSummary): string {
  return typeof route.providerName === "string" && route.providerName.trim()
    ? route.providerName
    : typeof route.providerId === "string" && route.providerId.trim()
      ? route.providerId
      : "Active/default provider";
}

function clientMatchesQuery(
  route: ClientRouteSummary,
  providersById: Map<string, ProviderSummary>,
  query: string,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const provider = route.providerId ? providersById.get(route.providerId) : undefined;
  const haystack = [
    route.key,
    route.providerId,
    route.providerName,
    route.modelOverride,
    provider?.name,
    provider?.id,
    String(getRouteApiKeyCount(route)),
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());

  return haystack.some((value) => value.includes(normalized));
}

function getRouteStatus(
  route: ClientRouteSummary,
  providersById: Map<string, ProviderSummary>,
): { variant: "success" | "warning" | "accent"; label: string } {
  if (route.key === "default") {
    return { variant: "success", label: "Default" };
  }

  if (getRouteApiKeyCount(route) === 0) {
    return { variant: "warning", label: "Missing keys" };
  }

  if (route.providerId && providersById.has(route.providerId)) {
    return { variant: "accent", label: "Bound" };
  }

  return { variant: "accent", label: "Configured" };
}

function getInitialClientFormData(
  route: ClientRouteSummary,
  tokenLimit: ClientTokenLimitSummary | null,
): Partial<ClientFormData> {
  const config = tokenLimit && isRecord(tokenLimit.config) ? tokenLimit.config : null;
  return {
    client: route.key,
    providerId: route.providerId ?? "",
    model: route.modelOverride ?? "",
    apiKeysText: Array.isArray(route.apiKeys) ? route.apiKeys.join("\n") : "",
    tokenLimitEnabled: config?.enabled === true,
    tokenLimitValue: typeof config?.tokenLimit === "number" ? String(config.tokenLimit) : "",
    tokenLimitWindowType:
      config && typeof config.windowType === "string"
        ? (config.windowType as ClientFormData["tokenLimitWindowType"])
        : "monthly",
    tokenLimitWindowSizeSeconds:
      typeof config?.windowSizeSeconds === "number" ? String(config.windowSizeSeconds) : "",
    tokenLimitHardBlock: config?.hardBlock !== false,
  };
}

export function ClientsScreen() {
  const [query, setQuery] = useState("");
  const [selectedClientKey, setSelectedClientKey] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingClientKey, setEditingClientKey] = useState<string | null>(null);
  const [deletingClientKey, setDeletingClientKey] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<MutationFeedback | null>(null);

  const loadClients = useCallback(async (): Promise<ClientsScreenData> => {
    const providers = await getProviders();
    const tokenLimitResult = await Promise.resolve(getClientTokenLimits()).then(
      (value) => ({ status: "fulfilled", value } as const),
      (error) => ({ status: "rejected", error } as const),
    );

    return {
      providers,
      tokenLimits:
        tokenLimitResult.status === "fulfilled" && Array.isArray(tokenLimitResult.value.clients)
          ? tokenLimitResult.value.clients
          : [],
      tokenLimitsWarning:
        tokenLimitResult.status === "rejected" ? "Token budget data is temporarily unavailable." : undefined,
    };
  }, []);

  const { state, retry } = useAsyncResource<ClientsScreenData>(loadClients);

  const clientRoutes = useMemo(
    () => (state.status === "success" && Array.isArray(state.data.providers.clientRoutes) ? state.data.providers.clientRoutes : []),
    [state],
  );
  const providerOptions = useMemo(
    () =>
      state.status === "success" && Array.isArray(state.data.providers.providerOptions)
        ? state.data.providers.providerOptions
        : [],
    [state],
  );
  const providers = useMemo(
    () => (state.status === "success" && Array.isArray(state.data.providers.providers) ? state.data.providers.providers : []),
    [state],
  );

  const providersById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers]);
  const tokenLimitsByClient = useMemo(
    () =>
      new Map(
        (state.status === "success" ? state.data.tokenLimits : []).map((entry) => [entry.clientRoute, entry] as const),
      ),
    [state],
  );

  const filteredRoutes = useMemo(
    () => clientRoutes.filter((route) => clientMatchesQuery(route, providersById, query)),
    [clientRoutes, providersById, query],
  );

  useEffect(() => {
    if (!filteredRoutes.length) {
      if (selectedClientKey !== null) {
        setSelectedClientKey(null);
      }
      return;
    }

    if (selectedClientKey && filteredRoutes.some((route) => route.key === selectedClientKey)) {
      return;
    }

    const preferred = filteredRoutes.find((route) => route.key !== "default") ?? filteredRoutes[0];
    setSelectedClientKey(preferred.key);
  }, [filteredRoutes, selectedClientKey]);

  const selectedRoute =
    filteredRoutes.find((route) => route.key === selectedClientKey) ??
    clientRoutes.find((route) => route.key === selectedClientKey) ??
    null;
  const editingRoute = clientRoutes.find((route) => route.key === editingClientKey) ?? null;
  const deletingRoute = clientRoutes.find((route) => route.key === deletingClientKey) ?? null;

  async function saveTokenLimit(clientKey: string, value: ClientFormSubmitValue["tokenLimit"]) {
    await updateClientTokenLimit(clientKey, value);
  }

  async function handleCreate(value: ClientFormSubmitValue) {
    setIsSubmitting(true);
    setMutationError(null);
    setFeedback(null);
    try {
      await createClient({
        client: value.client,
        providerId: value.providerId,
        model: value.model,
        apiKeys: value.apiKeys,
      });
      await saveTokenLimit(value.client, value.tokenLimit);
      setFeedback({ variant: "success", message: `Created client route ${value.client}.` });
      setIsCreateOpen(false);
      retry();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Could not create client route.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleEdit(value: ClientFormSubmitValue) {
    if (!editingRoute) {
      return;
    }

    setIsSubmitting(true);
    setMutationError(null);
    setFeedback(null);
    try {
      await updateClient(editingRoute.key, {
        client: editingRoute.key,
        providerId: value.providerId,
        model: value.model,
        apiKeys: value.apiKeys,
      });
      await saveTokenLimit(editingRoute.key, value.tokenLimit);
      setFeedback({ variant: "success", message: `Saved changes for ${editingRoute.key}.` });
      setEditingClientKey(null);
      retry();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Could not update client route.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deletingRoute) {
      return;
    }

    setIsSubmitting(true);
    setMutationError(null);
    setFeedback(null);
    try {
      await deleteClient(deletingRoute.key);
      setFeedback({ variant: "success", message: `Deleted client route ${deletingRoute.key}.` });
      setDeletingClientKey(null);
      if (selectedClientKey === deletingRoute.key) {
        setSelectedClientKey(null);
      }
      retry();
    } catch (error) {
      setMutationError(error instanceof Error ? error.message : "Could not delete client route.");
      setFeedback({
        variant: "error",
        message: error instanceof Error ? error.message : "Could not delete client route.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (state.status === "loading" || state.status === "idle") {
    return <LoadingState title="Loading clients" description="Reading client routes, provider bindings, and token budgets." />;
  }

  if (state.status === "error") {
    return <ErrorState title="Clients unavailable" description={state.error.message} onRetry={retry} />;
  }

  const nonDefaultRoutes = clientRoutes.filter((route) => route.key !== "default");
  const routesWithKeys = clientRoutes.filter((route) => getRouteApiKeyCount(route) > 0);
  const routesWithModelOverride = clientRoutes.filter(
    (route) => typeof route.modelOverride === "string" && route.modelOverride.trim(),
  );
  const routesWithProviderBinding = clientRoutes.filter(
    (route) => typeof route.providerId === "string" && route.providerId.trim(),
  );
  const defaultRoute = clientRoutes.find((route) => route.key === "default") ?? null;
  const selectedTokenLimit = selectedRoute ? getTokenLimitEntry(tokenLimitsByClient, selectedRoute.key) : null;

  return (
    <div className="screen-stack">
      <PageHeader
        eyebrow="Clients"
        title="Client routes"
        description="Manage client API keys, provider bindings, model overrides, and token budgets for each route."
        actions={
          <div className="page-header-actions page-header-actions-group">
            <RefreshButton onClick={retry} />
            <button className="button-link button-primary" onClick={() => {
              setMutationError(null);
              setIsCreateOpen(true);
            }} type="button">
              New client
            </button>
          </div>
        }
      />

      {feedback ? (
        <InlineAlert
          message={feedback.message}
          title={feedback.variant === "success" ? "Client routes updated" : "Client route action failed"}
          variant={feedback.variant}
        />
      ) : null}

      {state.data.tokenLimitsWarning ? (
        <InlineAlert message={state.data.tokenLimitsWarning} title="Partial telemetry" variant="error" />
      ) : null}

      <div className="stat-grid">
        <StatCard label="Total clients" value={formatNumber(nonDefaultRoutes.length)} />
        <StatCard label="Routes with API keys" value={formatNumber(routesWithKeys.length)} />
        <StatCard label="Routes with model override" value={formatNumber(routesWithModelOverride.length)} />
        <StatCard label="Routes with binding" value={formatNumber(routesWithProviderBinding.length)} />
        <StatCard label="Default route provider" value={defaultRoute ? getProviderLabel(defaultRoute) : "Unavailable"} />
      </div>

      <SurfaceCard title="Search client routes" description="Filter by client key, provider, model override, or API key count.">
        <div className="provider-search">
          <label className="field-label" htmlFor="client-search">
            Search clients
          </label>
          <input
            className="search-input"
            id="client-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by client key, provider, model, or key count"
            type="search"
            value={query}
          />
        </div>
      </SurfaceCard>

      {clientRoutes.length === 0 ? (
        <EmptyState
          title="No client routes configured"
          description="The backend did not report any client routes yet."
        />
      ) : (
        <div className="client-layout">
          <SurfaceCard
            title="Client route list"
            description={`${formatNumber(filteredRoutes.length)} route${filteredRoutes.length === 1 ? "" : "s"} match the current filter.`}
          >
            {!filteredRoutes.length ? (
              <div className="table-empty">
                <strong>No routes match this search</strong>
                <p>Try a broader query to see the full client inventory.</p>
              </div>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table provider-table">
                  <thead>
                    <tr>
                      <th scope="col">Client</th>
                      <th scope="col">Provider</th>
                      <th scope="col">Model override</th>
                      <th className="align-right" scope="col">API keys</th>
                      <th scope="col">Token limit</th>
                      <th scope="col">Status</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRoutes.map((route) => {
                      const selected = route.key === selectedClientKey;
                      const status = getRouteStatus(route, providersById);
                      const tokenLimit = getTokenLimitEntry(tokenLimitsByClient, route.key);
                      return (
                        <tr className={selected ? "provider-row provider-row-selected" : "provider-row"} key={route.key}>
                          <td>
                            <button
                              aria-pressed={selected}
                              className="provider-row-button"
                              onClick={() => setSelectedClientKey(route.key)}
                              type="button"
                            >
                              <span className="provider-row-name">{route.key}</span>
                              <span className="provider-row-meta">{selected ? "Selected" : "View details"}</span>
                            </button>
                          </td>
                          <td>{getProviderLabel(route)}</td>
                          <td>{formatUnknown(route.modelOverride)}</td>
                          <td className="align-right">{formatNumber(getRouteApiKeyCount(route))}</td>
                          <td>{summarizeTokenLimit(tokenLimit)}</td>
                          <td>
                            <div className="provider-status-stack">
                              <StatusBadge variant={status.variant}>{status.label}</StatusBadge>
                            </div>
                          </td>
                          <td>
                            <div className="row-actions">
                              <button className="button-link row-action-button" onClick={() => {
                                setMutationError(null);
                                setEditingClientKey(route.key);
                              }} type="button">
                                Edit
                              </button>
                              <button
                                className="button-link button-danger row-action-button"
                                disabled={route.key === "default"}
                                onClick={() => {
                                  setMutationError(null);
                                  setDeletingClientKey(route.key);
                                }}
                                type="button"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SurfaceCard>

          <SurfaceCard title="Selected client route" description="Inspect route configuration without exposing client keys outside the form editor.">
            {!selectedRoute ? (
              <div className="table-empty">
                <strong>No client selected</strong>
                <p>Select a client route from the list to inspect its configuration details.</p>
              </div>
            ) : (
              <div className="provider-detail">
                <div className="hero-status">
                  <div>
                    <p className="eyebrow">Client route detail</p>
                    <h2>{selectedRoute.key}</h2>
                    <p>{getProviderLabel(selectedRoute)}</p>
                  </div>
                  <div className="card-inline-status">
                    <StatusBadge variant={getRouteStatus(selectedRoute, providersById).variant}>
                      {getRouteStatus(selectedRoute, providersById).label}
                    </StatusBadge>
                    {selectedTokenLimit && isRecord(selectedTokenLimit.config) && selectedTokenLimit.config.enabled === true ? (
                      <StatusBadge variant="accent">Budget enabled</StatusBadge>
                    ) : (
                      <StatusBadge variant="neutral">Budget disabled</StatusBadge>
                    )}
                  </div>
                </div>

                <div className="row-actions">
                  <button className="button-link" onClick={() => {
                    setMutationError(null);
                    setEditingClientKey(selectedRoute.key);
                  }} type="button">
                    Edit client
                  </button>
                  <button
                    className="button-link button-danger"
                    disabled={selectedRoute.key === "default"}
                    onClick={() => {
                      setMutationError(null);
                      setDeletingClientKey(selectedRoute.key);
                    }}
                    type="button"
                  >
                    Delete client
                  </button>
                </div>

                <dl className="detail-list">
                  <div><dt>Client key</dt><dd>{selectedRoute.key}</dd></div>
                  <div><dt>Provider</dt><dd>{getProviderLabel(selectedRoute)}</dd></div>
                  <div><dt>Model override</dt><dd>{formatUnknown(selectedRoute.modelOverride)}</dd></div>
                  <div><dt>API key count</dt><dd>{formatNumber(getRouteApiKeyCount(selectedRoute))}</dd></div>
                  <div><dt>Token budget</dt><dd>{summarizeTokenLimit(selectedTokenLimit)}</dd></div>
                  <div><dt>Token budget status</dt><dd>{summarizeTokenStatus(selectedTokenLimit)}</dd></div>
                  <div><dt>RTK policy</dt><dd>{summarizeRouteRtkPolicy(selectedRoute)}</dd></div>
                  <div>
                    <dt>Provider availability</dt>
                    <dd>{getRouteStatus(selectedRoute, providersById).label}</dd>
                  </div>
                </dl>

                {selectedTokenLimit ? (
                  <section className="provider-detail-section">
                    <h3>Token usage</h3>
                    <dl className="provider-meta-list">
                      <div>
                        <dt>Total tokens</dt>
                        <dd>{formatNumber(isRecord(selectedTokenLimit.usage) ? selectedTokenLimit.usage.totalTokens : undefined)}</dd>
                      </div>
                      <div>
                        <dt>Input tokens</dt>
                        <dd>{formatNumber(isRecord(selectedTokenLimit.usage) ? selectedTokenLimit.usage.inputTokens : undefined)}</dd>
                      </div>
                      <div>
                        <dt>Output tokens</dt>
                        <dd>{formatNumber(isRecord(selectedTokenLimit.usage) ? selectedTokenLimit.usage.outputTokens : undefined)}</dd>
                      </div>
                    </dl>
                  </section>
                ) : null}
              </div>
            )}
          </SurfaceCard>
        </div>
      )}

      {isCreateOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div aria-modal="true" className="modal-card" role="dialog">
            <ClientForm
              error={mutationError}
              isSubmitting={isSubmitting}
              mode="create"
              onCancel={() => {
                if (!isSubmitting) {
                  setIsCreateOpen(false);
                  setMutationError(null);
                }
              }}
              onSubmit={handleCreate}
              providerOptions={providerOptions}
            />
          </div>
        </div>
      ) : null}

      {editingRoute ? (
        <div className="modal-backdrop" role="presentation">
          <div aria-modal="true" className="modal-card" role="dialog">
            <ClientForm
              error={mutationError}
              initialData={getInitialClientFormData(editingRoute, getTokenLimitEntry(tokenLimitsByClient, editingRoute.key))}
              isSubmitting={isSubmitting}
              mode="edit"
              onCancel={() => {
                if (!isSubmitting) {
                  setEditingClientKey(null);
                  setMutationError(null);
                }
              }}
              onSubmit={handleEdit}
              providerOptions={providerOptions}
            />
          </div>
        </div>
      ) : null}

      {deletingRoute ? (
        <ConfirmDialog
          confirmLabel="Delete client"
          description={
            deletingRoute.key === "default"
              ? "The default client route cannot be deleted."
              : `Delete client route ${deletingRoute.key}? This removes its provider binding, model override, API keys, and token budget state.`
          }
          isSubmitting={isSubmitting}
          onCancel={() => {
            if (!isSubmitting) {
              setDeletingClientKey(null);
            }
          }}
          onConfirm={handleDelete}
          title={`Delete ${deletingRoute.key}`}
        />
      ) : null}
    </div>
  );
}
