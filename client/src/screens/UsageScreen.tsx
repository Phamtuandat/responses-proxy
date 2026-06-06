/**
 * Usage & Analytics Screen — 9Router clone.
 *
 * Layout:
 * - Tabs: Overview | Details
 * - Period selector: Today | 7D | 30D
 * - Overview:
 *   - 4 summary cards (Total Requests, Input Tokens, Output Tokens, Est. Cost)
 *   - Usage chart (line chart with tokens/cost toggle)
 *   - Usage table by provider (sortable, expandable)
 *   - Usage table by model
 * - Details: Live provider status + cache performance
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { LineChart, type LineChartDataPoint } from "../components/charts/LineChart";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatNumber, formatPercent, isRecord } from "../lib/format";
import { AlertIcon } from "../components/icons";

type LiveUsageState =
  | { status: "idle" | "loading"; data?: LiveUsageResponse }
  | { status: "success"; data: LiveUsageResponse };

type Tab = "overview" | "details";
type Period = "today" | "7d" | "30d";

const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
];

const fmt = (n: unknown) => new Intl.NumberFormat().format(Number(n) || 0);
const fmtCost = (n: unknown) => `$${(Number(n) || 0).toFixed(2)}`;
const fmtTokensShort = (n: number) => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n || 0);
};

// ─── Main Screen ─────────────────────────────────────────────────────────────

export function UsageScreen() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [period, setPeriod] = useState<Period>("today");
  const [chartMode, setChartMode] = useState<"tokens" | "cost">("tokens");

  const loadUsage = useCallback(() => getUsageStats(), []);
  const { state, retry } = useAsyncResource<UsageStatsResponse>(loadUsage);
  const [liveState, setLiveState] = useState<LiveUsageState>({ status: "idle" });

  const refreshLiveUsage = useCallback(async () => {
    setLiveState((c) => ({ status: "loading", data: c.data }));
    try {
      const data = await getLiveUsage();
      setLiveState({ status: "success", data });
    } catch {
      setLiveState({ status: "success", data: { ok: true, providers: [] } });
    }
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLiveState((c) => ({ status: "loading", data: c.data }));
      try {
        const data = await getLiveUsage();
        if (active) setLiveState({ status: "success", data });
      } catch {
        if (active) setLiveState({ status: "success", data: { ok: true, providers: [] } });
      }
    };
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => { active = false; clearInterval(id); };
  }, []);

  // Extract data (safe even during loading — just empty)
  const stats = state.status === "success" && isRecord(state.data.stats) ? state.data.stats : {};
  const today = isRecord(stats.today) ? (stats.today as UsageStatsBucket) : {};
  const month = isRecord(stats.month) ? (stats.month as UsageStatsBucket) : {};
  const daily = Array.isArray(stats.daily) ? stats.daily : [];
  const byProvider = Array.isArray(stats.byProvider) ? (stats.byProvider as UsageDimensionBucket[]) : [];
  const byModel = Array.isArray(stats.byModel) ? (stats.byModel as UsageDimensionBucket[]) : [];
  const byClientRoute = Array.isArray(stats.byClientRoute) ? (stats.byClientRoute as UsageDimensionBucket[]) : [];
  const liveProviders = Array.isArray(liveState.data?.providers) ? liveState.data.providers : [];

  const periodBucket = period === "30d" ? month : today;
  const totalInputTokens = Number(periodBucket.totalInputTokens) || 0;
  const totalCachedTokens = Number(periodBucket.totalCachedTokens) || 0;
  const totalRequests = Number(periodBucket.requests) || 0;

  // Build chart data from daily array — must be before any return
  const chartData: LineChartDataPoint[] = useMemo(() => {
    return daily.map((d: any) => ({
      timestamp: d.date || new Date().toISOString(),
      value: chartMode === "tokens" ? (Number(d.totalInputTokens || 0) + Number(d.totalCachedTokens || 0)) : Number(d.requests || 0),
    }));
  }, [daily, chartMode]);

  // Early returns AFTER all hooks
  if (state.status === "loading" || state.status === "idle") {
    return <LoadingState title="Loading usage" description="Reading usage data..." />;
  }
  if (state.status === "error") {
    return <ErrorState title="Usage unavailable" description={state.error.message} onRetry={retry} />;
  }

  return (
    <div className="screen-stack">
      <PageHeader
        title="Usage & Analytics"
        description="Track requests, tokens, cost, and provider utilization."
        actions={<RefreshButton onClick={retry} />}
      />

      {/* Tabs + Period */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-4)", flexWrap: "wrap" }}>
        <SegmentedControl options={[{ value: "overview", label: "Overview" }, { value: "details", label: "Details" }]} value={activeTab} onChange={(v) => setActiveTab(v as Tab)} />
        {activeTab === "overview" && (
          <SegmentedControl options={PERIODS} value={period} onChange={(v) => setPeriod(v as Period)} size="sm" />
        )}
      </div>

      {/* ─── OVERVIEW TAB ─── */}
      {activeTab === "overview" && (
        <>
          {/* 9Router-style 4 summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--space-4)" }}>
            <OverviewCard label="Total Requests" value={fmt(totalRequests)} />
            <OverviewCard label="Total Input Tokens" value={fmtTokensShort(totalInputTokens)} color="var(--accent)" />
            <OverviewCard label="Cached Tokens" value={fmtTokensShort(totalCachedTokens)} color="var(--success)" />
            <OverviewCard label="Cache Hit Rate" value={formatPercent(periodBucket.hitRate)} color="var(--warning)" subtitle="Prompt cache efficiency" />
          </div>

          {/* Usage Chart */}
          {chartData.length > 0 && (
            <SurfaceCard>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
                <h3 style={{ margin: 0, fontSize: "var(--text-sm)", fontWeight: 600 }}>Usage Over Time</h3>
                <SegmentedControl
                  options={[{ value: "tokens", label: "Tokens" }, { value: "cost", label: "Requests" }]}
                  value={chartMode}
                  onChange={(v) => setChartMode(v as "tokens" | "cost")}
                  size="sm"
                />
              </div>
              <LineChart
                data={chartData}
                height={200}
                color={chartMode === "tokens" ? "var(--accent)" : "var(--warning)"}
                fill={true}
                valueFormatter={(v) => chartMode === "tokens" ? fmtTokensShort(v) : fmt(v)}
              />
            </SurfaceCard>
          )}

          {/* RTK Stats */}
          {typeof periodBucket.rtkRequests === "number" && periodBucket.rtkRequests > 0 && (
            <SurfaceCard title="RTK Token Saver" description="Tool output compression statistics">
              <div className="stat-grid">
                <StatCard label="RTK Requests" value={fmt(periodBucket.rtkRequests)} />
                <StatCard label="Applied" value={fmt(periodBucket.rtkAppliedRequests)} />
                <StatCard label="Apply Rate" value={formatPercent(periodBucket.rtkAppliedRate)} />
                <StatCard label="Chars Saved" value={fmt(periodBucket.rtkCharsSaved)} />
              </div>
            </SurfaceCard>
          )}

          {/* By Provider */}
          <SurfaceCard title="By Provider" description="Request distribution across providers">
            <DataTable
              columns={[
                { key: "key", label: "Provider" },
                { key: "requests", label: "Requests", align: "right", render: (v) => fmt(v) },
                { key: "totalCachedTokens", label: "Cached Tokens", align: "right", render: (v) => fmt(v) },
                { key: "hitRate", label: "Hit Rate", align: "right", render: (v) => formatPercent(v) },
                { key: "rtkCharsSaved", label: "RTK Saved", align: "right", render: (v) => fmt(v) },
              ]}
              rows={byProvider}
              emptyTitle="No provider data"
              emptyDescription="Usage will appear after requests are processed."
            />
          </SurfaceCard>

          {/* By Model */}
          {byModel.length > 0 && (
            <SurfaceCard title="By Model" description="Token usage per model">
              <DataTable
                columns={[
                  { key: "key", label: "Model" },
                  { key: "requests", label: "Requests", align: "right", render: (v) => fmt(v) },
                  { key: "totalCachedTokens", label: "Cached", align: "right", render: (v) => fmt(v) },
                  { key: "avgCacheSavedPercent", label: "Avg Saved", align: "right", render: (v) => formatPercent(v) },
                ]}
                rows={byModel}
                emptyTitle="No model data"
                emptyDescription=""
              />
            </SurfaceCard>
          )}

          {/* By Client Route */}
          <SurfaceCard title="By Client Route" description="Usage per API key route">
            <DataTable
              columns={[
                { key: "key", label: "Route" },
                { key: "requests", label: "Requests", align: "right", render: (v) => fmt(v) },
                { key: "hitRate", label: "Hit Rate", align: "right", render: (v) => formatPercent(v) },
                { key: "rtkCharsSaved", label: "RTK Saved", align: "right", render: (v) => fmt(v) },
              ]}
              rows={byClientRoute}
              emptyTitle="No route data"
              emptyDescription="Client route usage will appear when route-specific logs exist."
            />
          </SurfaceCard>
        </>
      )}

      {/* ─── DETAILS TAB ─── */}
      {activeTab === "details" && (
        <>
          <SurfaceCard
            title="Live Provider Status"
            description="Real-time provider availability. Auto-refreshes every 30s."
            actions={<RefreshButton onClick={refreshLiveUsage} label="Refresh" />}
          >
            {liveProviders.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", textAlign: "center", padding: "var(--space-4)" }}>
                No live data available.
              </p>
            ) : (
              <div style={{ display: "grid", gap: "var(--space-2)" }}>
                {liveProviders.map((p) => {
                  const usage = isRecord(p.usage) ? p.usage : {};
                  const isOk = p.ok !== false && usage.allowed !== false;
                  return (
                    <div key={p.providerId || p.providerName} style={{
                      display: "flex", alignItems: "center", gap: "var(--space-3)",
                      padding: "var(--space-3) var(--space-4)", background: "var(--surface-muted)",
                      borderRadius: "var(--radius-sm)", border: "1px solid var(--line)",
                    }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: isOk ? "var(--success)" : "var(--danger)", boxShadow: `0 0 0 3px ${isOk ? "var(--success-soft)" : "var(--danger-soft)"}` }} />
                      <span style={{ flex: 1, fontWeight: 600, fontSize: "var(--text-sm)" }}>{p.providerName || p.providerId}</span>
                      {typeof usage.remaining === "number" && typeof usage.limit === "number" && (
                        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                          {fmt(usage.remaining)} / {fmt(usage.limit)}
                        </span>
                      )}
                      <StatusBadge status={isOk ? "success" : "danger"}>
                        {isOk ? "Available" : p.error ? "Error" : "Exhausted"}
                      </StatusBadge>
                    </div>
                  );
                })}
              </div>
            )}
          </SurfaceCard>

          <SurfaceCard title="Cache Performance" description="Detailed cache statistics">
            <div className="stat-grid">
              <StatCard label="Today Requests" value={fmt(today.requests)} />
              <StatCard label="Today Hit Rate" value={formatPercent(today.hitRate)} />
              <StatCard label="Today Cached" value={fmt(today.totalCachedTokens)} />
              <StatCard label="Today Avg Saved" value={formatPercent(today.avgCacheSavedPercent)} />
              <StatCard label="Month Requests" value={fmt(month.requests)} />
              <StatCard label="Month Hit Rate" value={formatPercent(month.hitRate)} />
              <StatCard label="Month Cached" value={fmt(month.totalCachedTokens)} />
              <StatCard label="Month Avg Saved" value={formatPercent(month.avgCacheSavedPercent)} />
            </div>
          </SurfaceCard>
        </>
      )}
    </div>
  );
}

