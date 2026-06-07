/**
 * MITM Screen — 9Router-style MITM proxy management.
 *
 * Shows:
 * - Warning banner about ToS risks
 * - MITM Server status card (cert, server, DNS status)
 * - Per-tool interception cards (Antigravity, Copilot, Kiro IDE)
 *
 * Note: MITM functionality requires the proxy to run directly on the host
 * (not in Docker) with root/admin privileges for port 443 + DNS + cert trust.
 */

import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "../components/PageHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { StatusBadge } from "../components/StatusBadge";
import { LoadingState } from "../components/LoadingState";
import {
  getProviders,
  getMitmMappings,
  setMitmMappings,
  getModelCombos,
} from "../api/client";
import type { ProviderSummary, ModelCombo } from "../api/types";
import { ModelPickerModal, COMBO_PROVIDER } from "../components/ModelPickerModal";

// ─── MITM Tool Definitions (mirrors 9Router's MITM_TOOLS) ───────────────────

type MitmToolDef = {
  id: string;
  name: string;
  color: string;
  description: string;
  mitmDomain: string;
  models: { id: string; name: string }[];
};

const MITM_TOOLS: MitmToolDef[] = [
  {
    id: "antigravity",
    name: "Antigravity (Google)",
    color: "#4285F4",
    description: "Google Antigravity IDE — intercepts daily-cloudcode-pa.googleapis.com",
    mitmDomain: "daily-cloudcode-pa.googleapis.com",
    models: [
      { id: "gemini-3.5-flash-low", name: "Gemini 3.5 Flash (Medium)" },
      { id: "gemini-3-flash-agent", name: "Gemini 3.5 Flash (High)" },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)" },
      { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)" },
    ],
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    color: "#1F6FEB",
    description: "GitHub Copilot IDE — intercepts api.individual.githubcopilot.com",
    mitmDomain: "api.individual.githubcopilot.com",
    models: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4.1", name: "GPT-4.1" },
      { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
    ],
  },
  {
    id: "kiro",
    name: "Kiro IDE",
    color: "#FF6B00",
    description: "Kiro IDE — intercepts q.us-east-1.amazonaws.com",
    mitmDomain: "q.us-east-1.amazonaws.com",
    models: [
      { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
      { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
      { id: "deepseek-3.2", name: "DeepSeek 3.2" },
      { id: "minimax-m2.1", name: "MiniMax M2.1" },
    ],
  },
];

// ─── Main Screen ─────────────────────────────────────────────────────────────

export function MitmScreen() {
  const [serverStatus, setServerStatus] = useState<{
    running: boolean;
    certExists: boolean;
    certTrusted: boolean;
    dnsStatus: Record<string, boolean>;
    needsSudoPassword?: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [sudoPassword, setSudoPassword] = useState("");
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [combos, setCombos] = useState<ModelCombo[]>([]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/cli-tools/mitm-status");
      if (res.ok) {
        const data = await res.json();
        setServerStatus(data);
      } else {
        setServerStatus({ running: false, certExists: false, certTrusted: false, dnsStatus: {} });
      }
    } catch {
      setServerStatus({ running: false, certExists: false, certTrusted: false, dnsStatus: {} });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  useEffect(() => {
    getProviders()
      .then((data) => setProviders(data.providerOptions || data.providers || []))
      .catch(() => setProviders([]));
  }, []);

  useEffect(() => {
    getModelCombos()
      .then((data) => setCombos(data.combos || []))
      .catch(() => setCombos([]));
  }, []);

  // Ask for sudo password before executing a privileged action
  const [pendingActionRef] = useState<{ current: ((password: string) => Promise<void>) | null }>({ current: null });

  const withSudo = (action: (password: string) => Promise<void>) => {
    if (sudoPassword || serverStatus?.needsSudoPassword === false) {
      action(sudoPassword);
    } else {
      pendingActionRef.current = action;
      setShowPasswordPrompt(true);
    }
  };

  const handlePasswordSubmit = () => {
    setShowPasswordPrompt(false);
    if (pendingActionRef.current) {
      pendingActionRef.current(sudoPassword);
      pendingActionRef.current = null;
    }
  };

  if (loading) {
    return <LoadingState title="Loading MITM status" description="Checking MITM server and certificates..." cards={3} />;
  }

  const isRunning = serverStatus?.running || false;

  return (
    <div className="screen-stack">
      <PageHeader
        title="MITM Proxy"
        description="Intercept IDE HTTPS traffic to route through your providers."
      />

      {/* Warning Banner */}
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--space-3)",
        padding: "var(--space-3) var(--space-4)",
        borderRadius: "var(--radius-md)",
        background: "var(--warning-soft)",
        border: "1px solid color-mix(in srgb, var(--warning) 30%, transparent)",
      }}>
        <span style={{ color: "var(--warning)", fontSize: "16px", marginTop: 2, flexShrink: 0 }}>⚠️</span>
        <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--danger)", lineHeight: 1.5 }}>
          MITM intercepts HTTPS traffic of IDE tools (Antigravity, GitHub Copilot, Kiro) via local CA
          to redirect requests to your providers. May violate ToS → account ban. Use at your own risk.
        </p>
      </div>

      {/* MITM Server Card */}
      <MitmServerCard status={serverStatus} isRunning={isRunning} onRefresh={fetchStatus} withSudo={withSudo} />

      {/* Per-Tool Cards */}
      <div style={{ display: "grid", gap: "var(--space-3)" }}>
        {MITM_TOOLS.map((tool) => (
          <MitmToolCard
            key={tool.id}
            tool={tool}
            isExpanded={expandedTool === tool.id}
            onToggle={() => setExpandedTool(expandedTool === tool.id ? null : tool.id)}
            serverRunning={isRunning}
            dnsActive={serverStatus?.dnsStatus?.[tool.id] || false}
            withSudo={withSudo}
            onDnsChanged={fetchStatus}
            providers={providers}
            combos={combos}
          />
        ))}
      </div>

      {/* Sudo password modal */}
      {showPasswordPrompt && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowPasswordPrompt(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div className="modal-header"><div><p className="eyebrow">Sudo Required</p><h2>Enter Mac Password</h2></div></div>
            <div style={{ padding: "0 var(--space-5) var(--space-4)" }}>
              <p style={{ margin: "0 0 var(--space-3)", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                Modifying /etc/hosts requires administrator privileges.
              </p>
              <input
                type="password"
                value={sudoPassword}
                onChange={(e) => setSudoPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handlePasswordSubmit(); }}
                placeholder="Mac login password"
                autoFocus
                style={{ minHeight: 42 }}
              />
            </div>
            <div className="modal-actions" style={{ padding: "var(--space-3) var(--space-5)" }}>
              <button className="button-link" onClick={() => { setShowPasswordPrompt(false); pendingActionRef.current = null; }}>Cancel</button>
              <button className="button-primary" onClick={handlePasswordSubmit} disabled={!sudoPassword}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MITM Server Card ────────────────────────────────────────────────────────

function MitmServerCard({
  status,
  isRunning,
  onRefresh,
  withSudo,
}: {
  status: any;
  isRunning: boolean;
  onRefresh: () => void;
  withSudo: (action: (password: string) => Promise<void>) => void;
}) {
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = () => {
    withSudo(async (password) => {
      setActionLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/cli-tools/mitm-start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sudoPassword: password }) });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || "Failed to start MITM server");
        } else {
          await onRefresh();
        }
      } catch (e: any) {
        setError(e.message || "Network error");
      } finally {
        setActionLoading(false);
      }
    });
  };

  const handleStop = () => {
    withSudo(async (password) => {
      setActionLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/cli-tools/mitm-stop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sudoPassword: password }) });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || "Failed to stop MITM server");
        } else {
          await onRefresh();
        }
      } catch (e: any) {
        setError(e.message || "Network error");
      } finally {
        setActionLoading(false);
      }
    });
  };

  return (
    <section className="surface-card surface-card-info" style={{ padding: "var(--space-4) var(--space-5)" }}>
      <div style={{ display: "grid", gap: "var(--space-4)" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-3)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <span style={{ fontSize: 20, color: "var(--accent)" }}>🔒</span>
            <span style={{ fontWeight: 600, fontSize: "var(--text-sm)" }}>MITM Server</span>
            <StatusBadge status={isRunning ? "success" : "neutral"}>
              {isRunning ? "Running" : "Stopped"}
            </StatusBadge>
          </div>

          {/* Status indicators */}
          <div style={{ display: "flex", gap: "var(--space-3)", fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            <StatusIndicator label="Cert" ok={status?.certExists} />
            <StatusIndicator label="Trusted" ok={status?.certTrusted} />
            <StatusIndicator label="Server" ok={isRunning} />
          </div>
        </div>

        {/* How it works */}
        <div style={{ padding: "var(--space-3)", background: "var(--surface-muted)", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)" }}>
          <p style={{ margin: "0 0 4px", fontSize: "0.68rem", color: "var(--text-secondary)" }}>
            <strong style={{ color: "var(--text-primary)" }}>Purpose:</strong> Use Antigravity IDE & GitHub Copilot with ANY provider/model from the proxy
          </p>
          <p style={{ margin: 0, fontSize: "0.68rem", color: "var(--text-secondary)" }}>
            <strong style={{ color: "var(--text-primary)" }}>How it works:</strong> IDE request → DNS redirect to localhost:443 → MITM intercepts → Proxy routes → response to IDE
          </p>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
          {isRunning ? (
            <button className="button-danger" onClick={handleStop} disabled={actionLoading} style={{ minHeight: 36 }}>
              {actionLoading ? "Stopping..." : "Stop Server"}
            </button>
          ) : (
            <button className="button-primary" onClick={handleStart} disabled={actionLoading} style={{ minHeight: 36 }}>
              {actionLoading ? "Starting..." : "Start Server"}
            </button>
          )}
          <button className="button-link" onClick={onRefresh} style={{ minHeight: 36 }}>
            Refresh Status
          </button>
          {isRunning && (
            <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
              Enable DNS per tool below to activate interception
            </span>
          )}
        </div>

        {error && (
          <div style={{ padding: "var(--space-2) var(--space-3)", background: "var(--danger-soft)", borderRadius: "var(--radius-sm)", fontSize: "var(--text-xs)", color: "var(--danger)" }}>
            {error}
          </div>
        )}
      </div>
    </section>
  );
}

// ─── MITM Tool Card ──────────────────────────────────────────────────────────

function MitmToolCard({
  tool,
  isExpanded,
  onToggle,
  serverRunning,
  dnsActive,
  withSudo,
  onDnsChanged,
  providers,
  combos,
}: {
  tool: MitmToolDef;
  isExpanded: boolean;
  onToggle: () => void;
  serverRunning: boolean;
  dnsActive: boolean;
  withSudo: (action: (password: string) => Promise<void>) => void;
  onDnsChanged: () => void;
  providers: ProviderSummary[];
  combos: ModelCombo[];
}) {
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState("");
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  // Load saved mappings when the card expands
  useEffect(() => {
    if (!isExpanded) return;
    let cancelled = false;
    getMitmMappings(tool.id)
      .then((data) => { if (!cancelled) setMappings(data.mappings || {}); })
      .catch(() => { /* keep empty */ });
    return () => { cancelled = true; };
  }, [isExpanded, tool.id]);

  const persistMappings = useCallback(async (next: Record<string, string>) => {
    setMappings(next);
    try {
      await setMitmMappings(tool.id, next);
    } catch (e: any) {
      setError(e.message || "Failed to save model mapping");
    }
  }, [tool.id]);

  const handleSelectModel = (nativeModel: string, providerId: string, proxyModel: string) => {
    const next = { ...mappings, [nativeModel]: `${providerId}::${proxyModel}` };
    persistMappings(next);
    setPickerFor(null);
  };

  const handleClearModel = (nativeModel: string) => {
    const next = { ...mappings };
    delete next[nativeModel];
    persistMappings(next);
  };

  const handleToggleDns = () => {
    withSudo(async (password) => {
      setToggling(true);
      setError("");
      try {
        const res = await fetch("/api/cli-tools/mitm-dns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toolId: tool.id, enable: !dnsActive, sudoPassword: password }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || "Failed to update DNS");
        } else {
          onDnsChanged();
        }
      } catch (e: any) {
        setError(e.message || "Network error");
      } finally {
        setToggling(false);
      }
    });
  };

  return (
    <section className="surface-card" style={{ padding: 0, overflow: "hidden" }}>
      {/* Header — always visible */}
      <div
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-3) var(--space-4)", cursor: "pointer" }}
      >
        <div style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          background: `${tool.color}18`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: tool.color }}>{tool.name.charAt(0)}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <h3 style={{ margin: 0, fontSize: "var(--text-sm)", fontWeight: 600 }}>{tool.name}</h3>
            {dnsActive && <StatusBadge status="success">Intercepting</StatusBadge>}
          </div>
          <p style={{ margin: "2px 0 0", fontSize: "var(--text-xs)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {tool.mitmDomain}
          </p>
        </div>
        <span style={{ color: "var(--text-muted)", transition: "transform var(--animation-normal)", transform: isExpanded ? "rotate(180deg)" : "none" }}>▾</span>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div style={{ borderTop: "1px solid var(--line)", padding: "var(--space-4)", display: "grid", gap: "var(--space-3)" }}>
          <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{tool.description}</p>

          {/* DNS Toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-2) var(--space-3)", background: "var(--surface-muted)", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)" }}>
            <span style={{ fontSize: "var(--text-xs)", fontWeight: 600 }}>DNS Interception</span>
            <button
              onClick={handleToggleDns}
              disabled={!serverRunning || toggling}
              style={{
                position: "relative",
                display: "inline-flex",
                width: 36, height: 20,
                borderRadius: "var(--radius-pill)",
                border: "none",
                background: dnsActive ? "var(--success)" : "var(--neutral-soft)",
                cursor: serverRunning ? "pointer" : "not-allowed",
                opacity: serverRunning ? 1 : 0.5,
                padding: 0,
                transition: "background var(--animation-normal)",
              }}
              title={!serverRunning ? "Start MITM server first" : dnsActive ? "Disable DNS interception" : "Enable DNS interception"}
            >
              <span style={{
                position: "absolute", top: 2, left: dnsActive ? 18 : 2,
                width: 16, height: 16, borderRadius: "50%", background: "#fff",
                boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                transition: "left var(--animation-normal)",
              }} />
            </button>
          </div>

          {/* Error display */}
          {error && (
            <div style={{ padding: "var(--space-2) var(--space-3)", background: "var(--danger-soft)", borderRadius: "var(--radius-sm)", fontSize: "var(--text-xs)", color: "var(--danger)" }}>
              {error}
            </div>
          )}

          {/* Model mapping editor */}
          <div>
            <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)", display: "block", marginBottom: "var(--space-2)" }}>
              Model Mapping
            </span>
            <p style={{ margin: "0 0 var(--space-3)", fontSize: "0.65rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
              Map each {tool.name} model to a proxy model. Requests using that model will be rewritten before routing. Leave unset to pass through unchanged.
            </p>
            <div style={{ display: "grid", gap: "var(--space-2)" }}>
              {tool.models.map((m) => {
                const raw = mappings[m.id];
                const isCombo = !!raw && raw.startsWith(`${COMBO_PROVIDER}::`);
                const rawValue = raw ? (raw.includes("::") ? raw.slice(raw.indexOf("::") + 2) : raw) : null;
                const comboName = isCombo ? (combos.find((c) => c.id === rawValue)?.name || rawValue) : null;
                const mapped = isCombo ? `⚡ ${comboName}` : rawValue;
                return (
                  <div
                    key={m.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-2)",
                      padding: "var(--space-2) var(--space-3)",
                      background: "var(--surface-muted)",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--line)",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ flex: "1 1 140px", minWidth: 0 }}>
                      <div style={{ fontSize: "var(--text-xs)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</div>
                      <code style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>{m.id}</code>
                    </div>
                    <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>→</span>
                    <div style={{ flex: "1 1 160px", minWidth: 0, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                      {mapped ? (
                        <code
                          className="metadata-pill"
                          style={{ fontSize: "0.62rem", padding: "2px 6px", minHeight: "auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}
                          title={mapped}
                        >
                          {mapped}
                        </code>
                      ) : (
                        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", flex: 1 }}>Passthrough</span>
                      )}
                      <button
                        className="button-link"
                        onClick={() => setPickerFor(m.id)}
                        style={{ minHeight: "auto", padding: "2px 6px", fontSize: "0.65rem" }}
                      >
                        {mapped ? "Change" : "Select"}
                      </button>
                      {mapped && (
                        <button
                          className="button-link"
                          onClick={() => handleClearModel(m.id)}
                          style={{ minHeight: "auto", padding: "2px 6px", fontSize: "0.65rem", color: "var(--danger)" }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Model picker modal */}
          {pickerFor && (() => {
            const raw = mappings[pickerFor] || "";
            const isComboSel = raw.startsWith(`${COMBO_PROVIDER}::`);
            const valuePart = raw.includes("::") ? raw.slice(raw.indexOf("::") + 2) : raw;
            return (
              <ModelPickerModal
                providers={providers}
                combos={combos}
                title="Map to Proxy Model"
                selectedModel={isComboSel ? null : (valuePart || null)}
                selectedComboId={isComboSel ? valuePart : null}
                onSelect={(sel) => {
                  if (sel.kind === "combo") handleSelectModel(pickerFor, COMBO_PROVIDER, sel.combo.id);
                  else handleSelectModel(pickerFor, sel.providerId, sel.model);
                }}
                onClose={() => setPickerFor(null)}
              />
            );
          })()}

          {/* Domain info */}
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>
            <strong>Target domain:</strong> <code style={{ fontSize: "0.65rem" }}>{tool.mitmDomain}</code>
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Status Indicator ────────────────────────────────────────────────────────

function StatusIndicator({ label, ok }: { label: string; ok?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      <span style={{ color: ok ? "var(--success)" : "var(--text-muted)", fontSize: "0.7rem" }}>
        {ok ? "✓" : "✗"}
      </span>
      {label}
    </span>
  );
}
