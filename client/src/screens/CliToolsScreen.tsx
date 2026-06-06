/**
 * CLI Tools Screen — Cloned from 9Router's cli-tools UX.
 *
 * Each tool is an expandable card showing:
 * - Connection status (Connected / Not configured / Not installed)
 * - Endpoint URL field
 * - API Key selector
 * - Model input with picker
 * - Apply / Reset buttons that write config files on the host
 * - Manual Config fallback
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { PageHeader } from "../components/PageHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { LoadingState } from "../components/LoadingState";
import { RefreshButton } from "../components/RefreshButton";
import {
  getProviders,
  getClientConfigsStatus,
  getProviderModels,
} from "../api/client";
import type {
  ClientRouteSummary,
  ClientConfigsStatusResponse,
  ProviderSummary,
} from "../api/types";

// ─── Types ───────────────────────────────────────────────────────────────────

type ToolStatus = {
  installed: boolean;
  has9Router?: boolean;
  path?: string;
  settings?: { env?: Record<string, string> };
  config?: string;
  error?: string;
};

type ToolMessage = { type: "success" | "error"; text: string } | null;

// ─── Tool Registry ───────────────────────────────────────────────────────────

type ToolDef = {
  id: string;
  name: string;
  color: string;
  description: string;
  statusEndpoint: string;
  applyEndpoint: string;
  resetEndpoint: string;
  installCmd?: string;
  models?: { alias: string; name: string; envKey?: string; defaultValue?: string }[];
};

const TOOLS: ToolDef[] = [
  {
    id: "claude",
    name: "Claude Code",
    color: "#D97757",
    description: "Anthropic Claude Code CLI",
    statusEndpoint: "/api/cli-tools/claude-settings",
    applyEndpoint: "/api/cli-tools/claude-settings",
    resetEndpoint: "/api/cli-tools/claude-settings",
    installCmd: "npm install -g @anthropic-ai/claude-code",
    models: [
      { alias: "opus", name: "Opus Model", envKey: "ANTHROPIC_DEFAULT_OPUS_MODEL", defaultValue: "kr/claude-opus-4-7" },
      { alias: "sonnet", name: "Sonnet Model", envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL", defaultValue: "kr/claude-sonnet-4.5" },
      { alias: "haiku", name: "Haiku Model", envKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL", defaultValue: "kr/claude-haiku-4.5" },
    ],
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    color: "#10A37F",
    description: "OpenAI Codex CLI / App",
    statusEndpoint: "/api/cli-tools/codex-settings",
    applyEndpoint: "/api/cli-tools/codex-settings",
    resetEndpoint: "/api/cli-tools/codex-settings",
    installCmd: "npm install -g @openai/codex",
  },
  {
    id: "cursor",
    name: "Cursor",
    color: "#6366F1",
    description: "Cursor AI Code Editor — manual config via Settings → Models",
    statusEndpoint: "",
    applyEndpoint: "",
    resetEndpoint: "",
  },
  {
    id: "cline",
    name: "Cline",
    color: "#00D1B2",
    description: "Cline AI Coding Assistant (VSCode extension)",
    statusEndpoint: "",
    applyEndpoint: "",
    resetEndpoint: "",
  },
  {
    id: "opencode",
    name: "OpenCode",
    color: "#E87040",
    description: "OpenCode AI Terminal Assistant",
    statusEndpoint: "",
    applyEndpoint: "",
    resetEndpoint: "",
  },
  {
    id: "kilo",
    name: "Kilo Code",
    color: "#FF6B6B",
    description: "Kilo Code AI Assistant (VSCode extension)",
    statusEndpoint: "",
    applyEndpoint: "",
    resetEndpoint: "",
  },
];

// ─── Main Screen ─────────────────────────────────────────────────────────────

export function CliToolsScreen() {
  const [loading, setLoading] = useState(true);
  const [clientRoutes, setClientRoutes] = useState<ClientRouteSummary[]>([]);
  const [configStatus, setConfigStatus] = useState<ClientConfigsStatusResponse | null>(null);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [toolStatuses, setToolStatuses] = useState<Record<string, ToolStatus>>({});
  const [providers, setProviders] = useState<ProviderSummary[]>([]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [providersData, configs] = await Promise.all([
        getProviders(),
        getClientConfigsStatus().catch(() => null),
      ]);
      setClientRoutes(providersData.clientRoutes || []);
      setProviders(providersData.providerOptions || providersData.providers || []);
      setConfigStatus(configs);
    } catch (error) {
      console.error("Failed to fetch CLI tools data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch statuses for tools that have endpoints
  useEffect(() => {
    TOOLS.forEach(async (tool) => {
      if (!tool.statusEndpoint) return;
      try {
        const res = await fetch(tool.statusEndpoint);
        if (res.ok) {
          const data = await res.json();
          setToolStatuses((prev) => ({ ...prev, [tool.id]: data }));
        }
      } catch { /* skip */ }
    });
  }, []);

  const apiKeyOptions = useMemo(() => {
    return clientRoutes.flatMap((route) => {
      const keys = Array.isArray(route.apiKeys) ? route.apiKeys.filter(Boolean) : [];
      return keys.map((apiKey) => ({ apiKey, routeKey: route.key }));
    });
  }, [clientRoutes]);

  const endpointUrl = configStatus?.proxyBaseUrl || `${window.location.origin}/v1`;

  if (loading) {
    return <LoadingState title="Loading CLI tools" description="Checking tool configurations..." cards={6} />;
  }

  return (
    <div className="screen-stack">
      <PageHeader
        title="CLI Tools"
        description="Connect your AI coding tools to route through responses-proxy. Click a tool to configure."
        actions={<RefreshButton onClick={fetchData} />}
      />

      <div style={{ display: "grid", gap: "var(--space-3)" }}>
        {TOOLS.map((tool) => (
          <ToolCard
            key={tool.id}
            tool={tool}
            status={toolStatuses[tool.id]}
            isExpanded={expandedTool === tool.id}
            onToggle={() => setExpandedTool(expandedTool === tool.id ? null : tool.id)}
            endpointUrl={endpointUrl}
            apiKeys={apiKeyOptions}
            providers={providers}
          />
        ))}
      </div>
    </div>
  );
}


