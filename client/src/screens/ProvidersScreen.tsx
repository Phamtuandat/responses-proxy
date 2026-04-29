import { useCallback, useMemo, useState } from "react";
import { createProvider, deleteProvider, getProviders, updateProvider } from "../api/client";
import type {
  ClientRouteSummary,
  ProviderMutationInput,
  ProviderSummary,
  ProvidersResponse,
} from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { InlineAlert } from "../components/InlineAlert";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { ProviderForm, type ProviderFormData } from "../components/ProviderForm";
import { RefreshButton } from "../components/RefreshButton";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { SurfaceCard } from "../components/SurfaceCard";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatDateTime, formatNumber, formatUnknown, isRecord } from "../lib/format";

type MutationFeedback = {
  variant: "success" | "error";
  message: string;
};

function getProviderKeyCount(provider: ProviderSummary): number {
  if (typeof provider.providerApiKeysCount === "number") {
    return provider.providerApiKeysCount;
  }
  if (Array.isArray(provider.providerApiKeys)) {
    return provider.providerApiKeys.length;
  }
  return provider.hasProviderApiKey ? 1 : 0;
}

function providerMatchesQuery(provider: ProviderSummary, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const capabilities = isRecord(provider.capabilities) ? provider.capabilities : {};
  const ownedBy = typeof capabilities.ownedBy === "string" ? capabilities.ownedBy : "";
  const accountPlatform = typeof capabilities.accountPlatform === "string" ? capabilities.accountPlatform : "";

  return [
    provider.id,
    provider.name,
    provider.baseUrl,
    provider.authMode,
    provider.chatgptAccountId,
    ownedBy,
    accountPlatform,
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLowerCase().includes(normalized));
}

function isProviderActive(provider: ProviderSummary, activeProviderId?: string | null): boolean {
  return provider.id === activeProviderId || provider.current === true;
}

function isProviderAvailable(provider: ProviderSummary): boolean {
  return getProviderKeyCount(provider) > 0 || provider.authMode === "chatgpt_oauth" || Boolean(provider.chatgptAccountId);
}

function summarizeRequestPolicy(provider: ProviderSummary): string {
  const capabilities = isRecord(provider.capabilities) ? provider.capabilities : {};
  const policy = isRecord(capabilities.requestParameterPolicy) ? capabilities.requestParameterPolicy : null;
  if (!policy) {
    return "Not reported";
  }

  const parts = [
    typeof policy.maxInputItems === "number" ? `max input ${policy.maxInputItems}` : null,
    typeof policy.maxToolCount === "number" ? `max tools ${policy.maxToolCount}` : null,
    typeof policy.preserveSystemMessages === "boolean"
      ? policy.preserveSystemMessages
        ? "preserve system messages"
        : "rewrite system messages"
      : null,
  ].filter((value): value is string => Boolean(value));

  return parts.length ? parts.join(" • ") : "Configured";
}

function summarizeRtkPolicy(value: unknown): string {
  const policy = isRecord(value) ? value : null;
  if (!policy) {
    return "Not reported";
  }

  const parts = [
    typeof policy.mode === "string" ? policy.mode : null,
    typeof policy.maxChars === "number" ? `max ${policy.maxChars} chars` : null,
    typeof policy.keepLastMessages === "number" ? `keep ${policy.keepLastMessages}` : null,
  ].filter((entry): entry is string => Boolean(entry));

  return parts.length ? parts.join(" • ") : "Configured";
}

function summarizeErrorPolicy(provider: ProviderSummary): string {
  const capabilities = isRecord(provider.capabilities) ? provider.capabilities : {};
  const policy = isRecord(capabilities.errorPolicy) ? capabilities.errorPolicy : null;
  const rules = policy && Array.isArray(policy.rules) ? policy.rules.length : 0;
  return rules > 0 ? `${rules} rule${rules === 1 ? "" : "s"}` : "Not reported";
}

