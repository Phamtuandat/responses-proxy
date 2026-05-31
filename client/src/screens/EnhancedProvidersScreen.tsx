import { useCallback, useMemo, useState } from "react";
import { createProvider, deleteProvider, getProviders, updateProvider } from "../api/client";
import type {
  ClientRouteSummary,
  ProviderMutationInput,
  ProviderSummary,
  ProvidersResponse,
  ProviderTier,
  ProviderHealth,
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
import { TierSection } from "../components/providers/TierSection";
import { ProviderTierBadge } from "../components/providers/ProviderTierBadge";
import { ProviderHealthIndicator } from "../components/providers/ProviderHealthIndicator";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatDateTime, formatNumber, formatUnknown, isRecord } from "../lib/format";

type MutationFeedback = {
  variant: "success" | "error";
  message: string;
};

type EnhancedProvider = ProviderSummary & {
  metadata?: {
    tier: ProviderTier;
    serviceKinds: string[];
    vendor: string;
    features: string[];
    description?: string;
  };
};

// Mock health data - in real implementation this would come from API
const mockProviderHealth: Record<string, ProviderHealth> = {};

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

function enhanceProviderWithMetadata(provider: ProviderSummary): EnhancedProvider {
  const capabilities = isRecord(provider.capabilities) ? provider.capabilities : {};

  // Determine tier based on provider characteristics
  let tier: ProviderTier = 'custom';
  const vendor = typeof capabilities.accountPlatform === "string" ? capabilities.accountPlatform : "Unknown";

  // Tier assignment logic based on provider characteristics
  if (provider.authMode === 'chatgpt_oauth' || vendor.toLowerCase().includes('openai')) {
    tier = 'subscription';
  } else if (capabilities.usageCheckEnabled === true) {
    tier = 'cheap';
  } else if (provider.name.toLowerCase().includes('free') || vendor.toLowerCase().includes('free')) {
    tier = 'free';
  }

  // Extract features from capabilities
  const features: string[] = [];
  if (capabilities.usageCheckEnabled === true) features.push('Usage Monitoring');
  if (capabilities.sanitizeReasoningSummary === true) features.push('Reasoning Sanitization');
  if (capabilities.accountPoolRequired === true) features.push('Account Pool');
  if (capabilities.stripMaxOutputTokens === true) features.push('Token Stripping');

  return {
    ...provider,
    metadata: {
      tier,
      serviceKinds: ['chat'], // Default to chat, could be enhanced based on capabilities
      vendor,
      features,
      description: `${vendor} provider with ${provider.authMode === 'chatgpt_oauth' ? 'OAuth' : 'API key'} authentication`
    }
  };
}

function groupProvidersByTier(providers: EnhancedProvider[]): Record<ProviderTier, EnhancedProvider[]> {
  const groups: Record<ProviderTier, EnhancedProvider[]> = {
    subscription: [],
    cheap: [],
    free: [],
    custom: []
  };

  providers.forEach(provider => {
    const tier = provider.metadata?.tier || 'custom';
    groups[tier].push(provider);
  });

  // Sort providers within each tier by name
  Object.keys(groups).forEach(tier => {
    groups[tier as ProviderTier].sort((a, b) => a.name.localeCompare(b.name));
  });

  return groups;
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
    transportMode: "responses" | "chat_completions";
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
    capabilities: {
      ...(provider && isRecord(provider.capabilities) ? provider.capabilities : {}),
      transportMode: values.transportMode,
    },
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
    transportMode:
      isRecord(provider.capabilities) && provider.capabilities.transportMode === "chat_completions"
        ? "chat_completions"
        : "responses",
  };
}

type EnhancedProvidersScreenProps = {
  providerId?: string;
};

