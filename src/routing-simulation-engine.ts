import type { RoutingCombo } from "./routing-combo-repository.js";
import { RoutingEngine, type RoutingRequest, type RoutingResult } from "./routing-engine.js";
import type { RuntimeProviderRepository } from "./runtime-provider-repository.js";

// Simulation types matching frontend expectations
export type RoutingSimulationRequest = {
  comboId: string;
  route: string;
  model?: string;
  tokenCount?: number;
  priority?: 'low' | 'normal' | 'high';
  includeHealthCheck?: boolean;
  simulateFailures?: boolean;
  maxRetries?: number;
};

export type RoutingSimulationResponse = {
  success: boolean;
  selectedProvider?: string;
  selectedTier?: string;
  route: string;
  metrics: RoutingSimulationMetrics;
  routingPath: RoutingStep[];
  errors?: RoutingError[];
  recommendations?: string[];
};

export type RoutingSimulationMetrics = {
  totalDuration: number;
  providerSelectionTime: number;
  fallbackCount: number;
  retryCount: number;
};

export type RoutingStep = {
  stepType: 'tier_selection' | 'provider_selection' | 'fallback' | 'retry' | 'error';
  success: boolean;
  duration: number;
  tierName?: string;
  providerId?: string;
  reason: string;
};

export type RoutingError = {
  message: string;
  suggestedAction?: string;
};

export class RoutingSimulationEngine {
  constructor(
    private readonly routingEngine: RoutingEngine,
    private readonly providerRepository: RuntimeProviderRepository
  ) {}

  /**
   * Run a comprehensive routing simulation
   */
  async simulate(
    combo: RoutingCombo,
    request: RoutingSimulationRequest
  ): Promise<RoutingSimulationResponse> {
    const startTime = Date.now();
    const routingPath: RoutingStep[] = [];
    const errors: RoutingError[] = [];
    const recommendations: string[] = [];

    try {
      // Validate combo configuration
      const validationErrors = this.validateCombo(combo);
      if (validationErrors.length > 0) {
        errors.push(...validationErrors);
      }

      // Create routing request
      const routingRequest: RoutingRequest = {
        route: request.route,
        model: request.model,
        tokenCount: request.tokenCount,
        priority: request.priority || 'normal',
        clientRoute: request.route,
        startTime: Date.now()
      };

      // Add tier selection step
      const enabledTiers = combo.tiers
        .filter(tier => tier.isEnabled)
        .sort((a, b) => a.priority - b.priority);

      if (enabledTiers.length === 0) {
        routingPath.push({
          stepType: 'error',
          success: false,
          duration: 1,
          reason: 'No enabled tiers available'
        });

        return {
          success: false,
          route: request.route,
          metrics: {
            totalDuration: Date.now() - startTime,
            providerSelectionTime: 0,
            fallbackCount: 0,
            retryCount: 0
          },
          routingPath,
          errors: [{ message: 'No enabled tiers available', suggestedAction: 'Enable at least one tier in the routing combo' }],
          recommendations
        };
      }

      routingPath.push({
        stepType: 'tier_selection',
        success: true,
        duration: 2,
        reason: `Found ${enabledTiers.length} enabled tier${enabledTiers.length !== 1 ? 's' : ''}`
      });

      // Simulate provider selection with potential failures
      let result: RoutingResult;
      let retryCount = 0;
      const maxRetries = request.maxRetries || 3;

      do {
        if (retryCount > 0) {
          routingPath.push({
            stepType: 'retry',
            success: false,
            duration: 100 + (retryCount * 50),
            reason: `Retry attempt ${retryCount} after previous failure`
          });
        }

        // Simulate potential failures if requested
        if (request.simulateFailures && Math.random() < 0.3 && retryCount < maxRetries) {
          result = {
            success: false,
            error: 'Simulated provider failure',
            selectionTime: Math.floor(Math.random() * 100) + 50,
            fallbackCount: 0,
            retryCount: retryCount
          };
          retryCount++;
          continue;
        }

        // Perform actual routing
        result = await this.routingEngine.selectProvider(combo, routingRequest);
        break;
      } while (!result.success && retryCount < maxRetries);

      // Add provider selection steps based on result
      if (result.success && result.provider) {
        routingPath.push({
          stepType: 'provider_selection',
          success: true,
          duration: result.selectionTime,
          tierName: result.tier,
          providerId: result.provider.id,
          reason: `Selected provider with eligibility score ${result.eligibilityScore || 'unknown'}`
        });

        // Add fallback steps if any occurred
        if (result.fallbackCount && result.fallbackCount > 0) {
          for (let i = 0; i < result.fallbackCount; i++) {
            routingPath.push({
              stepType: 'fallback',
              success: false,
              duration: 50,
              reason: `Fallback to next tier (attempt ${i + 1})`
            });
          }
        }
      } else {
        routingPath.push({
          stepType: 'error',
          success: false,
          duration: result.selectionTime,
          reason: result.error || 'Provider selection failed'
        });

        errors.push({
          message: result.error || 'No eligible providers found',
          suggestedAction: 'Check provider health status and configuration'
        });
      }

      // Generate recommendations based on simulation results
      recommendations.push(...this.generateRecommendations(combo, result, routingPath));

      // Calculate final metrics
      const totalDuration = Date.now() - startTime;
      const metrics: RoutingSimulationMetrics = {
        totalDuration,
        providerSelectionTime: result.selectionTime,
        fallbackCount: result.fallbackCount || 0,
        retryCount
      };

      return {
        success: result.success,
        selectedProvider: result.provider?.id,
        selectedTier: result.tier,
        route: request.route,
        metrics,
        routingPath,
        errors: errors.length > 0 ? errors : undefined,
        recommendations: recommendations.length > 0 ? recommendations : undefined
      };

    } catch (error) {
      console.error('Simulation error:', error);

      routingPath.push({
        stepType: 'error',
        success: false,
        duration: Date.now() - startTime,
        reason: error instanceof Error ? error.message : 'Unknown simulation error'
      });

      return {
        success: false,
        route: request.route,
        metrics: {
          totalDuration: Date.now() - startTime,
          providerSelectionTime: 0,
          fallbackCount: 0,
          retryCount: 0
        },
        routingPath,
        errors: [{
          message: error instanceof Error ? error.message : 'Simulation failed',
          suggestedAction: 'Check routing combo configuration and provider availability'
        }]
      };
    }
  }

