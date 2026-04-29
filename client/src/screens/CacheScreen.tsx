import { useCallback, useState } from "react";
import { getPromptCacheLatest, getProviders } from "../api/client";
import type { PromptCacheLatestResponse, ProvidersResponse } from "../api/types";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { RefreshButton } from "../components/RefreshButton";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { SurfaceCard } from "../components/SurfaceCard";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatDateTime, formatNumber, formatPercent, formatUnknown } from "../lib/format";

type CacheScreenData = {
  providers: ProvidersResponse;
  cache: PromptCacheLatestResponse;
};

export function CacheScreen() {
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const loadCache = useCallback(
    async () => {
      const [providers, cache] = await Promise.all([
        getProviders(),
        getPromptCacheLatest(selectedProviderId || undefined),
      ]);
      return { providers, cache };
    },
    [selectedProviderId],
  );
  const { state, retry } = useAsyncResource<CacheScreenData>(loadCache);

  if (state.status === "loading" || state.status === "idle") {
    return <LoadingState title="Loading cache telemetry" description="Reading the latest prompt cache observation." />;
  }

  if (state.status === "error") {
    return <ErrorState title="Cache telemetry unavailable" description={state.error.message} onRetry={retry} />;
  }

  const providers = Array.isArray(state.data.providers.providers)
    ? state.data.providers.providers
    : Array.isArray(state.data.providers.providerOptions)
      ? state.data.providers.providerOptions
      : [];
  const latest = state.data.cache.latest;

  if (!latest) {
    return (
      <div className="screen-stack">
        <PageHeader
          eyebrow="Cache"
          title="Latest prompt cache telemetry"
          description="Read-only latest cache observation from `/api/debug/prompt-cache/latest`."
          actions={<RefreshButton onClick={retry} />}
        />

        <SurfaceCard title="Provider filter" description="Optionally inspect the latest observation for one provider.">
          <div className="provider-search">
            <label className="field-label" htmlFor="cache-provider-filter">
              Provider
            </label>
            <select
              className="search-input"
              id="cache-provider-filter"
              value={selectedProviderId}
              onChange={(event) => setSelectedProviderId(event.target.value)}
            >
              <option value="">All providers</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name || provider.id}
                </option>
              ))}
            </select>
          </div>
        </SurfaceCard>

        <EmptyState
          title="No cache telemetry yet"
          description="Cache telemetry will appear after compatible requests are processed."
        />
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <PageHeader
        eyebrow="Cache"
        title="Latest prompt cache telemetry"
        description="Most recent cache observation reported by the backend."
        actions={<RefreshButton onClick={retry} />}
      />

      <SurfaceCard title="Provider filter" description="Inspect the latest cache observation globally or for one provider.">
        <div className="provider-search">
          <label className="field-label" htmlFor="cache-provider-filter">
            Provider
          </label>
          <select
            className="search-input"
            id="cache-provider-filter"
            value={selectedProviderId}
            onChange={(event) => setSelectedProviderId(event.target.value)}
          >
            <option value="">All providers</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name || provider.id}
              </option>
            ))}
          </select>
        </div>
      </SurfaceCard>

      <SurfaceCard>
        <div className="hero-status">
          <div>
            <p className="eyebrow">Latest observation</p>
            <h2>{formatUnknown(latest.providerId)}</h2>
            <p>{formatDateTime(latest.timestamp)}</p>
          </div>
          <StatusBadge variant={latest.cacheHit ? "success" : "neutral"}>
            {latest.cacheHit ? "Cache hit" : "Observed"}
          </StatusBadge>
        </div>
      </SurfaceCard>

      <div className="stat-grid">
        <StatCard label="Cached tokens" value={formatNumber(latest.cachedTokens)} />
        <StatCard label="Saved percent" value={formatPercent(latest.cacheSavedPercent)} />
        <StatCard label="Consecutive hits" value={formatNumber(latest.consecutiveCacheHits)} />
        <StatCard label="RTK chars saved" value={formatNumber(latest.rtkCharsSaved)} />
      </div>

      <SurfaceCard title="Routing context" description="Identifiers that help explain which request produced this cache observation.">
        <dl className="detail-list">
          <div>
            <dt>Provider</dt>
            <dd>{formatUnknown(latest.providerId)}</dd>
          </div>
          <div>
            <dt>Client route</dt>
            <dd>{formatUnknown(latest.clientRoute)}</dd>
          </div>
          <div>
            <dt>Request ID</dt>
            <dd>{formatUnknown(latest.requestId)}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{formatUnknown(latest.model)}</dd>
          </div>
          <div>
            <dt>Upstream target</dt>
            <dd>{formatUnknown(latest.upstreamTarget)}</dd>
          </div>
        </dl>
      </SurfaceCard>

      <SurfaceCard title="Cache identity" description="Keys and retention details reported by the backend cache telemetry.">
        <dl className="detail-list">
          <div>
            <dt>Family ID</dt>
            <dd>{formatUnknown(latest.familyId)}</dd>
          </div>
          <div>
            <dt>Static key</dt>
            <dd>{formatUnknown(latest.staticKey)}</dd>
          </div>
          <div>
            <dt>Request key</dt>
            <dd>{formatUnknown(latest.requestKey)}</dd>
          </div>
          <div>
            <dt>Prompt cache key</dt>
            <dd>{formatUnknown(latest.promptCacheKey)}</dd>
          </div>
          <div>
            <dt>Retention</dt>
            <dd>{formatUnknown(latest.promptCacheRetention)}</dd>
          </div>
        </dl>
      </SurfaceCard>

      <SurfaceCard title="Execution details" description="Only fields reported by the backend are shown.">
        <dl className="detail-list">
          <div>
            <dt>Truncation</dt>
            <dd>{formatUnknown(latest.truncation)}</dd>
          </div>
          <div>
            <dt>Reasoning effort</dt>
            <dd>{formatUnknown(latest.reasoningEffort)}</dd>
          </div>
          <div>
            <dt>Reasoning summary</dt>
            <dd>{formatUnknown(latest.reasoningSummary)}</dd>
          </div>
          <div>
            <dt>Text verbosity</dt>
            <dd>{formatUnknown(latest.textVerbosity)}</dd>
          </div>
          <div>
            <dt>Streaming</dt>
            <dd>{formatUnknown(latest.stream)}</dd>
          </div>
          <div>
            <dt>RTK applied</dt>
            <dd>{formatUnknown(latest.rtkApplied)}</dd>
          </div>
        </dl>
      </SurfaceCard>
    </div>
  );
}
