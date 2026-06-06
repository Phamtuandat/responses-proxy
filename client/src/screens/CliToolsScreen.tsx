/**
 * CLI Tools Screen — 9Router-style tool configuration grid.
 *
 * Shows a grid of supported CLI tools with connection status.
 * Each tool card shows: name, icon/color, status badge, and links
 * to a detail panel with setup instructions.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { PageHeader } from "../components/PageHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { LoadingState } from "../components/LoadingState";
import { RefreshButton } from "../components/RefreshButton";
import {
  getProviders,
  getClientConfigsStatus,
} from "../api/client";
import type {
  ClientRouteSummary,
  ClientConfigsStatusResponse,
  ProviderSummary,
} from "../api/types";

// ─── CLI Tool Definitions (mirroring 9Router's cliTools.js) ──────────────────

type CliToolDef = {
  id: string;
  name: string;
  color: string;
  description: string;
  configType: "env" | "custom" | "guide";
  envVars?: Record<string, string>;
  guideSteps?: { step: number; title: string; desc?: string; value?: string; copyable?: boolean }[];
  codeBlock?: { language: string; code: string };
};

const CLI_TOOLS: Record<string, CliToolDef> = {
  claude: {
    id: "claude",
    name: "Claude Code",
    color: "#D97757",
    description: "Anthropic Claude Code CLI",
    configType: "env",
    envVars: { baseUrl: "ANTHROPIC_BASE_URL", apiKey: "ANTHROPIC_API_KEY" },
  },
  codex: {
    id: "codex",
    name: "OpenAI Codex",
    color: "#10A37F",
    description: "OpenAI Codex CLI / App",
    configType: "custom",
  },
  cursor: {
    id: "cursor",
    name: "Cursor",
    color: "#000000",
    description: "Cursor AI Code Editor",
    configType: "guide",
    guideSteps: [
      { step: 1, title: "Open Settings", desc: "Go to Settings → Models" },
      { step: 2, title: "Enable OpenAI API", desc: 'Enable "OpenAI API key" option' },
      { step: 3, title: "Base URL", value: "{{baseUrl}}", copyable: true },
      { step: 4, title: "API Key", value: "{{apiKey}}", copyable: true },
      { step: 5, title: "Add Custom Model", desc: 'Click "View All Model" → "Add Custom Model"' },
    ],
  },
  cline: {
    id: "cline",
    name: "Cline",
    color: "#00D1B2",
    description: "Cline AI Coding Assistant (VSCode)",
    configType: "guide",
    guideSteps: [
      { step: 1, title: "Open Cline Settings", desc: "Select API Provider → OpenAI Compatible" },
      { step: 2, title: "Base URL", value: "{{baseUrl}}", copyable: true },
      { step: 3, title: "API Key", value: "{{apiKey}}", copyable: true },
      { step: 4, title: "Model", value: "auto", copyable: true },
    ],
  },
  hermes: {
    id: "hermes",
    name: "Hermes Agent",
    color: "#8B5CF6",
    description: "Nous Research Hermes AI agent",
    configType: "custom",
  },
  opencode: {
    id: "opencode",
    name: "OpenCode",
    color: "#E87040",
    description: "OpenCode AI Terminal Assistant",
    configType: "guide",
    guideSteps: [
      { step: 1, title: "Open Config", desc: "Edit ~/.opencode/config.json" },
      { step: 2, title: "Set Provider", desc: 'Set provider to "openai"' },
      { step: 3, title: "Base URL", value: "{{baseUrl}}", copyable: true },
      { step: 4, title: "API Key", value: "{{apiKey}}", copyable: true },
    ],
  },
  kilo: {
    id: "kilo",
    name: "Kilo Code",
    color: "#FF6B6B",
    description: "Kilo Code AI Assistant (VSCode)",
    configType: "guide",
    guideSteps: [
      { step: 1, title: "Open Settings", desc: "Go to Kilo Code settings" },
      { step: 2, title: "Select Provider", desc: "Choose API Provider → OpenAI Compatible" },
      { step: 3, title: "Base URL", value: "{{baseUrl}}", copyable: true },
      { step: 4, title: "API Key", value: "{{apiKey}}", copyable: true },
    ],
  },
  "openai-sdk": {
    id: "openai-sdk",
    name: "OpenAI SDK",
    color: "#10A37F",
    description: "Python / Node.js OpenAI SDK",
    configType: "env",
    envVars: { baseUrl: "OPENAI_BASE_URL", apiKey: "OPENAI_API_KEY" },
  },
};

// ─── Main Screen ─────────────────────────────────────────────────────────────

export function CliToolsScreen() {
  const [loading, setLoading] = useState(true);
  const [clientRoutes, setClientRoutes] = useState<ClientRouteSummary[]>([]);
  const [configStatus, setConfigStatus] = useState<ClientConfigsStatusResponse | null>(null);
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [selectedApiKey, setSelectedApiKey] = useState("");

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [providers, configs] = await Promise.all([
        getProviders(),
        getClientConfigsStatus().catch(() => null),
      ]);
      setClientRoutes(providers.clientRoutes || []);
      setConfigStatus(configs);
    } catch (error) {
      console.error("Failed to fetch CLI tools data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const apiKeyOptions = useMemo(() => {
    return clientRoutes.flatMap((route) => {
      const keys = Array.isArray(route.apiKeys) ? route.apiKeys.filter(Boolean) : [];
      return keys.map((apiKey, index) => ({
        apiKey,
        routeKey: route.key,
        label: `${route.key}${keys.length > 1 ? ` (${index + 1})` : ""} • ••••${apiKey.slice(-4)}`,
      }));
    });
  }, [clientRoutes]);

  useEffect(() => {
    if (apiKeyOptions.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeyOptions[0].apiKey);
    }
  }, [apiKeyOptions, selectedApiKey]);

  const endpointUrl = configStatus?.proxyBaseUrl || `${window.location.origin}/v1`;
  const activeApiKey = selectedApiKey || "your-api-key";

  // Derive tool statuses from config status
  const toolStatuses = useMemo(() => {
    const statuses: Record<string, { configured: boolean; label: string }> = {};
    const clients = configStatus?.clients || {};
    if (clients.hermes?.configured) statuses.hermes = { configured: true, label: "Configured" };
    if (clients.codex?.configured) statuses.codex = { configured: true, label: "Configured" };
    // For other tools, we don't have config detection, so show "Ready" if we have API keys
    const hasKeys = apiKeyOptions.length > 0;
    for (const toolId of Object.keys(CLI_TOOLS)) {
      if (!statuses[toolId]) {
        statuses[toolId] = hasKeys
          ? { configured: false, label: "Ready" }
          : { configured: false, label: "No API keys" };
      }
    }
    return statuses;
  }, [configStatus, apiKeyOptions]);

  if (loading) {
    return <LoadingState title="Loading CLI tools" description="Checking tool configurations..." cards={6} />;
  }

  return (
    <div className="screen-stack">
      <PageHeader
        title="CLI Tools"
        description="Connect your AI coding tools to route through responses-proxy."
        actions={<RefreshButton onClick={fetchData} />}
      />

      {/* API Key Selector */}
      <SurfaceCard>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", flexWrap: "wrap" }}>
          <label className="field-label" style={{ margin: 0, whiteSpace: "nowrap" }}>API Key:</label>
          <select
            value={selectedApiKey}
            onChange={(e) => setSelectedApiKey(e.target.value)}
            style={{ flex: 1, minWidth: 240, maxWidth: 400 }}
          >
            {apiKeyOptions.length === 0 && <option value="">No API keys found</option>}
            {apiKeyOptions.map((opt) => (
              <option key={opt.apiKey} value={opt.apiKey}>{opt.label}</option>
            ))}
          </select>
          <code style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", padding: "4px 8px", background: "var(--surface-muted)", borderRadius: "var(--radius-sm)" }}>
            {endpointUrl}
          </code>
        </div>
      </SurfaceCard>

      {/* Tool Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "var(--space-4)" }}>
        {Object.entries(CLI_TOOLS).map(([toolId, tool]) => (
          <ToolCard
            key={toolId}
            tool={tool}
            status={toolStatuses[toolId]}
            isSelected={selectedTool === toolId}
            onClick={() => setSelectedTool(selectedTool === toolId ? null : toolId)}
          />
        ))}
      </div>

      {/* Detail Panel */}
      {selectedTool && CLI_TOOLS[selectedTool] && (
        <ToolDetailPanel
          tool={CLI_TOOLS[selectedTool]}
          endpointUrl={endpointUrl}
          apiKey={activeApiKey}
        />
      )}
    </div>
  );
}


