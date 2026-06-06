import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "../components/PageHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { RefreshButton } from "../components/RefreshButton";
import { ApiKeyManager } from "../components/ApiKeyManager";
import { EndpointIcon, AlertIcon } from "../components/icons";
import { getHealth, getUsageStats } from "../api/client";
import type { HealthResponse, UsageStatsResponse } from "../api/types";
import { useProviders, useAutoHealthMonitoring } from "../features/providers/providerHooks";
import type { Provider } from "../features/providers/providerTypes";
import { formatNumber, formatPercent } from "../lib/format";

// Helper function to render syntax-highlighted terminal commands
function renderSyntaxHighlightedCommand(cmd: string, type: "claude" | "cursor" | "openai") {
  if (type === "cursor") {
    return cmd.split("\n").map((line, idx) => {
      if (line.trim().startsWith("//")) {
        return (
          <div key={idx} className="terminal-comment">
            {line}
          </div>
        );
      }
      const parts = line.split(":");
      if (parts.length >= 2) {
        const key = parts[0];
        const val = parts.slice(1).join(":");
        return (
          <div key={idx}>
            <span className="terminal-key">{key}</span>:
            <span className="terminal-value">{val}</span>
          </div>
        );
      }
      return <div key={idx} className="terminal-text">{line}</div>;
    });
  } else {
    return cmd.split("\n").map((line, idx) => {
      if (line.startsWith("export ")) {
        const parts = line.split("=");
        const variable = parts[0];
        const value = parts.slice(1).join("=");
        return (
          <div key={idx}>
            <span className="command-highlight">export</span>{" "}
            <span className="variable-highlight">{variable.replace("export ", "")}</span>=
            <span className="terminal-value">{value}</span>
          </div>
        );
      }
      return <div key={idx}>{line}</div>;
    });
  }
}

interface ServerStatusCardProps {
  health: HealthResponse | null;
  loading: boolean;
  endpointUrl: string;
  onRefresh: () => void;
}

function ServerStatusCard({ health, loading, endpointUrl, onRefresh }: ServerStatusCardProps) {
  const isRunning = health?.ok ?? false;
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(endpointUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <SurfaceCard
      title="Server Status"
      description="Local router server health and information"
      actions={<RefreshButton onClick={onRefresh} isRefreshing={loading} />}
    >
      <div className="endpoint-status-grid">
        <div className="status-item">
          <div className="status-indicator">
            {isRunning ? (
              <span className="status-pulse-dot" />
            ) : (
              <AlertIcon className="status-icon status-error" />
            )}
          </div>
          <div className="status-details">
            <div className="status-label">Server</div>
            <div className="status-value">
              {isRunning ? "Running" : "Stopped"}
            </div>
          </div>
        </div>

        <div className="status-item">
          <div className="status-details">
            <div className="status-label">Service</div>
            <div className="status-value">{health?.service || "responses-proxy"}</div>
          </div>
        </div>

        <div className="status-item">
          <div className="status-details">
            <div className="status-label">Status</div>
            <div className="status-value">{isRunning ? "Online" : "Offline"}</div>
          </div>
        </div>

        <div className="status-item">
          <div className="status-details">
            <div className="status-label">Port</div>
            <div className="status-value">{window.location.port || "8318"}</div>
          </div>
        </div>
      </div>

      <div className="endpoint-url-section">
        <div className="endpoint-label">Local Endpoint</div>
        <div className="endpoint-url-container">
          <code className="endpoint-url">{endpointUrl}</code>
          <button
            className="copy-button"
            onClick={handleCopy}
            title="Copy endpoint URL"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
    </SurfaceCard>
  );
}

interface ActiveProviderCardProps {
  health: HealthResponse | null;
  providers: Provider[];
}

