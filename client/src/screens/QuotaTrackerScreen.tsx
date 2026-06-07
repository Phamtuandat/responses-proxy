/**
 * Quota Tracker Screen — real-time provider quota / credit usage.
 *
 * Shows per-provider quota status with:
 * - Provider cards in a responsive grid
 * - Progress bar for each quota resource (used/total) when known
 * - For Kiro: real CodeWhisperer credit usage (used / total / reset date)
 * - For account-pool providers (no credit API): healthy account count
 * - For api_key providers with usage check configured: upstream usage
 * - Auto-refresh with countdown
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { PageHeader } from "../components/PageHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { LoadingState } from "../components/LoadingState";
import { RefreshButton } from "../components/RefreshButton";
import { StatusBadge } from "../components/StatusBadge";
import { getLiveUsage, getProviders } from "../api/client";
import type { LiveUsageProvider, ProviderSummary } from "../api/types";
import { formatNumber } from "../lib/format";

const REFRESH_INTERVAL_MS = 60_000;

type QuotaResource = {
  resourceType: string;
  used: number;
  total: number;
  remaining: number;
  resetAt: string | null;
  unlimited: boolean;
};

type ProviderQuota = {
  id: string;
  name: string;
  authMode?: string;
  ok: boolean;
  error?: string;
  /** Detailed quota resources (Kiro credits, etc.) — preferred display. */
  resources: QuotaResource[];
  /** Plan label, e.g. "KIRO POWER". */
  plan?: string;
  /** Account-pool stats fallback (Kiro/OAuth) when no credit data is available. */
  accountPool?: {
    total: number;
    active: number;
    healthy: number;
  };
  /** Generic usage block (for api_key providers with custom usage checks). */
  usage?: {
    used?: number;
    limit?: number;
    remaining?: number;
  };
};

