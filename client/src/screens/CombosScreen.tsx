// Combos/Routing Screen - Complete routing configuration UI
// Replaces the placeholder with full routing management capabilities

import React, { useState, useMemo } from "react";
import { PageHeader } from "../components/PageHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import { RefreshButton } from "../components/RefreshButton";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { RoutingComboBuilder } from "../components/routing/RoutingComboBuilder";
import { RoutingFlowVisualizer } from "../components/routing/RoutingFlowVisualizer";
import { RoutingSimulator } from "../components/routing/RoutingSimulator";
import {
  ConfigIcon,
  PlusIcon,
  PlayIcon,
  ChartIcon,
  SettingsIcon,
  TestIcon,
  CheckCircleIcon,
  AlertIcon,
  ClockIcon
} from "../components/icons";
import type {
  RoutingCombo,
  RoutingComboInput,
  RoutingSimulationResponse
} from "../features/routing/routingTypes";
import {
  useRoutingCombos,
  useRoutingCombo,
  useRoutingComboOperations,
  useRoutingSimulation,
  useRoutingComboTemplates
} from "../features/routing/routingHooks";
import { useProviders } from "../features/providers/providerHooks";
import { useAutoHealthMonitoring } from "../features/health/healthHooks";

interface CombosScreenProps {
  comboId?: string;
}

