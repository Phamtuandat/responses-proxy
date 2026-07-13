import React, { useState, useMemo, useEffect } from "react";
import { getHealth } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { StatusBadge } from "../components/StatusBadge";
import { RefreshButton } from "../components/RefreshButton";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { ProvidersIcon } from "../components/icons";
import type {
  Provider,
  ProviderTier,
} from "../features/providers/providerTypes";
import {
  TRANSPORT_LABELS,
  clientApisForTransport,
  normalizeTransportMode,
} from "../features/providers/transportCompat";
import {
  useProviders,
  useProviderTest,
} from "../features/providers/providerHooks";
import {
  useHealthBasedProviders,
  useAutoHealthMonitoring
} from "../features/health/healthHooks";

// Real API integration - no more mock data

function getProviderGradient(providerId: string): string {
  const id = providerId.toLowerCase();
  if (id.includes("claude") || id.includes("anthropic")) {
    return "linear-gradient(135deg, #d97706, #b45309)"; // Warm amber
  }
  if (id.includes("openai") || id.includes("codex") || id.includes("copilot")) {
    return "linear-gradient(135deg, #1e293b, #0f172a)"; // Dark slate
  }
  if (id.includes("gemini") || id.includes("google")) {
    return "linear-gradient(135deg, #2563eb, #7c3aed)"; // Blue to violet
  }
  if (id.includes("deepseek")) {
    return "linear-gradient(135deg, #0d9488, #0f766e)"; // Teal
  }
  if (id.includes("groq")) {
    return "linear-gradient(135deg, #ea580c, #c2410c)"; // Orange/Red
  }
  if (id.includes("mistral")) {
    return "linear-gradient(135deg, #e11d48, #be123c)"; // Rose
  }
  if (id.includes("xai") || id.includes("grok")) {
    return "linear-gradient(135deg, #000000, #1e293b)"; // True black
  }
  if (id.includes("cursor")) {
    return "linear-gradient(135deg, #4f46e5, #3730a3)"; // Indigo
  }
  if (id.includes("qwen") || id.includes("alibaba")) {
    return "linear-gradient(135deg, #059669, #047857)"; // Emerald
  }
  if (id.includes("cloudflare")) {
    return "linear-gradient(135deg, #f97316, #ea580c)"; // Cloudflare orange
  }
  if (id.includes("nvidia")) {
    return "linear-gradient(135deg, #16a34a, #15803d)"; // Nvidia green
  }
  return "linear-gradient(135deg, #64748b, #475569)"; // Gray default
}

function getProviderInitials(displayName: string): string {
  const parts = displayName.split(" ");
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return displayName.slice(0, 2).toUpperCase();
}

function getProviderStatus(provider: Provider) {
  if (!provider.configured) {
    return { label: "No connection", dotClass: "not_configured" };
  }
  if (provider.healthStatus === "healthy") {
    return { label: "Ready", dotClass: "healthy" };
  } else if (provider.healthStatus === "degraded") {
    return { label: "Degraded", dotClass: "degraded" };
  } else if (provider.healthStatus === "quota_exhausted") {
    return { label: "Quota Exhausted", dotClass: "quota_exhausted" };
  }
  return { label: "Ready", dotClass: "healthy" };
}

