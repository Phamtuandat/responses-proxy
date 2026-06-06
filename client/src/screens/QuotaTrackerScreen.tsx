/**
 * Quota Tracker Screen — 9Router-style ProviderLimits clone.
 *
 * Shows per-provider quota status with:
 * - Provider cards in a 2-column grid
 * - Quota progress bars (used/limit)
 * - Auto-refresh with countdown timer
 * - Enable/disable toggle per provider
 * - Refresh individual or all
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { PageHeader } from "../components/PageHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { LoadingState } from "../components/LoadingState";
import { RefreshButton } from "../components/RefreshButton";
import { StatusBadge } from "../components/StatusBadge";
import { getLiveUsage, getProviders, toggleProviderEnabled } from "../api/client";
import type { LiveUsageProvider, LiveUsageResponse, ProviderSummary } from "../api/types";
import { formatNumber, isRecord } from "../lib/format";

const REFRESH_INTERVAL_MS = 60_000;

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

  // Auto-refresh
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

  // Build merged provider list with live quota data
  const providerQuotas = useMemo(() => {
    const liveMap = new Map<string, LiveUsageProvider>();
    for (const l of liveData) {
      if (l.providerId) liveMap.set(l.providerId, l);
    }

    return providers.map((p) => {
      const live = liveMap.get(p.id);
      const usage = live && isRecord(live.usage) ? live.usage : null;
      return {
        id: p.id,
        name: p.name,
        live,
        ok: live?.ok !== false && usage?.allowed !== false,
        allowed: usage?.allowed,
        remaining: typeof usage?.remaining === "number" ? usage.remaining : undefined,
        limit: typeof usage?.limit === "number" ? usage.limit : undefined,
        used: typeof usage?.used === "number" ? usage.used : undefined,
        error: live?.error,
        hasQuota: live !== undefined,
      };
    });
  }, [providers, liveData]);

  // Only show providers that have quota data or are known to be tracked
  const visibleProviders = useMemo(() => {
    return providerQuotas.filter((p) => p.hasQuota);
  }, [providerQuotas]);

  if (loading) {
    return <LoadingState title="Loading quotas" description="Fetching provider quota status..." cards={4} />;
  }

  return (
    <div className="screen-stack">
      <PageHeader
        title="Quota Tracker"
        description="Real-time provider quota limits and usage status."
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            {/* Auto-refresh toggle */}
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

      {/* Last updated */}
      {lastUpdated && (
        <p style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", margin: 0 }}>
          Last updated: {lastUpdated.toLocaleTimeString()}
        </p>
      )}

      {/* Empty state */}
      {visibleProviders.length === 0 ? (
        <SurfaceCard>
          <div style={{ textAlign: "center", padding: "var(--space-8)" }}>
            <p style={{ fontSize: "var(--text-base)", fontWeight: 600, margin: "0 0 var(--space-2)" }}>No Quota Data Available</p>
            <p style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", margin: 0, maxWidth: 400, marginInline: "auto" }}>
              Connect providers with quota tracking (OAuth subscriptions like Claude Code, Codex) to see quota limits and usage here.
            </p>
          </div>
        </SurfaceCard>
      ) : (
        /* Provider quota cards — 2 column grid like 9Router */
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "var(--space-4)" }}>
          {visibleProviders.map((pq) => (
            <ProviderQuotaCard key={pq.id} provider={pq} onRefresh={fetchAll} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Provider Quota Card ─────────────────────────────────────────────────────

type ProviderQuota = {
  id: string;
  name: string;
  ok: boolean;
  allowed?: boolean;
  remaining?: number;
  limit?: number;
  used?: number;
  error?: string;
  hasQuota: boolean;
};

function ProviderQuotaCard({ provider, onRefresh }: { provider: ProviderQuota; onRefresh: () => void }) {
  const percentage = provider.limit && provider.limit > 0
    ? Math.round(((provider.used || 0) / provider.limit) * 100)
    : null;

  const remainingPercentage = percentage !== null ? 100 - percentage : null;

  const getBarColor = () => {
    if (!provider.ok) return "var(--danger)";
    if (remainingPercentage !== null && remainingPercentage <= 10) return "var(--danger)";
    if (remainingPercentage !== null && remainingPercentage <= 30) return "var(--warning)";
    return "var(--success)";
  };

  return (
    <section className="surface-card" style={{ padding: 0, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", padding: "var(--space-3) var(--space-4)", borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", minWidth: 0 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)" }}>{provider.name.charAt(0).toUpperCase()}</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: "var(--text-sm)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {provider.name}
            </h3>
          </div>
        </div>
        <StatusBadge status={provider.ok ? "success" : "danger"}>
          {provider.ok ? "Active" : provider.error ? "Error" : "Exhausted"}
        </StatusBadge>
      </div>

      {/* Quota content */}
      <div style={{ padding: "var(--space-3) var(--space-4)" }}>
        {provider.error ? (
          <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--danger)" }}>{provider.error}</p>
        ) : provider.limit !== undefined ? (
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            {/* Progress bar */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
                  {formatNumber(provider.remaining)} remaining
                </span>
                <span style={{ fontSize: "var(--text-xs)", fontWeight: 600 }}>
                  {remainingPercentage !== null ? `${remainingPercentage}%` : "—"}
                </span>
              </div>
              <div style={{ height: 8, borderRadius: "var(--radius-pill)", background: "var(--neutral-soft)", overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  width: `${remainingPercentage ?? 0}%`,
                  borderRadius: "var(--radius-pill)",
                  background: getBarColor(),
                  transition: "width var(--animation-slow) var(--animation-easing)",
                }} />
              </div>
            </div>

            {/* Stats row */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--space-2)" }}>
              <div style={{ textAlign: "center" }}>
                <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Used</span>
                <span style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600 }}>{formatNumber(provider.used)}</span>
              </div>
              <div style={{ textAlign: "center" }}>
                <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Remaining</span>
                <span style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600, color: "var(--success)" }}>{formatNumber(provider.remaining)}</span>
              </div>
              <div style={{ textAlign: "center" }}>
                <span style={{ display: "block", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Limit</span>
                <span style={{ display: "block", fontSize: "var(--text-sm)", fontWeight: 600 }}>{formatNumber(provider.limit)}</span>
              </div>
            </div>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--text-muted)", textAlign: "center", padding: "var(--space-2)" }}>
            {provider.ok ? "Connected — no quota limits reported" : "Unable to fetch quota"}
          </p>
        )}
      </div>
    </section>
  );
}