function summarizeCapabilityPills(provider: ProviderSummary): string[] {
  const capabilities = isRecord(provider.capabilities) ? provider.capabilities : {};
  const pills = [
    typeof capabilities.ownedBy === "string" ? capabilities.ownedBy : null,
    typeof capabilities.accountPlatform === "string" ? capabilities.accountPlatform : null,
    capabilities.usageCheckEnabled === true ? "usage checks" : null,
    capabilities.sanitizeReasoningSummary === true ? "sanitized reasoning" : null,
    capabilities.accountPoolRequired === true ? "account pool" : null,
    capabilities.stripMaxOutputTokens === true ? "strips max output" : null,
  ].filter((value): value is string => Boolean(value));

  return pills;
}

function summarizeRouteRtkPolicy(route: ClientRouteSummary): string {
  return summarizeRtkPolicy(route.rtkPolicy);
}

function buildProviderPayload(
  provider: ProviderSummary | null,
  values: {
    name: string;
    baseUrl: string;
    authMode: "api_key" | "chatgpt_oauth";
    chatgptAccountId?: string;
    providerApiKeys?: string[];
    replaceKeys: boolean;
  },
): ProviderMutationInput {
  return {
    name: values.name,
    baseUrl: values.baseUrl,
    authMode: values.authMode,
    chatgptAccountId: values.authMode === "chatgpt_oauth" ? values.chatgptAccountId ?? "" : "",
    providerApiKeys: values.replaceKeys
      ? values.providerApiKeys ?? []
      : provider && Array.isArray(provider.providerApiKeys)
        ? provider.providerApiKeys
        : [],
    capabilities: provider && isRecord(provider.capabilities) ? provider.capabilities : {},
  };
}

function getInitialFormData(provider?: ProviderSummary | null): Partial<ProviderFormData> {
  if (!provider) {
    return {};
  }

  return {
    name: provider.name,
    baseUrl: provider.baseUrl,
    authMode: provider.authMode === "chatgpt_oauth" ? "chatgpt_oauth" : "api_key",
    chatgptAccountId: typeof provider.chatgptAccountId === "string" ? provider.chatgptAccountId : "",
    providerApiKeysText: "",
  };
}

type ProvidersScreenProps = {
  providerId?: string;
};

