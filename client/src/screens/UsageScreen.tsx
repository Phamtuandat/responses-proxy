import { useCallback } from "react";
import { getUsageStats } from "../api/client";
import type { UsageDimensionBucket, UsageStatsBucket, UsageStatsResponse } from "../api/types";
import { DataTable } from "../components/DataTable";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { StatCard } from "../components/StatCard";
import { SurfaceCard } from "../components/SurfaceCard";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatNumber, formatPercent, isRecord } from "../lib/format";

function renderCacheCards(label: string, bucket: UsageStatsBucket) {
  return (
    <div className="stat-grid">
      <StatCard label={`${label} requests`} value={formatNumber(bucket.requests)} />
      <StatCard label={`${label} hit rate`} value={formatPercent(bucket.hitRate)} />
      <StatCard label={`${label} cached tokens`} value={formatNumber(bucket.totalCachedTokens)} />
      <StatCard label={`${label} avg saved`} value={formatPercent(bucket.avgCacheSavedPercent)} />
    </div>
  );
}

function renderRtkCards(label: string, bucket: UsageStatsBucket) {
  if (typeof bucket.rtkRequests !== "number" || bucket.rtkRequests <= 0) {
    return null;
  }

  return (
    <div className="stat-grid">
      <StatCard label={`${label} RTK requests`} value={formatNumber(bucket.rtkRequests)} />
      <StatCard label={`${label} RTK applied`} value={formatNumber(bucket.rtkAppliedRequests)} />
      <StatCard label={`${label} RTK applied rate`} value={formatPercent(bucket.rtkAppliedRate)} />
      <StatCard label={`${label} chars saved`} value={formatNumber(bucket.rtkCharsSaved)} />
    </div>
  );
}

export function UsageScreen() {
  const loadUsage = useCallback(() => getUsageStats(), []);
  const { state, retry } = useAsyncResource<UsageStatsResponse>(loadUsage);

  if (state.status === "loading" || state.status === "idle") {
    return <LoadingState title="Loading usage" description="Reading usage summaries from session logs." />;
  }

  if (state.status === "error") {
    return <ErrorState title="Usage stats unavailable" description={state.error.message} onRetry={retry} />;
  }

  const stats = isRecord(state.data.stats) ? state.data.stats : {};
  const today = isRecord(stats.today) ? (stats.today as UsageStatsBucket) : {};
  const month = isRecord(stats.month) ? (stats.month as UsageStatsBucket) : {};
  const byProvider = Array.isArray(stats.byProvider) ? (stats.byProvider as UsageDimensionBucket[]) : [];
  const byClientRoute = Array.isArray(stats.byClientRoute) ? (stats.byClientRoute as UsageDimensionBucket[]) : [];
  const hasUsage = typeof today.requests === "number" || typeof month.requests === "number";

  if (!hasUsage) {
    return (
      <SurfaceCard>
        <PageHeader
          eyebrow="Usage"
          title="Usage summaries"
          description="Read-only cache and RTK summaries will appear after the proxy has processed logged requests."
        />
        <div className="table-empty">
          <strong>No usage data yet</strong>
          <p>Usage summaries will appear after requests are processed and session logs are available.</p>
        </div>
      </SurfaceCard>
    );
  }

  return (
    <div className="screen-stack">
      <PageHeader
        eyebrow="Usage"
        title="Usage summaries"
        description="Read-only cache and RTK summaries from `/api/stats/usage`."
      />

      <SurfaceCard title="Today cache stats">{renderCacheCards("Today", today)}</SurfaceCard>
      <SurfaceCard title="This month cache stats">{renderCacheCards("Month", month)}</SurfaceCard>

      {renderRtkCards("Today", today) ? <SurfaceCard title="Today RTK stats">{renderRtkCards("Today", today)}</SurfaceCard> : null}
      {renderRtkCards("Month", month) ? <SurfaceCard title="This month RTK stats">{renderRtkCards("Month", month)}</SurfaceCard> : null}

      <SurfaceCard title="Provider cache table" description="Top providers by logged request volume this month.">
        <DataTable
          columns={[
            { key: "key", label: "Provider" },
            { key: "requests", label: "Requests", align: "right" },
            { key: "hitRate", label: "Hit rate", align: "right", render: (value) => formatPercent(value) },
            { key: "totalCachedTokens", label: "Cached tokens", align: "right", render: (value) => formatNumber(value) },
            { key: "avgCacheSavedPercent", label: "Avg saved", align: "right", render: (value) => formatPercent(value) },
          ]}
          emptyDescription="Provider cache telemetry has not been reported yet."
          emptyTitle="No provider usage yet"
          rows={byProvider}
        />
      </SurfaceCard>

      <SurfaceCard title="Client route usage table" description="Read-only route usage and cache telemetry.">
        <DataTable
          columns={[
            { key: "key", label: "Client route" },
            { key: "requests", label: "Requests", align: "right", render: (value) => formatNumber(value) },
            { key: "hitRate", label: "Hit rate", align: "right", render: (value) => formatPercent(value) },
            { key: "rtkRequests", label: "RTK reqs", align: "right", render: (value) => formatNumber(value) },
            { key: "rtkCharsSaved", label: "RTK chars saved", align: "right", render: (value) => formatNumber(value) },
          ]}
          emptyDescription="Client route usage will appear when route-specific logs exist."
          emptyTitle="No client route usage yet"
          rows={byClientRoute}
        />
      </SurfaceCard>
    </div>
  );
}
