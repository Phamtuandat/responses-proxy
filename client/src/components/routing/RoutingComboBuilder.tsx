// Routing Combo Builder Component
// Visual interface for configuring multi-tier routing with drag-and-drop capabilities

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { validateRoutingCombo } from "../../features/routing/routingApi";
import { SurfaceCard } from "../SurfaceCard";
import { StatusBadge } from "../StatusBadge";
import { LoadingState } from "../LoadingState";
import { EmptyState } from "../EmptyState";
import { TierConfigPanel } from "./TierConfigPanel";
import { RoutingPoliciesPanel } from "./RoutingPoliciesPanel";
import { ProviderSelectionMatrix } from "./ProviderSelectionMatrix";
import {
  PlusIcon,
  TrashIcon,
  DragIcon,
  CheckCircleIcon,
  AlertIcon,
  SettingsIcon,
  TemplateIcon,
  SaveIcon,
  CancelIcon
} from "../icons";
import type {
  RoutingCombo,
  RoutingComboInput,
  RoutingTier,
  RoutingComboTemplate,
  ValidationResult,
  ProviderBinding
} from "../../features/routing/routingTypes";
import type { Provider } from "../../features/providers/providerTypes";
import {
  useRoutingComboBuilder,
  useRoutingComboValidation,
  useProvidersForRouting
} from "../../features/routing/routingHooks";

interface RoutingComboBuilderProps {
  combo?: RoutingCombo | null;
  providers: Provider[];
  templates: RoutingComboTemplate[];
  onSave: (combo: RoutingComboInput) => Promise<void>;
  onCancel: () => void;
  loading?: boolean;
  error?: string | null;
}