// ─── Components ──────────────────────────────────────────────────────────────

function OverviewCard({ label, value, color, subtitle }: { label: string; value: string; color?: string; subtitle?: string }) {
  return (
    <section className="surface-card" style={{ padding: "var(--space-4) var(--space-5)" }}>
      <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" }}>{label}</span>
      <span style={{ display: "block", marginTop: 4, fontSize: "var(--text-2xl)", fontWeight: 700, letterSpacing: "-0.04em", color: color || "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
      {subtitle && <span style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>{subtitle}</span>}
    </section>
  );
}

function SegmentedControl({ options, value, onChange, size }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; size?: "sm" }) {
  return (
    <div style={{ display: "inline-flex", borderRadius: "var(--radius-pill)", overflow: "hidden", border: "1px solid var(--line)", background: "var(--surface-muted)" }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            padding: size === "sm" ? "var(--space-1) var(--space-3)" : "var(--space-2) var(--space-4)",
            fontSize: size === "sm" ? "var(--text-xs)" : "var(--text-xs)",
            fontWeight: 600,
            cursor: "pointer",
            background: value === opt.value ? "var(--accent)" : "transparent",
            color: value === opt.value ? "#fff" : "var(--text-secondary)",
            border: "none",
            minHeight: size === "sm" ? 28 : 34,
            transition: "background var(--animation-fast), color var(--animation-fast)",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