// ─── Tool Card ───────────────────────────────────────────────────────────────

function ToolCard({
  tool,
  status,
  isSelected,
  onClick,
}: {
  tool: CliToolDef;
  status?: { configured: boolean; label: string };
  isSelected: boolean;
  onClick: () => void;
}) {
  const statusLabel = status?.label || "Unknown";
  const isConfigured = status?.configured;

  return (
    <section
      className="surface-card"
      onClick={onClick}
      style={{
        cursor: "pointer",
        borderColor: isSelected ? "var(--accent)" : undefined,
        transition: "border-color var(--animation-normal), transform var(--animation-normal)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        {/* Icon circle */}
        <div style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: `${tool.color}18`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: tool.color }}>
            {tool.name.charAt(0)}
          </span>
        </div>

        {/* Name + description */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: "var(--text-sm)", fontWeight: 600, lineHeight: 1.3 }}>{tool.name}</h3>
          <span
            style={{
              display: "inline-block",
              marginTop: 4,
              padding: "2px 8px",
              fontSize: "0.65rem",
              fontWeight: 600,
              borderRadius: "var(--radius-pill)",
              background: isConfigured ? "var(--success-soft)" : "var(--neutral-soft)",
              color: isConfigured ? "var(--success)" : "var(--text-muted)",
            }}
          >
            {statusLabel}
          </span>
        </div>

        {/* Chevron */}
        <span style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
          {isSelected ? "▼" : "▶"}
        </span>
      </div>
    </section>
  );
}

