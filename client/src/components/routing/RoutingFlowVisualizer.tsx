// Routing Flow Visualizer Component
// Visual diagram showing routing flow and provider selection logic

import React, { useMemo } from "react";
import { SurfaceCard } from "../SurfaceCard";
import { StatusBadge } from "../StatusBadge";
import {
  CheckCircleIcon,
  AlertIcon,
  ArrowRightIcon,
  ClockIcon,
  TrendingUpIcon
} from "../icons";
import type {
  RoutingCombo,
  RoutingSimulationResponse,
  RoutingStep
} from "../../features/routing/routingTypes";
import type { Provider } from "../../features/providers/providerTypes";

interface RoutingFlowVisualizerProps {
  combo: RoutingCombo;
  providers: Provider[];
  simulationResult?: RoutingSimulationResponse;
}

export function RoutingFlowVisualizer({
  combo,
  providers,
  simulationResult
}: RoutingFlowVisualizerProps) {
  const providerMap = useMemo(() => {
    return providers.reduce((map, provider) => {
      map[provider.id] = provider;
      return map;
    }, {} as Record<string, Provider>);
  }, [providers]);

  const enabledTiers = (combo.tiers || [])
    .filter(tier => tier && tier.isEnabled)
    .sort((a, b) => (a.priority || 0) - (b.priority || 0));

  return (
    <SurfaceCard
      title="Routing Flow"
      description="Visual representation of the routing decision flow"
    >
      <div className="routing-flow-visualizer">
        {/* Flow Diagram */}
        <div className="flow-diagram">
          <div className="flow-start">
            <div className="flow-node start-node">
              <span className="node-label">Request</span>
            </div>
          </div>

          <ArrowRightIcon className="flow-arrow" />

          <div className="flow-tiers">
            {enabledTiers.map((tier, index) => (
              <React.Fragment key={tier.id}>
                <TierFlowNode
                  tier={tier}
                  providers={providers}
                  isSelected={simulationResult?.selectedTier === tier.name}
                  simulationResult={simulationResult}
                />
                {index < enabledTiers.length - 1 && (
                  <div className="tier-fallback">
                    <ArrowRightIcon className="fallback-arrow" />
                    <span className="fallback-label">
                      Fallback ({tier.fallbackDelay}ms)
                    </span>
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>

          <ArrowRightIcon className="flow-arrow" />

          <div className="flow-end">
            <div className={`flow-node end-node ${simulationResult?.success ? 'success' : 'error'}`}>
              {simulationResult?.success ? (
                <>
                  <CheckCircleIcon className="node-icon" />
                  <span className="node-label">Success</span>
                </>
              ) : (
                <>
                  <AlertIcon className="node-icon" />
                  <span className="node-label">Failed</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Simulation Results */}
        {simulationResult && (
          <SimulationResultsDisplay
            result={simulationResult}
            providerMap={providerMap}
          />
        )}

        {/* Flow Statistics */}
        <FlowStatistics combo={combo} providers={providers} />
      </div>
    </SurfaceCard>
  );
}

// Tier flow node component
interface TierFlowNodeProps {
  tier: any;
  providers: Provider[];
  isSelected: boolean;
  simulationResult?: RoutingSimulationResponse;
}

function TierFlowNode({ tier, providers, isSelected, simulationResult }: TierFlowNodeProps) {
  const tierProviders = (tier.providers || []).map((binding: any) => {
    const provider = providers.find(p => p.id === binding?.providerId);
    return { ...binding, provider };
  });

  const selectedProvider = simulationResult?.selectedProvider;

  return (
    <div className={`tier-flow-node ${isSelected ? 'selected' : ''}`}>
      <div className="tier-header">
        <span className="tier-name">{tier.name}</span>
        <StatusBadge variant="neutral" size="xs">
          Priority {tier.priority}
        </StatusBadge>
      </div>

      <div className="tier-providers">
        {tierProviders.map((binding: any, index: number) => (
          <div
            key={index}
            className={`provider-node ${selectedProvider === binding.providerId ? 'selected' : ''}`}
          >
            <div className="provider-info">
              <span className="provider-name">
                {binding.provider?.displayName || binding.providerId}
              </span>
              <span className="provider-weight">{binding.weight}%</span>
            </div>
            <StatusBadge
              variant={
                binding.provider?.healthStatus === 'healthy' ? 'success' :
                binding.provider?.healthStatus === 'degraded' ? 'warning' : 'danger'
              }
              size="xs"
            >
              {binding.provider?.healthStatus || 'unknown'}
            </StatusBadge>
          </div>
        ))}
      </div>

      {tier.fallbackDelay && (
        <div className="tier-fallback-info">
          <ClockIcon className="fallback-icon" />
          <span>{tier.fallbackDelay}ms delay</span>
        </div>
      )}
    </div>
  );
}

// Simulation results display
interface SimulationResultsDisplayProps {
  result: RoutingSimulationResponse;
  providerMap: Record<string, Provider>;
}

function SimulationResultsDisplay({ result, providerMap }: SimulationResultsDisplayProps) {
  return (
    <div className="simulation-results">
      <div className="results-header">
        <h4>Simulation Results</h4>
        <StatusBadge
          variant={result.success ? "success" : "danger"}
          size="sm"
        >
          {result.success ? "Success" : "Failed"}
        </StatusBadge>
      </div>

      <div className="results-content">
        {/* Selected Provider */}
        {result.selectedProvider && (
          <div className="result-item">
            <span className="result-label">Selected Provider:</span>
            <span className="result-value">
              {providerMap[result.selectedProvider]?.displayName || result.selectedProvider}
            </span>
          </div>
        )}

        {/* Selected Tier */}
        {result.selectedTier && (
          <div className="result-item">
            <span className="result-label">Selected Tier:</span>
            <span className="result-value">{result.selectedTier}</span>
          </div>
        )}

        {/* Metrics */}
        <div className="result-metrics">
          <div className="metric-item">
            <span className="metric-label">Total Duration:</span>
            <span className="metric-value">{result.metrics.totalDuration}ms</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Selection Time:</span>
            <span className="metric-value">{result.metrics.providerSelectionTime}ms</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Fallback Count:</span>
            <span className="metric-value">{result.metrics.fallbackCount}</span>
          </div>
          <div className="metric-item">
            <span className="metric-label">Retry Count:</span>
            <span className="metric-value">{result.metrics.retryCount}</span>
          </div>
        </div>

        {/* Routing Path */}
        {result.routingPath.length > 0 && (
          <div className="routing-path">
            <h5>Routing Path</h5>
            <div className="path-steps">
              {result.routingPath.map((step, index) => (
                <RoutingPathStep key={index} step={step} />
              ))}
            </div>
          </div>
        )}

        {/* Errors */}
        {result.errors && result.errors.length > 0 && (
          <div className="routing-errors">
            <h5>Errors</h5>
            <div className="error-list">
              {result.errors.map((error, index) => (
                <div key={index} className="error-item">
                  <AlertIcon className="error-icon" />
                  <div className="error-content">
                    <div className="error-message">{error.message}</div>
                    {error.suggestedAction && (
                      <div className="error-suggestion">
                        Suggestion: {error.suggestedAction}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommendations */}
        {result.recommendations && result.recommendations.length > 0 && (
          <div className="routing-recommendations">
            <h5>Recommendations</h5>
            <ul className="recommendation-list">
              {result.recommendations.map((recommendation, index) => (
                <li key={index}>{recommendation}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// Routing path step component
interface RoutingPathStepProps {
  step: RoutingStep;
}

function RoutingPathStep({ step }: RoutingPathStepProps) {
  const getStepIcon = () => {
    switch (step.stepType) {
      case 'tier_selection':
        return <TrendingUpIcon className="step-icon" />;
      case 'provider_selection':
        return <CheckCircleIcon className="step-icon" />;
      case 'fallback':
        return <ArrowRightIcon className="step-icon" />;
      case 'retry':
        return <ClockIcon className="step-icon" />;
      case 'error':
        return <AlertIcon className="step-icon" />;
      default:
        return <CheckCircleIcon className="step-icon" />;
    }
  };

  return (
    <div className={`routing-step ${step.success ? 'success' : 'error'}`}>
      <div className="step-header">
        {getStepIcon()}
        <span className="step-type">{step.stepType.replace('_', ' ')}</span>
        <span className="step-duration">{step.duration}ms</span>
      </div>
      <div className="step-details">
        {step.tierName && (
          <span className="step-tier">Tier: {step.tierName}</span>
        )}
        {step.providerId && (
          <span className="step-provider">Provider: {step.providerId}</span>
        )}
      </div>
      <div className="step-reason">{step.reason}</div>
    </div>
  );
}

// Flow statistics component
interface FlowStatisticsProps {
  combo: RoutingCombo;
  providers: Provider[];
}

function FlowStatistics({ combo, providers }: FlowStatisticsProps) {
  const stats = useMemo(() => {
    const totalTiers = (combo.tiers || []).length;
    const enabledTiers = (combo.tiers || []).filter(tier => tier && tier.isEnabled).length;
    const totalProviders = (combo.tiers || []).reduce((sum, tier) => sum + (tier?.providers || []).length, 0);
    const healthyProviders = (combo.tiers || []).reduce((sum, tier) => {
      return sum + (tier?.providers || []).filter(binding => {
        const provider = providers.find(p => p.id === binding?.providerId);
        return provider?.healthStatus === 'healthy';
      }).length;
    }, 0);

    return {
      totalTiers,
      enabledTiers,
      totalProviders,
      healthyProviders,
      healthyPercentage: totalProviders > 0 ? Math.round((healthyProviders / totalProviders) * 100) : 0
    };
  }, [combo, providers]);

  return (
    <div className="flow-statistics">
      <h4>Flow Statistics</h4>
      <div className="stats-grid">
        <div className="stat-item">
          <span className="stat-label">Total Tiers</span>
          <span className="stat-value">{stats.totalTiers}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Enabled Tiers</span>
          <span className="stat-value">{stats.enabledTiers}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Total Providers</span>
          <span className="stat-value">{stats.totalProviders}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Healthy Providers</span>
          <span className="stat-value">
            {stats.healthyProviders} ({stats.healthyPercentage}%)
          </span>
        </div>
      </div>
    </div>
  );
}