import { useCallback, useEffect, useMemo, useState } from "react";
import { getProviders } from "../api/client";
import type { ClientRouteSummary, ProviderSummary, ProvidersResponse } from "../api/types";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { RefreshButton } from "../components/RefreshButton";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { SurfaceCard } from "../components/SurfaceCard";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatDateTime, formatNumber, formatUnknown, isRecord } from "../lib/format";

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

export function ProvidersScreen() {
  const [query, setQuery] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
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

  useEffect(() => {
    if (!filteredProviders.length) {
      if (selectedProviderId !== null) {
        setSelectedProviderId(null);
      }
      return;
    }

    if (selectedProviderId && filteredProviders.some((provider) => provider.id === selectedProviderId)) {
      return;
    }

    const nextSelection =
      filteredProviders.find((provider) => isProviderActive(provider, activeProviderId)) ?? filteredProviders[0];
    if (nextSelection && nextSelection.id !== selectedProviderId) {
      setSelectedProviderId(nextSelection.id);
    }
  }, [activeProviderId, filteredProviders, selectedProviderId]);

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
  const selectedProvider =
    filteredProviders.find((provider) => provider.id === selectedProviderId) ??
    providers.find((provider) => provider.id === selectedProviderId) ??
    null;

  return (
    <div className="screen-stack">
      <PageHeader
        eyebrow="Providers"
        title="Provider inventory"
        description="Read-only React migration for provider inventory. CRUD and provider editing remain in the legacy dashboard until a later phase."
        actions={<RefreshButton onClick={retry} />}
      />

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

      {providers.length === 0 ? (
        <EmptyState
          title="No providers configured"
          description="The backend did not report any runtime providers yet."
        />
      ) : (
        <div className="provider-layout">
          <SurfaceCard
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
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProviders.map((provider) => {
                      const active = isProviderActive(provider, activeProviderId);
                      const available = isProviderAvailable(provider);
                      const selected = provider.id === selectedProviderId;
                      return (
                        <tr className={selected ? "provider-row provider-row-selected" : "provider-row"} key={provider.id}>
                          <td>
                            <button
                              aria-pressed={selected}
                              className="provider-row-button"
                              onClick={() => setSelectedProviderId(provider.id)}
                              type="button"
                            >
                              <span className="provider-row-name">{provider.name}</span>
                              <span className="provider-row-meta">{selected ? "Selected" : "View details"}</span>
                            </button>
                          </td>
                          <td>{formatUnknown(provider.id)}</td>
                          <td>{formatUnknown(provider.authMode)}</td>
                          <td className="provider-url-cell">{formatUnknown(provider.baseUrl)}</td>
                          <td className="align-right">{formatNumber(getProviderKeyCount(provider))}</td>
                          <td>
                            <div className="provider-status-stack">
                              {active ? <StatusBadge variant="success">Active</StatusBadge> : null}
                              <StatusBadge variant={available ? "accent" : "warning"}>
                                {available ? "Available" : "Needs key"}
                              </StatusBadge>
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

          <SurfaceCard title="Selected provider" description="Read-only details for the current provider selection.">
            {!selectedProvider ? (
              <div className="table-empty">
                <strong>No provider selected</strong>
                <p>Select a provider from the inventory list to inspect its runtime metadata.</p>
              </div>
            ) : (
              <div className="provider-detail">
                <div className="hero-status">
                  <div>
                    <p className="eyebrow">Provider detail</p>
                    <h2>{selectedProvider.name}</h2>
                    <p>{formatUnknown(selectedProvider.baseUrl)}</p>
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
                  <div><dt>Name</dt><dd>{formatUnknown(selectedProvider.name)}</dd></div>
                  <div><dt>ID</dt><dd>{formatUnknown(selectedProvider.id)}</dd></div>
                  <div><dt>Base URL</dt><dd>{formatUnknown(selectedProvider.baseUrl)}</dd></div>
                  <div><dt>Auth mode</dt><dd>{formatUnknown(selectedProvider.authMode)}</dd></div>
                  <div><dt>Account ID</dt><dd>{formatUnknown(selectedProvider.chatgptAccountId)}</dd></div>
                  <div><dt>Provider API keys</dt><dd>{formatNumber(getProviderKeyCount(selectedProvider))}</dd></div>
                  <div><dt>Created</dt><dd>{formatDateTime(selectedProvider.createdAt)}</dd></div>
                  <div><dt>Updated</dt><dd>{formatDateTime(selectedProvider.updatedAt)}</dd></div>
                </dl>

                <div className="provider-detail-sections">
                  <section className="provider-detail-section">
                    <h3>Capabilities</h3>
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
                  </section>

                  <section className="provider-detail-section">
                    <h3>Policies</h3>
                    <dl className="provider-meta-list">
                      <div><dt>Request policy</dt><dd>{summarizeRequestPolicy(selectedProvider)}</dd></div>
                      <div>
                        <dt>RTK policy</dt>
                        <dd>
                          {summarizeRtkPolicy(
                            isRecord(selectedProvider.capabilities)
                              ? selectedProvider.capabilities.rtkPolicy
                              : undefined,
                          )}
                        </dd>
                      </div>
                      <div><dt>Error policy</dt><dd>{summarizeErrorPolicy(selectedProvider)}</dd></div>
                    </dl>
                  </section>
                </div>
              </div>
            )}
          </SurfaceCard>
        </div>
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
    </div>
  );
}