function ActiveProviderCard({ health, providers }: ActiveProviderCardProps) {
  const activeProviderId = health?.activeProviderId;
  const activeProvider = providers.find(p => p.id === activeProviderId);

  const displayName = activeProvider?.displayName || activeProviderId || "None";
  const tier = activeProvider?.tier || "n/a";
  const status = activeProvider?.healthStatus || "unknown";
  
  const activeModel = activeProvider?.models?.[0]?.id || 
                      (activeProvider as any)?.capabilities?.defaultModels?.[0] ||
                      "auto";

  // Class tone mappings and icons for vendors
  const { cardClass, icon } = (() => {
    const id = activeProviderId?.toLowerCase() || "";
    if (id.includes("claude") || id.includes("anthropic")) {
      return { cardClass: "active-provider-card-anthropic", icon: "🦉" };
    } else if (id.includes("openai") || id.includes("codex") || id.includes("gpt")) {
      return { cardClass: "active-provider-card-openai", icon: "🧠" };
    } else if (id.includes("gemini") || id.includes("google")) {
      return { cardClass: "active-provider-card-google", icon: "✨" };
    } else if (id.includes("kiro")) {
      return { cardClass: "active-provider-card-kiro", icon: "⚡" };
    } else {
      return { cardClass: "active-provider-card-default", icon: "🔌" };
    }
  })();

  return (
    <SurfaceCard
      title="Active Provider"
      description="Currently selected provider for new requests"
      className={cardClass}
    >
      <div className="active-provider-info">
        <div className="provider-header-row">
          <div className="provider-vendor-icon">
            {icon}
          </div>
          <div className="provider-details-wrapper">
            <div className="provider-name">
              {displayName}
            </div>
            <div className="provider-meta-row">
              <StatusBadge variant="accent">
                {tier}
              </StatusBadge>
              <StatusBadge 
                variant={status === "healthy" ? "success" : status === "degraded" ? "warning" : "danger"} 
              >
                {status}
              </StatusBadge>
            </div>
          </div>
        </div>
        <div className="provider-model-wrapper">
          <div className="model-label">Active Model</div>
          <code className="model-name">{activeModel}</code>
        </div>
      </div>
    </SurfaceCard>
  );
}

interface FallbackTiersCardProps {
  providers: Provider[];
}

function FallbackTiersCard({ providers }: FallbackTiersCardProps) {
  const tiers = ["subscription", "cheap", "free"] as const;
  
  const tierData = tiers.map(tier => {
    const tierProviders = providers.filter(p => p.tier === tier);
    const configuredProviders = tierProviders.filter(p => p.configured);
    const healthyCount = configuredProviders.filter(p => p.healthStatus === "healthy").length;
    
    let status: "healthy" | "warning" | "not_configured" = "not_configured";
    if (configuredProviders.length > 0) {
      status = healthyCount > 0 ? "healthy" : "warning";
    }

    const usagePercent = configuredProviders.length > 0
      ? (healthyCount / configuredProviders.length) * 100
      : 0;

    const tierLabels = {
      subscription: "Subscription",
      cheap: "Cheap",
      free: "Free"
    };

    return {
      tier: tierLabels[tier],
      providers: configuredProviders.length,
      healthy: healthyCount,
      status,
      usagePercent
    };
  });

  return (
    <SurfaceCard
      title="Fallback Tiers"
      description="Provider tier health and fallback readiness"
    >
      <div className="fallback-tiers-list">
        {tierData.map((tier) => (
          <div key={tier.tier} className="fallback-tier-item">
            <div className="tier-header">
              <div className="tier-name">{tier.tier}</div>
              <div className="tier-stats">
                {tier.providers > 0 ? (
                  `${tier.healthy}/${tier.providers} healthy`
                ) : (
                  "Not configured"
                )}
              </div>
            </div>

            {tier.providers > 0 ? (
              <>
                <div className="tier-progress-container">
                  <div 
                    className={`tier-progress-fill tier-progress-fill-${tier.status}`} 
                    style={{ width: `${tier.usagePercent}%` }} 
                  />
                </div>
                <div className="tier-footer">
                  <StatusBadge
                    variant={tier.status === "healthy" ? "success" : "warning"}
                  >
                    {tier.status === "healthy" ? "Ready" : "Warning"}
                  </StatusBadge>
                </div>
              </>
            ) : (
              <div className="tier-footer">
                <StatusBadge variant="neutral">
                  Disabled
                </StatusBadge>
              </div>
            )}
          </div>
        ))}
      </div>
    </SurfaceCard>
  );
}

