// React hooks for routing management
import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  RoutingCombo,
  RoutingComboInput,
  RoutingSimulationRequest,
  RoutingSimulationResponse,
  RoutingComboTemplate,
  ValidationResult,
  RoutingTier,
  ProviderBinding
} from "./routingTypes";
import type { Provider } from "../providers/providerTypes";
import {
  fetchRoutingCombos,
  fetchRoutingCombo,
  createRoutingCombo,
  updateRoutingCombo,
  deleteRoutingCombo,
  simulateRouting,
  validateRoutingCombo,
  getRoutingTemplates
} from "./routingApi";

// Hook for managing routing combos
export function useRoutingCombos() {
  const [combos, setCombos] = useState<RoutingCombo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadCombos = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchRoutingCombos();
      setCombos(data);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load routing combos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCombos();
  }, [loadCombos]);

  const refresh = useCallback(async () => {
    await loadCombos();
  }, [loadCombos]);

  // Combo statistics
  const stats = useMemo(() => {
    const total = combos.length;
    const active = combos.filter(combo => combo.isActive).length;
    const defaultCombo = combos.find(combo => combo.isDefault);
    const totalClientRoutes = combos.reduce((sum, combo) => sum + combo.clientRoutes.length, 0);

    return {
      total,
      active,
      inactive: total - active,
      defaultComboId: defaultCombo?.id,
      totalClientRoutes,
      averageTiersPerCombo: total > 0 ? combos.reduce((sum, combo) => sum + combo.tiers.length, 0) / total : 0
    };
  }, [combos]);

  return {
    combos,
    loading,
    error,
    lastRefresh,
    stats,
    refresh
  };
}