  /**
   * Validate routing combo configuration
   */
  private validateCombo(combo: RoutingCombo): RoutingError[] {
    const errors: RoutingError[] = [];

    // Check if combo has tiers
    if (!combo.tiers || combo.tiers.length === 0) {
      errors.push({
        message: 'Routing combo has no tiers configured',
        suggestedAction: 'Add at least one tier to the routing combo'
      });
      return errors;
    }

    // Check for enabled tiers
    const enabledTiers = combo.tiers.filter(tier => tier.isEnabled);
    if (enabledTiers.length === 0) {
      errors.push({
        message: 'No tiers are enabled',
        suggestedAction: 'Enable at least one tier in the routing combo'
      });
    }

    // Check tier priorities
    const priorities = enabledTiers.map(tier => tier.priority);
    const uniquePriorities = new Set(priorities);
    if (priorities.length !== uniquePriorities.size) {
      errors.push({
        message: 'Multiple tiers have the same priority',
        suggestedAction: 'Ensure each tier has a unique priority value'
      });
    }

    // Check providers in tiers
    for (const tier of enabledTiers) {
      if (!tier.providers || tier.providers.length === 0) {
        errors.push({
          message: `Tier "${tier.name}" has no providers configured`,
          suggestedAction: `Add at least one provider to tier "${tier.name}"`
        });
        continue;
      }

      const enabledProviders = tier.providers.filter(p => p.isEnabled);
      if (enabledProviders.length === 0) {
        errors.push({
          message: `Tier "${tier.name}" has no enabled providers`,
          suggestedAction: `Enable at least one provider in tier "${tier.name}"`
        });
        continue;
      }

      // Check provider weights
      const totalWeight = enabledProviders.reduce((sum, p) => sum + p.weight, 0);
      if (Math.abs(totalWeight - 100) > 5) {
        errors.push({
          message: `Tier "${tier.name}" provider weights sum to ${totalWeight}%, not 100%`,
          suggestedAction: `Adjust provider weights in tier "${tier.name}" to sum to 100%`
        });
      }

      // Check if providers exist
      for (const binding of enabledProviders) {
        const provider = this.providerRepository.getProvider(binding.providerId);
        if (!provider) {
          errors.push({
            message: `Provider "${binding.providerId}" in tier "${tier.name}" not found`,
            suggestedAction: `Remove invalid provider or create provider "${binding.providerId}"`
          });
        }
      }
    }

    return errors;
  }