interface RoutingPipelineCardProps {
  health: HealthResponse | null;
  providers: Provider[];
  endpointUrl: string;
}

function RoutingPipelineCard({ health, providers, endpointUrl }: RoutingPipelineCardProps) {
  const activeProviderId = health?.activeProviderId;
  const activeProvider = providers.find(p => p.id === activeProviderId);
  const activeProviderName = activeProvider?.displayName || activeProviderId || "No Active Upstream";
  const activeTier = activeProvider?.tier ? `${activeProvider.tier.toUpperCase()} Tier` : "Routing Pipeline";

  const routingPipeline = [
    { step: "Client CLI", description: "Claude Code / Cline Client", active: true },
    { step: "Local Proxy", description: endpointUrl.replace(/^https?:\/\//, ""), active: true },
    { step: "Router Engine", description: "Failover Strategy Routing", active: true },
    { step: activeTier, description: activeProviderName, active: activeProvider !== undefined },
    { step: "Response Stream", description: "Dynamic cache delivery", active: activeProvider !== undefined }
  ];

  return (
    <SurfaceCard
      title="Routing Pipeline"
      description="Request flow through the router system"
    >
      <div className="pipeline-container-premium">
        {routingPipeline.map((step, index) => (
          <div 
            key={step.step} 
            className={`pipeline-step-premium ${step.active ? "active" : ""}`}
          >
            <div className="step-indicator-premium">
              {index + 1}
            </div>
            <div className="pipeline-step-info">
              <div className="pipeline-step-title">{step.step}</div>
              <div className="pipeline-step-desc">{step.description}</div>
            </div>
            <div className="step-status">
              <StatusBadge variant={step.active ? "success" : "neutral"}>
                {step.active ? "Active" : "Pending"}
              </StatusBadge>
            </div>
          </div>
        ))}
      </div>
    </SurfaceCard>
  );
}

function QuickSetupCard({ endpointUrl }: { endpointUrl: string }) {
  const [activeTab, setActiveTab] = useState<"claude" | "cursor" | "openai">("claude");
  const [copied, setCopied] = useState(false);

  const setupCommands = {
    claude: {
      tool: "Claude Code",
      command: `export ANTHROPIC_API_KEY="your-key-here"\nexport ANTHROPIC_BASE_URL="${endpointUrl}"`
    },
    cursor: {
      tool: "Cursor",
      command: `// In Cursor settings:\n{\n  "anthropic.baseURL": "${endpointUrl}",\n  "anthropic.apiKey": "your-key-here"\n}`
    },
    openai: {
      tool: "OpenAI CLI",
      command: `export OPENAI_API_KEY="your-key-here"\nexport OPENAI_BASE_URL="${endpointUrl}"`
    }
  };

  const currentSetup = setupCommands[activeTab];

  const copyCommand = (command: string) => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <SurfaceCard
      title="Quick Setup"
      description="Copy configuration for popular AI tools"
    >
      <div className="setup-tab-bar">
        <button 
          className={`setup-tab-btn ${activeTab === "claude" ? "active" : ""}`}
          onClick={() => setActiveTab("claude")}
        >
          Claude Code
        </button>
        <button 
          className={`setup-tab-btn ${activeTab === "cursor" ? "active" : ""}`}
          onClick={() => setActiveTab("cursor")}
        >
          Cursor
        </button>
        <button 
          className={`setup-tab-btn ${activeTab === "openai" ? "active" : ""}`}
          onClick={() => setActiveTab("openai")}
        >
          OpenAI CLI
        </button>
      </div>

      <div className="terminal-wrapper">
        <div className="terminal-header">
          <div className="terminal-dots">
            <span className="terminal-dot terminal-dot-red" />
            <span className="terminal-dot terminal-dot-yellow" />
            <span className="terminal-dot terminal-dot-green" />
          </div>
          <span className="terminal-title">{activeTab === "cursor" ? "JSON" : "BASH"}</span>
          <button
            className="copy-command-button"
            onClick={() => copyCommand(currentSetup.command)}
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <div className="terminal-body">
          <pre>
            <code>
              {renderSyntaxHighlightedCommand(currentSetup.command, activeTab)}
            </code>
          </pre>
        </div>
      </div>
    </SurfaceCard>
  );
}

export function EndpointScreen() {
  const { providers, loading: providersLoading, refresh: refreshProviders } = useProviders();
  useAutoHealthMonitoring(true);

  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [usageStats, setUsageStats] = useState<UsageStatsResponse | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setLoadingStats(true);
      setError(null);
      const [healthData, usageData] = await Promise.all([
        getHealth(),
        getUsageStats(),
      ]);
      setHealth(healthData);
      setUsageStats(usageData);
    } catch (err) {
      console.error("Failed to load telemetry", err);
      setError(err instanceof Error ? err.message : "Failed to connect to local proxy. Make sure it is running.");
    } finally {
      setLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const handleRefresh = async () => {
    await Promise.all([loadStats(), refreshProviders()]);
  };

  const endpointUrl = `${window.location.origin}/v1`;

  // Parse usage statistics
  const statsData = usageStats?.stats || {};
  const today = (statsData.today || {}) as any;

  const requestsToday = today.requests || 0;
  const tokensToday = (today.totalInputTokens || 0) + (today.totalCachedTokens || 0);
  const cacheHitRate = today.hitRate || 0;
  const avgSavings = today.avgCacheSavedPercent || 0;
  const rtkApplied = today.rtkAppliedRequests || 0;

  const isScreenLoading = providersLoading || loadingStats;

  return (
    <div className="screen-stack">
      <PageHeader
        icon={EndpointIcon}
        title="Endpoint"
        description="Local OpenAI-compatible endpoint and router status"
        actions={
          <div className="page-actions">
            <RefreshButton onClick={handleRefresh} isRefreshing={isScreenLoading} />
          </div>
        }
      />

      <div className="endpoint-screen-layout">
        {error && (
          <div className="error-banner" style={{
            background: "var(--danger-soft)",
            border: "1px solid var(--danger)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-4)",
            marginBottom: "var(--space-5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--space-4)"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <AlertIcon className="status-icon status-error" style={{ width: "24px", height: "24px" }} />
              <div>
                <h3 style={{ margin: 0, color: "var(--danger)", fontSize: "var(--font-md)" }}>Connection Offline</h3>
                <p style={{ margin: "var(--space-1) 0 0 0", fontSize: "var(--font-sm)", color: "var(--text-secondary)" }}>
                  Failed to connect to local proxy: {error}. Check if your service is active.
                </p>
              </div>
            </div>
            <button className="button-secondary" style={{ whiteSpace: "nowrap" }} onClick={handleRefresh}>
              Retry Connection
            </button>
          </div>
        )}

        <div className="endpoint-top-row">
          <ServerStatusCard 
            health={health} 
            loading={isScreenLoading} 
            endpointUrl={endpointUrl} 
            onRefresh={handleRefresh} 
          />
          <ActiveProviderCard health={health} providers={providers} />
        </div>

        <div className="endpoint-stats-row">
          <StatCard
            label="Requests Today"
            value={formatNumber(requestsToday)}
            caption="API requests processed"
          />
          <StatCard
            label="Tokens Today"
            value={formatNumber(tokensToday)}
            caption="Input + cached tokens"
          />
          <StatCard
            label="RTK Applied"
            value={formatNumber(rtkApplied)}
            caption="Reduced context requests"
          />
          <StatCard
            label="Cache Hit Rate"
            value={formatPercent(cacheHitRate)}
            caption="Prompt cache efficiency"
          />
          <StatCard
            label="Average Savings"
            value={formatPercent(avgSavings)}
            caption="Tokens saved ratio"
          />
        </div>

        <div className="endpoint-bottom-row">
          <FallbackTiersCard providers={providers} />
          <RoutingPipelineCard health={health} providers={providers} endpointUrl={endpointUrl} />
        </div>

        <div className="endpoint-setup-row">
          <QuickSetupCard endpointUrl={endpointUrl} />
        </div>

        <ApiKeyManager />
      </div>
    </div>
  );
}