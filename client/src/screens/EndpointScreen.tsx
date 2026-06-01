import React, { useState, useEffect, useCallback } from "react";
import { PageHeader } from "../components/PageHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { RefreshButton } from "../components/RefreshButton";
import { EndpointIcon, ProvidersIcon, CheckCircleIcon, AlertIcon } from "../components/icons";
import { getHealth, getUsageStats } from "../api/client";
import type { HealthResponse, UsageStatsResponse } from "../api/types";
import { useProviders, useAutoHealthMonitoring } from "../features/providers/providerHooks";
import type { Provider } from "../features/providers/providerTypes";
import { formatNumber, formatPercent } from "../lib/format";

// Local premium styling overrides embedded for visual encapsulation
const PremiumStyles = () => (
  <style>{`
    /* Server status pulsing indicator */
    @keyframes statusPulse {
      0% {
        box-shadow: 0 0 0 0 rgba(48, 209, 88, 0.4);
      }
      70% {
        box-shadow: 0 0 0 8px rgba(48, 209, 88, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(48, 209, 88, 0);
      }
    }

    .status-pulse-dot {
      width: 10px;
      height: 10px;
      background-color: var(--status-healthy);
      border-radius: 50%;
      display: inline-block;
      margin-right: 8px;
      animation: statusPulse 2s infinite var(--animation-easing);
    }

    /* Fallback progress bar styles */
    .tier-progress-container {
      width: 100%;
      background: var(--neutral-soft);
      height: 8px;
      border-radius: var(--radius-pill);
      overflow: hidden;
      margin-top: 8px;
      position: relative;
    }

    .tier-progress-fill {
      height: 100%;
      border-radius: var(--radius-pill);
      transition: width var(--animation-normal) var(--animation-easing), background-color var(--animation-normal) var(--animation-easing);
    }

    /* Setup command tab styles */
    .setup-tab-bar {
      display: flex;
      gap: var(--space-2);
      border-bottom: 1px solid var(--line);
      margin-bottom: var(--space-4);
      padding-bottom: var(--space-1);
    }

    .setup-tab-btn {
      background: none;
      border: none;
      font-family: inherit;
      font-size: var(--text-sm);
      font-weight: 500;
      color: var(--text-secondary);
      padding: var(--space-2) var(--space-4);
      cursor: pointer;
      border-radius: var(--radius-sm);
      transition: all var(--animation-fast) var(--animation-easing);
    }

    .setup-tab-btn:hover {
      color: var(--text-primary);
      background: var(--interactive-hover);
    }

    .setup-tab-btn.active {
      color: var(--accent);
      background: var(--accent-soft);
    }

    /* Stylized workflow step layout */
    .pipeline-container-premium {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      width: 100%;
    }

    .pipeline-step-premium {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      background: var(--surface-muted);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      transition: all var(--animation-normal) var(--animation-easing);
      cursor: default;
    }

    .pipeline-step-premium:hover {
      background: var(--surface-hover);
      border-color: var(--line-strong);
      transform: translateX(4px);
    }

    .pipeline-step-premium.active {
      border-left: 3px solid var(--accent);
      background: var(--surface);
    }

    .step-indicator-premium {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: var(--text-xs);
      font-weight: 600;
    }
  `}</style>
);

interface ServerStatusCardProps {
  health: HealthResponse | null;
  loading: boolean;
  endpointUrl: string;
  onRefresh: () => void;
}