// ─── Tool Detail Panel ───────────────────────────────────────────────────────

function ToolDetailPanel({
  tool,
  endpointUrl,
  apiKey,
}: {
  tool: CliToolDef;
  endpointUrl: string;
  apiKey: string;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [claudeStatus, setClaudeStatus] = useState<any>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  // Auto-detect Claude Code status on mount
  useEffect(() => {
    if (tool.id === "claude") {
      checkClaudeStatus();
    }
  }, [tool.id]);

  const checkClaudeStatus = async () => {
    setCheckingStatus(true);
    try {
      const res = await fetch("/api/cli-tools/claude-settings");
      if (res.ok) setClaudeStatus(await res.json());
    } catch { /* ignore */ }
    finally { setCheckingStatus(false); }
  };

  const handleApplyClaude = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const env: Record<string, string> = {
        ANTHROPIC_BASE_URL: endpointUrl,
        ANTHROPIC_AUTH_TOKEN: apiKey,
      };
      const res = await fetch("/api/cli-tools/claude-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ env }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: data.changed ? "Settings applied!" : "Already up to date." });
        checkClaudeStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply" });
      }
    } catch (error: any) {
      setMessage({ type: "error", text: error.message || "Failed" });
    } finally { setApplying(false); }
  };

  const handleResetClaude = async () => {
    setResetting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/claude-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset!" });
        checkClaudeStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset" });
      }
    } catch (error: any) {
      setMessage({ type: "error", text: error.message || "Failed" });
    } finally { setResetting(false); }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const resolveTemplate = (text: string) =>
    text.replace(/\{\{baseUrl\}\}/g, endpointUrl).replace(/\{\{apiKey\}\}/g, apiKey);

  return (
    <SurfaceCard title={`${tool.name} Setup`} description={tool.description}>
      <div style={{ display: "grid", gap: "var(--space-4)", marginTop: "var(--space-3)" }}>

        {/* Auto-Apply Section for Claude Code */}
        {tool.id === "claude" && (
          <div style={{ padding: "var(--space-4)", background: "var(--surface-muted)", borderRadius: "var(--radius-md)", border: "1px solid var(--line)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", marginBottom: "var(--space-3)" }}>
              <div>
                <strong style={{ fontSize: "var(--text-sm)" }}>Auto-Apply</strong>
                <p style={{ margin: "2px 0 0", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                  {checkingStatus ? "Checking..." : claudeStatus?.installed
                    ? claudeStatus.has9Router ? "Connected to proxy" : "Installed, not configured"
                    : "Claude CLI not detected"
                  }
                </p>
              </div>
              {claudeStatus?.installed && (
                <span
                  className="status-badge"
                  style={{
                    background: claudeStatus.has9Router ? "var(--success-soft)" : "var(--warning-soft)",
                    color: claudeStatus.has9Router ? "var(--success)" : "var(--warning)",
                  }}
                >
                  {claudeStatus.has9Router ? "Connected" : "Not configured"}
                </span>
              )}
            </div>

            {claudeStatus?.settings?.env?.ANTHROPIC_BASE_URL && (
              <div style={{ marginBottom: "var(--space-3)", padding: "var(--space-2) var(--space-3)", background: "var(--control-bg)", borderRadius: "var(--radius-sm)", border: "1px solid var(--line)" }}>
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Current: </span>
                <code style={{ fontSize: "var(--text-xs)" }}>{claudeStatus.settings.env.ANTHROPIC_BASE_URL}</code>
              </div>
            )}

            <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
              <button
                className="button-primary"
                onClick={handleApplyClaude}
                disabled={applying || !apiKey}
                style={{ minHeight: 36 }}
              >
                {applying ? "Applying..." : "Apply Settings"}
              </button>
              <button
                className="button-link"
                onClick={handleResetClaude}
                disabled={resetting || !claudeStatus?.has9Router}
                style={{ minHeight: 36 }}
              >
                {resetting ? "Resetting..." : "Reset"}
              </button>
              <button
                className="button-link"
                onClick={checkClaudeStatus}
                disabled={checkingStatus}
                style={{ minHeight: 36 }}
              >
                Refresh Status
              </button>
            </div>

            {message && (
              <div style={{
                marginTop: "var(--space-3)",
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

        {/* Environment variable config */}
        {tool.configType === "env" && tool.envVars && (
          <div>
            <p style={{ margin: "0 0 var(--space-3)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
              Export these environment variables before starting your tool:
            </p>
            <div style={{
              background: "var(--surface-muted)",
              border: "1px solid var(--line)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-4)",
              fontFamily: "monospace",
              fontSize: "var(--text-xs)",
              overflowX: "auto",
              position: "relative",
            }}>
              <button
                onClick={() => {
                  const code = Object.entries(tool.envVars!).map(([key, envName]) => {
                    const val = key === "baseUrl" ? endpointUrl : apiKey;
                    return `export ${envName}="${val}"`;
                  }).join("\n");
                  handleCopy(code, "env");
                }}
                style={{
                  position: "absolute",
                  top: 8,
                  right: 8,
                  background: "none",
                  border: "none",
                  color: "var(--accent)",
                  cursor: "pointer",
                  fontSize: "var(--text-xs)",
                  fontWeight: 600,
                  minHeight: "auto",
                }}
              >
                {copied === "env" ? "Copied!" : "Copy"}
              </button>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {Object.entries(tool.envVars).map(([key, envName]) => {
                  const val = key === "baseUrl" ? endpointUrl : apiKey;
                  return `export ${envName}="${val}"`;
                }).join("\n")}
              </pre>
            </div>
          </div>
        )}

        {/* Guide steps */}
        {tool.guideSteps && (
          <div>
            <p style={{ margin: "0 0 var(--space-3)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
              Follow these steps to configure {tool.name}:
            </p>
            <div style={{ display: "grid", gap: "var(--space-2)" }}>
              {tool.guideSteps.map((step) => (
                <div
                  key={step.step}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "var(--space-3)",
                    padding: "var(--space-3)",
                    background: "var(--surface-muted)",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--line)",
                  }}
                >
                  <span style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "var(--accent-soft)",
                    color: "var(--accent)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>
                    {step.step}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: "var(--text-sm)" }}>{step.title}</strong>
                    {step.desc && <p style={{ margin: "2px 0 0", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{step.desc}</p>}
                    {step.value && (
                      <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                        <code style={{
                          flex: 1,
                          padding: "4px 8px",
                          background: "var(--control-bg)",
                          border: "1px solid var(--line)",
                          borderRadius: "var(--radius-sm)",
                          fontSize: "var(--text-xs)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}>
                          {resolveTemplate(step.value)}
                        </code>
                        {step.copyable && (
                          <button
                            onClick={() => handleCopy(resolveTemplate(step.value!), `step-${step.step}`)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "var(--accent)",
                              cursor: "pointer",
                              fontSize: "var(--text-xs)",
                              fontWeight: 600,
                              minHeight: "auto",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {copied === `step-${step.step}` ? "✓" : "Copy"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Custom tool — show generic endpoint info */}
        {tool.configType === "custom" && !tool.guideSteps && (
          <div>
            <p style={{ margin: "0 0 var(--space-3)", fontSize: "var(--text-sm)", color: "var(--text-secondary)" }}>
              Configure {tool.name} with these connection details:
            </p>
            <div style={{ display: "grid", gap: "var(--space-2)" }}>
              <CopyableField label="Endpoint URL" value={endpointUrl} copied={copied} onCopy={handleCopy} id="url" />
              <CopyableField label="API Key" value={apiKey} copied={copied} onCopy={handleCopy} id="key" />
              <CopyableField label="Model" value="auto" copied={copied} onCopy={handleCopy} id="model" />
            </div>
          </div>
        )}

        {/* Code block */}
        {tool.codeBlock && (
          <div style={{
            background: "var(--surface-muted)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-4)",
            fontFamily: "monospace",
            fontSize: "var(--text-xs)",
            overflowX: "auto",
            position: "relative",
          }}>
            <button
              onClick={() => handleCopy(resolveTemplate(tool.codeBlock!.code), "codeblock")}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                background: "none",
                border: "none",
                color: "var(--accent)",
                cursor: "pointer",
                fontSize: "var(--text-xs)",
                fontWeight: 600,
                minHeight: "auto",
              }}
            >
              {copied === "codeblock" ? "Copied!" : "Copy"}
            </button>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{resolveTemplate(tool.codeBlock.code)}</pre>
          </div>
        )}
      </div>
    </SurfaceCard>
  );
}

// ─── Copyable Field ──────────────────────────────────────────────────────────

function CopyableField({
  label,
  value,
  copied,
  onCopy,
  id,
}: {
  label: string;
  value: string;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
  id: string;
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "var(--space-3)",
      padding: "var(--space-2) var(--space-3)",
      background: "var(--surface-muted)",
      borderRadius: "var(--radius-sm)",
      border: "1px solid var(--line)",
    }}>
      <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)", width: 90, flexShrink: 0 }}>{label}</span>
      <code style={{ flex: 1, fontSize: "var(--text-xs)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</code>
      <button
        onClick={() => onCopy(value, id)}
        style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "var(--text-xs)", fontWeight: 600, minHeight: "auto", whiteSpace: "nowrap" }}
      >
        {copied === id ? "✓" : "Copy"}
      </button>
    </div>
  );
}