export function QuotaTrackerScreen() {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [liveData, setLiveData] = useState<LiveUsageProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(60);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      setRefreshing(true);
      const [providersData, liveUsage] = await Promise.all([
        getProviders(),
        getLiveUsage(),
      ]);
      setProviders(providersData.providerOptions || providersData.providers || []);
      setLiveData(liveUsage.providers || []);
      setLastUpdated(new Date());
      setCountdown(60);
    } catch (error) {
      console.error("Failed to fetch quota data:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!autoRefresh) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      return;
    }
    intervalRef.current = setInterval(fetchAll, REFRESH_INTERVAL_MS);
    countdownRef.current = setInterval(() => {
      setCountdown((p) => (p <= 1 ? 60 : p - 1));
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoRefresh, fetchAll]);

  const providerQuotas = useMemo<ProviderQuota[]>(() => {
    const liveMap = new Map<string, LiveUsageProvider>();
    for (const l of liveData) {
      if (l.providerId) liveMap.set(l.providerId, l);
    }

    return providers
      .filter((p) => liveMap.has(p.id))
      .map((p): ProviderQuota => {
        const live = liveMap.get(p.id)!;
        const resources: QuotaResource[] = [];

        if (live.creditUsage?.quotas) {
          for (const [key, value] of Object.entries(live.creditUsage.quotas)) {
            resources.push({
              resourceType: value?.resourceType ?? key,
              used: typeof value?.used === "number" ? value.used : 0,
              total: typeof value?.total === "number" ? value.total : 0,
              remaining: typeof value?.remaining === "number" ? value.remaining : 0,
              resetAt: typeof value?.resetAt === "string" ? value.resetAt : null,
              unlimited: value?.unlimited === true,
            });
          }
        }

        const usage = live.usage ?? null;
        const accountPool = live.accounts
          ? {
              total: live.accounts.total ?? 0,
              active: live.accounts.active ?? 0,
              healthy: live.accounts.healthy ?? 0,
            }
          : undefined;

        return {
          id: p.id,
          name: p.name,
          authMode: live.authMode,
          ok: live.ok !== false,
          error: live.error || (live.creditUsage?.error ?? undefined),
          resources,
          plan: live.creditUsage?.plan,
          accountPool,
          usage:
            usage && (typeof usage.used === "number" || typeof usage.limit === "number")
              ? {
                  used: typeof usage.used === "number" ? usage.used : undefined,
                  limit: typeof usage.limit === "number" ? usage.limit : undefined,
                  remaining: typeof usage.remaining === "number" ? usage.remaining : undefined,
                }
              : undefined,
        };
      });
  }, [providers, liveData]);

  if (loading) {
    return <LoadingState title="Loading quotas" description="Fetching provider quota status..." cards={4} />;
  }

  return (
    <div className="screen-stack">
      <PageHeader
        title="Quota Tracker"
        description="Real-time provider quota and credit usage from upstream APIs."
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <button
              onClick={() => setAutoRefresh((p) => !p)}
              className="button-link"
              style={{ minHeight: 36, gap: "var(--space-2)" }}
              title={autoRefresh ? "Disable auto-refresh" : "Enable auto-refresh"}
            >
              <span style={{ color: autoRefresh ? "var(--accent)" : "var(--text-muted)" }}>
                {autoRefresh ? "⟳" : "⏸"}
              </span>
              <span>Auto</span>
              {autoRefresh && (
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
                  ({countdown}s)
                </span>
              )}
            </button>
            <RefreshButton onClick={fetchAll} isRefreshing={refreshing} />
          </div>
        }
      />

      {lastUpdated && (
        <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", margin: 0 }}>
          Last updated: {lastUpdated.toLocaleTimeString()}
        </p>
      )}

      {providerQuotas.length === 0 ? (
        <SurfaceCard>
          <div style={{ textAlign: "center", padding: "var(--space-8)" }}>
            <p style={{ fontSize: "var(--text-base)", fontWeight: 600, margin: "0 0 var(--space-2)" }}>No Quota Data Available</p>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", margin: 0, maxWidth: 400, marginInline: "auto" }}>
              Connect a provider with quota tracking (Kiro, OAuth subscriptions, or custom usage-check URLs) to see live limits and credit usage here.
            </p>
          </div>
        </SurfaceCard>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: "var(--space-4)" }}>
          {providerQuotas.map((pq) => (
            <ProviderQuotaCard key={pq.id} provider={pq} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Provider Quota Card ─────────────────────────────────────────────────────

function ProviderQuotaCard({ provider }: { provider: ProviderQuota }) {
  const hasResources = provider.resources.length > 0;
  const hasGenericUsage = !hasResources && provider.usage !== undefined;
  const hasAccountPool = !hasResources && !hasGenericUsage && provider.accountPool !== undefined;

  return (
    <section className="surface-card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3)",
          padding: "var(--space-3) var(--space-4)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", minWidth: 0 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "var(--accent-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)" }}>
              {provider.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div style={{ minWidth: 0 }}>
            <h3
              style={{
                margin: 0,
                fontSize: "var(--text-sm)",
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {provider.name}
            </h3>
            {provider.plan && (
              <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                {provider.plan}
                {provider.authMode ? ` · ${provider.authMode}` : ""}
              </p>
            )}
          </div>
        </div>
        <StatusBadge variant={provider.ok ? "success" : provider.error ? "danger" : "warning"}>
          {provider.ok ? "Active" : provider.error ? "Error" : "Exhausted"}
        </StatusBadge>
      </div>

      <div style={{ padding: "var(--space-3) var(--space-4)" }}>
        {provider.error ? (
          <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--danger)" }}>{provider.error}</p>
        ) : hasResources ? (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            {provider.resources.map((resource) => (
              <QuotaResourceRow key={resource.resourceType} resource={resource} />
            ))}
          </div>
        ) : hasGenericUsage ? (
          <GenericUsageBlock usage={provider.usage!} />
        ) : hasAccountPool ? (
          <AccountPoolBlock pool={provider.accountPool!} />
        ) : (
          <p
            style={{
              margin: 0,
              fontSize: "var(--text-xs)",
              color: "var(--text-muted)",
              textAlign: "center",
              padding: "var(--space-2)",
            }}
          >
            {provider.ok ? "Connected — no quota data reported" : "Unable to fetch quota"}
          </p>
        )}
      </div>
    </section>
  );
}

function QuotaResourceRow({ resource }: { resource: QuotaResource }) {
  const total = resource.total;
  const used = resource.used;
  const remaining = resource.remaining;
  const remainingPercentage = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : null;

  const barColor = (() => {
    if (remainingPercentage === null) return "var(--accent)";
    if (remainingPercentage <= 10) return "var(--danger)";
    if (remainingPercentage <= 30) return "var(--warning)";
    return "var(--success)";
  })();

  const resetLabel = resource.resetAt ? formatResetLabel(resource.resetAt) : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", fontWeight: 600 }}>
          {humanizeResource(resource.resourceType)}
        </span>
        <span style={{ fontSize: "var(--text-xs)", fontWeight: 600 }}>
          {resource.unlimited
            ? "Unlimited"
            : remainingPercentage !== null
              ? `${remainingPercentage.toFixed(0)}% remaining`
              : "—"}
        </span>
      </div>
      {!resource.unlimited && total > 0 && (
        <div
          style={{
            height: 8,
            borderRadius: "var(--radius-pill)",
            background: "var(--neutral-soft)",
            overflow: "hidden",
            marginBottom: 6,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${remainingPercentage ?? 0}%`,
              borderRadius: "var(--radius-pill)",
              background: barColor,
              transition: "width var(--animation-slow) var(--animation-easing)",
            }}
          />
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-2)" }}>
        <Stat label="Used" value={formatNumber(used)} />
        <Stat label="Remaining" value={formatNumber(remaining)} tone="success" />
        <Stat label="Total" value={resource.unlimited ? "∞" : formatNumber(total)} />
      </div>
      {resetLabel && (
        <p style={{ margin: "6px 0 0", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
          Resets {resetLabel}
        </p>
      )}
    </div>
  );
}

function GenericUsageBlock({ usage }: { usage: { used?: number; limit?: number; remaining?: number } }) {
  const total = usage.limit ?? 0;
  const used = usage.used ?? 0;
  const remaining = usage.remaining ?? Math.max(0, total - used);
  const remainingPercentage = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : null;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
          {formatNumber(remaining)} remaining
        </span>
        <span style={{ fontSize: "var(--text-xs)", fontWeight: 600 }}>
          {remainingPercentage !== null ? `${remainingPercentage.toFixed(0)}%` : "—"}
        </span>
      </div>
      {total > 0 && (
        <div
          style={{
            height: 8,
            borderRadius: "var(--radius-pill)",
            background: "var(--neutral-soft)",
            overflow: "hidden",
            marginBottom: 6,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${remainingPercentage ?? 0}%`,
              borderRadius: "var(--radius-pill)",
              background: "var(--success)",
              transition: "width var(--animation-slow) var(--animation-easing)",
            }}
          />
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-2)" }}>
        <Stat label="Used" value={formatNumber(used)} />
        <Stat label="Remaining" value={formatNumber(remaining)} tone="success" />
        <Stat label="Limit" value={total > 0 ? formatNumber(total) : "—"} />
      </div>
    </div>
  );
}

function AccountPoolBlock({ pool }: { pool: { total: number; active: number; healthy: number } }) {
  return (
    <div>
      <p style={{ margin: "0 0 6px", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
        Account pool
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-2)" }}>
        <Stat label="Total" value={String(pool.total)} />
        <Stat label="Active" value={String(pool.active)} />
        <Stat
          label="Healthy"
          value={String(pool.healthy)}
          tone={pool.healthy > 0 ? "success" : "danger"}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger";
}) {
  const color = tone === "success" ? "var(--success)" : tone === "danger" ? "var(--danger)" : undefined;
  return (
    <div style={{ textAlign: "center" }}>
      <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
        {label}
      </span>
      <span style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, color }}>
        {value}
      </span>
    </div>
  );
}

function humanizeResource(type: string): string {
  const trimmed = type.trim();
  if (!trimmed) return "Quota";
  if (trimmed.endsWith("_freetrial")) {
    const base = trimmed.slice(0, -"_freetrial".length);
    return `${prettyCase(base)} (Free trial)`;
  }
  return prettyCase(trimmed);
}

function prettyCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function formatResetLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = Date.now();
  const diffMs = date.getTime() - now;
  if (diffMs <= 0) return "now";
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days >= 1) {
    return `in ${days} day${days === 1 ? "" : "s"} (${date.toLocaleDateString()})`;
  }
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours >= 1) {
    return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const minutes = Math.max(1, Math.floor(diffMs / (1000 * 60)));
  return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
}
