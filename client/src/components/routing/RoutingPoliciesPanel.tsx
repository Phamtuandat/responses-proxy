// Routing Policies Panel Component
// Configures routing policies like load balancing, failover, and token budgets

import React, { useCallback } from "react";
import { SurfaceCard } from "../SurfaceCard";
import { StatusBadge } from "../StatusBadge";
import {
  SettingsIcon,
  CheckCircleIcon,
  AlertIcon,
  ClockIcon,
  DollarIcon
} from "../icons";
import type {
  RoutingPolicies,
  LoadBalancingStrategy,
  FailoverStrategy,
  TokenBudgetMode,
  QuotaPolicy,
  CostOptimizationPolicy,
  RetryPolicy
} from "../../features/routing/routingTypes";

interface RoutingPoliciesPanelProps {
  policies: RoutingPolicies;
  onChange: (policies: RoutingPolicies) => void;
}

export function RoutingPoliciesPanel({ policies, onChange }: RoutingPoliciesPanelProps) {
  const updatePolicy = useCallback(<K extends keyof RoutingPolicies>(
    key: K,
    value: RoutingPolicies[K]
  ) => {
    onChange({ ...policies, [key]: value });
  }, [policies, onChange]);

  return (
    <div className="routing-policies-panel">
      {/* Load Balancing */}
      <SurfaceCard
        title="Load Balancing"
        description="Configure how requests are distributed among providers"
        icon={SettingsIcon}
      >
        <div className="policy-section">
          <div className="form-group">
            <label htmlFor="loadBalancing">Strategy</label>
            <select
              id="loadBalancing"
              value={policies.loadBalancing}
              onChange={(e) => updatePolicy('loadBalancing', e.target.value as LoadBalancingStrategy)}
            >
              <option value="round_robin">Round Robin</option>
              <option value="weighted">Weighted Distribution</option>
              <option value="health_based">Health-Based Selection</option>
              <option value="cost_optimized">Cost Optimized</option>
              <option value="least_connections">Least Connections</option>
              <option value="random">Random Selection</option>
            </select>
          </div>

          <div className="policy-description">
            {getLoadBalancingDescription(policies.loadBalancing)}
          </div>
        </div>
      </SurfaceCard>

      {/* Failover Strategy */}
      <SurfaceCard
        title="Failover Strategy"
        description="Configure how the system handles provider failures"
        icon={AlertIcon}
      >
        <div className="policy-section">
          <div className="form-group">
            <label htmlFor="failoverStrategy">Strategy</label>
            <select
              id="failoverStrategy"
              value={policies.failoverStrategy}
              onChange={(e) => updatePolicy('failoverStrategy', e.target.value as FailoverStrategy)}
            >
              <option value="immediate">Immediate Failover</option>
              <option value="delayed">Delayed Failover</option>
              <option value="circuit_breaker">Circuit Breaker</option>
              <option value="health_check">Health Check Based</option>
              <option value="manual">Manual Failover</option>
            </select>
          </div>

          <div className="policy-description">
            {getFailoverDescription(policies.failoverStrategy)}
          </div>
        </div>
      </SurfaceCard>

      {/* Token Budget */}
      <SurfaceCard
        title="Token Budget Management"
        description="Configure token usage limits and tracking"
        icon={ClockIcon}
      >
        <div className="policy-section">
          <div className="form-group">
            <label htmlFor="tokenBudgetMode">Budget Mode</label>
            <select
              id="tokenBudgetMode"
              value={policies.tokenBudgetMode}
              onChange={(e) => updatePolicy('tokenBudgetMode', e.target.value as TokenBudgetMode)}
            >
              <option value="per_route">Per Route</option>
              <option value="per_provider">Per Provider</option>
              <option value="shared">Shared Pool</option>
              <option value="unlimited">Unlimited</option>
            </select>
          </div>

          <div className="policy-description">
            {getTokenBudgetDescription(policies.tokenBudgetMode)}
          </div>
        </div>
      </SurfaceCard>

      {/* Quota Management */}
      <SurfaceCard
        title="Quota Management"
        description="Configure quota monitoring and exhaustion handling"
        icon={CheckCircleIcon}
      >
        <QuotaPolicyConfig
          policy={policies.quotaManagement}
          onChange={(quotaManagement) => updatePolicy('quotaManagement', quotaManagement)}
        />
      </SurfaceCard>

      {/* Cost Optimization */}
      <SurfaceCard
        title="Cost Optimization"
        description="Configure cost-aware routing and budget limits"
        icon={DollarIcon}
      >
        <CostOptimizationConfig
          policy={policies.costOptimization}
          onChange={(costOptimization) => updatePolicy('costOptimization', costOptimization)}
        />
      </SurfaceCard>

      {/* Retry Policy */}
      <SurfaceCard
        title="Retry Policy"
        description="Configure automatic retry behavior for failed requests"
        icon={AlertIcon}
      >
        <RetryPolicyConfig
          policy={policies.retryPolicy}
          onChange={(retryPolicy) => updatePolicy('retryPolicy', retryPolicy)}
        />
      </SurfaceCard>
    </div>
  );
}