function ServerStatusCard({ health, loading, endpointUrl, onRefresh }: ServerStatusCardProps) {
  const isRunning = health?.ok ?? false;
  return (
    <SurfaceCard
      title="Server Status"
      description="Local router server health and information"
      actions={<RefreshButton onClick={onRefresh} loading={loading} />}
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
            <div className="status-value">Online</div>
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
            onClick={() => navigator.clipboard.writeText(endpointUrl)}
            title="Copy endpoint URL"
          >
            Copy
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
  
  // Find an enabled model or a default model for this provider
  const activeModel = activeProvider?.models?.[0]?.id || 
                      (activeProvider as any)?.capabilities?.defaultModels?.[0] ||
                      "auto";

  // Dynamic vendor-specific HSL styling attributes
  const vendorStyles = (() => {
    const id = activeProviderId?.toLowerCase() || "";
    if (id.includes("claude") || id.includes("anthropic")) {
      return {
        bg: "rgba(245, 166, 35, 0.06)",
        border: "rgba(245, 166, 35, 0.22)",
        text: "var(--warning)",
        icon: "🦉"
      };
    } else if (id.includes("openai") || id.includes("codex") || id.includes("gpt")) {
      return {
        bg: "rgba(48, 209, 88, 0.06)",
        border: "rgba(48, 209, 88, 0.22)",
        text: "var(--success)",
        icon: "🧠"
      };
    } else if (id.includes("gemini") || id.includes("google")) {
      return {
        bg: "rgba(10, 132, 255, 0.06)",
        border: "rgba(10, 132, 255, 0.22)",
        text: "var(--accent)",
        icon: "✨"
      };
    } else if (id.includes("kiro")) {
      return {
        bg: "rgba(111, 91, 255, 0.06)",
        border: "rgba(111, 91, 255, 0.22)",
        text: "var(--accent-2)",
        icon: "⚡"
      };
    } else {
      return {
        bg: "var(--neutral-soft)",
        border: "var(--line)",
        text: "var(--text-secondary)",
        icon: "🔌"
      };
    }
  })();

  return (
    <SurfaceCard
      title="Active Provider"
      description="Currently selected provider for new requests"
      style={{
        border: `1px solid ${vendorStyles.border}`,
        background: vendorStyles.bg,
        transition: "all var(--animation-normal) var(--animation-easing)",
      }}
    >
      <div className="active-provider-info">
        <div className="provider-header" style={{ display: "flex", alignItems: "center" }}>
          <div className="provider-vendor-icon" style={{ fontSize: "2rem", marginRight: "12px" }}>
            {vendorStyles.icon}
          </div>
          <div className="provider-details" style={{ flex: 1 }}>
            <div className="provider-name" style={{ color: vendorStyles.text, fontWeight: "600", fontSize: "1.1rem" }}>
              {displayName}
            </div>
            <div className="provider-meta" style={{ marginTop: "4px" }}>
              <StatusBadge variant="accent" size="sm">
                {tier}
              </StatusBadge>
              <StatusBadge 
                variant={status === "healthy" ? "success" : status === "degraded" ? "warning" : "danger"} 
                size="sm"
              >
                {status}
              </StatusBadge>
            </div>
          </div>
        </div>
        <div className="provider-model" style={{ marginTop: "16px" }}>
          <div className="model-label" style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>Active Model</div>
          <code className="model-name" style={{ display: "block", marginTop: "4px" }}>{activeModel}</code>
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
    
    // Status of the tier
    let status: "healthy" | "warning" | "not_configured" = "not_configured";
    if (configuredProviders.length > 0) {
      status = healthyCount > 0 ? "healthy" : "warning";
    }

    const usagePercent = configuredProviders.length > 0
      ? (healthyCount / configuredProviders.length) * 100
      : 0;

    let barColor = "var(--neutral-soft)";
    if (configuredProviders.length > 0) {
      barColor = usagePercent === 100
        ? "var(--success)"
        : usagePercent > 0
          ? "var(--warning)"
          : "var(--danger)";
    }

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
      usagePercent,
      barColor
    };
  });

  return (
    <SurfaceCard
      title="Fallback Tiers"
      description="Provider tier health and fallback readiness"
    >
      <div className="fallback-tiers-list">
        {tierData.map((tier) => (
          <div key={tier.tier} className="fallback-tier-item" style={{ marginBottom: "16px" }}>
            <div className="tier-info" style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <div className="tier-name" style={{ fontWeight: "500" }}>{tier.tier}</div>
              <div className="tier-stats" style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
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
                    className="tier-progress-fill" 
                    style={{ 
                      width: `${tier.usagePercent}%`, 
                      backgroundColor: tier.barColor 
                    }} 
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                  <StatusBadge
                    variant={tier.status === "healthy" ? "success" : "warning"}
                    size="xs"
                  >
                    {tier.status === "healthy" ? "Ready" : "Warning"}
                  </StatusBadge>
                </div>
              </>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
                <StatusBadge variant="neutral" size="xs">
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
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: "600", fontSize: "var(--text-sm)" }}>{step.step}</div>
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>{step.description}</div>
            </div>
            <div className="step-status">
              <StatusBadge variant={step.active ? "success" : "neutral"} size="xs">
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

      <div className="setup-command-item" style={{ position: "relative", marginTop: "12px" }}>
        <button
          className="copy-command-button"
          onClick={() => copyCommand(currentSetup.command)}
          style={{
            position: "absolute",
            top: "8px",
            right: "8px",
            zIndex: 10,
            background: "var(--control-bg)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-sm)",
            padding: "4px 8px",
            fontSize: "var(--text-xs)",
            cursor: "pointer",
            transition: "all var(--animation-fast) var(--animation-easing)",
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
        <pre className="command-code" style={{ paddingRight: "70px", margin: 0 }}>
          {currentSetup.command}
        </pre>
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
  const [errorStats, setErrorStats] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setLoadingStats(true);
      setErrorStats(null);
      const [healthData, usageData] = await Promise.all([
        getHealth(),
        getUsageStats(),
      ]);
      setHealth(healthData);
      setUsageStats(usageData);
    } catch (err) {
      setErrorStats(err instanceof Error ? err.message : "Failed to load telemetry");
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
      <PremiumStyles />
      <PageHeader
        icon={EndpointIcon}
        title="Endpoint"
        description="Local OpenAI-compatible endpoint and router status"
        actions={
          <div className="page-actions">
            <RefreshButton onClick={handleRefresh} loading={isScreenLoading} />
          </div>
        }
      />

      <div className="endpoint-screen-layout">
        {/* Top row - Server status and active provider */}
        <div className="endpoint-top-row">
          <ServerStatusCard 
            health={health} 
            loading={isScreenLoading} 
            endpointUrl={endpointUrl} 
            onRefresh={handleRefresh} 
          />
          <ActiveProviderCard health={health} providers={providers} />
        </div>

        {/* Middle row - Usage stats */}
        <div className="endpoint-stats-row">
          <StatCard
            title="Requests Today"
            value={formatNumber(requestsToday)}
            caption="API requests processed"
            trend={requestsToday > 0 ? "up" : "neutral"}
          />
          <StatCard
            title="Tokens Today"
            value={formatNumber(tokensToday)}
            caption="Input + cached tokens"
            trend={tokensToday > 0 ? "up" : "neutral"}
          />
          <StatCard
            title="RTK Applied"
            value={formatNumber(rtkApplied)}
            caption="Reduced context requests"
            trend={rtkApplied > 0 ? "up" : "neutral"}
          />
          <StatCard
            title="Cache Hit Rate"
            value={formatPercent(cacheHitRate)}
            caption="Prompt cache efficiency"
            trend={cacheHitRate > 0.5 ? "up" : "neutral"}
          />
          <StatCard
            title="Average Savings"
            value={formatPercent(avgSavings)}
            caption="Tokens saved ratio"
            trend={avgSavings > 0.3 ? "up" : "neutral"}
          />
        </div>

        {/* Bottom row - Fallback tiers and routing pipeline */}
        <div className="endpoint-bottom-row">
          <FallbackTiersCard providers={providers} />
          <RoutingPipelineCard health={health} providers={providers} endpointUrl={endpointUrl} />
        </div>

        {/* Quick setup section */}
        <div className="endpoint-setup-row">
          <QuickSetupCard endpointUrl={endpointUrl} />
        </div>
      </div>
    </div>
  );
}