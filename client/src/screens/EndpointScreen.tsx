/**
 * Endpoint screen — 9router-inspired layout.
 *
 * Lists every URL the proxy is reachable on (loopback, LAN, Tailscale,
 * configured public URL) as compact rows with copy buttons. Below that, a
 * quick-setup card with copy-paste env vars for popular AI tools, and the
 * route API-key manager.
 *
 * No fake metrics, no fake routing pipeline visualization — those belong
 * on the dashboard / quota tracker. This page is just the endpoint surface.
 */

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/PageHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { RefreshButton } from "../components/RefreshButton";
import { StatusBadge } from "../components/StatusBadge";
import { ApiKeyManager } from "../components/ApiKeyManager";
import { EndpointIcon, AlertIcon } from "../components/icons";
import { getEndpointInfo, getHealth } from "../api/client";
import type {
  EndpointEntry,
  EndpointInfoResponse,
  HealthResponse,
} from "../api/types";

type EndpointKind = EndpointEntry["kind"] | "public";

type EndpointRow = {
  id: string;
  kind: EndpointKind;
  label: string;
  description?: string;
  apiUrl: string;
};

const KIND_LABELS: Record<EndpointKind, string> = {
  loopback: "Local",
  lan: "LAN",
  tailscale: "Tailscale",
  other: "Network",
  public: "Public",
};

const KIND_DESCRIPTIONS: Record<EndpointKind, string> = {
  loopback: "Same machine only",
  lan: "Reachable on the local network",
  tailscale: "Reachable on your tailnet",
  other: "Externally routable address",
  public: "Configured via PROXY_PUBLIC_URL",
};

