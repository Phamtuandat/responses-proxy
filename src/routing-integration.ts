import type { RuntimeProviderPreset, ClientRouteKey } from "./runtime-provider-repository.js";
import type { RoutingComboRepository } from "./routing-combo-repository.js";
import type { RoutingEngine } from "./routing-engine.js";
import type { ProviderHealthService } from "./provider-health-service.js";
import {
  type ProviderRoutingHint,
  type ProviderRoutingResolution,
  resolveProviderForRequest
} from "./provider-routing.js";

export type RoutingIntegrationContext = {
  routingComboRepository: RoutingComboRepository;
  routingEngine: RoutingEngine;
  healthService: ProviderHealthService;
};

export type RoutingRequest = {
  clientRoute: ClientRouteKey;
  providers: RuntimeProviderPreset[];
  providerHint: ProviderRoutingHint;
  requestId: string;
  startedAt: number;
  headers: Record<string, unknown>;
  metadata?: unknown;
};

export type RoutingResult = {
  provider: RuntimeProviderPreset;
  matchReason: "routing_combo" | "explicit_provider" | "single_match" | "fallback";
  routingComboId?: string;
  tierName?: string;
  selectionTime?: number;
  fallbackCount?: number;
} | {
  error: {
    statusCode: number;
    type: string;
    code: string;
    message: string;
  };
};

/**
 * A combo-selected provider must be one the request's API key is entitled to.
 * `allowed` is the set already resolved by resolveCustomerRoutingAccess (+ the
 * open-routing fallback, which fills the playground case). An empty set here means
 * an unauthenticated/invalid key, so nothing is allowed — the caller falls through
 * to resolveProviderForRequest, which returns the proper 401.
 */
function isProviderAllowed(
  provider: RuntimeProviderPreset,
  allowed: RuntimeProviderPreset[],
): boolean {
  return allowed.some((candidate) => candidate.id === provider.id);
}

/**
 * Enhanced provider resolution that uses routing combos when available,
 * falling back to the original simple provider selection logic.
 */
