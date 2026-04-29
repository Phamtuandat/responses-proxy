import { useCallback, useEffect, useState } from "react";
import { getLiveUsage, getUsageStats } from "../api/client";
import type {
  LiveUsageProvider,
  LiveUsageResponse,
  UsageDimensionBucket,
  UsageStatsBucket,
  UsageStatsResponse,
} from "../api/types";
import { DataTable } from "../components/DataTable";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { RefreshButton } from "../components/RefreshButton";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { SurfaceCard } from "../components/SurfaceCard";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatDateTime, formatNumber, formatPercent, formatUnknown, isRecord } from "../lib/format";

type LiveUsageState =
  | { status: "idle" | "loading"; data?: LiveUsageResponse; error?: undefined }
  | { status: "success"; data: LiveUsageResponse; error?: undefined }
  | { status: "error"; data?: LiveUsageResponse; error: Error };

type LiveUsageRow = Record<string, unknown> & {
  providerId: string;
  providerName: string;
  state: "available" | "blocked" | "error";
  allowed?: boolean;
  remaining?: number;
  limit?: number;
  used?: number;
  configured?: boolean;
  timestamp?: string;
  error?: string;
};

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

function buildLiveUsageRows(providers: LiveUsageProvider[]): LiveUsageRow[] {
  return providers.map((provider) => {
    const usage = isRecord(provider.usage) ? provider.usage : {};
    const allowed = typeof usage.allowed === "boolean" ? usage.allowed : undefined;
    const state = provider.ok === false || allowed === false
      ? provider.error
        ? "error"
        : "blocked"
      : "available";

    return {
      providerId: provider.providerId || "unknown",
      providerName: provider.providerName || provider.providerId || "Provider",
      state,
      allowed,
      remaining: typeof usage.remaining === "number" ? usage.remaining : undefined,
      limit: typeof usage.limit === "number" ? usage.limit : undefined,
      used: typeof usage.used === "number" ? usage.used : undefined,
      configured: provider.configured,
      timestamp: provider.timestamp,
      error: provider.error,
    };
  });
}

export function UsageScreen() {
  const loadUsage = useCallback(() => getUsageStats(), []);
  const { state, retry } = useAsyncResource<UsageStatsResponse>(loadUsage);
  const [liveState, setLiveState] = useState<LiveUsageState>({ status: "idle" });

  const refreshLiveUsage = useCallback(async () => {
    setLiveState((current) => ({ status: "loading", data: current.data }));
    try {
      const data = await getLiveUsage();
      setLiveState({ status: "success", data });
    } catch (error) {
      setLiveState((current) => ({
        status: "error",
        data: current.data,
        error: error instanceof Error ? error : new Error("Live usage refresh failed."),
      }));
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      setLiveState((current) => ({ status: "loading", data: current.data }));
      try {
        const data = await getLiveUsage();
        if (active) {
          setLiveState({ status: "success", data });
        }
      } catch (error) {
        if (active) {
          setLiveState((current) => ({
            status: "error",
            data: current.data,
            error: error instanceof Error ? error : new Error("Live usage refresh failed."),
          }));
        }
      }
    }

    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 30_000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

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
  const liveProviders = Array.isArray(liveState.data?.providers) ? liveState.data.providers : [];
  const liveRows = buildLiveUsageRows(liveProviders);
  const liveTimestamp = liveState.data?.timestamp || liveState.data?.updatedAt;

  if (!hasUsage) {
    return (
      <div className="screen-stack">
        <PageHeader
          eyebrow="Usage"
          title="Usage summaries"
          description="Read-only cache and RTK summaries will appear after the proxy has processed logged requests."
          actions={<RefreshButton label="Refresh live" onClick={refreshLiveUsage} />}
        />
        <SurfaceCard>
          <div className="table-empty">
            <strong>No usage data yet</strong>
            <p>Usage summaries will appear after requests are processed and session logs are available.</p>
          </div>
        </SurfaceCard>
        <LiveUsagePanel
          liveRows={liveRows}
          liveState={liveState}
          liveTimestamp={liveTimestamp}
          onRefresh={refreshLiveUsage}
        />
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <PageHeader
        eyebrow="Usage"
        title="Usage summaries"
        description="Read-only cache, RTK, and live provider usage. Live data refreshes every 30 seconds."
        actions={
          <div className="table-actions">
            <RefreshButton label="Refresh stats" onClick={retry} />
            <RefreshButton label="Refresh live" onClick={refreshLiveUsage} />
          </div>
        }
      />

      <LiveUsagePanel
        liveRows={liveRows}
        liveState={liveState}
        liveTimestamp={liveTimestamp}
        onRefresh={refreshLiveUsage}
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

function LiveUsagePanel({
  liveRows,
  liveState,
  liveTimestamp,
  onRefresh,
}: {
  liveRows: LiveUsageRow[];
  liveState: LiveUsageState;
  liveTimestamp?: string;
  onRefresh: () => void;
}) {
  const isRefreshing = liveState.status === "loading";

  return (
    <SurfaceCard
      title="Live provider usage"
      description={`Read-only allowance checks from /api/providers/live-usage${
        liveTimestamp ? ` · last updated ${formatDateTime(liveTimestamp)}` : ""
      }.`}
    >
      <div className="table-actions">
        <RefreshButton label={isRefreshing ? "Refreshing…" : "Refresh live"} onClick={onRefresh} />
      </div>

      {liveState.status === "error" ? (
        <div className="inline-alert inline-alert-error">
          <strong>Live usage refresh failed</strong>
          <p>{liveState.error.message}</p>
        </div>
      ) : null}

      <DataTable
        columns={[
          {
            key: "providerName",
            label: "Provider",
            render: (_value, row) => (
              <div className="provider-status-stack">
                <strong>{String(row.providerName)}</strong>
                <span>{String(row.providerId)}</span>
              </div>
            ),
          },
          {
            key: "state",
            label: "State",
            render: (_value, row) => (
              <StatusBadge
                variant={
                  row.state === "available" ? "success" : row.state === "blocked" ? "warning" : "danger"
                }
              >
                {String(row.state)}
              </StatusBadge>
            ),
          },
          {
            key: "allowed",
            label: "Allowed",
            render: (value) => (typeof value === "boolean" ? (value ? "Yes" : "No") : "Unknown"),
          },
          { key: "remaining", label: "Remaining", align: "right", render: (value) => formatNumber(value) },
          { key: "limit", label: "Limit", align: "right", render: (value) => formatNumber(value) },
          { key: "used", label: "Used", align: "right", render: (value) => formatNumber(value) },
          {
            key: "configured",
            label: "Configured",
            render: (value) => (typeof value === "boolean" ? (value ? "Yes" : "No") : "Unknown"),
          },
          { key: "timestamp", label: "Checked", render: (value) => formatDateTime(value) },
          { key: "error", label: "Note", render: (value) => formatUnknown(value) },
        ]}
        emptyDescription={
          isRefreshing
            ? "Checking provider usage now."
            : "Live usage appears for OAuth-backed providers and providers with usage checks enabled."
        }
        emptyTitle={isRefreshing ? "Refreshing live usage" : "No live usage providers"}
        rows={liveRows}
      />
    </SurfaceCard>
  );
}
