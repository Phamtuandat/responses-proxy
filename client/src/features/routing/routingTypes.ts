// Enhanced Routing Configuration Types
// Extends existing client route management with multi-tier fallback chains

import type {
  ProviderTier,
  ProviderHealthStatus,
  Provider
} from "../providers/providerTypes";
import type { RtkLayerPolicy } from "./rtkTypes";

// Core routing combo configuration
export interface RoutingCombo {
  id: string;
  name: string;
  description?: string;
  clientRoutes: string[];
  tiers: RoutingTier[];
  policies: RoutingPolicies;
  isActive: boolean;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
  metrics?: RoutingMetrics;
}

// Routing tier with provider bindings
export interface RoutingTier {
  id: string;
  name: string;
  tier: ProviderTier;
  providers: ProviderBinding[];
  healthThreshold: ProviderHealthStatus[];
  fallbackDelay?: number; // milliseconds
  maxRetries?: number;
  isEnabled: boolean;
  priority: number; // Lower number = higher priority
}

// Provider binding within a tier
export interface ProviderBinding {
  providerId: string;
  weight: number; // 0-100 for load balancing
  modelOverride?: string;
  isEnabled: boolean;
  conditions?: RoutingCondition[];
  costMultiplier?: number;
  maxConcurrency?: number;
}

// Routing condition for conditional provider selection
export interface RoutingCondition {
  type: 'model' | 'client' | 'time' | 'quota' | 'custom';
  operator: 'equals' | 'contains' | 'starts_with' | 'regex' | 'greater_than' | 'less_than';
  value: string | number;
  negate?: boolean;
}

// Routing policies configuration
export interface RoutingPolicies {
  loadBalancing: LoadBalancingStrategy;
  failoverStrategy: FailoverStrategy;
  tokenBudgetMode: TokenBudgetMode;
  rtkPolicy?: RtkLayerPolicy;
  quotaManagement?: QuotaPolicy;
  costOptimization?: CostOptimizationPolicy;
  retryPolicy?: RetryPolicy;
}

export type LoadBalancingStrategy =
  | 'round_robin'
  | 'weighted'
  | 'health_based'
  | 'cost_optimized'
  | 'least_connections'
  | 'random';

export type FailoverStrategy =
  | 'immediate'
  | 'delayed'
  | 'circuit_breaker'
  | 'health_check'
  | 'manual';

export type TokenBudgetMode =
  | 'per_route'
  | 'per_provider'
  | 'shared'
  | 'unlimited';

// Quota management policy
export interface QuotaPolicy {
  enabled: boolean;
  softLimit?: number; // Percentage (0-100)
  hardLimit?: number; // Percentage (0-100)
  resetStrategy: 'daily' | 'weekly' | 'monthly' | 'rolling';
  alertThreshold?: number; // Percentage (0-100)
  fallbackOnExhaustion: boolean;
}

// Cost optimization policy
export interface CostOptimizationPolicy {
  enabled: boolean;
  maxCostPerRequest?: number; // USD
  preferCheapProviders: boolean;
  costThreshold?: number; // USD per 1M tokens
  budgetLimit?: number; // USD per day/week/month
  budgetPeriod?: 'daily' | 'weekly' | 'monthly';
}

// Retry policy configuration
export interface RetryPolicy {
  enabled: boolean;
  maxRetries: number;
  backoffStrategy: 'linear' | 'exponential' | 'fixed';
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  retryableErrors: string[]; // Error codes to retry
}

// Routing simulation request
export interface RoutingSimulationRequest {
  comboId: string;
  requestType: 'chat' | 'completion' | 'embedding';
  model?: string;
  clientRoute?: string;
  providerHealthOverrides?: Record<string, ProviderHealthStatus>;
  loadScenario?: LoadScenario;
  iterations?: number;
}

// Load testing scenario
export interface LoadScenario {
  type: 'burst' | 'sustained' | 'gradual' | 'spike';
  requestsPerSecond: number;
  duration: number; // seconds
  concurrency: number;
}

// Routing simulation response
export interface RoutingSimulationResponse {
  success: boolean;
  selectedProvider?: string;
  selectedTier?: string;
  routingPath: RoutingStep[];
  metrics: SimulationMetrics;
  errors?: RoutingError[];
  recommendations?: string[];
}

// Individual routing step in simulation
export interface RoutingStep {
  stepType: 'tier_selection' | 'provider_selection' | 'fallback' | 'retry' | 'error';
  tierName?: string;
  providerId?: string;
  timestamp: string;
  duration: number; // milliseconds
  reason: string;
  success: boolean;
  metadata?: Record<string, unknown>;
}

