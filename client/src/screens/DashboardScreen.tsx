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
  providers: ProvidersResponse | null;
  usage: UsageStatsResponse | null;
  cache: PromptCacheLatestResponse | null;
  telemetryWarning?: string;
};

export function DashboardScreen() {
  const loadDashboard = useCallback(
    async () => {
      const health = await getHealth();
      const telemetryResults = await Promise.allSettled([
        getProviders(),
        getUsageStats(),
        getPromptCacheLatest(),
      ]);

      const [providersResult, usageResult, cacheResult] = telemetryResults;
      const failedTelemetry = telemetryResults.filter((result) => result.status === "rejected").length;

      return {
        health,
        providers: providersResult.status === "fulfilled" ? providersResult.value : null,
        usage: usageResult.status === "fulfilled" ? usageResult.value : null,
        cache: cacheResult.status === "fulfilled" ? cacheResult.value : null,
        telemetryWarning:
          failedTelemetry > 0
            ? `${failedTelemetry} optional telemetry source${failedTelemetry === 1 ? "" : "s"} unavailable`
            : undefined,
      };
    },
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

  const { health, providers, usage, cache, telemetryWarning } = state.data;
  const stats = usage && isRecord(usage.stats) ? usage.stats : {};
  const today = isRecord(stats.today) ? stats.today : {};
  const month = isRecord(stats.month) ? stats.month : {};
  const latest = cache?.latest ?? null;
  const clientRoutes = providers && Array.isArray(providers.clientRoutes) ? providers.clientRoutes : [];
  const providerList = providers && Array.isArray(providers.providers) ? providers.providers : [];
  const cacheStatus = cache
    ? latest
      ? latest.cacheHit
        ? "Hit observed"
        : "Latest miss/unknown"
      : "No telemetry yet"
    : "Unavailable";
  const cacheCaption = cache
    ? latest?.timestamp
      ? formatDateTime(latest.timestamp)
      : "Waiting for cache telemetry"
    : "Optional endpoint unavailable";

  return (
    <div className="screen-stack">
      <PageHeader
        eyebrow="Dashboard"
        title="System status"
        description="Live service health, provider readiness, cache activity, and request telemetry at a glance."
      />

      <SurfaceCard className="hero-card">
        <div className="hero-status">
          <div>
            <p className="eyebrow">Service health</p>
            <h2>{health.service ?? "responses-proxy"}</h2>
            <p>{health.upstream ?? "Upstream not reported"}</p>
          </div>
          <div className="card-inline-status">
            <StatusBadge variant={health.ok ? "success" : "warning"}>
              {health.ok ? "Healthy" : "Check status"}
            </StatusBadge>
            {telemetryWarning ? <StatusBadge variant="warning">{telemetryWarning}</StatusBadge> : null}
          </div>
        </div>
      </SurfaceCard>

      <div className="stat-grid">
        <StatCard label="Active provider" value={formatUnknown(health.activeProviderId)} />
        <StatCard label="Provider count" value={formatNumber(providerList.length)} />
        <StatCard label="Client routes" value={formatNumber(clientRoutes.length)} />
        <StatCard
          label="Cache status"
          value={cacheStatus}
          caption={cacheCaption}
        />
        <StatCard
          label="Today requests"
          value={usage ? formatNumber(today.requests) : "Unavailable"}
          caption={usage ? `Hit rate ${formatPercent(today.hitRate)}` : "Optional endpoint unavailable"}
        />
        <StatCard
          label="Month requests"
          value={usage ? formatNumber(month.requests) : "Unavailable"}
          caption={usage ? `Saved ${formatPercent(month.avgCacheSavedPercent)}` : "Optional endpoint unavailable"}
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
            <dd>{cache ? formatUnknown(latest?.providerId) : "Unavailable"}</dd>
          </div>
          <div>
            <dt>Latest request ID</dt>
            <dd>{cache ? formatUnknown(latest?.requestId) : "Unavailable"}</dd>
          </div>
          <div>
            <dt>Latest cached tokens</dt>
            <dd>{cache ? formatNumber(latest?.cachedTokens) : "Unavailable"}</dd>
          </div>
          <div>
            <dt>Latest saved percent</dt>
            <dd>{cache ? formatPercent(latest?.cacheSavedPercent) : "Unavailable"}</dd>
          </div>
        </dl>
      </SurfaceCard>
    </div>
  );
}
