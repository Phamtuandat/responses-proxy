// Tier Configuration Panel Component
// Manages individual routing tier configuration with provider selection

import React, { useState, useCallback } from "react";
import { StatusBadge } from "../StatusBadge";
import { ProviderSelectionMatrix } from "./ProviderSelectionMatrix";
import {
  DragIcon,
  TrashIcon,
  PlusIcon,
  SettingsIcon,
  CheckCircleIcon,
  AlertIcon
} from "../icons";
import type {
  RoutingTier,
  ProviderBinding,
  ProviderHealthStatus
} from "../../features/routing/routingTypes";
import type { Provider, ProviderTier } from "../../features/providers/providerTypes";

interface TierConfigPanelProps {
  tier: RoutingTier;
  tierIndex: number;
  providers: Provider[];
  availableProviders: Provider[];
  onUpdateTier: (updates: Partial<RoutingTier>) => void;
  onRemoveTier: () => void;
  onAddProvider: (providerId: string) => void;
  onUpdateProvider: (providerIndex: number, updates: Partial<ProviderBinding>) => void;
  onRemoveProvider: (providerIndex: number) => void;
}

export function TierConfigPanel({
  tier,
  tierIndex,
  providers,
  availableProviders,
  onUpdateTier,
  onRemoveTier,
  onAddProvider,
  onUpdateProvider,
  onRemoveProvider
}: TierConfigPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showProviderSelection, setShowProviderSelection] = useState(false);

  const handleTierTypeChange = useCallback((newTier: ProviderTier) => {
    onUpdateTier({ tier: newTier });
  }, [onUpdateTier]);

  const handleHealthThresholdChange = useCallback((status: ProviderHealthStatus, checked: boolean) => {
    const currentThresholds = tier.healthThreshold || [];
    const newThresholds = checked
      ? [...currentThresholds, status]
      : currentThresholds.filter(s => s !== status);
    onUpdateTier({ healthThreshold: newThresholds });
  }, [tier.healthThreshold, onUpdateTier]);

  const handleProviderWeightChange = useCallback((providerIndex: number, weight: number) => {
    onUpdateProvider(providerIndex, { weight });
  }, [onUpdateProvider]);

  const totalWeight = tier.providers.reduce((sum, provider) => sum + provider.weight, 0);
  const isWeightBalanced = Math.abs(totalWeight - 100) < 1;

  return (
    <div className={`tier-config-panel ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="tier-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="tier-drag-handle">
          <DragIcon className="drag-icon" />
        </div>

        <div className="tier-info">
          <div className="tier-name-row">
            <span className="tier-priority">#{tier.priority}</span>
            <input
              type="text"
              className="tier-name-input"
              value={tier.name}
              onChange={(e) => onUpdateTier({ name: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              placeholder="Tier name..."
            />
            <StatusBadge
              variant={tier.isEnabled ? "success" : "neutral"}
              size="sm"
            >
              {tier.isEnabled ? "Enabled" : "Disabled"}
            </StatusBadge>
          </div>

          <div className="tier-summary">
            <span className="provider-count">
              {tier.providers.length} provider{tier.providers.length !== 1 ? 's' : ''}
            </span>
            {!isWeightBalanced && (
              <span className="weight-warning">
                <AlertIcon className="warning-icon" />
                Weights: {totalWeight}%
              </span>
            )}
          </div>
        </div>

        <div className="tier-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="button-secondary button-sm"
            onClick={() => setShowProviderSelection(true)}
            title="Add provider"
          >
            <PlusIcon className="button-icon" />
          </button>
          <button
            className="button-danger button-sm"
            onClick={onRemoveTier}
            title="Remove tier"
          >
            <TrashIcon className="button-icon" />
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="tier-content">
          {/* Tier Configuration */}
          <div className="tier-config-section">
            <div className="config-row">
              <div className="config-group">
                <label>Tier Type</label>
                <select
                  value={tier.tier}
                  onChange={(e) => handleTierTypeChange(e.target.value as ProviderTier)}
                >
                  <option value="subscription">Subscription</option>
                  <option value="cheap">Cost-Effective</option>
                  <option value="free">Free</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              <div className="config-group">
                <label>Priority</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={tier.priority}
                  onChange={(e) => onUpdateTier({ priority: parseInt(e.target.value) || 1 })}
                />
              </div>

              <div className="config-group">
                <label>Fallback Delay (ms)</label>
                <input
                  type="number"
                  min="0"
                  max="30000"
                  step="100"
                  value={tier.fallbackDelay || 1000}
                  onChange={(e) => onUpdateTier({ fallbackDelay: parseInt(e.target.value) || 1000 })}
                />
              </div>

              <div className="config-group">
                <label>Max Retries</label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={tier.maxRetries || 2}
                  onChange={(e) => onUpdateTier({ maxRetries: parseInt(e.target.value) || 2 })}
                />
              </div>
            </div>

            <div className="config-row">
              <div className="config-group">
                <label>
                  <input
                    type="checkbox"
                    checked={tier.isEnabled}
                    onChange={(e) => onUpdateTier({ isEnabled: e.target.checked })}
                  />
                  <span>Enabled</span>
                </label>
              </div>
            </div>

            {/* Health Threshold */}
            <div className="config-group">
              <label>Health Threshold</label>
              <div className="health-threshold-options">
                {(['healthy', 'degraded', 'rate_limited'] as ProviderHealthStatus[]).map(status => (
                  <label key={status} className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={tier.healthThreshold?.includes(status) || false}
                      onChange={(e) => handleHealthThresholdChange(status, e.target.checked)}
                    />
                    <span>{status.replace('_', ' ')}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Providers List */}
          <div className="tier-providers-section">
            <div className="providers-header">
              <h4>Providers ({tier.providers.length})</h4>
              <button
                className="button-secondary button-sm"
                onClick={() => setShowProviderSelection(true)}
              >
                <PlusIcon className="button-icon" />
                Add Provider
              </button>
            </div>

            {tier.providers.length === 0 ? (
              <div className="empty-providers">
                <p>No providers configured for this tier.</p>
                <button
                  className="button-primary button-sm"
                  onClick={() => setShowProviderSelection(true)}
                >
                  Add First Provider
                </button>
              </div>
            ) : (
              <div className="providers-list">
                {tier.providers.map((provider, providerIndex) => {
                  const providerInfo = providers.find(p => p.id === provider.providerId);
                  return (
                    <ProviderConfigItem
                      key={providerIndex}
                      provider={provider}
                      providerInfo={providerInfo}
                      onUpdateWeight={(weight) => handleProviderWeightChange(providerIndex, weight)}
                      onToggleEnabled={(enabled) => onUpdateProvider(providerIndex, { isEnabled: enabled })}
                      onUpdateModelOverride={(modelOverride) => onUpdateProvider(providerIndex, { modelOverride })}
                      onRemove={() => onRemoveProvider(providerIndex)}
                    />
                  );
                })}
              </div>
            )}

            {!isWeightBalanced && tier.providers.length > 1 && (
              <div className="weight-balance-warning">
                <AlertIcon className="warning-icon" />
                <span>Provider weights sum to {totalWeight}%, not 100%. Consider rebalancing.</span>
                <button
                  className="button-secondary button-sm"
                  onClick={() => {
                    // Auto-balance weights
                    const equalWeight = Math.floor(100 / tier.providers.length);
                    const remainder = 100 - (equalWeight * tier.providers.length);

                    tier.providers.forEach((_, index) => {
                      const weight = equalWeight + (index < remainder ? 1 : 0);
                      onUpdateProvider(index, { weight });
                    });
                  }}
                >
                  Auto-Balance
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Provider Selection Modal */}
      {showProviderSelection && (
        <ProviderSelectionModal
          availableProviders={availableProviders}
          selectedProviders={tier.providers.map(p => p.providerId)}
          onSelect={onAddProvider}
          onClose={() => setShowProviderSelection(false)}
        />
      )}
    </div>
  );
}

// Provider configuration item
interface ProviderConfigItemProps {
  provider: ProviderBinding;
  providerInfo?: Provider;
  onUpdateWeight: (weight: number) => void;
  onToggleEnabled: (enabled: boolean) => void;
  onUpdateModelOverride: (modelOverride?: string) => void;
  onRemove: () => void;
}

function ProviderConfigItem({
  provider,
  providerInfo,
  onUpdateWeight,
  onToggleEnabled,
  onUpdateModelOverride,
  onRemove
}: ProviderConfigItemProps) {
  return (
    <div className="provider-config-item">
      <div className="provider-info">
        <div className="provider-name">
          {providerInfo?.displayName || provider.providerId}
        </div>
        <div className="provider-meta">
          {providerInfo && (
            <StatusBadge variant="neutral" size="xs">
              {providerInfo.tier}
            </StatusBadge>
          )}
          <StatusBadge
            variant={provider.isEnabled ? "success" : "neutral"}
            size="xs"
          >
            {provider.isEnabled ? "Enabled" : "Disabled"}
          </StatusBadge>
        </div>
      </div>

      <div className="provider-config">
        <div className="config-item">
          <label>Weight (%)</label>
          <input
            type="number"
            min="0"
            max="100"
            value={provider.weight}
            onChange={(e) => onUpdateWeight(parseInt(e.target.value) || 0)}
            className="weight-input"
          />
        </div>

        <div className="config-item">
          <label>Model Override</label>
          <input
            type="text"
            value={provider.modelOverride || ''}
            onChange={(e) => onUpdateModelOverride(e.target.value || undefined)}
            placeholder="Optional model override..."
            className="model-input"
          />
        </div>

        <div className="config-item">
          <label>
            <input
              type="checkbox"
              checked={provider.isEnabled}
              onChange={(e) => onToggleEnabled(e.target.checked)}
            />
            <span>Enabled</span>
          </label>
        </div>
      </div>

      <div className="provider-actions">
        <button
          className="button-danger button-sm"
          onClick={onRemove}
          title="Remove provider"
        >
          <TrashIcon className="button-icon" />
        </button>
      </div>
    </div>
  );
}

// Provider selection modal
interface ProviderSelectionModalProps {
  availableProviders: Provider[];
  selectedProviders: string[];
  onSelect: (providerId: string) => void;
  onClose: () => void;
}

function ProviderSelectionModal({
  availableProviders,
  selectedProviders,
  onSelect,
  onClose
}: ProviderSelectionModalProps) {
  const unselectedProviders = availableProviders.filter(
    provider => !selectedProviders.includes(provider.id)
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card provider-selection-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Add Provider to Tier</h3>
          <p>Select a provider to add to this routing tier</p>
        </div>

        <div className="provider-selection-content">
          {unselectedProviders.length === 0 ? (
            <div className="no-providers">
              <p>All available providers are already added to this tier.</p>
            </div>
          ) : (
            <div className="providers-grid">
              {unselectedProviders.map(provider => (
                <div
                  key={provider.id}
                  className="provider-option"
                  onClick={() => {
                    onSelect(provider.id);
                    onClose();
                  }}
                >
                  <div className="provider-option-header">
                    <span className="provider-name">{provider.displayName}</span>
                    <StatusBadge variant="neutral" size="xs">
                      {provider.tier}
                    </StatusBadge>
                  </div>
                  <div className="provider-option-status">
                    <StatusBadge
                      variant={
                        provider.healthStatus === 'healthy' ? 'success' :
                        provider.healthStatus === 'degraded' ? 'warning' : 'danger'
                      }
                      size="xs"
                    >
                      {provider.healthStatus}
                    </StatusBadge>
                    <span className="provider-configured">
                      {provider.configured ? 'Configured' : 'Not configured'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
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