export function CombosScreen({ comboId }: CombosScreenProps) {
  const [selectedComboId, setSelectedComboId] = useState<string | null>(comboId || null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [showSimulator, setShowSimulator] = useState(false);
  const [editingCombo, setEditingCombo] = useState<RoutingCombo | null>(null);

  // Auto-start health monitoring for routing decisions
  useAutoHealthMonitoring(true);

  // Fetch routing combos and providers
  const { combos, loading: combosLoading, error: combosError, stats, refresh: refreshCombos } = useRoutingCombos();
  const { combo: selectedCombo, loading: comboLoading } = useRoutingCombo(selectedComboId);
  const { providers, loading: providersLoading } = useProviders();
  const { templates } = useRoutingComboTemplates();

  // Routing operations
  const {
    createCombo,
    updateCombo,
    deleteCombo,
    operationLoading,
    operationError,
    clearError
  } = useRoutingComboOperations();

  // Simulation capabilities
  const {
    simulate,
    getSimulationResult,
    isSimulating,
    clearAllResults
  } = useRoutingSimulation();

  // Event handlers
  const handleCreateCombo = () => {
    setEditingCombo(null);
    setShowBuilder(true);
  };

  const handleEditCombo = (combo: RoutingCombo) => {
    setEditingCombo(combo);
    setShowBuilder(true);
  };

  const handleDeleteCombo = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this routing combo?')) {
      try {
        await deleteCombo(id);
        await refreshCombos();
        if (selectedComboId === id) {
          setSelectedComboId(null);
        }
      } catch (error) {
        console.error('Failed to delete combo:', error);
      }
    }
  };

  const handleSaveCombo = async (input: RoutingComboInput) => {
    try {
      if (editingCombo) {
        await updateCombo(editingCombo.id, input);
      } else {
        await createCombo(input);
      }
      await refreshCombos();
      setShowBuilder(false);
      setEditingCombo(null);
    } catch (error) {
      console.error('Failed to save combo:', error);
    }
  };

  const handleCancelBuilder = () => {
    setShowBuilder(false);
    setEditingCombo(null);
    clearError();
  };

  const handleSelectCombo = (combo: RoutingCombo) => {
    setSelectedComboId(combo.id);
    setShowBuilder(false);
    setShowSimulator(false);
  };

  const handleSimulateRouting = () => {
    setShowSimulator(true);
  };

  const handleRefresh = async () => {
    await refreshCombos();
  };

  // Compute summary statistics
  const summaryStats = useMemo(() => {
    return {
      totalCombos: stats.total,
      activeCombos: stats.active,
      totalClientRoutes: stats.totalClientRoutes,
      averageTiers: Math.round(stats.averageTiersPerCombo * 10) / 10
    };
  }, [stats]);

  // Loading state
  if (combosLoading || providersLoading) {
    return (
      <div className="screen-stack">
        <PageHeader
          icon={ConfigIcon}
          title="Routing Combos"
          description="Configure multi-tier provider routing and fallback chains"
        />
        <LoadingState
          title="Loading routing configuration"
          description="Fetching routing combos and provider data..."
          cards={3}
        />
      </div>
    );
  }

  // Error state
  if (combosError) {
    return (
      <div className="screen-stack">
        <PageHeader
          icon={ConfigIcon}
          title="Routing Combos"
          description="Configure multi-tier provider routing and fallback chains"
        />
        <EmptyState
          title="Failed to load routing combos"
          description={combosError}
          actionLabel="Retry"
          onClick={handleRefresh}
        />
      </div>
    );
  }

  // Builder mode
  if (showBuilder) {
    return (
      <div className="screen-stack">
        <PageHeader
          icon={ConfigIcon}
          title={editingCombo ? "Edit Routing Combo" : "Create Routing Combo"}
          description="Configure multi-tier provider routing with fallback chains"
        />
        <RoutingComboBuilder
          combo={editingCombo}
          providers={providers}
          templates={templates}
          onSave={handleSaveCombo}
          onCancel={handleCancelBuilder}
          loading={operationLoading}
          error={operationError}
        />
      </div>
    );
  }

  // Simulator mode
  if (showSimulator && selectedCombo) {
    return (
      <div className="screen-stack">
        <PageHeader
          icon={TestIcon}
          title="Routing Simulator"
          description="Test and validate routing configurations"
        />
        <RoutingSimulator
          combo={selectedCombo}
          providers={providers}
          onClose={() => setShowSimulator(false)}
          onSimulate={simulate}
          getSimulationResult={getSimulationResult}
          isSimulating={isSimulating}
        />
      </div>
    );
  }

  return (
    <div className="screen-stack">
      <PageHeader
        icon={ConfigIcon}
        title="Routing Combos"
        description="Configure multi-tier provider routing and fallback chains"
        actions={
          <div className="page-actions">
            <RefreshButton onClick={handleRefresh} />
            <button
              className="button-secondary"
              onClick={() => clearAllResults()}
              title="Clear simulation results"
            >
              Clear Results
            </button>
            <button className="button-primary" onClick={handleCreateCombo}>
              <PlusIcon className="button-icon" />
              Create Combo
            </button>
          </div>
        }
      />

      <div className="combos-screen-layout">
        {/* Summary Stats */}
        <div className="combos-stats-row">
          <StatCard
            title="Total Combos"
            value={summaryStats.totalCombos.toString()}
            caption="Routing configurations"
          />
          <StatCard
            title="Active Combos"
            value={summaryStats.activeCombos.toString()}
            caption="Currently enabled"
            trend={summaryStats.activeCombos > 0 ? "up" : "neutral"}
          />
          <StatCard
            title="Client Routes"
            value={summaryStats.totalClientRoutes.toString()}
            caption="Routes configured"
            trend={summaryStats.totalClientRoutes > 0 ? "up" : "neutral"}
          />
          <StatCard
            title="Avg Tiers"
            value={summaryStats.averageTiers.toString()}
            caption="Per combo"
            trend="neutral"
          />
        </div>

        <div className="combos-main-layout">
          {/* Combos List */}
          <div className="combos-list-section">
            <SurfaceCard
              title="Routing Combos"
              description="Manage your routing configurations"
              badge={combos.length > 0 ? combos.length.toString() : undefined}
              actions={
                <button className="button-secondary button-sm" onClick={handleCreateCombo}>
                  <PlusIcon className="button-icon" />
                  New
                </button>
              }
            >
              {combos.length === 0 ? (
                <EmptyState
                  title="No routing combos"
                  description="Create your first routing combo to configure multi-tier provider fallback chains."
                  actionLabel="Create Combo"
                  onClick={handleCreateCombo}
                />
              ) : (
                <div className="combos-list">
                  {combos.map(combo => (
                    <ComboCard
                      key={combo.id}
                      combo={combo}
                      isSelected={selectedComboId === combo.id}
                      onSelect={() => handleSelectCombo(combo)}
                      onEdit={() => handleEditCombo(combo)}
                      onDelete={() => handleDeleteCombo(combo.id)}
                      onSimulate={() => {
                        setSelectedComboId(combo.id);
                        setShowSimulator(true);
                      }}
                    />
                  ))}
                </div>
              )}
            </SurfaceCard>
          </div>

          {/* Combo Detail */}
          <div className="combo-detail-section">
            {selectedCombo ? (
              <>
                <ComboDetailCard
                  combo={selectedCombo}
                  providers={providers}
                  onEdit={() => handleEditCombo(selectedCombo)}
                  onSimulate={handleSimulateRouting}
                />
                <RoutingFlowVisualizer
                  combo={selectedCombo}
                  providers={providers}
                  simulationResult={getSimulationResult(selectedCombo.id, 'chat')}
                />
              </>
            ) : (
              <EmptyState
                title="Select a routing combo"
                description="Choose a routing combo from the list to view its configuration and test routing decisions."
                actionLabel="Create New Combo"
                onClick={handleCreateCombo}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Combo card component
interface ComboCardProps {
  combo: RoutingCombo;
  isSelected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSimulate: () => void;
}

function ComboCard({ combo, isSelected, onSelect, onEdit, onDelete, onSimulate }: ComboCardProps) {
  return (
    <div className={`combo-card ${isSelected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="combo-card-header">
        <div className="combo-info">
          <div className="combo-name-row">
            <h3 className="combo-name">{combo.name}</h3>
            <div className="combo-badges">
              {combo.isDefault && (
                <StatusBadge variant="accent" size="xs">
                  Default
                </StatusBadge>
              )}
              <StatusBadge
                variant={combo.isActive ? "success" : "neutral"}
                size="xs"
              >
                {combo.isActive ? "Active" : "Inactive"}
              </StatusBadge>
            </div>
          </div>
          {combo.description && (
            <div className="combo-description">{combo.description}</div>
          )}
        </div>
      </div>

      <div className="combo-card-body">
        <div className="combo-stats">
          <div className="combo-stat">
            <span className="stat-label">Tiers</span>
            <span className="stat-value">{combo.tiers.length}</span>
          </div>
          <div className="combo-stat">
            <span className="stat-label">Providers</span>
            <span className="stat-value">
              {combo.tiers.reduce((sum, tier) => sum + tier.providers.length, 0)}
            </span>
          </div>
          <div className="combo-stat">
            <span className="stat-label">Routes</span>
            <span className="stat-value">{combo.clientRoutes.length}</span>
          </div>
        </div>

        <div className="combo-tiers-preview">
          {combo.tiers.slice(0, 3).map((tier, index) => (
            <div key={tier.id} className="tier-preview">
              <StatusBadge variant="neutral" size="xs">
                {tier.name}
              </StatusBadge>
              <span className="tier-provider-count">
                {tier.providers.length}p
              </span>
            </div>
          ))}
          {combo.tiers.length > 3 && (
            <span className="tier-more">+{combo.tiers.length - 3} more</span>
          )}
        </div>
      </div>

      <div className="combo-card-actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="button-secondary button-sm"
          onClick={onSimulate}
          title="Test routing"
        >
          <TestIcon className="button-icon" />
        </button>
        <button
          className="button-secondary button-sm"
          onClick={onEdit}
          title="Edit combo"
        >
          <SettingsIcon className="button-icon" />
        </button>
        {!combo.isDefault && (
          <button
            className="button-danger button-sm"
            onClick={onDelete}
            title="Delete combo"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}

// Combo detail card component
interface ComboDetailCardProps {
  combo: RoutingCombo;
  providers: any[];
  onEdit: () => void;
  onSimulate: () => void;
}

function ComboDetailCard({ combo, providers, onEdit, onSimulate }: ComboDetailCardProps) {
  const enabledTiers = combo.tiers.filter(tier => tier.isEnabled);
  const totalProviders = combo.tiers.reduce((sum, tier) => sum + tier.providers.length, 0);

  return (
    <SurfaceCard
      title={combo.name}
      description={combo.description || "Routing combo configuration"}
      badge={combo.isActive ? "Active" : "Inactive"}
      actions={
        <div className="combo-detail-actions">
          <button className="button-secondary button-sm" onClick={onSimulate}>
            <TestIcon className="button-icon" />
            Test
          </button>
          <button className="button-secondary button-sm" onClick={onEdit}>
            <SettingsIcon className="button-icon" />
            Edit
          </button>
        </div>
      }
    >
      <div className="combo-detail-content">
        {/* Combo Overview */}
        <div className="combo-overview">
          <div className="overview-stats">
            <div className="overview-stat">
              <span className="stat-label">Total Tiers</span>
              <span className="stat-value">{combo.tiers.length}</span>
            </div>
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
              <span className="stat-value">{combo.clientRoutes.length}</span>
            </div>
          </div>

          {/* Policies Summary */}
          <div className="policies-summary">
            <h4>Routing Policies</h4>
            <div className="policy-items">
              <div className="policy-item">
                <span className="policy-label">Load Balancing</span>
                <StatusBadge variant="neutral" size="xs">
                  {combo.policies.loadBalancing.replace('_', ' ')}
                </StatusBadge>
              </div>
              <div className="policy-item">
                <span className="policy-label">Failover Strategy</span>
                <StatusBadge variant="neutral" size="xs">
                  {combo.policies.failoverStrategy.replace('_', ' ')}
                </StatusBadge>
              </div>
              <div className="policy-item">
                <span className="policy-label">Token Budget</span>
                <StatusBadge variant="neutral" size="xs">
                  {combo.policies.tokenBudgetMode.replace('_', ' ')}
                </StatusBadge>
              </div>
            </div>
          </div>
        </div>

        {/* Tiers List */}
        <div className="combo-tiers-detail">
          <h4>Routing Tiers</h4>
          <div className="tiers-list">
            {combo.tiers
              .sort((a, b) => a.priority - b.priority)
              .map((tier, index) => (
                <div key={tier.id} className="tier-detail-item">
                  <div className="tier-header">
                    <div className="tier-info">
                      <span className="tier-priority">#{tier.priority}</span>
                      <span className="tier-name">{tier.name}</span>
                      <StatusBadge
                        variant={tier.isEnabled ? "success" : "neutral"}
                        size="xs"
                      >
                        {tier.isEnabled ? "Enabled" : "Disabled"}
                      </StatusBadge>
                    </div>
                    <div className="tier-stats">
                      <span className="tier-stat">
                        {tier.providers.length} provider{tier.providers.length !== 1 ? 's' : ''}
                      </span>
                      {tier.fallbackDelay && (
                        <span className="tier-stat">
                          {tier.fallbackDelay}ms delay
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="tier-providers">
                    {tier.providers.map((provider, pIndex) => {
                      const providerInfo = providers.find(p => p.id === provider.providerId);
                      return (
                        <div key={pIndex} className="provider-item">
                          <span className="provider-name">
                            {providerInfo?.displayName || provider.providerId}
                          </span>
                          <span className="provider-weight">{provider.weight}%</span>
                          {!provider.isEnabled && (
                            <StatusBadge variant="neutral" size="xs">
                              Disabled
                            </StatusBadge>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Client Routes */}
        {combo.clientRoutes.length > 0 && (
          <div className="combo-client-routes">
            <h4>Assigned Client Routes</h4>
            <div className="client-routes-list">
              {combo.clientRoutes.map(route => (
                <StatusBadge key={route} variant="accent" size="sm">
                  {route}
                </StatusBadge>
              ))}
            </div>
          </div>
        )}
      </div>
    </SurfaceCard>
  );
}