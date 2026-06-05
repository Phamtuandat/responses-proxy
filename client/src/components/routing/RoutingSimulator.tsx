// Routing Simulator Component
// Test and validate routing configurations with different scenarios

import React, { useState, useCallback, useMemo } from "react";
import { SurfaceCard } from "../SurfaceCard";
import { StatusBadge } from "../StatusBadge";
import { LoadingState } from "../LoadingState";
import {
  PlayIcon,
  TestIcon,
  CheckCircleIcon,
  AlertIcon,
  ClockIcon,
  RefreshIcon,
  SettingsIcon
} from "../icons";
import type {
  RoutingCombo,
  RoutingSimulationRequest,
  RoutingSimulationResponse,
  ClientRoute
} from "../../features/routing/routingTypes";
import type { Provider } from "../../features/providers/providerTypes";

interface RoutingSimulatorProps {
  combo: RoutingCombo;
  providers: Provider[];
  onClose: () => void;
  onSimulate: (request: RoutingSimulationRequest) => Promise<RoutingSimulationResponse>;
  getSimulationResult: (comboId: string, route: ClientRoute) => RoutingSimulationResponse | undefined;
  isSimulating: boolean;
}

export function RoutingSimulator({
  combo,
  providers,
  onClose,
  onSimulate,
  getSimulationResult,
  isSimulating
}: RoutingSimulatorProps) {
  const [selectedRoute, setSelectedRoute] = useState<ClientRoute>((combo.clientRoutes || [])[0] || 'chat');
  const [simulationParams, setSimulationParams] = useState({
    model: 'claude-3-5-sonnet-20241022',
    tokenCount: 1000,
    priority: 'normal' as 'low' | 'normal' | 'high',
    includeHealthCheck: true,
    simulateFailures: false,
    maxRetries: 3
  });
  const [simulationHistory, setSimulationHistory] = useState<RoutingSimulationResponse[]>([]);

  const currentResult = getSimulationResult(combo.id, selectedRoute);

  const handleSimulate = useCallback(async () => {
    const request: RoutingSimulationRequest = {
      comboId: combo.id,
      route: selectedRoute,
      model: simulationParams.model,
      tokenCount: simulationParams.tokenCount,
      priority: simulationParams.priority,
      includeHealthCheck: simulationParams.includeHealthCheck,
      simulateFailures: simulationParams.simulateFailures,
      maxRetries: simulationParams.maxRetries
    };

    try {
      const result = await onSimulate(request);
      setSimulationHistory(prev => [result, ...prev.slice(0, 9)]); // Keep last 10 results
    } catch (error) {
      console.error('Simulation failed:', error);
    }
  }, [combo.id, selectedRoute, simulationParams, onSimulate]);

  const enabledTiers = (combo.tiers || []).filter(tier => tier && tier.isEnabled);
  const totalProviders = (combo.tiers || []).reduce((sum, tier) => sum + (tier?.providers || []).length, 0);

  return (
    <div className="routing-simulator">
      <div className="simulator-header">
        <button className="button-secondary" onClick={onClose}>
          ← Back to Combos
        </button>
      </div>

      <div className="simulator-layout">
        {/* Simulation Controls */}
        <SurfaceCard
          title="Simulation Parameters"
          description="Configure test scenarios for routing validation"
          icon={SettingsIcon}
        >
          <div className="simulation-controls">
            <div className="control-group">
              <label htmlFor="route">Client Route</label>
              <select
                id="route"
                value={selectedRoute}
                onChange={(e) => setSelectedRoute(e.target.value as ClientRoute)}
              >
                {(combo.clientRoutes || []).map(route => (
                  <option key={route} value={route}>{route}</option>
                ))}
                <option value="chat">chat</option>
                <option value="completions">completions</option>
                <option value="embeddings">embeddings</option>
              </select>
            </div>

            <div className="control-group">
              <label htmlFor="model">Model</label>
              <select
                id="model"
                value={simulationParams.model}
                onChange={(e) => setSimulationParams(prev => ({ ...prev, model: e.target.value }))}
              >
                <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                <option value="gpt-4">GPT-4</option>
                <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                <option value="gemini-pro">Gemini Pro</option>
              </select>
            </div>

            <div className="control-row">
              <div className="control-group">
                <label htmlFor="tokenCount">Token Count</label>
                <input
                  id="tokenCount"
                  type="number"
                  min="1"
                  max="100000"
                  value={simulationParams.tokenCount}
                  onChange={(e) => setSimulationParams(prev => ({
                    ...prev,
                    tokenCount: parseInt(e.target.value) || 1000
                  }))}
                />
              </div>

              <div className="control-group">
                <label htmlFor="priority">Priority</label>
                <select
                  id="priority"
                  value={simulationParams.priority}
                  onChange={(e) => setSimulationParams(prev => ({
                    ...prev,
                    priority: e.target.value as 'low' | 'normal' | 'high'
                  }))}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </div>

              <div className="control-group">
                <label htmlFor="maxRetries">Max Retries</label>
                <input
                  id="maxRetries"
                  type="number"
                  min="0"
                  max="10"
                  value={simulationParams.maxRetries}
                  onChange={(e) => setSimulationParams(prev => ({
                    ...prev,
                    maxRetries: parseInt(e.target.value) || 3
                  }))}
                />
              </div>
            </div>

            <div className="control-checkboxes">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={simulationParams.includeHealthCheck}
                  onChange={(e) => setSimulationParams(prev => ({
                    ...prev,
                    includeHealthCheck: e.target.checked
                  }))}
                />
                <span>Include health checks</span>
              </label>

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={simulationParams.simulateFailures}
                  onChange={(e) => setSimulationParams(prev => ({
                    ...prev,
                    simulateFailures: e.target.checked
                  }))}
                />
                <span>Simulate provider failures</span>
              </label>
            </div>

            <div className="simulation-actions">
              <button
                className="button-primary"
                onClick={handleSimulate}
                disabled={isSimulating}
              >
                {isSimulating ? (
                  <>
                    <ClockIcon className="button-icon spinning" />
                    Simulating...
                  </>
                ) : (
                  <>
                    <PlayIcon className="button-icon" />
                    Run Simulation
                  </>
                )}
              </button>
            </div>
          </div>
        </SurfaceCard>

        {/* Current Result */}
        {currentResult && (
          <SurfaceCard
            title="Current Simulation Result"
            description="Latest routing simulation outcome"
            badge={currentResult.success ? "Success" : "Failed"}
          >
            <SimulationResultDisplay result={currentResult} providers={providers} />
          </SurfaceCard>
        )}

        {/* Combo Overview */}
        <SurfaceCard
          title="Combo Overview"
          description="Current routing configuration being tested"
        >
          <div className="combo-overview">
            <div className="overview-stats">
              <div className="overview-stat">
                <span className="stat-label">Enabled Tiers</span>
                <span className="stat-value">{enabledTiers.length}</span>
              </div>
              <div className="overview-stat">
                <span className="stat-label">Total Providers</span>
                <span className="stat-value">{totalProviders}</span>
              </div>
              <div className="overview-stat">
                <span className="stat-label">Client Routes</span>
                <span className="stat-value">{(combo.clientRoutes || []).length}</span>
              </div>
            </div>

            <div className="tier-summary">
              {enabledTiers.map((tier, index) => (
                <div key={tier?.id || index} className="tier-summary-item">
                  <span className="tier-priority">#{tier?.priority}</span>
                  <span className="tier-name">{tier?.name}</span>
                  <StatusBadge variant="neutral" size="xs">
                    {(tier?.providers || []).length}p
                  </StatusBadge>
                  {tier.fallbackDelay && (
                    <span className="tier-delay">{tier.fallbackDelay}ms</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </SurfaceCard>

        {/* Simulation History */}
        {simulationHistory.length > 0 && (
          <SurfaceCard
            title="Simulation History"
            description="Previous simulation results"
            badge={simulationHistory.length.toString()}
          >
            <div className="simulation-history">
              {simulationHistory.map((result, index) => (
                <div key={index} className="history-item">
                  <div className="history-header">
                    <StatusBadge
                      variant={result.success ? "success" : "danger"}
                      size="xs"
                    >
                      {result.success ? "Success" : "Failed"}
                    </StatusBadge>
                    <span className="history-route">{result.route}</span>
                    <span className="history-time">
                      {result.metrics.totalDuration}ms
                    </span>
                  </div>
                  {result.selectedProvider && (
                    <div className="history-provider">
                      Selected: {providers.find(p => p.id === result.selectedProvider)?.displayName || result.selectedProvider}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </SurfaceCard>
        )}
      </div>
    </div>
  );
}

// Simulation result display component
interface SimulationResultDisplayProps {
  result: RoutingSimulationResponse;
  providers: Provider[];
}

function SimulationResultDisplay({ result, providers }: SimulationResultDisplayProps) {
  const selectedProvider = providers.find(p => p.id === result.selectedProvider);

  return (
    <div className="simulation-result-display">
      <div className="result-summary">
        <div className="result-status">
          {result.success ? (
            <CheckCircleIcon className="status-icon success" />
          ) : (
            <AlertIcon className="status-icon error" />
          )}
          <span className="status-text">
            {result.success ? "Routing Successful" : "Routing Failed"}
          </span>
        </div>

        {result.selectedProvider && (
          <div className="selected-provider">
            <span className="provider-label">Selected Provider:</span>
            <span className="provider-name">
              {selectedProvider?.displayName || result.selectedProvider}
            </span>
            {selectedProvider && (
              <StatusBadge variant="neutral" size="xs">
                {selectedProvider.tier}
              </StatusBadge>
            )}
          </div>
        )}

        {result.selectedTier && (
          <div className="selected-tier">
            <span className="tier-label">Selected Tier:</span>
            <span className="tier-name">{result.selectedTier}</span>
          </div>
        )}
      </div>

      <div className="result-metrics">
        <div className="metric-item">
          <span className="metric-label">Total Duration</span>
          <span className="metric-value">{result.metrics.totalDuration}ms</span>
        </div>
        <div className="metric-item">
          <span className="metric-label">Selection Time</span>
          <span className="metric-value">{result.metrics.providerSelectionTime}ms</span>
        </div>
        <div className="metric-item">
          <span className="metric-label">Fallbacks</span>
          <span className="metric-value">{result.metrics.fallbackCount}</span>
        </div>
        <div className="metric-item">
          <span className="metric-label">Retries</span>
          <span className="metric-value">{result.metrics.retryCount}</span>
        </div>
      </div>

      {result.routingPath.length > 0 && (
        <div className="routing-path">
          <h4>Routing Path</h4>
          <div className="path-steps">
            {result.routingPath.map((step, index) => (
              <div key={index} className={`path-step ${step.success ? 'success' : 'error'}`}>
                <div className="step-info">
                  <span className="step-type">{step.stepType.replace('_', ' ')}</span>
                  <span className="step-duration">{step.duration}ms</span>
                </div>
                <div className="step-details">
                  {step.tierName && <span>Tier: {step.tierName}</span>}
                  {step.providerId && <span>Provider: {step.providerId}</span>}
                </div>
                <div className="step-reason">{step.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.errors && result.errors.length > 0 && (
        <div className="result-errors">
          <h4>Errors</h4>
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
      )}

      {result.recommendations && result.recommendations.length > 0 && (
        <div className="result-recommendations">
          <h4>Recommendations</h4>
          <ul>
            {result.recommendations.map((recommendation, index) => (
              <li key={index}>{recommendation}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}