export function EnhancedProvidersScreen({ providerId }: EnhancedProvidersScreenProps) {
  const [query, setQuery] = useState("");
  const [selectedTier, setSelectedTier] = useState<ProviderTier | 'all'>('all');
  const [feedback, setFeedback] = useState<MutationFeedback | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [deletingProviderId, setDeletingProviderId] = useState<string | null>(null);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
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

  const enhancedProviders = useMemo(
    () => providers.map(enhanceProviderWithMetadata),
    [providers]
  );

  const filteredProviders = useMemo(() => {
    return enhancedProviders.filter(provider => {
      const matchesQuery = providerMatchesQuery(provider, query);
      const matchesTier = selectedTier === 'all' || provider.metadata?.tier === selectedTier;
      return matchesQuery && matchesTier;
    });
  }, [enhancedProviders, query, selectedTier]);

  const providersByTier = useMemo(
    () => groupProvidersByTier(filteredProviders),
    [filteredProviders]
  );

  const selectedProvider = providerId ? providers.find((provider) => provider.id === providerId) ?? null : null;
  const editingProvider = providers.find((provider) => provider.id === editingProviderId) ?? null;
  const deletingProvider = providers.find((provider) => provider.id === deletingProviderId) ?? null;

  const handleProviderAction = useCallback((action: string, providerId: string) => {
    switch (action) {
      case 'edit':
        setEditingProviderId(providerId);
        break;
      case 'delete':
        setDeletingProviderId(providerId);
        break;
      case 'test':
        setTestingProviderId(providerId);
        // TODO: Implement provider connection testing
        setFeedback({ variant: "success", message: `Testing connection to provider ${providerId}...` });
        break;
      case 'create':
        setIsCreateOpen(true);
        break;
    }
  }, []);

  async function handleCreate(values: {
    name: string;
    baseUrl: string;
    authMode: "api_key" | "chatgpt_oauth";
    chatgptAccountId?: string;
    providerApiKeys?: string[];
    replaceKeys: boolean;
    transportMode: "responses" | "chat_completions";
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
    transportMode: "responses" | "chat_completions";
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
  const healthyCount = enhancedProviders.filter(p => {
    const health = mockProviderHealth[p.id];
    return health?.status === 'healthy';
  }).length;

  // Tier counts for filter tabs
  const tierCounts = {
    all: enhancedProviders.length,
    subscription: providersByTier.subscription.length,
    cheap: providersByTier.cheap.length,
    free: providersByTier.free.length,
    custom: providersByTier.custom.length,
  };

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
            : "Manage AI providers organized by tier with intelligent routing and fallback capabilities."
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
                  Add Provider
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
          {/* Enhanced Stats Grid */}
          <div className="stat-grid">
            <StatCard label="Total providers" value={formatNumber(providers.length)} />
            <StatCard label="Active provider" value={formatUnknown(activeProviderId)} />
            <StatCard label="Healthy providers" value={formatNumber(healthyCount)} />
            <StatCard label="Providers with keys" value={formatNumber(providersWithKeysCount)} />
            <StatCard label="Client routes" value={formatNumber(clientRoutes.length)} />
          </div>

          {/* Search and Filter Controls */}
          <SurfaceCard title="Search and filter" description="Find providers by name, tier, or capabilities.">
            <div className="enhanced-provider-controls">
              <div className="provider-search">
                <label className="field-label" htmlFor="provider-search">
                  Search providers
                </label>
                <input
                  className="search-input"
                  id="provider-search"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search by name, ID, URL, or vendor"
                  type="search"
                  value={query}
                />
              </div>

              <div className="tier-filter-tabs">
                <div className="tier-filter-tabs-label">Filter by tier:</div>
                <div className="tier-filter-tabs-list">
                  {(['all', 'subscription', 'cheap', 'free', 'custom'] as const).map((tier) => (
                    <button
                      key={tier}
                      className={`tier-filter-tab ${selectedTier === tier ? 'tier-filter-tab-active' : ''}`}
                      onClick={() => setSelectedTier(tier)}
                    >
                      {tier === 'all' ? (
                        <>All ({tierCounts.all})</>
                      ) : (
                        <>
                          <ProviderTierBadge tier={tier} size="sm" />
                          ({tierCounts[tier]})
                        </>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </SurfaceCard>

          {/* Tier-based Provider Organization */}
          {providers.length === 0 ? (
            <EmptyState
              title="No providers configured"
              description="Add your first AI provider to start routing requests through the proxy."
              actionLabel="Add Provider"
              actionHref="#"
              onClick={() => setIsCreateOpen(true)}
            />
          ) : filteredProviders.length === 0 ? (
            <EmptyState
              title="No providers match your search"
              description="Try adjusting your search query or tier filter to see more providers."
            />
          ) : (
            <div className="enhanced-providers-content">
              {(selectedTier === 'all' ? (['subscription', 'cheap', 'free', 'custom'] as const) : [selectedTier]).map((tier) => {
                const tierProviders = providersByTier[tier];
                if (tierProviders.length === 0 && selectedTier === 'all') return null;

                return (
                  <TierSection
                    key={tier}
                    tier={tier}
                    providers={tierProviders}
                    health={mockProviderHealth}
                    onProviderAction={handleProviderAction}
                    defaultExpanded={selectedTier !== 'all' || tier === 'subscription'}
                  />
                );
              })}
            </div>
          )}
        </>
      ) : (
        // Provider Detail View (unchanged from original)
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
      )}

      {/* Client Route Bindings (unchanged) */}
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

      {/* Modals (unchanged) */}
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