function SmallProviderCard({ 
  provider, 
  isDisabled, 
  onToggle, 
  onClick 
}: { 
  provider: Provider; 
  isDisabled: boolean; 
  onToggle: () => void; 
  onClick: () => void; 
}) {
  const statusInfo = isDisabled
    ? { label: "Disabled", dotClass: "not_configured" }
    : getProviderStatus(provider);
  const gradient = getProviderGradient(provider.id);
  const initials = getProviderInitials(provider.displayName);
  // Custom providers expose a transport mode; surface what it serves so users know
  // a single endpoint covers both OpenAI clients and Claude Code.
  const transport = provider.tier === "custom" ? normalizeTransportMode(provider.transportMode) : null;
  const servedApis = transport ? clientApisForTransport(transport) : [];

  return (
    <div className="provider-small-card" onClick={onClick}>
      <div className="provider-small-logo-container" style={{ background: gradient }}>
        {initials}
      </div>
      <div className="provider-small-info">
        <div className="provider-small-name-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
          <h4 className="provider-small-name" title={provider.displayName}>{provider.displayName}</h4>
          <div
            className={`custom-switch ${isDisabled ? 'off' : 'on'}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            title={isDisabled ? "Enable Provider" : "Disable Provider"}
          >
            <span className="custom-switch-slider" />
          </div>
        </div>
        <div className="provider-small-status">
          <span className={`provider-small-status-dot ${statusInfo.dotClass}`} />
          <span>{statusInfo.label}</span>
        </div>
        {transport ? (
          <div className="provider-small-compat" title={`Transport: ${TRANSPORT_LABELS[transport]}`}>
            <span className="provider-transport-chip">{TRANSPORT_LABELS[transport]}</span>
            <span className="provider-compat-chips">
              {servedApis.map((api) => (
                <span className="provider-compat-chip" key={api.endpoint} title={api.endpoint}>
                  {api.label}
                </span>
              ))}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function EnhancedProvidersScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [disabledProviderIds, setDisabledProviderIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem("disabled_providers");
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  const toggleProviderEnabled = (providerId: string) => {
    setDisabledProviderIds(prev => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      try {
        localStorage.setItem("disabled_providers", JSON.stringify(Array.from(next)));
      } catch (err) {
        console.error("Failed to persist disabled providers:", err);
      }
      return next;
    });
  };

  useEffect(() => {
    getHealth().then(data => {
      if (data && data.activeProviderId) {
        setActiveProviderId(data.activeProviderId);
      }
    }).catch(() => {});
  }, []);

  // Fetch providers from real API
  const { providers, loading, error, refresh } = useProviders();
  const { testProvider } = useProviderTest();

  // Auto-start health monitoring
  useAutoHealthMonitoring(true);

  // Get health-enhanced providers with real-time status
  const { enhancedProviders } = useHealthBasedProviders(providers);

  // Filter providers based on search query
  const filteredProviders = useMemo(() => {
    return enhancedProviders.filter(provider => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          provider.name.toLowerCase().includes(query) ||
          provider.displayName.toLowerCase().includes(query) ||
          provider.description?.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [enhancedProviders, searchQuery]);

  const customProviders = useMemo(() => {
    return filteredProviders.filter(p => p.tier === "custom");
  }, [filteredProviders]);

  const oauthProviders = useMemo(() => {
    return filteredProviders.filter(p => p.tier !== "custom" && p.authTypes.includes("oauth"));
  }, [filteredProviders]);

  const freeProviders = useMemo(() => {
    return filteredProviders.filter(p => p.tier === "free" && !p.authTypes.includes("oauth"));
  }, [filteredProviders]);

  const apiKeyProviders = useMemo(() => {
    return filteredProviders.filter(p => 
      p.tier !== "custom" && 
      !p.authTypes.includes("oauth") && 
      p.tier !== "free"
    );
  }, [filteredProviders]);

  // Event handlers
  const handleConnect = (providerId: string) => {
    window.location.hash = `#/providers/${providerId}`;
  };

  const handleTest = async (providerId: string) => {
    try {
      await testProvider(providerId);
    } catch (error) {
      console.error(`Failed to test provider ${providerId}:`, error);
    }
  };

  const handleAddProvider = () => {
    window.location.hash = "#/providers/new";
  };

  const handleTestAll = async (providersToTest: Provider[]) => {
    const configured = providersToTest.filter(p => p.configured);
    for (const p of configured) {
      handleTest(p.id);
    }
  };

  const handleRefresh = async () => {
    try {
      await refresh();
    } catch (error) {
      console.error('Failed to refresh providers:', error);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="screen-stack">
        <PageHeader
          icon={ProvidersIcon}
          title="Providers"
          description="Manage AI provider connections and routing configuration"
        />
        <LoadingState
          title="Loading providers"
          description="Fetching provider data and health status..."
          cards={3}
        />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="screen-stack">
        <PageHeader
          icon={ProvidersIcon}
          title="Providers"
          description="Manage AI provider connections and routing configuration"
        />
        <EmptyState
          title="Failed to load providers"
          description={error}
          actionLabel="Retry"
          onClick={handleRefresh}
        />
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <PageHeader
        icon={ProvidersIcon}
        title="Providers"
        description="Manage your AI provider connections"
        actions={
          <div className="page-actions" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            <div className="search-container" style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <input
                type="text"
                className="search-input"
                placeholder="Search providers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  padding: "6px 12px 6px 32px",
                  fontSize: "var(--font-sm)",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--line)",
                  background: "var(--surface-input)",
                  color: "var(--text-primary)",
                  width: "200px",
                }}
              />
              <span style={{ position: "absolute", left: "10px", color: "var(--text-secondary)", fontSize: "var(--font-sm)", pointerEvents: "none" }}>🔍</span>
            </div>
            <RefreshButton onClick={handleRefresh} />
          </div>
        }
      />

      <div className="providers-screen-layout">
        {/* Custom Providers */}
        <div className="provider-section" style={{ marginBottom: "var(--space-6)" }}>
          <div className="provider-section-title-row">
            <h3>Custom Providers (OpenAI/Anthropic Compatible)</h3>
            <div className="provider-section-actions">
              <button className="button-primary" onClick={handleAddProvider}>
                + Add Provider
              </button>
            </div>
          </div>
          {customProviders.length === 0 ? (
            <div className="provider-empty-state" style={{ 
              textAlign: "center", 
              padding: "var(--space-6)", 
              border: "1px dashed var(--line)", 
              borderRadius: "var(--radius-md)",
              color: "var(--text-secondary)",
              fontSize: "var(--font-sm)"
            }}>
              No custom providers — use buttons above to add OpenAI/Anthropic compatible endpoints
            </div>
          ) : (
            <div className="providers-small-grid">
              {customProviders.map(provider => (
                <SmallProviderCard
                  key={provider.id}
                  provider={provider}
                  isDisabled={disabledProviderIds.has(provider.id)}
                  onToggle={() => toggleProviderEnabled(provider.id)}
                  onClick={() => handleConnect(provider.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* OAuth Providers */}
        <div className="provider-section" style={{ marginBottom: "var(--space-6)" }}>
          <div className="provider-section-title-row">
            <h3>OAuth Providers</h3>
            <button 
              className="button-secondary" 
              style={{ fontSize: "var(--font-xs)", padding: "4px var(--space-2)" }}
              onClick={() => handleTestAll(oauthProviders)}
              disabled={oauthProviders.filter(p => p.configured).length === 0}
            >
              ▷ Test All
            </button>
          </div>
          {oauthProviders.length === 0 ? (
            <div style={{ color: "var(--text-secondary)", fontSize: "var(--font-sm)" }}>No OAuth providers found</div>
          ) : (
            <div className="providers-small-grid">
              {oauthProviders.map(provider => (
                <SmallProviderCard
                  key={provider.id}
                  provider={provider}
                  isDisabled={disabledProviderIds.has(provider.id)}
                  onToggle={() => toggleProviderEnabled(provider.id)}
                  onClick={() => handleConnect(provider.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Free Tier Providers */}
        <div className="provider-section" style={{ marginBottom: "var(--space-6)" }}>
          <div className="provider-section-title-row">
            <h3>Free Tier Providers</h3>
            <button 
              className="button-secondary" 
              style={{ fontSize: "var(--font-xs)", padding: "4px var(--space-2)" }}
              onClick={() => handleTestAll(freeProviders)}
              disabled={freeProviders.filter(p => p.configured).length === 0}
            >
              ▷ Test All
            </button>
          </div>
          {freeProviders.length === 0 ? (
            <div style={{ color: "var(--text-secondary)", fontSize: "var(--font-sm)" }}>No Free Tier providers found</div>
          ) : (
            <div className="providers-small-grid">
              {freeProviders.map(provider => (
                <SmallProviderCard
                  key={provider.id}
                  provider={provider}
                  isDisabled={disabledProviderIds.has(provider.id)}
                  onToggle={() => toggleProviderEnabled(provider.id)}
                  onClick={() => handleConnect(provider.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* API Key Providers */}
        <div className="provider-section" style={{ marginBottom: "var(--space-6)" }}>
          <div className="provider-section-title-row">
            <h3>API Key Providers</h3>
            <button 
              className="button-secondary" 
              style={{ fontSize: "var(--font-xs)", padding: "4px var(--space-2)" }}
              onClick={() => handleTestAll(apiKeyProviders)}
              disabled={apiKeyProviders.filter(p => p.configured).length === 0}
            >
              ▷ Test All
            </button>
          </div>
          {apiKeyProviders.length === 0 ? (
            <div style={{ color: "var(--text-secondary)", fontSize: "var(--font-sm)" }}>No API Key providers found</div>
          ) : (
            <div className="providers-small-grid">
              {apiKeyProviders.map(provider => (
                <SmallProviderCard
                  key={provider.id}
                  provider={provider}
                  isDisabled={disabledProviderIds.has(provider.id)}
                  onToggle={() => toggleProviderEnabled(provider.id)}
                  onClick={() => handleConnect(provider.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function MediaProvidersScreen() {
  return (
    <div className="screen-stack">
      <PageHeader
        icon={ProvidersIcon}
        title="Media Providers"
        description="Multimodal, voice, image, and video generation upstreams"
      />
      <SurfaceCard title="Feature Coming Soon" description="Extended media provider pool" tone="info">
        <div style={{ padding: "var(--space-6) var(--space-4)", textAlign: "center" }}>
          <span style={{ fontSize: "3rem" }}>🎨</span>
          <h3 style={{ margin: "var(--space-3) 0 var(--space-2) 0", fontSize: "var(--font-lg)" }}>Extended Multimodal Pipeline</h3>
          <p style={{ margin: "0 auto var(--space-4) auto", color: "var(--text-secondary)", fontSize: "var(--font-sm)", maxWidth: "540px", lineHeight: "1.6" }}>
            Media Providers will allow responses-proxy to handle multimodal requests (audio processing, text-to-speech, DALL-E image generation, and video upstreams) with automatic cost routing and fallback policies.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", justifyContent: "center" }}>
            <StatusBadge variant="accent">Image Tiers</StatusBadge>
            <StatusBadge variant="accent">Audio Failover</StatusBadge>
            <StatusBadge variant="accent">Video Upstreams</StatusBadge>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}

export function ProxyPoolsScreen() {
  return (
    <div className="screen-stack">
      <PageHeader
        icon={ProvidersIcon}
        title="Proxy Pools"
        description="Distributed network proxies and rotating IP pools"
      />
      <SurfaceCard title="Feature Coming Soon" description="Network proxy list configuration" tone="info">
        <div style={{ padding: "var(--space-6) var(--space-4)", textAlign: "center" }}>
          <span style={{ fontSize: "3rem" }}>🌐</span>
          <h3 style={{ margin: "var(--space-3) 0 var(--space-2) 0", fontSize: "var(--font-lg)" }}>Rotating Network IP Pools</h3>
          <p style={{ margin: "0 auto var(--space-4) auto", color: "var(--text-secondary)", fontSize: "var(--font-sm)", maxWidth: "540px", lineHeight: "1.6" }}>
            Proxy Pools will enable routing upstream provider requests through a configured list of residential or datacenter web proxies. This prevents rate-limiting and geographical blocks from impacting high-frequency developer workflows.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", justifyContent: "center" }}>
            <StatusBadge variant="accent">Rotating Proxies</StatusBadge>
            <StatusBadge variant="accent">IP Health Check</StatusBadge>
            <StatusBadge variant="accent">Geo-Targeting</StatusBadge>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}