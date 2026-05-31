// Routing API Client
// Handles backend integration for routing combos and configuration management

import { apiGet, apiSend } from "../../api/client";
import type {
  RoutingCombo,
  RoutingComboInput,
  RoutingSimulationRequest,
  RoutingSimulationResponse,
  RoutingComboTemplate,
  ValidationResult
} from "./routingTypes";

// Routing combo management
export async function fetchRoutingCombos(): Promise<RoutingCombo[]> {
  try {
    const response = await apiGet('/api/routing/combos');
    return response.combos || [];
  } catch (error) {
    console.error('Failed to fetch routing combos:', error);
    // Fallback to empty array if API fails
    return [];
  }
}

export async function fetchRoutingCombo(id: string): Promise<RoutingCombo | null> {
  try {
    const response = await apiGet(`/api/routing/combos/${id}`);
    return response;
  } catch (error) {
    console.error(`Failed to fetch routing combo ${id}:`, error);
    return null;
  }
}

export async function createRoutingCombo(input: RoutingComboInput): Promise<RoutingCombo> {
  try {
    const response = await apiSend('/api/routing/combos', 'POST', input);
    return response;
  } catch (error) {
    console.error('Failed to create routing combo:', error);
    throw new Error('Failed to create routing configuration');
  }
}

export async function updateRoutingCombo(id: string, input: RoutingComboInput): Promise<RoutingCombo> {
  try {
    const response = await apiSend(`/api/routing/combos/${id}`, 'PUT', input);
    return response;
  } catch (error) {
    console.error('Failed to update routing combo:', error);
    throw new Error('Failed to update routing configuration');
  }
}

export async function deleteRoutingCombo(id: string): Promise<void> {
  try {
    await apiSend(`/api/routing/combos/${id}`, 'DELETE', {});
  } catch (error) {
    console.error(`Failed to delete routing combo ${id}:`, error);
    throw new Error('Failed to delete routing configuration');
  }
}

export async function simulateRouting(request: RoutingSimulationRequest): Promise<RoutingSimulationResponse> {
  try {
    const response = await apiSend(`/api/routing/combos/${request.comboId}/simulate`, 'POST', request);
    return response;
  } catch (error) {
    console.error('Failed to simulate routing:', error);
    throw new Error('Failed to simulate routing configuration');
  }
}

export async function setDefaultCombo(id: string): Promise<void> {
  try {
    await apiSend(`/api/routing/combos/${id}/set-default`, 'POST', {});
  } catch (error) {
    console.error('Failed to set default combo:', error);
    throw new Error('Failed to set default routing combo');
  }
}

