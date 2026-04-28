import { useCallback } from "react";
import { getHealth, getPromptCacheLatest, getProviders, getUsageStats } from "../api/client";
import type { HealthResponse, PromptCacheLatestResponse, ProvidersResponse, UsageStatsResponse } from "../api/types";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { SurfaceCard } from "../components/SurfaceCard";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatDateTime, formatNumber, formatPercent, formatUnknown, isRecord } from "../lib/format";

type DashboardData = {
  health: HealthResponse;
  providers: ProvidersResponse;
  usage: UsageStatsResponse;
  cache: PromptCacheLatestResponse;
};

export function DashboardScreen() {
  const loadDashboard = useCallback(
    () =>
      Promise.all([getHealth(), getProviders(), getUsageStats(), getPromptCacheLatest()]).then(
        ([health, providers, usage, cache]) => ({
          health,
          providers,
          usage,
          cache,
        }),
      ),
    [],
  );
  const { state, retry } = useAsyncResource<DashboardData>(loadDashboard);

  if (state.status === "loading" || state.status === "idle") {
    return <LoadingState title="Loading dashboard" description="Reading health, provider, usage, and cache telemetry." />;
  }

  if (state.status === "error") {
    return (
      <ErrorState
        title="Dashboard unavailable"
        description={state.error.message}
        onRetry={retry}
      />
    );
  }

  const { health, providers, usage, cache } = state.data;
  const stats = isRecord(usage.stats) ? usage.stats : {};
  const today = isRecord(stats.today) ? stats.today : {};
  const month = isRecord(stats.month) ? stats.month : {};
  const latest = cache.latest;
  const clientRoutes = Array.isArray(providers.clientRoutes) ? providers.clientRoutes : [];
  const providerList = Array.isArray(providers.providers) ? providers.providers : [];

  return (
    <div className="screen-stack">
      <PageHeader
        eyebrow="Dashboard"
        title="System status"
        description="Read-only overview from the current Fastify API. Production serving still stays on the legacy public UI."
      />

      <SurfaceCard className="hero-card">
        <div className="hero-status">
          <div>
            <p className="eyebrow">Service health</p>
            <h2>{health.service ?? "responses-proxy"}</h2>
            <p>{health.upstream ?? "Upstream not reported"}</p>
          </div>
          <StatusBadge variant={health.ok ? "success" : "warning"}>
            {health.ok ? "Healthy" : "Check status"}
          </StatusBadge>
        </div>
      </SurfaceCard>

      <div className="stat-grid">
        <StatCard label="Active provider" value={formatUnknown(health.activeProviderId)} />
        <StatCard label="Provider count" value={formatNumber(providerList.length)} />
        <StatCard label="Client routes" value={formatNumber(clientRoutes.length)} />
        <StatCard
          label="Cache status"
          value={latest ? (latest.cacheHit ? "Hit observed" : "Latest miss/unknown") : "No telemetry yet"}
          caption={latest?.timestamp ? formatDateTime(latest.timestamp) : "Waiting for cache telemetry"}
        />
        <StatCard
          label="Today requests"
          value={formatNumber(today.requests)}
          caption={`Hit rate ${formatPercent(today.hitRate)}`}
        />
        <StatCard
          label="Month requests"
          value={formatNumber(month.requests)}
          caption={`Saved ${formatPercent(month.avgCacheSavedPercent)}`}
        />
      </div>

      <SurfaceCard title="System overview" description="Current backend-reported runtime details.">
        <dl className="detail-list">
          <div>
            <dt>Upstream base URL</dt>
            <dd>{formatUnknown(health.upstream)}</dd>
          </div>
          <div>
            <dt>Fallback upstream</dt>
            <dd>{formatUnknown(health.fallback)}</dd>
          </div>
          <div>
            <dt>Latest cache provider</dt>
            <dd>{formatUnknown(latest?.providerId)}</dd>
          </div>
          <div>
            <dt>Latest request ID</dt>
            <dd>{formatUnknown(latest?.requestId)}</dd>
          </div>
          <div>
            <dt>Latest cached tokens</dt>
            <dd>{formatNumber(latest?.cachedTokens)}</dd>
          </div>
          <div>
            <dt>Latest saved percent</dt>
            <dd>{formatPercent(latest?.cacheSavedPercent)}</dd>
          </div>
        </dl>
      </SurfaceCard>
    </div>
  );
}
