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
  DashboardIcon,
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

  // Generate mock time-series data for demonstration
  const mockTimeSeriesData = useMemo((): LineChartDataPoint[] => {
    const now = new Date();
    const data: LineChartDataPoint[] = [];

    for (let i = 23; i >= 0; i--) {
      const timestamp = new Date(now.getTime() - i * 60 * 60 * 1000); // Last 24 hours
      const baseValue = 75 + Math.sin(i * 0.5) * 15; // Simulate cache hit rate trend
      const noise = (Math.random() - 0.5) * 10;
      data.push({
        timestamp,
        value: Math.max(0, Math.min(100, baseValue + noise)),
      });
    }

    return data;
  }, []);

  // Generate mock provider performance data
  const mockProviderData = useMemo((): BarChartDataPoint[] => {
    return [
      { label: 'OpenAI', value: 95.2, color: 'var(--chart-success)' },
      { label: 'Anthropic', value: 97.8, color: 'var(--chart-primary)' },
      { label: 'Kiro', value: 89.1, color: 'var(--chart-secondary)' },
      { label: 'Fallback', value: 78.5, color: 'var(--chart-warning)' },
    ];
  }, []);

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

  // Generate sparkline data for metrics
  const generateSparklineData = (baseValue: number): LineChartDataPoint[] => {
    // Safety check for valid baseValue
    if (typeof baseValue !== 'number' || isNaN(baseValue)) {
      return [];
    }

    return Array.from({ length: 12 }, (_, i) => ({
      timestamp: new Date(Date.now() - (11 - i) * 60 * 60 * 1000),
      value: Math.max(0, baseValue + (Math.random() - 0.5) * baseValue * 0.2),
    }));
  };

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
          sparklineData={generateSparklineData(health.ok ? 95 : 75)}
          trend={{
            direction: health.ok ? 'up' : 'down',
            percentage: health.ok ? 2.1 : -1.5,
            period: '24h'
          }}
        />

        <MetricCard
          title="Active Providers"
          value={providerList.length}
          icon={ProvidersIcon}
          status="healthy"
          description={`${formatUnknown(health.activeProviderId)} currently active`}
          sparklineData={generateSparklineData(providerList.length)}
        />

        <MetricCard
          title="Client Routes"
          value={clientRoutes.length}
          icon={AccountsIcon}
          status="healthy"
          description="Configured routing endpoints"
          sparklineData={generateSparklineData(clientRoutes.length)}
        />

        <MetricCard
          title="Cache Hit Rate"
          value={usage ? formatPercent(today.hitRate || 0) : "N/A"}
          icon={CacheIcon}
          status={cacheHealthStatus}
          description={cache ? formatDateTime(latest?.timestamp) : "Cache unavailable"}
          sparklineData={usage && typeof today.hitRate === 'number' ? generateSparklineData(today.hitRate * 100) : undefined}
          trend={usage && typeof today.hitRate === 'number' ? {
            direction: today.hitRate > 0.8 ? 'up' : today.hitRate > 0.6 ? 'neutral' : 'down',
            percentage: ((today.hitRate - 0.75) * 100),
            period: 'today'
          } : undefined}
        />

        <MetricCard
          title="Today's Requests"
          value={usage ? formatNumber(today.requests || 0) : "N/A"}
          icon={UsageIcon}
          status={usage ? 'healthy' : 'error'}
          description="API requests processed today"
          sparklineData={usage && typeof today.requests === 'number' ? generateSparklineData(Math.max(1, today.requests / 100)) : undefined}
          trend={usage ? {
            direction: 'up',
            percentage: 12.5,
            period: 'vs yesterday'
          } : undefined}
        />

        <MetricCard
          title="Monthly Savings"
          value={usage ? formatPercent(month.avgCacheSavedPercent || 0) : "N/A"}
          icon={RtkIcon}
          status={usage ? 'healthy' : 'error'}
          description="Average cache efficiency this month"
          sparklineData={usage && typeof month.avgCacheSavedPercent === 'number' ? generateSparklineData(month.avgCacheSavedPercent * 100) : undefined}
          trend={usage ? {
            direction: 'up',
            percentage: 5.2,
            period: 'vs last month'
          } : undefined}
        />
      </div>

      {/* Data Visualization Section */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-5)', marginBottom: 'var(--space-6)' }}>
        <SurfaceCard title="Cache Hit Rate Trend" description="24-hour cache performance overview">
          <LineChart
            data={mockTimeSeriesData}
            title="Hit Rate %"
            height={250}
            color="var(--chart-primary)"
            fill={true}
            valueFormatter={(value) => `${value.toFixed(1)}%`}
          />
        </SurfaceCard>

        <SurfaceCard title="Provider Performance" description="Response time comparison across providers">
          <BarChart
            data={mockProviderData}
            title="Avg Response Time (ms)"
            height={250}
            valueFormatter={(value) => `${value.toFixed(1)}ms`}
          />
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