export function ProvidersScreen({ providerId }: ProvidersScreenProps) {
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState<MutationFeedback | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [deletingProviderId, setDeletingProviderId] = useState<string | null>(null);
  const [mutationTarget, setMutationTarget] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const loadProviders = useCallback(() => getProviders(), []);
  const { state, retry } = useAsyncResource<ProvidersResponse>(loadProviders);

  const providers = useMemo(
    () => (state.status === "success" && Array.isArray(state.data.providers) ? state.data.providers : []),
    [state],
  );
  const clientRoutes = useMemo(
    () => (state.status === "success" && Array.isArray(state.data.clientRoutes) ? state.data.clientRoutes : []),
    [state],
  );
  const activeProviderId = state.status === "success" ? state.data.activeProviderId : null;

  const filteredProviders = useMemo(
    () => providers.filter((provider) => providerMatchesQuery(provider, query)),
    [providers, query],
  );
  const selectedProvider = providerId ? providers.find((provider) => provider.id === providerId) ?? null : null;
  const editingProvider = providers.find((provider) => provider.id === editingProviderId) ?? null;
  const deletingProvider = providers.find((provider) => provider.id === deletingProviderId) ?? null;

  async function handleCreate(values: {
    name: string;
    baseUrl: string;
    authMode: "api_key" | "chatgpt_oauth";
    chatgptAccountId?: string;
    providerApiKeys?: string[];
    replaceKeys: boolean;
  }) {
    setMutationTarget("create");
    try {
      await createProvider(buildProviderPayload(null, values));
      setFeedback({ variant: "success", message: `Created provider ${values.name}.` });
      setIsCreateOpen(false);
      retry();
    } finally {
      setMutationTarget(null);
    }
  }

  async function handleEdit(values: {
    name: string;
    baseUrl: string;
    authMode: "api_key" | "chatgpt_oauth";
    chatgptAccountId?: string;
    providerApiKeys?: string[];
    replaceKeys: boolean;
  }) {
    if (!editingProvider) {
      throw new Error("Provider no longer exists.");
    }

    setMutationTarget(editingProvider.id);
    try {
      await updateProvider(editingProvider.id, buildProviderPayload(editingProvider, values));
      setFeedback({ variant: "success", message: `Saved changes for ${values.name}.` });
      setEditingProviderId(null);
      retry();
    } finally {
      setMutationTarget(null);
    }
  }

  async function handleDeleteConfirm() {
    if (!deletingProvider) {
      return;
    }

    setIsDeleting(true);
    setFeedback(null);
    try {
      await deleteProvider(deletingProvider.id);
      setFeedback({ variant: "success", message: `Deleted provider ${deletingProvider.name}.` });
      setDeletingProviderId(null);
      if (providerId === deletingProvider.id) {
        window.location.hash = "#/providers";
      }
      retry();
    } catch (caughtError) {
      setFeedback({
        variant: "error",
        message: caughtError instanceof Error ? caughtError.message : "Could not delete provider.",
      });
    } finally {
      setIsDeleting(false);
    }
  }

  if (state.status === "loading" || state.status === "idle") {
    return <LoadingState title="Loading providers" description="Reading the provider inventory and client route bindings." />;
  }

  if (state.status === "error") {
    return <ErrorState title="Providers unavailable" description={state.error.message} onRetry={retry} />;
  }

  const providersWithKeysCount = providers.filter((provider) => getProviderKeyCount(provider) > 0).length;
  const accountBackedCount = providers.filter(
    (provider) => provider.authMode === "chatgpt_oauth" || Boolean(provider.chatgptAccountId),
  ).length;

  return (
    <div className="screen-stack">
      <PageHeader
        eyebrow={providerId ? "Provider detail" : "Providers"}
        title={providerId && selectedProvider ? selectedProvider.name : "Provider inventory"}
        description={
          providerId
            ? selectedProvider
              ? formatUnknown(selectedProvider.baseUrl)
              : "Inspect provider metadata, policies, and capability summaries."
            : "Manage upstream providers, account-backed routes, request policy metadata, and key coverage."
        }
        actions={
          <div className="page-header-actions page-header-actions-group">
            {providerId ? (
              <>
                <a className="button-link" href="#/providers">
                  Back to providers
                </a>
                {selectedProvider ? (
                  <>
                    <button className="button-link" onClick={() => setEditingProviderId(selectedProvider.id)} type="button">
                      Edit provider
                    </button>
                    <button
                      className="button-link button-danger"
                      onClick={() => setDeletingProviderId(selectedProvider.id)}
                      type="button"
                    >
                      Delete provider
                    </button>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <RefreshButton onClick={retry} />
                <button className="button-link button-primary" onClick={() => setIsCreateOpen(true)} type="button">
                  Create Provider
                </button>
              </>
            )}
          </div>
        }
      />

      {feedback ? (
        <InlineAlert
          message={feedback.message}
          title={feedback.variant === "success" ? "Provider updated" : "Provider action failed"}
          variant={feedback.variant}
        />
      ) : null}

      {!providerId ? (
        <>
          <div className="stat-grid">
            <StatCard label="Total providers" value={formatNumber(providers.length)} />
            <StatCard label="Active provider" value={formatUnknown(activeProviderId)} />
            <StatCard label="Providers with keys" value={formatNumber(providersWithKeysCount)} />
            <StatCard label="Client routes" value={formatNumber(clientRoutes.length)} />
            <StatCard label="OAuth/account-backed" value={formatNumber(accountBackedCount)} />
          </div>

          <SurfaceCard title="Search providers" description="Filter by name, ID, base URL, auth mode, or capability metadata.">
            <div className="provider-search">
              <label className="field-label" htmlFor="provider-search">
                Search provider inventory
              </label>
              <input
                className="search-input"
                id="provider-search"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by provider name, ID, URL, auth mode, or owner"
                type="search"
                value={query}
              />
            </div>
          </SurfaceCard>
        </>
      ) : null}

      {providerId ? (
        !selectedProvider ? (
          <EmptyState
            title="Provider not found"
            description="This provider ID is not available in the current runtime snapshot."
            actionHref="#/providers"
            actionLabel="Back to providers"
          />
        ) : (
          <div className="screen-stack">
            <div className="detail-page-grid">
              <SurfaceCard title="Overview" description="Provider identity, connectivity, and lifecycle metadata.">
                <div className="provider-detail">
                  <div className="hero-status">
                    <div>
                      <p className="eyebrow">Provider detail</p>
                      <h2>{selectedProvider.name}</h2>
                      <p className="long-value">{formatUnknown(selectedProvider.baseUrl)}</p>
                    </div>
                    <div className="card-inline-status">
                      {isProviderActive(selectedProvider, activeProviderId) ? (
                        <StatusBadge variant="success">Active</StatusBadge>
                      ) : null}
                      <StatusBadge variant={isProviderAvailable(selectedProvider) ? "accent" : "warning"}>
                        {isProviderAvailable(selectedProvider) ? "Available" : "Needs key"}
                      </StatusBadge>
                      <StatusBadge variant="neutral">{formatUnknown(selectedProvider.authMode)}</StatusBadge>
                    </div>
                  </div>

                  <dl className="detail-list">
                    <div><dt>Name</dt><dd className="long-value">{formatUnknown(selectedProvider.name)}</dd></div>
                    <div><dt>ID</dt><dd className="long-value">{formatUnknown(selectedProvider.id)}</dd></div>
                    <div><dt>Base URL</dt><dd className="long-value">{formatUnknown(selectedProvider.baseUrl)}</dd></div>
                    <div><dt>Auth mode</dt><dd>{formatUnknown(selectedProvider.authMode)}</dd></div>
                    <div><dt>Account ID</dt><dd className="long-value">{formatUnknown(selectedProvider.chatgptAccountId)}</dd></div>
                    <div><dt>Provider API keys</dt><dd>{formatNumber(getProviderKeyCount(selectedProvider))}</dd></div>
                    <div><dt>Created</dt><dd>{formatDateTime(selectedProvider.createdAt)}</dd></div>
                    <div><dt>Updated</dt><dd>{formatDateTime(selectedProvider.updatedAt)}</dd></div>
                  </dl>
                </div>
              </SurfaceCard>

              <SurfaceCard title="Policies" description="Current request, RTK, and error policy summary.">
                <section className="provider-detail-section">
                  <dl className="provider-meta-list">
                    <div><dt>Request policy</dt><dd className="long-value">{summarizeRequestPolicy(selectedProvider)}</dd></div>
                    <div>
                      <dt>RTK policy</dt>
                      <dd className="long-value">
                        {summarizeRtkPolicy(
                          isRecord(selectedProvider.capabilities) ? selectedProvider.capabilities.rtkPolicy : undefined,
                        )}
                      </dd>
                    </div>
                    <div><dt>Error policy</dt><dd className="long-value">{summarizeErrorPolicy(selectedProvider)}</dd></div>
                  </dl>
                </section>
              </SurfaceCard>
            </div>

            <SurfaceCard title="Capabilities" description="Capability labels reported by the provider runtime.">
              <div className="metadata-pills">
                {summarizeCapabilityPills(selectedProvider).length ? (
                  summarizeCapabilityPills(selectedProvider).map((item) => (
                    <span className="metadata-pill" key={item}>
                      {item}
                    </span>
                  ))
                ) : (
                  <span className="metadata-pill">No extra capability labels reported</span>
                )}
              </div>
            </SurfaceCard>
          </div>
        )
      ) : providers.length === 0 ? (
        <EmptyState
          title="No providers configured"
          description="The backend did not report any runtime providers yet."
        />
      ) : (
        <SurfaceCard
          className="list-card list-table"
          title="Provider list"
          description={`${formatNumber(filteredProviders.length)} provider${filteredProviders.length === 1 ? "" : "s"} match the current filter.`}
        >
          {!filteredProviders.length ? (
            <div className="table-empty">
              <strong>No providers match this search</strong>
              <p>Try a broader query to see the full provider inventory.</p>
            </div>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table provider-table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">ID</th>
                    <th scope="col">Auth</th>
                    <th scope="col">Base URL</th>
                    <th className="align-right" scope="col">Keys</th>
                    <th scope="col">Status</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProviders.map((provider) => {
                    const active = isProviderActive(provider, activeProviderId);
                    const available = isProviderAvailable(provider);
                    const isEditingRow = mutationTarget === provider.id;

                    return (
                      <tr className="provider-row" key={provider.id}>
                        <td className="table-cell-long">
                          <button
                            className="item-title-link"
                            onClick={() => setEditingProviderId(provider.id)}
                            type="button"
                          >
                            {provider.name}
                          </button>
                          <span className="item-meta">{active ? "Active provider • Click to edit" : "Click to edit"}</span>
                        </td>
                        <td className="table-cell-long">
                          <span className="long-value">{formatUnknown(provider.id)}</span>
                        </td>
                        <td>{formatUnknown(provider.authMode)}</td>
                        <td className="provider-url-cell table-cell-long">
                          <span className="long-value">{formatUnknown(provider.baseUrl)}</span>
                        </td>
                        <td className="align-right">{formatNumber(getProviderKeyCount(provider))}</td>
                        <td>
                          <div className="provider-status-stack">
                            {active ? <StatusBadge variant="success">Active</StatusBadge> : null}
                            <StatusBadge variant={available ? "accent" : "warning"}>
                              {available ? "Available" : "Needs key"}
                            </StatusBadge>
                          </div>
                        </td>
                        <td>
                          <div className="row-actions">
                            <a className="button-link row-action-button" href={`#/providers/${encodeURIComponent(provider.id)}`}>
                              Details
                            </a>
                            <button className="button-link row-action-button" onClick={() => setEditingProviderId(provider.id)} type="button">
                              {isEditingRow ? "Saving..." : "Edit"}
                            </button>
                            <button
                              className="button-link button-danger row-action-button"
                              onClick={() => setDeletingProviderId(provider.id)}
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
      )}

      <SurfaceCard title="Client route bindings" description="Read-only route-to-provider mapping and policy summary.">
        {!clientRoutes.length ? (
          <div className="table-empty">
            <strong>No client routes reported</strong>
            <p>The backend did not return any route bindings for the current runtime.</p>
          </div>
        ) : (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Client route</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Model override</th>
                  <th className="align-right" scope="col">API key count</th>
                  <th scope="col">RTK policy</th>
                </tr>
              </thead>
              <tbody>
                {clientRoutes.map((route) => (
                  <tr key={route.key}>
                    <td>{formatUnknown(route.key)}</td>
                    <td>{formatUnknown(route.providerName ?? route.providerId)}</td>
                    <td>{formatUnknown(route.modelOverride)}</td>
                    <td className="align-right">{formatNumber(Array.isArray(route.apiKeys) ? route.apiKeys.length : 0)}</td>
                    <td>{summarizeRouteRtkPolicy(route)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      {isCreateOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div aria-modal="true" className="modal-card" role="dialog">
            <ProviderForm mode="create" onCancel={() => setIsCreateOpen(false)} onSubmit={handleCreate} />
          </div>
        </div>
      ) : null}

      {editingProvider ? (
        <div className="modal-backdrop" role="presentation">
          <div aria-modal="true" className="modal-card" role="dialog">
            <ProviderForm
              initialData={getInitialFormData(editingProvider)}
              mode="edit"
              onCancel={() => setEditingProviderId(null)}
              onSubmit={handleEdit}
            />
          </div>
        </div>
      ) : null}

      {deletingProvider ? (
        <ConfirmDialog
          confirmLabel="Delete provider"
          description={`Delete ${deletingProvider.name}? This removes the runtime provider from the backend. This action cannot be undone from this screen.`}
          isSubmitting={isDeleting}
          onCancel={() => {
            if (!isDeleting) {
              setDeletingProviderId(null);
            }
          }}
          onConfirm={handleDeleteConfirm}
          title={`Delete ${deletingProvider.name}`}
        />
      ) : null}
    </div>
  );
}