// Hook for managing a single routing combo
export function useRoutingCombo(id: string | null) {
  const [combo, setCombo] = useState<RoutingCombo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCombo = useCallback(async () => {
    if (!id) {
      setCombo(null);
      setLoading(false);
      setError(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const data = await fetchRoutingCombo(id);
      setCombo(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load routing combo');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadCombo();
  }, [loadCombo]);

  const refresh = useCallback(async () => {
    await loadCombo();
  }, [loadCombo]);

  return {
    combo,
    loading,
    error,
    refresh
  };
}

// Hook for routing combo operations (create, update, delete)
export function useRoutingComboOperations() {
  const [operationLoading, setOperationLoading] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

  const createCombo = useCallback(async (input: RoutingComboInput) => {
    try {
      setOperationLoading(true);
      setOperationError(null);
      const newCombo = await createRoutingCombo(input);
      return newCombo;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create routing combo';
      setOperationError(errorMessage);
      throw err;
    } finally {
      setOperationLoading(false);
    }
  }, []);

  const updateCombo = useCallback(async (id: string, input: RoutingComboInput) => {
    try {
      setOperationLoading(true);
      setOperationError(null);
      const updatedCombo = await updateRoutingCombo(id, input);
      return updatedCombo;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update routing combo';
      setOperationError(errorMessage);
      throw err;
    } finally {
      setOperationLoading(false);
    }
  }, []);

  const deleteCombo = useCallback(async (id: string) => {
    try {
      setOperationLoading(true);
      setOperationError(null);
      await deleteRoutingCombo(id);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete routing combo';
      setOperationError(errorMessage);
      throw err;
    } finally {
      setOperationLoading(false);
    }
  }, []);

  const clearError = useCallback(() => {
    setOperationError(null);
  }, []);

  return {
    createCombo,
    updateCombo,
    deleteCombo,
    operationLoading,
    operationError,
    clearError
  };
}

// Hook for routing simulation
export function useRoutingSimulation() {
  const [simulationResults, setSimulationResults] = useState<Map<string, RoutingSimulationResponse>>(new Map());
  const [simulating, setSimulating] = useState<Set<string>>(new Set());

  const simulate = useCallback(async (request: RoutingSimulationRequest) => {
    const requestKey = `${request.comboId}-${request.requestType}-${request.model || 'default'}`;

    if (simulating.has(requestKey)) return;

    try {
      setSimulating(prev => new Set(prev).add(requestKey));
      const result = await simulateRouting(request);
      setSimulationResults(prev => new Map(prev).set(requestKey, result));
      return result;
    } catch (err) {
      console.error('Routing simulation failed:', err);
      throw err;
    } finally {
      setSimulating(prev => {
        const newSet = new Set(prev);
        newSet.delete(requestKey);
        return newSet;
      });
    }
  }, [simulating]);

  const getSimulationResult = useCallback((comboId: string, requestType: string, model?: string) => {
    const requestKey = `${comboId}-${requestType}-${model || 'default'}`;
    return simulationResults.get(requestKey);
  }, [simulationResults]);

  const isSimulating = useCallback((comboId: string, requestType: string, model?: string) => {
    const requestKey = `${comboId}-${requestType}-${model || 'default'}`;
    return simulating.has(requestKey);
  }, [simulating]);

  const clearSimulationResult = useCallback((comboId: string, requestType: string, model?: string) => {
    const requestKey = `${comboId}-${requestType}-${model || 'default'}`;
    setSimulationResults(prev => {
      const newMap = new Map(prev);
      newMap.delete(requestKey);
      return newMap;
    });
  }, []);

  const clearAllResults = useCallback(() => {
    setSimulationResults(new Map());
  }, []);

  return {
    simulate,
    getSimulationResult,
    isSimulating,
    clearSimulationResult,
    clearAllResults,
    hasResults: simulationResults.size > 0
  };
}

// Hook for routing combo validation
export function useRoutingComboValidation() {
  const [validationResults, setValidationResults] = useState<Map<string, ValidationResult>>(new Map());
  const [validating, setValidating] = useState<Set<string>>(new Set());

  const validate = useCallback(async (combo: RoutingComboInput, key?: string) => {
    const validationKey = key || `validation-${Date.now()}`;

    if (validating.has(validationKey)) return;

    try {
      setValidating(prev => new Set(prev).add(validationKey));
      const result = await validateRoutingCombo(combo);
      setValidationResults(prev => new Map(prev).set(validationKey, result));
      return result;
    } catch (err) {
      console.error('Validation failed:', err);
      throw err;
    } finally {
      setValidating(prev => {
        const newSet = new Set(prev);
        newSet.delete(validationKey);
        return newSet;
      });
    }
  }, [validating]);

  const getValidationResult = useCallback((key: string) => {
    return validationResults.get(key);
  }, [validationResults]);

  const isValidating = useCallback((key: string) => {
    return validating.has(key);
  }, [validating]);

  const clearValidationResult = useCallback((key: string) => {
    setValidationResults(prev => {
      const newMap = new Map(prev);
      newMap.delete(key);
      return newMap;
    });
  }, []);

  return {
    validate,
    getValidationResult,
    isValidating,
    clearValidationResult
  };
}

// Hook for routing combo templates
export function useRoutingComboTemplates() {
  const [templates, setTemplates] = useState<RoutingComboTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getRoutingTemplates();
      setTemplates(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load routing templates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const getTemplatesByCategory = useCallback((category?: string) => {
    if (!category) return templates;
    return templates.filter(template => template.category === category);
  }, [templates]);

  const getTemplateById = useCallback((id: string) => {
    return templates.find(template => template.id === id);
  }, [templates]);

  return {
    templates,
    loading,
    error,
    getTemplatesByCategory,
    getTemplateById,
    refresh: loadTemplates
  };
}

// Hook for routing combo builder state management
export function useRoutingComboBuilder(initialCombo?: RoutingCombo) {
  const [combo, setCombo] = useState<RoutingComboInput>(() => {
    if (initialCombo) {
      return {
        name: initialCombo.name,
        description: initialCombo.description,
        clientRoutes: initialCombo.clientRoutes,
        tiers: initialCombo.tiers.map(tier => ({
          name: tier.name,
          tier: tier.tier,
          providers: tier.providers.map(provider => ({
            providerId: provider.providerId,
            weight: provider.weight,
            modelOverride: provider.modelOverride,
            isEnabled: provider.isEnabled,
            conditions: provider.conditions || [],
            costMultiplier: provider.costMultiplier,
            maxConcurrency: provider.maxConcurrency
          })),
          healthThreshold: tier.healthThreshold,
          fallbackDelay: tier.fallbackDelay,
          maxRetries: tier.maxRetries,
          isEnabled: tier.isEnabled,
          priority: tier.priority
        })),
        policies: initialCombo.policies,
        isActive: initialCombo.isActive,
        isDefault: initialCombo.isDefault
      };
    }

    return {
      name: '',
      description: '',
      clientRoutes: [],
      tiers: [],
      policies: {
        loadBalancing: 'health_based',
        failoverStrategy: 'delayed',
        tokenBudgetMode: 'per_route'
      },
      isActive: true,
      isDefault: false
    };
  });

  const [isDirty, setIsDirty] = useState(false);

  const updateCombo = useCallback((updates: Partial<RoutingComboInput>) => {
    setCombo(prev => ({ ...prev, ...updates }));
    setIsDirty(true);
  }, []);

  const updateTier = useCallback((tierIndex: number, updates: Partial<RoutingTier>) => {
    setCombo(prev => ({
      ...prev,
      tiers: prev.tiers.map((tier, index) =>
        index === tierIndex ? { ...tier, ...updates } : tier
      )
    }));
    setIsDirty(true);
  }, []);

  const addTier = useCallback((tier: Omit<RoutingTier, 'id'>) => {
    setCombo(prev => ({
      ...prev,
      tiers: [...prev.tiers, { ...tier, id: `tier-${Date.now()}` }]
    }));
    setIsDirty(true);
  }, []);

  const removeTier = useCallback((tierIndex: number) => {
    setCombo(prev => ({
      ...prev,
      tiers: prev.tiers.filter((_, index) => index !== tierIndex)
    }));
    setIsDirty(true);
  }, []);

  const updateProviderInTier = useCallback((tierIndex: number, providerIndex: number, updates: Partial<ProviderBinding>) => {
    setCombo(prev => ({
      ...prev,
      tiers: prev.tiers.map((tier, tIndex) =>
        tIndex === tierIndex
          ? {
              ...tier,
              providers: tier.providers.map((provider, pIndex) =>
                pIndex === providerIndex ? { ...provider, ...updates } : provider
              )
            }
          : tier
      )
    }));
    setIsDirty(true);
  }, []);

  const addProviderToTier = useCallback((tierIndex: number, provider: ProviderBinding) => {
    setCombo(prev => ({
      ...prev,
      tiers: prev.tiers.map((tier, index) =>
        index === tierIndex
          ? { ...tier, providers: [...tier.providers, provider] }
          : tier
      )
    }));
    setIsDirty(true);
  }, []);

  const removeProviderFromTier = useCallback((tierIndex: number, providerIndex: number) => {
    setCombo(prev => ({
      ...prev,
      tiers: prev.tiers.map((tier, tIndex) =>
        tIndex === tierIndex
          ? { ...tier, providers: tier.providers.filter((_, pIndex) => pIndex !== providerIndex) }
          : tier
      )
    }));
    setIsDirty(true);
  }, []);

  const resetCombo = useCallback(() => {
    if (initialCombo) {
      setCombo({
        name: initialCombo.name,
        description: initialCombo.description,
        clientRoutes: initialCombo.clientRoutes,
        tiers: initialCombo.tiers.map(tier => ({
          name: tier.name,
          tier: tier.tier,
          providers: tier.providers.map(provider => ({
            providerId: provider.providerId,
            weight: provider.weight,
            modelOverride: provider.modelOverride,
            isEnabled: provider.isEnabled,
            conditions: provider.conditions || [],
            costMultiplier: provider.costMultiplier,
            maxConcurrency: provider.maxConcurrency
          })),
          healthThreshold: tier.healthThreshold,
          fallbackDelay: tier.fallbackDelay,
          maxRetries: tier.maxRetries,
          isEnabled: tier.isEnabled,
          priority: tier.priority
        })),
        policies: initialCombo.policies,
        isActive: initialCombo.isActive,
        isDefault: initialCombo.isDefault
      });
    }
    setIsDirty(false);
  }, [initialCombo]);

  const loadFromTemplate = useCallback((template: RoutingComboTemplate) => {
    setCombo({
      ...template.template,
      name: template.name,
      description: template.description
    });
    setIsDirty(true);
  }, []);

  return {
    combo,
    isDirty,
    updateCombo,
    updateTier,
    addTier,
    removeTier,
    updateProviderInTier,
    addProviderToTier,
    removeProviderFromTier,
    resetCombo,
    loadFromTemplate
  };
}

// Hook for provider selection and filtering for routing
export function useProvidersForRouting(providers: Provider[]) {
  const providersByTier = useMemo(() => {
    const grouped = {
      subscription: [] as Provider[],
      cheap: [] as Provider[],
      free: [] as Provider[],
      custom: [] as Provider[]
    };

    providers.forEach(provider => {
      grouped[provider.tier].push(provider);
    });

    return grouped;
  }, [providers]);

  const availableProviders = useMemo(() => {
    return providers.filter(provider => provider.enabled && provider.configured);
  }, [providers]);

  const healthyProviders = useMemo(() => {
    return providers.filter(provider =>
      provider.healthStatus === 'healthy' || provider.healthStatus === 'degraded'
    );
  }, [providers]);

  const getProvidersForTier = useCallback((tier: string) => {
    return providersByTier[tier as keyof typeof providersByTier] || [];
  }, [providersByTier]);

  const getProviderById = useCallback((id: string) => {
    return providers.find(provider => provider.id === id);
  }, [providers]);

  return {
    providersByTier,
    availableProviders,
    healthyProviders,
    getProvidersForTier,
    getProviderById
  };
}