export function RoutingComboBuilder({
  combo,
  providers,
  templates,
  onSave,
  onCancel,
  loading = false,
  error = null
}: RoutingComboBuilderProps) {
  const [activeTab, setActiveTab] = useState<'basic' | 'tiers' | 'policies' | 'validation'>('basic');
  const [showTemplates, setShowTemplates] = useState(false);
  const [validationKey, setValidationKey] = useState<string>('validation-current');

  // Routing combo builder state
  const {
    combo: builderCombo,
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
  } = useRoutingComboBuilder(combo);

  // Validation (fully synchronous using pure function to avoid state-based infinite loops)
  const validationResult = useMemo(() => {
    return validateRoutingCombo(builderCombo);
  }, [builderCombo]);

  const isValidating = useCallback((key: string) => false, []);

  // Provider utilities
  const {
    providersByTier,
    availableProviders,
    healthyProviders,
    getProvidersForTier,
    getProviderById
  } = useProvidersForRouting(providers);

  // Event handlers
  const handleSave = useCallback(async () => {
    try {
      await onSave(builderCombo);
    } catch (err) {
      console.error('Failed to save combo:', err);
    }
  }, [builderCombo, onSave]);

  const handleCancel = useCallback(() => {
    if (isDirty) {
      if (window.confirm('You have unsaved changes. Are you sure you want to cancel?')) {
        onCancel();
      }
    } else {
      onCancel();
    }
  }, [isDirty, onCancel]);

  const handleLoadTemplate = useCallback((template: RoutingComboTemplate) => {
    loadFromTemplate(template);
    setShowTemplates(false);
    setActiveTab('tiers');
  }, [loadFromTemplate]);

  const handleAddTier = useCallback(() => {
    const newTier: Omit<RoutingTier, 'id'> = {
      name: `Tier ${builderCombo.tiers.length + 1}`,
      tier: 'custom',
      providers: [],
      healthThreshold: ['healthy'],
      fallbackDelay: 1000,
      maxRetries: 2,
      isEnabled: true,
      priority: builderCombo.tiers.length + 1
    };
    addTier(newTier);
  }, [builderCombo.tiers.length, addTier]);

  const handleRemoveTier = useCallback((tierIndex: number) => {
    if (window.confirm('Are you sure you want to remove this tier?')) {
      removeTier(tierIndex);
    }
  }, [removeTier]);

  const handleAddProviderToTier = useCallback((tierIndex: number, providerId: string) => {
    const provider = getProviderById(providerId);
    if (!provider) return;

    const tier = builderCombo.tiers[tierIndex];
    const existingProvider = tier.providers.find(p => p.providerId === providerId);
    if (existingProvider) return; // Already added

    const newProvider: ProviderBinding = {
      providerId,
      weight: Math.max(1, Math.floor(100 / (tier.providers.length + 1))),
      isEnabled: true,
      conditions: []
    };

    // Rebalance weights
    const updatedProviders = [...tier.providers, newProvider];
    const equalWeight = Math.floor(100 / updatedProviders.length);
    const remainder = 100 - (equalWeight * updatedProviders.length);

    updatedProviders.forEach((provider, index) => {
      provider.weight = equalWeight + (index < remainder ? 1 : 0);
    });

    updateTier(tierIndex, { providers: updatedProviders });
  }, [builderCombo.tiers, getProviderById, updateTier]);

  const canSave = validationResult?.isValid && !loading && isDirty;

  return (
    <div className="routing-combo-builder">
      {/* Builder Header */}
      <div className="builder-header">
        <div className="builder-tabs">
          <button
            className={`tab-button ${activeTab === 'basic' ? 'active' : ''}`}
            onClick={() => setActiveTab('basic')}
          >
            Basic Info
          </button>
          <button
            className={`tab-button ${activeTab === 'tiers' ? 'active' : ''}`}
            onClick={() => setActiveTab('tiers')}
          >
            Tiers ({builderCombo.tiers.length})
          </button>
          <button
            className={`tab-button ${activeTab === 'policies' ? 'active' : ''}`}
            onClick={() => setActiveTab('policies')}
          >
            Policies
          </button>
          <button
            className={`tab-button ${activeTab === 'validation' ? 'active' : ''}`}
            onClick={() => setActiveTab('validation')}
          >
            Validation
            {validationResult && !validationResult.isValid && (
              <span className="validation-indicator error">!</span>
            )}
          </button>
        </div>

        <div className="builder-actions">
          <button
            className="button-secondary"
            onClick={() => setShowTemplates(true)}
            disabled={loading}
          >
            <TemplateIcon className="button-icon" />
            Templates
          </button>
          <button
            className="button-secondary"
            onClick={resetCombo}
            disabled={loading || !isDirty}
          >
            Reset
          </button>
          <button
            className="button-secondary"
            onClick={handleCancel}
            disabled={loading}
          >
            <CancelIcon className="button-icon" />
            Cancel
          </button>
          <button
            className="button-primary"
            onClick={handleSave}
            disabled={!canSave}
          >
            <SaveIcon className="button-icon" />
            {loading ? 'Saving...' : 'Save Combo'}
          </button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="builder-error">
          <AlertIcon className="error-icon" />
          <span>{error}</span>
        </div>
      )}

      {/* Tab Content */}
      <div className="builder-content">
        {activeTab === 'basic' && (
          <BasicInfoPanel
            combo={builderCombo}
            onChange={updateCombo}
            providers={providers}
          />
        )}

        {activeTab === 'tiers' && (
          <TiersPanel
            combo={builderCombo}
            providers={providers}
            providersByTier={providersByTier}
            onUpdateTier={updateTier}
            onAddTier={handleAddTier}
            onRemoveTier={handleRemoveTier}
            onAddProviderToTier={handleAddProviderToTier}
            onUpdateProviderInTier={updateProviderInTier}
            onRemoveProviderFromTier={removeProviderFromTier}
          />
        )}

        {activeTab === 'policies' && (
          <RoutingPoliciesPanel
            policies={builderCombo.policies}
            onChange={(policies) => updateCombo({ policies })}
          />
        )}

        {activeTab === 'validation' && (
          <ValidationPanel
            validationResult={validationResult}
            isValidating={isValidating(validationKey)}
            combo={builderCombo}
          />
        )}
      </div>

      {/* Templates Modal */}
      {showTemplates && (
        <TemplatesModal
          templates={templates}
          onSelect={handleLoadTemplate}
          onClose={() => setShowTemplates(false)}
        />
      )}
    </div>
  );
}

// Basic info panel
interface BasicInfoPanelProps {
  combo: RoutingComboInput;
  onChange: (updates: Partial<RoutingComboInput>) => void;
  providers: Provider[];
}