// Quota policy configuration
interface QuotaPolicyConfigProps {
  policy?: QuotaPolicy;
  onChange: (policy?: QuotaPolicy) => void;
}

function QuotaPolicyConfig({ policy, onChange }: QuotaPolicyConfigProps) {
  const updateQuotaPolicy = useCallback(<K extends keyof QuotaPolicy>(
    key: K,
    value: QuotaPolicy[K]
  ) => {
    const newPolicy = policy ? { ...policy, [key]: value } : { enabled: true, [key]: value } as QuotaPolicy;
    onChange(newPolicy);
  }, [policy, onChange]);

  const toggleEnabled = useCallback((enabled: boolean) => {
    if (enabled) {
      onChange({
        enabled: true,
        softLimit: 80,
        hardLimit: 95,
        resetStrategy: 'daily',
        alertThreshold: 90,
        fallbackOnExhaustion: true
      });
    } else {
      onChange(undefined);
    }
  }, [onChange]);

  return (
    <div className="quota-policy-config">
      <div className="form-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={policy?.enabled || false}
            onChange={(e) => toggleEnabled(e.target.checked)}
          />
          <span>Enable Quota Management</span>
        </label>
      </div>

      {policy?.enabled && (
        <>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="softLimit">Soft Limit (%)</label>
              <input
                id="softLimit"
                type="number"
                min="0"
                max="100"
                value={policy.softLimit || 80}
                onChange={(e) => updateQuotaPolicy('softLimit', parseInt(e.target.value) || 80)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="hardLimit">Hard Limit (%)</label>
              <input
                id="hardLimit"
                type="number"
                min="0"
                max="100"
                value={policy.hardLimit || 95}
                onChange={(e) => updateQuotaPolicy('hardLimit', parseInt(e.target.value) || 95)}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="resetStrategy">Reset Strategy</label>
              <select
                id="resetStrategy"
                value={policy.resetStrategy || 'daily'}
                onChange={(e) => updateQuotaPolicy('resetStrategy', e.target.value as 'daily' | 'weekly' | 'monthly' | 'rolling')}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="rolling">Rolling Window</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="alertThreshold">Alert Threshold (%)</label>
              <input
                id="alertThreshold"
                type="number"
                min="0"
                max="100"
                value={policy.alertThreshold || 90}
                onChange={(e) => updateQuotaPolicy('alertThreshold', parseInt(e.target.value) || 90)}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={policy.fallbackOnExhaustion || false}
                onChange={(e) => updateQuotaPolicy('fallbackOnExhaustion', e.target.checked)}
              />
              <span>Fallback to next tier when quota exhausted</span>
            </label>
          </div>
        </>
      )}
    </div>
  );
}

// Cost optimization configuration
interface CostOptimizationConfigProps {
  policy?: CostOptimizationPolicy;
  onChange: (policy?: CostOptimizationPolicy) => void;
}

function CostOptimizationConfig({ policy, onChange }: CostOptimizationConfigProps) {
  const updateCostPolicy = useCallback(<K extends keyof CostOptimizationPolicy>(
    key: K,
    value: CostOptimizationPolicy[K]
  ) => {
    const newPolicy = policy ? { ...policy, [key]: value } : { enabled: true, [key]: value } as CostOptimizationPolicy;
    onChange(newPolicy);
  }, [policy, onChange]);

  const toggleEnabled = useCallback((enabled: boolean) => {
    if (enabled) {
      onChange({
        enabled: true,
        preferCheapProviders: true,
        costThreshold: 10.0,
        budgetLimit: 100.0,
        budgetPeriod: 'daily'
      });
    } else {
      onChange(undefined);
    }
  }, [onChange]);

  return (
    <div className="cost-optimization-config">
      <div className="form-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={policy?.enabled || false}
            onChange={(e) => toggleEnabled(e.target.checked)}
          />
          <span>Enable Cost Optimization</span>
        </label>
      </div>

      {policy?.enabled && (
        <>
          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={policy.preferCheapProviders || false}
                onChange={(e) => updateCostPolicy('preferCheapProviders', e.target.checked)}
              />
              <span>Prefer cheaper providers when possible</span>
            </label>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="maxCostPerRequest">Max Cost Per Request ($)</label>
              <input
                id="maxCostPerRequest"
                type="number"
                min="0"
                step="0.001"
                value={policy.maxCostPerRequest || ''}
                onChange={(e) => updateCostPolicy('maxCostPerRequest', parseFloat(e.target.value) || undefined)}
                placeholder="No limit"
              />
            </div>

            <div className="form-group">
              <label htmlFor="costThreshold">Cost Threshold ($/1M tokens)</label>
              <input
                id="costThreshold"
                type="number"
                min="0"
                step="0.1"
                value={policy.costThreshold || 10.0}
                onChange={(e) => updateCostPolicy('costThreshold', parseFloat(e.target.value) || 10.0)}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="budgetLimit">Budget Limit ($)</label>
              <input
                id="budgetLimit"
                type="number"
                min="0"
                step="1"
                value={policy.budgetLimit || 100.0}
                onChange={(e) => updateCostPolicy('budgetLimit', parseFloat(e.target.value) || 100.0)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="budgetPeriod">Budget Period</label>
              <select
                id="budgetPeriod"
                value={policy.budgetPeriod || 'daily'}
                onChange={(e) => updateCostPolicy('budgetPeriod', e.target.value as 'daily' | 'weekly' | 'monthly')}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Retry policy configuration
interface RetryPolicyConfigProps {
  policy?: RetryPolicy;
  onChange: (policy?: RetryPolicy) => void;
}

function RetryPolicyConfig({ policy, onChange }: RetryPolicyConfigProps) {
  const updateRetryPolicy = useCallback(<K extends keyof RetryPolicy>(
    key: K,
    value: RetryPolicy[K]
  ) => {
    const newPolicy = policy ? { ...policy, [key]: value } : { enabled: true, [key]: value } as RetryPolicy;
    onChange(newPolicy);
  }, [policy, onChange]);

  const toggleEnabled = useCallback((enabled: boolean) => {
    if (enabled) {
      onChange({
        enabled: true,
        maxRetries: 3,
        backoffStrategy: 'exponential',
        baseDelay: 1000,
        maxDelay: 10000,
        retryableErrors: ['429', '502', '503', '504']
      });
    } else {
      onChange(undefined);
    }
  }, [onChange]);

  return (
    <div className="retry-policy-config">
      <div className="form-group">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={policy?.enabled || false}
            onChange={(e) => toggleEnabled(e.target.checked)}
          />
          <span>Enable Automatic Retries</span>
        </label>
      </div>

      {policy?.enabled && (
        <>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="maxRetries">Max Retries</label>
              <input
                id="maxRetries"
                type="number"
                min="0"
                max="10"
                value={policy.maxRetries || 3}
                onChange={(e) => updateRetryPolicy('maxRetries', parseInt(e.target.value) || 3)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="backoffStrategy">Backoff Strategy</label>
              <select
                id="backoffStrategy"
                value={policy.backoffStrategy || 'exponential'}
                onChange={(e) => updateRetryPolicy('backoffStrategy', e.target.value as 'linear' | 'exponential' | 'fixed')}
              >
                <option value="linear">Linear</option>
                <option value="exponential">Exponential</option>
                <option value="fixed">Fixed</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="baseDelay">Base Delay (ms)</label>
              <input
                id="baseDelay"
                type="number"
                min="0"
                step="100"
                value={policy.baseDelay || 1000}
                onChange={(e) => updateRetryPolicy('baseDelay', parseInt(e.target.value) || 1000)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="maxDelay">Max Delay (ms)</label>
              <input
                id="maxDelay"
                type="number"
                min="0"
                step="1000"
                value={policy.maxDelay || 10000}
                onChange={(e) => updateRetryPolicy('maxDelay', parseInt(e.target.value) || 10000)}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="retryableErrors">Retryable Error Codes (comma-separated)</label>
            <input
              id="retryableErrors"
              type="text"
              value={policy.retryableErrors?.join(', ') || '429, 502, 503, 504'}
              onChange={(e) => {
                const errors = e.target.value
                  .split(',')
                  .map(code => code.trim())
                  .filter(code => code.length > 0);
                updateRetryPolicy('retryableErrors', errors);
              }}
              placeholder="429, 502, 503, 504"
            />
          </div>
        </>
      )}
    </div>
  );
}

// Helper functions for policy descriptions
function getLoadBalancingDescription(strategy: LoadBalancingStrategy): string {
  switch (strategy) {
    case 'round_robin':
      return 'Distributes requests evenly across all providers in rotation.';
    case 'weighted':
      return 'Distributes requests based on provider weight configuration.';
    case 'health_based':
      return 'Prioritizes healthy providers and avoids degraded ones.';
    case 'cost_optimized':
      return 'Selects the most cost-effective provider for each request.';
    case 'least_connections':
      return 'Routes to the provider with the fewest active connections.';
    case 'random':
      return 'Randomly selects a provider for each request.';
    default:
      return 'Configure how requests are distributed among providers.';
  }
}

function getFailoverDescription(strategy: FailoverStrategy): string {
  switch (strategy) {
    case 'immediate':
      return 'Immediately fails over to the next tier on any error.';
    case 'delayed':
      return 'Waits for the configured delay before failing over to next tier.';
    case 'circuit_breaker':
      return 'Uses circuit breaker pattern to prevent cascading failures.';
    case 'health_check':
      return 'Fails over based on provider health check results.';
    case 'manual':
      return 'Requires manual intervention to trigger failover.';
    default:
      return 'Configure how the system handles provider failures.';
  }
}

function getTokenBudgetDescription(mode: TokenBudgetMode): string {
  switch (mode) {
    case 'per_route':
      return 'Each client route has its own token budget.';
    case 'per_provider':
      return 'Each provider has its own token budget.';
    case 'shared':
      return 'All routes share a common token budget pool.';
    case 'unlimited':
      return 'No token budget limits are enforced.';
    default:
      return 'Configure token usage limits and tracking.';
  }
}