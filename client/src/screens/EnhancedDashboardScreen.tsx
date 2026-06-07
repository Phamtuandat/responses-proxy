import { useCallback, useMemo } from "react";
import { getHealth, getPromptCacheLatest, getProviders, getUsageStats } from "../api/client";
import type { HealthResponse, PromptCacheLatestResponse, ProvidersResponse, UsageStatsResponse } from "../api/types";
import { ErrorState } from "../components/ErrorState";
import { LineChart, type LineChartDataPoint } from "../components/charts/LineChart";
import { BarChart, type BarChartDataPoint } from "../components/charts/BarChart";
import { MetricCard } from "../components/metrics/MetricCard";
import { LoadingSkeleton } from "../components/feedback/LoadingSkeleton";
import {
  AccountsIcon,
  CacheIcon,
  ProvidersIcon,
  RtkIcon,
  UsageIcon,
  AlertIcon,
  CheckCircleIcon,
} from "../components/icons";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
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

export function EnhancedDashboardScreen() {
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
  const usageData = state.status === "success" ? state.data.usage : null;

  // Real day-over-day delta for "Today's Requests" trend.
  const dailyTrend = useMemo((): { direction: 'up' | 'down' | 'neutral'; percentage: number } | undefined => {
    if (!usageData || !isRecord(usageData.stats)) return undefined;
    const daily = (usageData.stats as any).daily;
    if (!Array.isArray(daily) || daily.length < 2) return undefined;
    const sorted = [...daily].sort((a: any, b: any) =>
      String(a?.date ?? '').localeCompare(String(b?.date ?? '')),
    );
    const todayReq = Number(sorted[sorted.length - 1]?.requests ?? 0);
    const prevReq = Number(sorted[sorted.length - 2]?.requests ?? 0);
    if (!Number.isFinite(todayReq) || !Number.isFinite(prevReq) || prevReq <= 0) {
      return undefined;
    }
    const pct = ((todayReq - prevReq) / prevReq) * 100;
    return {
      direction: pct > 1 ? 'up' : pct < -1 ? 'down' : 'neutral',
      percentage: Math.round(pct * 10) / 10,
    };
  }, [usageData]);

  // Real cache hit-rate trend from session log aggregation (last 30 days).
  const cacheHitTrend = useMemo((): LineChartDataPoint[] => {
    if (!usageData || !isRecord(usageData.stats)) return [];
    const daily = (usageData.stats as any).daily;
    if (!Array.isArray(daily)) return [];
    return daily
      .filter((d: any) => d && typeof d.date === 'string')
      .map((d: any) => ({
        timestamp: new Date(d.date),
        value: typeof d.hitRate === 'number' ? d.hitRate * 100 : 0,
      }));
  }, [usageData]);

  // Real per-provider request volume from usage stats.
  const providerVolume = useMemo((): BarChartDataPoint[] => {
    if (!usageData || !isRecord(usageData.stats)) return [];
    const byProvider = (usageData.stats as any).byProvider;
    if (!Array.isArray(byProvider)) return [];
    const palette = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
    return byProvider.slice(0, 6).map((entry: any, index: number) => ({
      label: typeof entry?.name === 'string' && entry.name ? entry.name : `provider ${index + 1}`,
      value: typeof entry?.requests === 'number' ? entry.requests : 0,
      color: palette[index % palette.length],
    }));
  }, [usageData]);

  if (state.status === "loading" || state.status === "idle") {
    return (
      <div className="screen-stack">
        <PageHeader
          eyebrow="Dashboard"
          title="System Status"
          description="Live service health, provider readiness, cache activity, and request telemetry at a glance."
        />

        <div className="metric-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <LoadingSkeleton key={i} variant="metric-card" />
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-5)' }}>
          <LoadingSkeleton variant="card" height="300px" />
          <LoadingSkeleton variant="card" height="300px" />
        </div>
      </div>
    );
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

  // Calculate system health status
  const systemHealthStatus = health.ok ? 'healthy' : 'warning';
  const cacheHealthStatus = cache
    ? (latest?.cacheHit ? 'healthy' : 'warning')
    : 'error';

  return (
    <div className="screen-stack">
      <PageHeader
        eyebrow="Dashboard"
        title="System Status"
        description="Live service health, provider readiness, cache activity, and request telemetry at a glance."
      />

      {/* System Health Hero Card */}
      <SurfaceCard className="hero-card">
        <div className="hero-status">
          <div>
            <p className="eyebrow">Service Health</p>
            <h2>{health.service ?? "responses-proxy"}</h2>
            <p>{health.upstream ?? "Upstream not reported"}</p>
          </div>
          <div className="card-inline-status">
            <StatusBadge variant={health.ok ? "success" : "warning"}>
              {health.ok ? "Healthy" : "Check status"}
            </StatusBadge>
            {telemetryWarning && <StatusBadge variant="warning">{telemetryWarning}</StatusBadge>}
          </div>
        </div>
      </SurfaceCard>

      {/* Enhanced Metrics Grid */}
      <div className="metric-grid">
        <MetricCard
          title="System Health"
          value={health.ok ? "Healthy" : "Warning"}
          icon={health.ok ? CheckCircleIcon : AlertIcon}
          status={systemHealthStatus}
          description="Overall system status"
        />

        <MetricCard
          title="Active Providers"
          value={providerList.length}
          icon={ProvidersIcon}
          status="healthy"
          description={`${formatUnknown(health.activeProviderId)} currently active`}
        />

        <MetricCard
          title="Client Routes"
          value={clientRoutes.length}
          icon={AccountsIcon}
          status="healthy"
          description="Configured routing endpoints"
        />

        <MetricCard
          title="Cache Hit Rate"
          value={usage ? formatPercent(today.hitRate || 0) : "N/A"}
          icon={CacheIcon}
          status={cacheHealthStatus}
          description={cache ? formatDateTime(latest?.timestamp) : "Cache unavailable"}
        />

        <MetricCard
          title="Today's Requests"
          value={usage ? formatNumber(today.requests || 0) : "N/A"}
          icon={UsageIcon}
          status={usage ? 'healthy' : 'error'}
          description="API requests processed today"
          trend={dailyTrend ? { ...dailyTrend, period: 'vs yesterday' } : undefined}
        />

        <MetricCard
          title="Monthly Savings"
          value={usage ? formatPercent(month.avgCacheSavedPercent || 0) : "N/A"}
          icon={RtkIcon}
          status={usage ? 'healthy' : 'error'}
          description="Average cache efficiency this month"
        />
      </div>

      {/* Data Visualization Section */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
        <SurfaceCard title="Cache Hit Rate Trend" description="Daily cache hit rate over the last month.">
          {cacheHitTrend.length > 0 ? (
            <LineChart
              data={cacheHitTrend}
              title="Hit Rate %"
              height={250}
              color="#6366f1"
              fill={true}
              timeFormat="MMM d"
              valueFormatter={(value) => `${value.toFixed(1)}%`}
            />
          ) : (
            <p style={{ padding: 'var(--space-5)', color: 'var(--text-muted)' }}>
              No usage telemetry yet. Send a request through the proxy to populate this chart.
            </p>
          )}
        </SurfaceCard>

        <SurfaceCard title="Requests by Provider" description="Total requests routed to each provider this month.">
          {providerVolume.length > 0 ? (
            <BarChart
              data={providerVolume}
              title="Requests"
              height={250}
              valueFormatter={(value) => formatNumber(value)}
            />
          ) : (
            <p style={{ padding: 'var(--space-5)', color: 'var(--text-muted)' }}>
              No per-provider telemetry yet.
            </p>
          )}
        </SurfaceCard>
      </div>

      {/* System Details */}
      <SurfaceCard title="System Overview" description="Current backend-reported runtime details.">
        <dl className="detail-list">
          <div>
            <dt>Upstream Base URL</dt>
            <dd>{formatUnknown(health.upstream)}</dd>
          </div>
          <div>
            <dt>Fallback Upstream</dt>
            <dd>{formatUnknown(health.fallback)}</dd>
          </div>
          <div>
            <dt>Latest Cache Provider</dt>
            <dd>{cache ? formatUnknown(latest?.providerId) : "Unavailable"}</dd>
          </div>
          <div>
            <dt>Latest Request ID</dt>
            <dd>{cache ? formatUnknown(latest?.requestId) : "Unavailable"}</dd>
          </div>
          <div>
            <dt>Latest Cached Tokens</dt>
            <dd>{cache ? formatNumber(latest?.cachedTokens) : "Unavailable"}</dd>
          </div>
          <div>
            <dt>Latest Saved Percent</dt>
            <dd>{cache ? formatPercent(latest?.cacheSavedPercent) : "Unavailable"}</dd>
          </div>
        </dl>
      </SurfaceCard>
    </div>
  );
}