// Simulation performance metrics
export interface SimulationMetrics {
  totalDuration: number; // milliseconds
  providerSelectionTime: number; // milliseconds
  fallbackCount: number;
  retryCount: number;
  successRate: number; // 0-1
  averageLatency: number; // milliseconds
  costEstimate?: number; // USD
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
}

// Routing error information
export interface RoutingError {
  code: string;
  message: string;
  providerId?: string;
  tierName?: string;
  timestamp: string;
  recoverable: boolean;
  suggestedAction?: string;
}

// Routing metrics for monitoring
export interface RoutingMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  providerDistribution: Record<string, number>;
  tierUtilization: Record<string, number>;
  fallbackFrequency: number;
  costPerRequest: number;
  lastUpdated: string;
}

// Combo creation/update input
export interface RoutingComboInput {
  name: string;
  description?: string;
  clientRoutes?: string[];
  tiers: RoutingTierInput[];
  policies: RoutingPolicies;
  isActive?: boolean;
  isDefault?: boolean;
}

export interface RoutingTierInput {
  name: string;
  tier: ProviderTier;
  providers: ProviderBindingInput[];
  healthThreshold?: ProviderHealthStatus[];
  fallbackDelay?: number;
  maxRetries?: number;
  isEnabled?: boolean;
  priority: number;
}

export interface ProviderBindingInput {
  providerId: string;
  weight: number;
  modelOverride?: string;
  isEnabled?: boolean;
  conditions?: RoutingCondition[];
  costMultiplier?: number;
  maxConcurrency?: number;
}

// API response types
export interface RoutingCombosResponse {
  combos: RoutingCombo[];
  total: number;
  defaultComboId?: string;
}

export interface RoutingComboResponse {
  combo: RoutingCombo;
  validation?: ValidationResult;
}

export interface RoutingComboDeleteResponse {
  success: boolean;
  message?: string;
}

export interface RoutingMetricsResponse {
  metrics: RoutingMetrics;
  timeRange: {
    start: string;
    end: string;
  };
  breakdown: {
    byProvider: Record<string, RoutingMetrics>;
    byTier: Record<string, RoutingMetrics>;
    byClientRoute: Record<string, RoutingMetrics>;
  };
}

// Validation result
export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  code: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

export interface ValidationWarning {
  field: string;
  code: string;
  message: string;
  suggestion?: string;
}

// Routing combo templates
export interface RoutingComboTemplate {
  id: string;
  name: string;
  description: string;
  category: 'basic' | 'advanced' | 'cost_optimized' | 'high_availability' | 'custom';
  template: RoutingComboInput;
  requiredProviders: string[];
  estimatedCost: 'low' | 'medium' | 'high';
  complexity: 'simple' | 'moderate' | 'complex';
}

// Routing analytics
export interface RoutingAnalytics {
  timeRange: {
    start: string;
    end: string;
  };
  summary: {
    totalRequests: number;
    successRate: number;
    averageLatency: number;
    totalCost: number;
  };
  trends: {
    requestVolume: TimeSeriesData[];
    successRate: TimeSeriesData[];
    latency: TimeSeriesData[];
    cost: TimeSeriesData[];
  };
  topProviders: ProviderUsageStats[];
  topClientRoutes: ClientRouteUsageStats[];
}

export interface TimeSeriesData {
  timestamp: string;
  value: number;
}

export interface ProviderUsageStats {
  providerId: string;
  providerName: string;
  requestCount: number;
  successRate: number;
  averageLatency: number;
  totalCost: number;
  percentage: number;
}

export interface ClientRouteUsageStats {
  clientRoute: string;
  requestCount: number;
  successRate: number;
  averageLatency: number;
  totalCost: number;
  percentage: number;
}

// Type guards and utilities
export function isRoutingCombo(obj: any): obj is RoutingCombo {
  return (
    obj &&
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    Array.isArray(obj.tiers) &&
    obj.policies &&
    typeof obj.isActive === 'boolean'
  );
}

export function isRoutingTier(obj: any): obj is RoutingTier {
  return (
    obj &&
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.tier === 'string' &&
    Array.isArray(obj.providers) &&
    typeof obj.priority === 'number'
  );
}

export function isProviderBinding(obj: any): obj is ProviderBinding {
  return (
    obj &&
    typeof obj.providerId === 'string' &&
    typeof obj.weight === 'number' &&
    typeof obj.isEnabled === 'boolean'
  );
}