  /**
   * Generate recommendations based on simulation results
   */
  private generateRecommendations(
    combo: RoutingCombo,
    result: RoutingResult,
    routingPath: RoutingStep[]
  ): string[] {
    const recommendations: string[] = [];

    // Analyze fallback patterns
    if (result.fallbackCount && result.fallbackCount > 0) {
      recommendations.push(
        `Consider reviewing tier ${combo.tiers[0]?.name || 'primary'} provider health - ${result.fallbackCount} fallback${result.fallbackCount !== 1 ? 's' : ''} occurred`
      );
    }

    // Analyze provider selection
    if (result.success && result.eligibilityScore !== undefined) {
      if (result.eligibilityScore < 70) {
        recommendations.push(
          `Selected provider has low eligibility score (${result.eligibilityScore}). Consider improving provider health or configuration.`
        );
      }
    }

    // Analyze tier configuration
    const enabledTiers = combo.tiers.filter(tier => tier.isEnabled);
    if (enabledTiers.length === 1) {
      recommendations.push(
        'Consider adding additional tiers for better fallback resilience'
      );
    }

    // Analyze load balancing
    if (combo.policies.loadBalancing === 'weighted') {
      const hasUnbalancedTiers = enabledTiers.some(tier => {
        const totalWeight = tier.providers.reduce((sum, p) => sum + p.weight, 0);
        return Math.abs(totalWeight - 100) > 5;
      });

      if (hasUnbalancedTiers) {
        recommendations.push(
          'Some tiers have unbalanced provider weights. Consider rebalancing for optimal distribution.'
        );
      }
    }

    // Analyze retry configuration
    if (result.retryCount && result.retryCount > 0) {
      recommendations.push(
        `${result.retryCount} retr${result.retryCount !== 1 ? 'ies' : 'y'} occurred. Consider adjusting retry policy or improving provider reliability.`
      );
    }

    // Performance recommendations
    const totalDuration = routingPath.reduce((sum, step) => sum + step.duration, 0);
    if (totalDuration > 1000) {
      recommendations.push(
        'Routing decision took longer than expected. Consider optimizing provider health checks or reducing fallback delays.'
      );
    }

    return recommendations;
  }

  /**
   * Run multiple simulations to get statistical insights
   */
  async runBatchSimulation(
    combo: RoutingCombo,
    request: RoutingSimulationRequest,
    iterations: number = 10
  ): Promise<{
    results: RoutingSimulationResponse[];
    summary: {
      successRate: number;
      averageDuration: number;
      providerDistribution: Record<string, number>;
      tierDistribution: Record<string, number>;
      commonErrors: string[];
    };
  }> {
    const results: RoutingSimulationResponse[] = [];

    // Run multiple simulations
    for (let i = 0; i < iterations; i++) {
      const result = await this.simulate(combo, request);
      results.push(result);
    }

    // Calculate summary statistics
    const successCount = results.filter(r => r.success).length;
    const successRate = (successCount / iterations) * 100;

    const averageDuration = results.reduce((sum, r) => sum + r.metrics.totalDuration, 0) / iterations;

    const providerDistribution: Record<string, number> = {};
    const tierDistribution: Record<string, number> = {};

    results.forEach(result => {
      if (result.selectedProvider) {
        providerDistribution[result.selectedProvider] = (providerDistribution[result.selectedProvider] || 0) + 1;
      }
      if (result.selectedTier) {
        tierDistribution[result.selectedTier] = (tierDistribution[result.selectedTier] || 0) + 1;
      }
    });

    const commonErrors = results
      .flatMap(r => r.errors || [])
      .map(e => e.message)
      .reduce((acc, error) => {
        acc[error] = (acc[error] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

    const sortedErrors = Object.entries(commonErrors)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([error]) => error);

    return {
      results,
      summary: {
        successRate,
        averageDuration,
        providerDistribution,
        tierDistribution,
        commonErrors: sortedErrors
      }
    };
  }
}