function BasicInfoPanel({ combo, onChange, providers }: BasicInfoPanelProps) {
  return (
    <div className="basic-info-panel">
      <SurfaceCard title="Basic Information" description="Configure combo name and description">
        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="comboName">Combo Name *</label>
            <input
              id="comboName"
              type="text"
              className="form-input"
              value={combo.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="Enter combo name..."
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="comboDescription">Description</label>
            <textarea
              id="comboDescription"
              className="form-textarea"
              value={combo.description || ''}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="Describe this routing configuration..."
              rows={3}
            />
          </div>

          <div className="form-group">
            <div className="checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={combo.isActive}
                  onChange={(e) => onChange({ isActive: e.target.checked })}
                />
                <span className="checkbox-text">Active</span>
              </label>
              <div className="checkbox-description">
                Enable this routing combo for request routing
              </div>
            </div>
          </div>

          <div className="form-group">
            <div className="checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={combo.isDefault}
                  onChange={(e) => onChange({ isDefault: e.target.checked })}
                />
                <span className="checkbox-text">Default Combo</span>
              </label>
              <div className="checkbox-description">
                Use this combo for unbound client routes
              </div>
            </div>
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard title="Client Routes" description="Assign client routes to this combo">
        <div className="client-routes-section">
          <div className="form-group">
            <label htmlFor="clientRoutes">Client Routes (comma-separated)</label>
            <input
              id="clientRoutes"
              type="text"
              className="form-input"
              value={combo.clientRoutes?.join(', ') || ''}
              onChange={(e) => {
                const routes = e.target.value
                  .split(',')
                  .map(route => route.trim())
                  .filter(route => route.length > 0);
                onChange({ clientRoutes: routes });
              }}
              placeholder="default, hermes, codex..."
            />
          </div>
          <div className="client-routes-help">
            <p>Specify which client routes should use this routing combo. Leave empty to use as default for unbound routes.</p>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}

// Tiers panel
interface TiersPanelProps {
  combo: RoutingComboInput;
  providers: Provider[];
  providersByTier: Record<string, Provider[]>;
  onUpdateTier: (tierIndex: number, updates: Partial<RoutingTier>) => void;
  onAddTier: () => void;
  onRemoveTier: (tierIndex: number) => void;
  onAddProviderToTier: (tierIndex: number, providerId: string) => void;
  onUpdateProviderInTier: (tierIndex: number, providerIndex: number, updates: Partial<ProviderBinding>) => void;
  onRemoveProviderFromTier: (tierIndex: number, providerIndex: number) => void;
}

function TiersPanel({
  combo,
  providers,
  providersByTier,
  onUpdateTier,
  onAddTier,
  onRemoveTier,
  onAddProviderToTier,
  onUpdateProviderInTier,
  onRemoveProviderFromTier
}: TiersPanelProps) {
  return (
    <div className="tiers-panel">
      <SurfaceCard
        title="Routing Tiers"
        description="Configure multi-tier provider fallback chains"
        actions={
          <button className="button-primary button-sm" onClick={onAddTier}>
            <PlusIcon className="button-icon" />
            Add Tier
          </button>
        }
      >
        {combo.tiers.length === 0 ? (
          <EmptyState
            title="No tiers configured"
            description="Add your first routing tier to configure provider fallback chains."
            actionLabel="Add Tier"
            onClick={onAddTier}
          />
        ) : (
          <div className="tiers-list">
            {combo.tiers
              .sort((a, b) => a.priority - b.priority)
              .map((tier, index) => (
                <TierConfigPanel
                  key={tier.id || index}
                  tier={tier}
                  tierIndex={index}
                  providers={providers}
                  availableProviders={providersByTier[tier.tier] || []}
                  onUpdateTier={(updates) => onUpdateTier(index, updates)}
                  onRemoveTier={() => onRemoveTier(index)}
                  onAddProvider={(providerId) => onAddProviderToTier(index, providerId)}
                  onUpdateProvider={(providerIndex, updates) => onUpdateProviderInTier(index, providerIndex, updates)}
                  onRemoveProvider={(providerIndex) => onRemoveProviderFromTier(index, providerIndex)}
                />
              ))}
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}

// Validation panel
interface ValidationPanelProps {
  validationResult: ValidationResult | undefined;
  isValidating: boolean;
  combo: RoutingComboInput;
}

function ValidationPanel({ validationResult, isValidating, combo }: ValidationPanelProps) {
  if (isValidating) {
    return (
      <div className="validation-panel">
        <LoadingState
          title="Validating configuration"
          description="Checking routing combo for errors and warnings..."
          cards={1}
        />
      </div>
    );
  }

  if (!validationResult) {
    return (
      <div className="validation-panel">
        <EmptyState
          title="No validation results"
          description="Validation will run automatically as you configure the combo."
        />
      </div>
    );
  }

  return (
    <div className="validation-panel">
      <SurfaceCard
        title="Validation Results"
        description="Configuration validation and recommendations"
        badge={validationResult.isValid ? "Valid" : "Invalid"}
      >
        <div className="validation-content">
          {/* Overall Status */}
          <div className="validation-status">
            <div className="status-indicator">
              {validationResult.isValid ? (
                <CheckCircleIcon className="status-icon status-success" />
              ) : (
                <AlertIcon className="status-icon status-error" />
              )}
            </div>
            <div className="status-text">
              <div className="status-title">
                {validationResult.isValid ? 'Configuration Valid' : 'Configuration Invalid'}
              </div>
              <div className="status-summary">
                {validationResult.errors.length} error(s), {validationResult.warnings.length} warning(s)
              </div>
            </div>
          </div>

          {/* Errors */}
          {validationResult.errors.length > 0 && (
            <div className="validation-section">
              <h4 className="section-title error">Errors</h4>
              <div className="validation-items">
                {validationResult.errors.map((error, index) => (
                  <div key={index} className="validation-item error">
                    <AlertIcon className="item-icon" />
                    <div className="item-content">
                      <div className="item-message">{error.message}</div>
                      <div className="item-field">Field: {error.field}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {validationResult.warnings.length > 0 && (
            <div className="validation-section">
              <h4 className="section-title warning">Warnings</h4>
              <div className="validation-items">
                {validationResult.warnings.map((warning, index) => (
                  <div key={index} className="validation-item warning">
                    <AlertIcon className="item-icon" />
                    <div className="item-content">
                      <div className="item-message">{warning.message}</div>
                      <div className="item-field">Field: {warning.field}</div>
                      {warning.suggestion && (
                        <div className="item-suggestion">Suggestion: {warning.suggestion}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Configuration Summary */}
          <div className="validation-section">
            <h4 className="section-title">Configuration Summary</h4>
            <div className="config-summary">
              <div className="summary-item">
                <span className="summary-label">Total Tiers:</span>
                <span className="summary-value">{combo.tiers.length}</span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Total Providers:</span>
                <span className="summary-value">
                  {combo.tiers.reduce((sum, tier) => sum + tier.providers.length, 0)}
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Enabled Tiers:</span>
                <span className="summary-value">
                  {combo.tiers.filter(tier => tier.isEnabled).length}
                </span>
              </div>
              <div className="summary-item">
                <span className="summary-label">Client Routes:</span>
                <span className="summary-value">{combo.clientRoutes?.length || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}

// Templates modal
interface TemplatesModalProps {
  templates: RoutingComboTemplate[];
  onSelect: (template: RoutingComboTemplate) => void;
  onClose: () => void;
}

function TemplatesModal({ templates, onSelect, onClose }: TemplatesModalProps) {
  const templatesByCategory = templates.reduce((acc, template) => {
    if (!acc[template.category]) {
      acc[template.category] = [];
    }
    acc[template.category].push(template);
    return acc;
  }, {} as Record<string, RoutingComboTemplate[]>);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card templates-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Routing Templates</h2>
          <p>Choose a template to get started quickly</p>
        </div>

        <div className="templates-content">
          {Object.entries(templatesByCategory).map(([category, categoryTemplates]) => (
            <div key={category} className="template-category">
              <h3 className="category-title">{category.replace('_', ' ')}</h3>
              <div className="templates-grid">
                {categoryTemplates.map(template => (
                  <div
                    key={template.id}
                    className="template-card"
                    onClick={() => onSelect(template)}
                  >
                    <div className="template-header">
                      <h4 className="template-name">{template.name}</h4>
                      <div className="template-badges">
                        <StatusBadge variant="neutral" size="xs">
                          {template.complexity}
                        </StatusBadge>
                        <StatusBadge
                          variant={
                            template.estimatedCost === 'low' ? 'success' :
                            template.estimatedCost === 'medium' ? 'warning' : 'danger'
                          }
                          size="xs"
                        >
                          {template.estimatedCost} cost
                        </StatusBadge>
                      </div>
                    </div>
                    <div className="template-description">
                      {template.description}
                    </div>
                    <div className="template-requirements">
                      <span className="requirements-label">Requires:</span>
                      <span className="requirements-list">
                        {template.requiredProviders.join(', ')} providers
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="modal-actions">
          <button className="button-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}