export async function resolveProviderWithRouting(
  request: RoutingRequest,
  context: RoutingIntegrationContext
): Promise<RoutingResult> {
  const { clientRoute, providers, providerHint, requestId, startedAt } = request;
  const { routingComboRepository, routingEngine, healthService } = context;

  // If explicit provider is requested, honor it directly (bypass routing combos)
  if (providerHint.providerId || providerHint.providerName) {
    const resolution = resolveProviderForRequest({
      providers,
      explicitProviderId: providerHint.providerId,
      explicitProviderName: providerHint.providerName,
    });

    if ("error" in resolution) {
      return { error: resolution.error };
    }

    return {
      provider: resolution.provider,
      matchReason: "explicit_provider",
      selectionTime: Date.now() - startedAt
    };
  }

  try {
    // Check if client route has a routing combo assigned
    const assignedComboId = await routingComboRepository.getClientRouteCombo(clientRoute);

    if (assignedComboId) {
      // Use routing combo for provider selection
      const combo = await routingComboRepository.getComboById(assignedComboId);

      if (combo && combo.isActive) {
        const routingResult = await routingEngine.selectProvider(combo, {
          route: typeof request.headers["x-proxy-route"] === "string" ? request.headers["x-proxy-route"] : "",
          clientRoute,
          startTime: startedAt,
          priority: request.headers["x-priority"] === "high" ? "high" : "normal",
        });

        if (routingResult.success && routingResult.provider) {
          // Entitlement guard: a combo is a preference WITHIN the set of providers
          // this API key may use, never an override of it. If the engine picked a
          // provider outside request.providers, drop to the simple selection path
          // (which enforces membership) instead of leaking access.
          if (isProviderAllowed(routingResult.provider, providers)) {
            return {
              provider: routingResult.provider,
              matchReason: "routing_combo",
              routingComboId: combo.id,
              tierName: routingResult.tier,
              selectionTime: routingResult.selectionTime,
              fallbackCount: routingResult.fallbackCount
            };
          }
          console.warn(
            `Routing combo ${assignedComboId} selected provider ${routingResult.provider.id} not permitted for client route ${clientRoute}; falling back to allowed providers`,
          );
        } else {
          // If routing combo failed, fall back to simple selection
          console.warn(`Routing combo ${assignedComboId} failed for client route ${clientRoute}: ${routingResult.error}`);
        }
      }
    }

    // Check for default routing combo if no specific assignment
    if (!assignedComboId) {
      const defaultCombo = await routingComboRepository.getDefaultCombo();

      if (defaultCombo && defaultCombo.isActive) {
        const routingResult = await routingEngine.selectProvider(defaultCombo, {
          route: typeof request.headers["x-proxy-route"] === "string" ? request.headers["x-proxy-route"] : "",
          clientRoute,
          startTime: startedAt,
          priority: request.headers["x-priority"] === "high" ? "high" : "normal",
        });

        if (routingResult.success && routingResult.provider) {
          if (isProviderAllowed(routingResult.provider, providers)) {
            return {
              provider: routingResult.provider,
              matchReason: "routing_combo",
              routingComboId: defaultCombo.id,
              tierName: routingResult.tier,
              selectionTime: routingResult.selectionTime,
              fallbackCount: routingResult.fallbackCount
            };
          }
          console.warn(
            `Default routing combo ${defaultCombo.id} selected provider ${routingResult.provider.id} not permitted for client route ${clientRoute}; falling back to allowed providers`,
          );
        } else {
          // Match the assigned-combo path: make default-combo failures visible.
          console.warn(`Default routing combo ${defaultCombo.id} failed for client route ${clientRoute}: ${routingResult.error}`);
        }
      }
    }

    // Fall back to original simple provider selection
    const fallbackResolution = resolveProviderForRequest({
      providers,
      explicitProviderId: undefined,
      explicitProviderName: undefined,
    });

    if ("error" in fallbackResolution) {
      return { error: fallbackResolution.error };
    }

    return {
      provider: fallbackResolution.provider,
      matchReason: "fallback",
      selectionTime: Date.now() - startedAt
    };

  } catch (error) {
    console.error(`Error in routing integration for client route ${clientRoute}:`, error);

    // Fall back to original simple provider selection on any error
    const fallbackResolution = resolveProviderForRequest({
      providers,
      explicitProviderId: undefined,
      explicitProviderName: undefined,
    });

    if ("error" in fallbackResolution) {
      return { error: fallbackResolution.error };
    }

    return {
      provider: fallbackResolution.provider,
      matchReason: "fallback",
      selectionTime: Date.now() - startedAt
    };
  }
}

/**
 * Record request result for health tracking
 */
export function recordRequestResult(
  context: RoutingIntegrationContext,
  providerId: string,
  responseTime: number,
  isError: boolean
): void {
  try {
    context.healthService.recordRequestResult(providerId, responseTime, isError);
  } catch (error) {
    console.error(`Failed to record request result for provider ${providerId}:`, error);
  }
}

/**
 * Get routing combo assignment for a client route
 */
export async function getClientRouteCombo(
  context: RoutingIntegrationContext,
  clientRoute: ClientRouteKey
): Promise<string | null> {
  try {
    return await context.routingComboRepository.getClientRouteCombo(clientRoute);
  } catch (error) {
    console.error(`Failed to get routing combo for client route ${clientRoute}:`, error);
    return null;
  }
}

/**
 * Assign a routing combo to a client route
 */
export async function assignClientRouteCombo(
  context: RoutingIntegrationContext,
  clientRoute: ClientRouteKey,
  comboId: string
): Promise<boolean> {
  try {
    await context.routingComboRepository.assignClientRouteCombo(clientRoute, comboId);
    return true;
  } catch (error) {
    console.error(`Failed to assign routing combo ${comboId} to client route ${clientRoute}:`, error);
    return false;
  }
}

/**
 * Remove routing combo assignment from a client route
 */
export async function unassignClientRouteCombo(
  context: RoutingIntegrationContext,
  clientRoute: ClientRouteKey
): Promise<boolean> {
  try {
    await context.routingComboRepository.unassignClientRouteCombo(clientRoute);
    return true;
  } catch (error) {
    console.error(`Failed to unassign routing combo from client route ${clientRoute}:`, error);
    return false;
  }
}