export function EndpointScreen() {
  const [info, setInfo] = useState<EndpointInfoResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRefreshing(true);
      setError(null);
      const [endpointInfo, healthInfo] = await Promise.all([getEndpointInfo(), getHealth()]);
      setInfo(endpointInfo);
      setHealth(healthInfo);
    } catch (err) {
      console.error("Failed to load endpoint info", err);
      setError(err instanceof Error ? err.message : "Could not load endpoint information");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows: EndpointRow[] = (() => {
    if (!info) return [];
    const result: EndpointRow[] = info.endpoints.map((entry, index) => ({
      id: `${entry.kind}-${entry.address}-${index}`,
      kind: entry.kind,
      label: KIND_LABELS[entry.kind] ?? entry.kind,
      description: KIND_DESCRIPTIONS[entry.kind],
      apiUrl: entry.apiUrl,
    }));
    if (info.publicUrl) {
      const trimmed = info.publicUrl.replace(/\/+$/, "");
      result.push({
        id: "public",
        kind: "public",
        label: KIND_LABELS.public,
        description: KIND_DESCRIPTIONS.public,
        apiUrl: trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`,
      });
    }
    return result;
  })();

  const primaryUrl = rows.find((r) => r.kind === "public")?.apiUrl
    ?? rows.find((r) => r.kind === "loopback")?.apiUrl
    ?? `${window.location.origin}/v1`;

  return (
    <div className="screen-stack">
      <PageHeader
        icon={EndpointIcon}
        title="Endpoint"
        description="Reach the proxy from any of these URLs. Use the API URL in your AI tool's base-url setting."
        actions={<RefreshButton onClick={load} isRefreshing={refreshing} />}
      />

      {error && (
        <div className="error-banner" style={{
          background: "var(--danger-soft)",
          border: "1px solid var(--danger)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-4)",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
        }}>
          <AlertIcon className="status-icon status-error" style={{ width: 20, height: 20 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: "var(--danger)" }}>Connection issue</div>
            <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
              {error}
            </div>
          </div>
          <button className="button-secondary" onClick={load}>Retry</button>
        </div>
      )}

      <SurfaceCard
        title="API Endpoint"
        description={
          health
            ? health.ok
              ? `Service ${health.service ?? "responses-proxy"} is online and listening on port ${info?.port ?? ""}.`
              : "Service is not reporting healthy."
            : "Loading service status..."
        }
        actions={
          <StatusBadge variant={health?.ok ? "success" : "warning"}>
            {health?.ok ? "Online" : health ? "Offline" : "Loading"}
          </StatusBadge>
        }
      >
        {loading && rows.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
            Loading endpoint URLs...
          </p>
        ) : rows.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
            No reachable URLs detected.
          </p>
        ) : (
          <div className="endpoint-rows">
            {rows.map((row) => (
              <EndpointUrlRow key={row.id} row={row} />
            ))}
          </div>
        )}
      </SurfaceCard>

      <QuickSetupCard endpointUrl={primaryUrl} />

      <ApiKeyManager />
    </div>
  );
}

function EndpointUrlRow({ row }: { row: EndpointRow }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(row.apiUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard write blocked; ignore */
    }
  };

  return (
    <div className="endpoint-row">
      <div className="endpoint-row-label">
        <StatusBadge variant={row.kind === "public" ? "accent" : "neutral"}>
          {row.label}
        </StatusBadge>
        {row.description && (
          <span className="endpoint-row-description">{row.description}</span>
        )}
      </div>
      <div className="endpoint-row-url-wrap">
        <input
          className="endpoint-row-input"
          readOnly
          value={row.apiUrl}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          className="endpoint-row-copy"
          onClick={handleCopy}
          title={copied ? "Copied" : "Copy URL"}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

// ─── Quick Setup Card ────────────────────────────────────────────────────────

type SetupTool = "claude" | "codex" | "openai" | "cursor";

const SETUP_TABS: { id: SetupTool; label: string }[] = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "openai", label: "OpenAI CLI" },
  { id: "cursor", label: "Cursor" },
];

function buildSetupCommand(tool: SetupTool, endpointUrl: string): { lang: "bash" | "json"; text: string } {
  switch (tool) {
    case "claude":
      return {
        lang: "bash",
        text: `# In ~/.claude/settings.json env block:
{
  "env": {
    "ANTHROPIC_BASE_URL": "${endpointUrl.replace(/\/$/, "")}",
    "ANTHROPIC_AUTH_TOKEN": "<route api key>"
  }
}`,
      };
    case "codex":
      return {
        lang: "bash",
        text: `export OPENAI_BASE_URL="${endpointUrl.replace(/\/$/, "")}"
export OPENAI_API_KEY="<route api key>"`,
      };
    case "openai":
      return {
        lang: "bash",
        text: `export OPENAI_BASE_URL="${endpointUrl.replace(/\/$/, "")}"
export OPENAI_API_KEY="<route api key>"`,
      };
    case "cursor":
      return {
        lang: "json",
        text: `// In Cursor settings (Settings → Models → OpenAI):
{
  "base_url": "${endpointUrl.replace(/\/$/, "")}",
  "api_key": "<route api key>"
}`,
      };
  }
}

function QuickSetupCard({ endpointUrl }: { endpointUrl: string }) {
  const [activeTab, setActiveTab] = useState<SetupTool>("claude");
  const [copied, setCopied] = useState(false);

  const setup = buildSetupCommand(activeTab, endpointUrl);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(setup.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <SurfaceCard
      title="Quick Setup"
      description="Copy-paste configuration for popular AI tools."
    >
      <div className="setup-tab-bar">
        {SETUP_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`setup-tab-btn ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="terminal-wrapper">
        <div className="terminal-header">
          <div className="terminal-dots">
            <span className="terminal-dot terminal-dot-red" />
            <span className="terminal-dot terminal-dot-yellow" />
            <span className="terminal-dot terminal-dot-green" />
          </div>
          <span className="terminal-title">{setup.lang.toUpperCase()}</span>
          <button type="button" className="copy-command-button" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="terminal-body">
          <pre><code>{renderHighlighted(setup.text, setup.lang)}</code></pre>
        </div>
      </div>
    </SurfaceCard>
  );
}

function renderHighlighted(source: string, lang: "bash" | "json"): JSX.Element[] {
  const lines = source.split("\n");
  return lines.map((line, idx) => {
    if (line.trim().startsWith("#") || line.trim().startsWith("//")) {
      return (
        <div key={idx} className="terminal-comment">{line}</div>
      );
    }
    if (lang === "bash" && line.startsWith("export ")) {
      const eq = line.indexOf("=");
      if (eq > 0) {
        const head = line.slice("export ".length, eq);
        const tail = line.slice(eq);
        return (
          <div key={idx}>
            <span className="command-highlight">export</span>{" "}
            <span className="variable-highlight">{head}</span>
            <span className="terminal-value">{tail}</span>
          </div>
        );
      }
    }
    if (lang === "json") {
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0 && line.trim().startsWith('"')) {
        const head = line.slice(0, colonIdx);
        const tail = line.slice(colonIdx);
        return (
          <div key={idx}>
            <span className="terminal-key">{head}</span>
            <span className="terminal-value">{tail}</span>
          </div>
        );
      }
    }
    return <div key={idx}>{line}</div>;
  });
}
