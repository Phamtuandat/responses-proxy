import React, { useState, useEffect } from "react";
import { PageHeader } from "../components/PageHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { RefreshButton } from "../components/RefreshButton";
import { EndpointIcon, ProvidersIcon, CheckCircleIcon, AlertIcon } from "../components/icons";

// Mock data - replace with real API calls
const mockServerStatus = {
  running: true,
  uptime: "2d 14h 32m",
  version: "0.1.0",
  port: 20128,
  endpoint: "http://localhost:20128/v1"
};

const mockActiveProvider = {
  name: "Claude Code",
  tier: "subscription",
  status: "healthy",
  model: "claude-3-5-sonnet-20241022"
};

const mockFallbackTiers = [
  { tier: "Subscription", providers: 3, healthy: 2, status: "healthy" },
  { tier: "Cheap", providers: 4, healthy: 4, status: "healthy" },
  { tier: "Free", providers: 2, healthy: 1, status: "warning" }
];

const mockUsageToday = {
  requests: 247,
  tokens: 125430,
  errors: 3,
  cacheHitRate: 0.85,
  avgLatency: 1240
};

const mockRoutingPipeline = [
  { step: "Client Tool", status: "active", description: "Claude Code CLI" },
  { step: "Local Endpoint", status: "active", description: "localhost:20128/v1" },
  { step: "Router", status: "active", description: "Request routing" },
  { step: "Subscription Tier", status: "active", description: "Claude Code" },
  { step: "Response", status: "active", description: "Streaming response" }
];

function ServerStatusCard() {
  return (
    <SurfaceCard
      title="Server Status"
      description="Local router server health and information"
      actions={<RefreshButton onClick={() => window.location.reload()} />}
    >
      <div className="endpoint-status-grid">
        <div className="status-item">
          <div className="status-indicator">
            {mockServerStatus.running ? (
              <CheckCircleIcon className="status-icon status-healthy" />
            ) : (
              <AlertIcon className="status-icon status-error" />
            )}
          </div>
          <div className="status-details">
            <div className="status-label">Server</div>
            <div className="status-value">
              {mockServerStatus.running ? "Running" : "Stopped"}
            </div>
          </div>
        </div>

        <div className="status-item">
          <div className="status-details">
            <div className="status-label">Uptime</div>
            <div className="status-value">{mockServerStatus.uptime}</div>
          </div>
        </div>

        <div className="status-item">
          <div className="status-details">
            <div className="status-label">Version</div>
            <div className="status-value">v{mockServerStatus.version}</div>
          </div>
        </div>

        <div className="status-item">
          <div className="status-details">
            <div className="status-label">Port</div>
            <div className="status-value">{mockServerStatus.port}</div>
          </div>
        </div>
      </div>

      <div className="endpoint-url-section">
        <div className="endpoint-label">Local Endpoint</div>
        <div className="endpoint-url-container">
          <code className="endpoint-url">{mockServerStatus.endpoint}</code>
          <button
            className="copy-button"
            onClick={() => navigator.clipboard.writeText(mockServerStatus.endpoint)}
            title="Copy endpoint URL"
          >
            Copy
          </button>
        </div>
      </div>
    </SurfaceCard>
  );
}

function ActiveProviderCard() {
  return (
    <SurfaceCard
      title="Active Provider"
      description="Currently selected provider for new requests"
    >
      <div className="active-provider-info">
        <div className="provider-header">
          <ProvidersIcon className="provider-icon" />
          <div className="provider-details">
            <div className="provider-name">{mockActiveProvider.name}</div>
            <div className="provider-meta">
              <StatusBadge variant="accent" size="sm">
                {mockActiveProvider.tier}
              </StatusBadge>
              <StatusBadge variant="success" size="sm">
                {mockActiveProvider.status}
              </StatusBadge>
            </div>
          </div>
        </div>
        <div className="provider-model">
          <div className="model-label">Active Model</div>
          <code className="model-name">{mockActiveProvider.model}</code>
        </div>
      </div>
    </SurfaceCard>
  );
}

function FallbackTiersCard() {
  return (
    <SurfaceCard
      title="Fallback Tiers"
      description="Provider tier health and fallback readiness"
    >
      <div className="fallback-tiers-list">
        {mockFallbackTiers.map((tier, index) => (
          <div key={tier.tier} className="fallback-tier-item">
            <div className="tier-info">
              <div className="tier-name">{tier.tier}</div>
              <div className="tier-stats">
                {tier.healthy}/{tier.providers} healthy
              </div>
            </div>
            <StatusBadge
              variant={tier.status === "healthy" ? "success" : "warning"}
              size="sm"
            >
              {tier.status === "healthy" ? "Ready" : "Warning"}
            </StatusBadge>
          </div>
        ))}
      </div>
    </SurfaceCard>
  );
}

function RoutingPipelineCard() {
  return (
    <SurfaceCard
      title="Routing Pipeline"
      description="Request flow through the router system"
    >
      <div className="routing-pipeline">
        {mockRoutingPipeline.map((step, index) => (
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
            {index < mockRoutingPipeline.length - 1 && (
              <div className="pipeline-arrow">→</div>
            )}
          </React.Fragment>
        ))}
      </div>
    </SurfaceCard>
  );
}

function QuickSetupCard() {
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  const setupCommands = [
    {
      tool: "Claude Code",
      command: `export ANTHROPIC_API_KEY="your-key-here"\nexport ANTHROPIC_BASE_URL="${mockServerStatus.endpoint}"`
    },
    {
      tool: "Cursor",
      command: `// In Cursor settings:\n{\n  "anthropic.baseURL": "${mockServerStatus.endpoint}",\n  "anthropic.apiKey": "your-key-here"\n}`
    },
    {
      tool: "OpenAI CLI",
      command: `export OPENAI_API_KEY="your-key-here"\nexport OPENAI_BASE_URL="${mockServerStatus.endpoint}"`
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
  return (
    <div className="screen-stack">
      <PageHeader
        icon={EndpointIcon}
        title="Endpoint"
        description="Local OpenAI-compatible endpoint and router status"
      />

      <div className="endpoint-screen-layout">
        {/* Top row - Server status and active provider */}
        <div className="endpoint-top-row">
          <ServerStatusCard />
          <ActiveProviderCard />
        </div>

        {/* Middle row - Usage stats */}
        <div className="endpoint-stats-row">
          <StatCard
            title="Requests Today"
            value={mockUsageToday.requests.toLocaleString()}
            caption="API requests processed"
            trend="up"
          />
          <StatCard
            title="Tokens Today"
            value={mockUsageToday.tokens.toLocaleString()}
            caption="Input + output tokens"
            trend="up"
          />
          <StatCard
            title="Error Rate"
            value={`${((mockUsageToday.errors / mockUsageToday.requests) * 100).toFixed(2)}%`}
            caption="Failed requests"
            trend={mockUsageToday.errors > 10 ? "down" : "neutral"}
          />
          <StatCard
            title="Cache Hit Rate"
            value={`${(mockUsageToday.cacheHitRate * 100).toFixed(1)}%`}
            caption="Prompt cache efficiency"
            trend="up"
          />
          <StatCard
            title="Avg Latency"
            value={`${mockUsageToday.avgLatency}ms`}
            caption="Response time"
            trend="neutral"
          />
        </div>

        {/* Bottom row - Fallback tiers and routing pipeline */}
        <div className="endpoint-bottom-row">
          <FallbackTiersCard />
          <RoutingPipelineCard />
        </div>

        {/* Quick setup section */}
        <div className="endpoint-setup-row">
          <QuickSetupCard />
        </div>
      </div>
    </div>
  );
}