// ─── Tool Card ───────────────────────────────────────────────────────────────

function ToolCard({
  tool,
  status,
  isExpanded,
  onToggle,
  endpointUrl,
  apiKeys,
  providers,
}: {
  tool: ToolDef;
  status?: ToolStatus;
  isExpanded: boolean;
  onToggle: () => void;
  endpointUrl: string;
  apiKeys: { apiKey: string; routeKey: string }[];
  providers: ProviderSummary[];
}) {
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [modelMappings, setModelMappings] = useState<Record<string, string>>({});
  const [applying, setApplying] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<ToolMessage>(null);
  const [showManual, setShowManual] = useState(false);
  const [localStatus, setLocalStatus] = useState<ToolStatus | undefined>(status);

  useEffect(() => { setLocalStatus(status); }, [status]);
  useEffect(() => {
    if (apiKeys.length > 0 && !selectedApiKey) setSelectedApiKey(apiKeys[0].apiKey);
  }, [apiKeys, selectedApiKey]);

  // Initialize model mappings from status
  useEffect(() => {
    if (localStatus?.settings?.env && tool.models) {
      const env = localStatus.settings.env;
      const initial: Record<string, string> = {};
      tool.models.forEach((m) => {
        if (m.envKey && env[m.envKey]) initial[m.alias] = env[m.envKey];
        else if (m.defaultValue) initial[m.alias] = m.defaultValue;
      });
      setModelMappings(initial);
    } else if (tool.models) {
      const initial: Record<string, string> = {};
      tool.models.forEach((m) => { if (m.defaultValue) initial[m.alias] = m.defaultValue; });
      setModelMappings(initial);
    }
  }, [localStatus, tool.models]);

  const refreshStatus = async () => {
    if (!tool.statusEndpoint) return;
    try {
      const res = await fetch(tool.statusEndpoint);
      if (res.ok) setLocalStatus(await res.json());
    } catch { /* skip */ }
  };

  const getConfigStatus = (): "connected" | "not_configured" | "not_installed" | "guide_only" => {
    if (!tool.statusEndpoint) return "guide_only";
    if (!localStatus?.installed) return "not_installed";
    if (localStatus.has9Router) return "connected";
    return "not_configured";
  };

  const configStatus = getConfigStatus();

  const handleApply = async () => {
    if (!tool.applyEndpoint) return;
    setApplying(true);
    setMessage(null);
    try {
      const effectiveUrl = endpointUrl.endsWith("/v1") ? endpointUrl : `${endpointUrl}/v1`;
      const keyToUse = selectedApiKey || apiKeys[0]?.apiKey || "sk_9router";

      let body: Record<string, unknown>;
      if (tool.id === "claude") {
        const env: Record<string, string> = {
          ANTHROPIC_BASE_URL: effectiveUrl,
          ANTHROPIC_AUTH_TOKEN: keyToUse,
        };
        if (tool.models) {
          tool.models.forEach((m) => {
            if (m.envKey && modelMappings[m.alias]) env[m.envKey] = modelMappings[m.alias];
          });
        }
        body = { env };
      } else if (tool.id === "codex") {
        body = {
          baseUrl: effectiveUrl,
          apiKey: keyToUse,
          model: modelMappings["model"] || "auto",
        };
      } else {
        body = { baseUrl: effectiveUrl, apiKey: keyToUse };
      }

      const res = await fetch(tool.applyEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: data.changed !== false ? "Settings applied!" : "Already up to date." });
        refreshStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply" });
      }
    } catch (error: any) {
      setMessage({ type: "error", text: error.message || "Failed" });
    } finally { setApplying(false); }
  };

  const handleReset = async () => {
    if (!tool.resetEndpoint) return;
    setResetting(true);
    setMessage(null);
    try {
      const res = await fetch(tool.resetEndpoint, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset!" });
        refreshStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset" });
      }
    } catch (error: any) {
      setMessage({ type: "error", text: error.message || "Failed" });
    } finally { setResetting(false); }
  };

  const effectiveUrl = endpointUrl.endsWith("/v1") ? endpointUrl : `${endpointUrl}/v1`;
  const keyToUse = selectedApiKey || apiKeys[0]?.apiKey || "your-api-key";

  return (
    <section className="surface-card" style={{ padding: "var(--space-4) var(--space-5)" }}>
      {/* Header — always visible */}
      <div
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", cursor: "pointer" }}
      >
        <div style={{
          width: 32, height: 32, borderRadius: 10, flexShrink: 0,
          background: `${tool.color}18`,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: tool.color }}>{tool.name.charAt(0)}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: "var(--text-sm)", fontWeight: 600 }}>{tool.name}</h3>
            <StatusPill status={configStatus} />
          </div>
          <p style={{ margin: "2px 0 0", fontSize: "var(--text-xs)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tool.description}</p>
        </div>
        <span style={{ color: "var(--text-muted)", transition: "transform var(--animation-normal)", transform: isExpanded ? "rotate(180deg)" : "none" }}>▾</span>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div style={{ marginTop: "var(--space-4)", paddingTop: "var(--space-4)", borderTop: "1px solid var(--line)", display: "grid", gap: "var(--space-3)" }}>

          {/* Not installed warning */}
          {configStatus === "not_installed" && (
            <div style={{ padding: "var(--space-3) var(--space-4)", background: "var(--warning-soft)", borderRadius: "var(--radius-sm)", border: "1px solid color-mix(in srgb, var(--warning) 30%, transparent)" }}>
              <strong style={{ fontSize: "var(--text-sm)", color: "var(--warning)" }}>Not detected locally</strong>
              <p style={{ margin: "4px 0 0", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>Manual configuration is still available if running on a remote server.</p>
              {tool.installCmd && (
                <code style={{ display: "block", marginTop: "var(--space-2)", padding: "var(--space-2) var(--space-3)", background: "var(--surface-muted)", borderRadius: "var(--radius-sm)", fontSize: "var(--text-xs)", fontFamily: "monospace" }}>
                  {tool.installCmd}
                </code>
              )}
            </div>
          )}

          {/* Config fields — for tools with auto-apply */}
          {tool.applyEndpoint && (configStatus === "connected" || configStatus === "not_configured" || configStatus === "not_installed") && (
            <>
              {/* Endpoint */}
              <ConfigRow label="Endpoint">
                <code style={{ flex: 1, fontSize: "var(--text-xs)", padding: "6px var(--space-3)", background: "var(--control-bg)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {effectiveUrl}
                </code>
              </ConfigRow>

              {/* Current URL */}
              {localStatus?.settings?.env?.ANTHROPIC_BASE_URL && (
                <ConfigRow label="Current">
                  <code style={{ flex: 1, fontSize: "var(--text-xs)", padding: "6px var(--space-3)", background: "var(--surface-muted)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {localStatus.settings.env.ANTHROPIC_BASE_URL}
                  </code>
                </ConfigRow>
              )}

              {/* API Key */}
              <ConfigRow label="API Key">
                <select
                  value={selectedApiKey}
                  onChange={(e) => setSelectedApiKey(e.target.value)}
                  style={{ flex: 1, minHeight: 32, fontSize: "var(--text-xs)", padding: "4px 8px" }}
                >
                  {apiKeys.length === 0 && <option value="">No API keys</option>}
                  {apiKeys.map((k) => (
                    <option key={k.apiKey} value={k.apiKey}>{k.routeKey} • ••••{k.apiKey.slice(-4)}</option>
                  ))}
                </select>
              </ConfigRow>

              {/* Model mappings */}
              {tool.models?.map((m) => (
                <ConfigRow key={m.alias} label={m.name}>
                  <input
                    type="text"
                    value={modelMappings[m.alias] || ""}
                    onChange={(e) => setModelMappings((prev) => ({ ...prev, [m.alias]: e.target.value }))}
                    placeholder={m.defaultValue || "provider/model"}
                    style={{ flex: 1, minHeight: 32, fontSize: "var(--text-xs)", padding: "4px 8px", fontFamily: "monospace" }}
                  />
                </ConfigRow>
              ))}

              {/* Actions */}
              <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", marginTop: "var(--space-2)" }}>
                <button className="button-primary" onClick={handleApply} disabled={applying} style={{ minHeight: 36 }}>
                  {applying ? "Applying..." : "Apply"}
                </button>
                <button className="button-link" onClick={handleReset} disabled={resetting || !localStatus?.has9Router} style={{ minHeight: 36 }}>
                  {resetting ? "Resetting..." : "Reset"}
                </button>
                <button className="button-link" onClick={() => setShowManual(!showManual)} style={{ minHeight: 36 }}>
                  Manual Config
                </button>
              </div>
            </>
          )}

          {/* Guide-only tools (no auto-apply) */}
          {!tool.applyEndpoint && (
            <div style={{ display: "grid", gap: "var(--space-2)" }}>
              <ConfigRow label="Endpoint">
                <CopyField value={effectiveUrl} />
              </ConfigRow>
              <ConfigRow label="API Key">
                <CopyField value={keyToUse} />
              </ConfigRow>
              <ConfigRow label="Model">
                <CopyField value="auto" />
              </ConfigRow>
            </div>
          )}

          {/* Manual config JSON */}
          {showManual && (
            <div style={{ background: "var(--surface-muted)", border: "1px solid var(--line)", borderRadius: "var(--radius-md)", padding: "var(--space-4)", fontFamily: "monospace", fontSize: "var(--text-xs)", overflowX: "auto", whiteSpace: "pre-wrap" }}>
              {tool.id === "claude" && JSON.stringify({
                hasCompletedOnboarding: true,
                env: {
                  ANTHROPIC_BASE_URL: effectiveUrl,
                  ANTHROPIC_AUTH_TOKEN: keyToUse,
                  ...(tool.models || []).reduce((acc, m) => {
                    if (m.envKey && modelMappings[m.alias]) acc[m.envKey] = modelMappings[m.alias];
                    return acc;
                  }, {} as Record<string, string>),
                },
              }, null, 2)}
              {tool.id === "codex" && `# ~/.codex/config.toml\nmodel = "${modelMappings["model"] || "auto"}"\nmodel_provider = "9router"\n\n[model_providers.9router]\nname = "9Router"\nbase_url = "${effectiveUrl}"\nwire_api = "responses"\n\n# ~/.codex/auth.json\n${JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: keyToUse }, null, 2)}`}
              {!["claude", "codex"].includes(tool.id) && `Endpoint: ${effectiveUrl}\nAPI Key: ${keyToUse}\nModel: auto`}
            </div>
          )}

          {/* Feedback message */}
          {message && (
            <div style={{
              padding: "var(--space-2) var(--space-3)",
              borderRadius: "var(--radius-sm)",
              background: message.type === "success" ? "var(--success-soft)" : "var(--danger-soft)",
              color: message.type === "success" ? "var(--success)" : "var(--danger)",
              fontSize: "var(--text-xs)",
              fontWeight: 600,
            }}>
              {message.text}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ─── Helper Components ───────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, { bg: string; color: string; label: string }> = {
    connected: { bg: "var(--success-soft)", color: "var(--success)", label: "Connected" },
    not_configured: { bg: "var(--warning-soft)", color: "var(--warning)", label: "Not configured" },
    not_installed: { bg: "var(--neutral-soft)", color: "var(--text-muted)", label: "Not installed" },
    guide_only: { bg: "var(--accent-soft)", color: "var(--accent)", label: "Manual" },
  };
  const s = styles[status] || styles.guide_only;
  return (
    <span style={{
      padding: "2px 8px",
      fontSize: "0.65rem",
      fontWeight: 600,
      borderRadius: "var(--radius-pill)",
      background: s.bg,
      color: s.color,
    }}>
      {s.label}
    </span>
  );
}

function ConfigRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", alignItems: "center", gap: "var(--space-2)" }}>
      <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)", textAlign: "right" }}>{label}</span>
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <>
      <code style={{ flex: 1, fontSize: "var(--text-xs)", padding: "6px var(--space-3)", background: "var(--control-bg)", border: "1px solid var(--line)", borderRadius: "var(--radius-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "monospace" }}>
        {value}
      </code>
      <button
        onClick={handleCopy}
        style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "var(--text-xs)", fontWeight: 600, minHeight: "auto", whiteSpace: "nowrap" }}
      >
        {copied ? "✓" : "Copy"}
      </button>
    </>
  );
}
