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
              <CheckCircleIcon className="status-icon status-healthy" />
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

  return (
    <SurfaceCard
      title="Active Provider"
      description="Currently selected provider for new requests"
    >
      <div className="active-provider-info">
        <div className="provider-header">
          <ProvidersIcon className="provider-icon" />
          <div className="provider-details">
            <div className="provider-name">{displayName}</div>
            <div className="provider-meta">
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
        <div className="provider-model">
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
    
    // Status of the tier
    let status: "healthy" | "warning" | "not_configured" = "not_configured";
    if (configuredProviders.length > 0) {
      status = healthyCount > 0 ? "healthy" : "warning";
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
      status
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
            <div className="tier-info">
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
              <StatusBadge
                variant={tier.status === "healthy" ? "success" : "warning"}
                size="sm"
              >
                {tier.status === "healthy" ? "Ready" : "Warning"}
              </StatusBadge>
            ) : (
              <StatusBadge variant="neutral" size="sm">
                Disabled
              </StatusBadge>
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
    { step: "Client Tool", status: "active", description: "Claude Code / Cline / API Client" },
    { step: "Local Endpoint", status: "active", description: endpointUrl.replace(/^https?:\/\//, "") },
    { step: "Router Engine", status: "active", description: "Smart Multi-Tier Routing" },
    { step: activeTier, status: "active", description: activeProviderName },
    { step: "Response", status: "active", description: "Streaming + Prompt Caching" }
  ];

  return (
    <SurfaceCard
      title="Routing Pipeline"
      description="Request flow through the router system"
    >
      <div className="routing-pipeline">
        {routingPipeline.map((step, index) => (
          <React.Fragment key={step.step}>
            <div className="pipeline-step">
              <div className="step-indicator">
                <CheckCircleIcon className="step-icon status-healthy" />
              </div>
              <div className="step-details">
                <div className="step-name">{step.step}</div>
                <div className="step-description">{step.description}</div>
              </div>
            </div>
            {index < routingPipeline.length - 1 && (
              <div className="pipeline-arrow">→</div>
            )}
          </React.Fragment>
        ))}
      </div>
    </SurfaceCard>
  );
}

function QuickSetupCard({ endpointUrl }: { endpointUrl: string }) {
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  const setupCommands = [
    {
      tool: "Claude Code",
      command: `export ANTHROPIC_API_KEY="your-key-here"\nexport ANTHROPIC_BASE_URL="${endpointUrl}"`
    },
    {
      tool: "Cursor",
      command: `// In Cursor settings:\n{\n  "anthropic.baseURL": "${endpointUrl}",\n  "anthropic.apiKey": "your-key-here"\n}`
    },
    {
      tool: "OpenAI CLI",
      command: `export OPENAI_API_KEY="your-key-here"\nexport OPENAI_BASE_URL="${endpointUrl}"`
    }
  ];

  const copyCommand = (command: string, tool: string) => {
    navigator.clipboard.writeText(command);
    setCopiedCommand(tool);
    setTimeout(() => setCopiedCommand(null), 2000);
  };

  return (
    <SurfaceCard
      title="Quick Setup"
      description="Copy configuration for popular AI tools"
    >
      <div className="setup-commands">
        {setupCommands.map((item) => (
          <div key={item.tool} className="setup-command-item">
            <div className="command-header">
              <span className="command-tool">{item.tool}</span>
              <button
                className="copy-command-button"
                onClick={() => copyCommand(item.command, item.tool)}
                title={`Copy ${item.tool} configuration`}
              >
                {copiedCommand === item.tool ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="command-code">{item.command}</pre>
          </div>
        ))}
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