// Routing combo validation
export function validateRoutingCombo(combo: RoutingComboInput): ValidationResult {
  const errors: any[] = [];
  const warnings: any[] = [];

  // Validate basic fields
  if (!combo.name || combo.name.trim().length === 0) {
    errors.push({
      field: 'name',
      code: 'REQUIRED',
      message: 'Combo name is required',
      severity: 'error'
    });
  }

  if (!combo.tiers || combo.tiers.length === 0) {
    errors.push({
      field: 'tiers',
      code: 'REQUIRED',
      message: 'At least one tier is required',
      severity: 'error'
    });
    return { isValid: false, errors, warnings };
  }

  // Validate tiers
  combo.tiers.forEach((tier, index) => {
    if (!tier.name || tier.name.trim().length === 0) {
      errors.push({
        field: `tiers[${index}].name`,
        code: 'REQUIRED',
        message: `Tier ${index + 1} name is required`,
        severity: 'error'
      });
    }

    if (!tier.providers || tier.providers.length === 0) {
      warnings.push({
        field: `tiers[${index}].providers`,
        code: 'NO_PROVIDERS',
        message: `Tier "${tier.name}" has no providers`,
        suggestion: 'Add at least one provider to this tier'
      });
    } else {
      // Validate provider weights
      const totalWeight = tier.providers.reduce((sum, p) => sum + (p.weight || 0), 0);
      if (Math.abs(totalWeight - 100) > 5) {
        warnings.push({
          field: `tiers[${index}].providers`,
          code: 'WEIGHT_MISMATCH',
          message: `Tier "${tier.name}" provider weights sum to ${totalWeight}%, not 100%`,
          suggestion: 'Adjust provider weights to sum to 100%'
        });
      }
    }
  });

  // Validate tier priorities
  const priorities = combo.tiers.map(t => t.priority);
  const uniquePriorities = new Set(priorities);
  if (priorities.length !== uniquePriorities.size) {
    errors.push({
      field: 'tiers',
      code: 'DUPLICATE_PRIORITIES',
      message: 'Tier priorities must be unique',
      severity: 'error'
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

export async function getRoutingTemplates(): Promise<RoutingComboTemplate[]> {
  // Return predefined routing templates
  return [
    {
      id: 'basic-fallback',
      name: 'Basic Fallback',
      description: 'Simple two-tier fallback from subscription to cheap providers',
      category: 'basic',
      requiredProviders: ['subscription', 'cheap'],
      estimatedCost: 'medium',
      complexity: 'simple',
      template: {
        name: 'Basic Fallback Routing',
        description: 'Subscription providers with cheap fallback',
        tiers: [
          {
            name: 'Primary',
            tier: 'subscription',
            providers: [],
            priority: 1,
            healthThreshold: ['healthy', 'degraded'],
            fallbackDelay: 1000,
            maxRetries: 2,
            isEnabled: true
          },
          {
            name: 'Fallback',
            tier: 'cheap',
            providers: [],
            priority: 2,
            healthThreshold: ['healthy'],
            fallbackDelay: 2000,
            maxRetries: 1,
            isEnabled: true
          }
        ],
        policies: {
          loadBalancing: 'health_based',
          failoverStrategy: 'delayed',
          tokenBudgetMode: 'per_route',
          retryPolicy: {
            enabled: true,
            maxRetries: 3,
            backoffStrategy: 'exponential',
            baseDelay: 1000,
            maxDelay: 10000,
            retryableErrors: ['429', '502', '503', '504']
          }
        },
        clientRoutes: [],
        isActive: true,
        isDefault: false
      }
    },
    {
      id: 'cost-optimized',
      name: 'Cost Optimized',
      description: 'Prioritizes cheap providers with premium fallback',
      category: 'cost_optimized',
      requiredProviders: ['cheap', 'subscription'],
      estimatedCost: 'low',
      complexity: 'moderate',
      template: {
        name: 'Cost Optimized Routing',
        description: 'Cheap providers first, premium as fallback',
        tiers: [
          {
            name: 'Cost Effective',
            tier: 'cheap',
            providers: [],
            priority: 1,
            healthThreshold: ['healthy'],
            fallbackDelay: 500,
            maxRetries: 1,
            isEnabled: true
          },
          {
            name: 'Premium Fallback',
            tier: 'subscription',
            providers: [],
            priority: 2,
            healthThreshold: ['healthy', 'degraded'],
            fallbackDelay: 1000,
            maxRetries: 2,
            isEnabled: true
          }
        ],
        policies: {
          loadBalancing: 'cost_optimized',
          failoverStrategy: 'immediate',
          tokenBudgetMode: 'shared',
          costOptimization: {
            enabled: true,
            preferCheapProviders: true,
            costThreshold: 5.0,
            budgetLimit: 50.0,
            budgetPeriod: 'daily'
          }
        },
        clientRoutes: [],
        isActive: true,
        isDefault: false
      }
    },
    {
      id: 'high-availability',
      name: 'High Availability',
      description: 'Maximum redundancy with three-tier fallback chain',
      category: 'reliability',
      requiredProviders: ['subscription', 'cheap', 'free'],
      estimatedCost: 'high',
      complexity: 'advanced',
      template: {
        name: 'High Availability Routing',
        description: 'Three-tier fallback for maximum reliability',
        tiers: [
          {
            name: 'Primary',
            tier: 'subscription',
            providers: [],
            priority: 1,
            healthThreshold: ['healthy'],
            fallbackDelay: 500,
            maxRetries: 2,
            isEnabled: true
          },
          {
            name: 'Secondary',
            tier: 'cheap',
            providers: [],
            priority: 2,
            healthThreshold: ['healthy'],
            fallbackDelay: 1000,
            maxRetries: 2,
            isEnabled: true
          },
          {
            name: 'Emergency',
            tier: 'free',
            providers: [],
            priority: 3,
            healthThreshold: ['healthy'],
            fallbackDelay: 2000,
            maxRetries: 1,
            isEnabled: true
          }
        ],
        policies: {
          loadBalancing: 'health_based',
          failoverStrategy: 'circuit_breaker',
          tokenBudgetMode: 'per_provider',
          quotaManagement: {
            enabled: true,
            softLimit: 70,
            hardLimit: 90,
            resetStrategy: 'daily',
            alertThreshold: 80,
            fallbackOnExhaustion: true
          }
        },
        clientRoutes: [],
        isActive: true,
        isDefault: false
      }
    }
  ];
}

// Helper function to classify provider tier (same as in providerApi.ts)
function classifyProviderTier(providerName: string): 'subscription' | 'cheap' | 'free' | 'custom' {
  const name = providerName.toLowerCase();

  if (name.includes('claude-code') || name.includes('copilot') || name.includes('cursor') ||
      name.includes('subscription') || name.includes('premium') || name.includes('pro')) {
    return 'subscription';
  }

  if (name.includes('free') || name.includes('trial') || name.includes('demo') ||
      name.includes('kiro-free') || name.includes('huggingface-free')) {
    return 'free';
  }

  if (name.includes('deepseek') || name.includes('groq') || name.includes('together') ||
      name.includes('cheap') || name.includes('budget')) {
    return 'cheap';
  }

  return 'custom';
}