// Provider Selection Matrix Component
// Visual matrix for selecting and configuring providers across tiers

import React, { useState, useMemo, useCallback } from "react";
import { StatusBadge } from "../StatusBadge";
import {
  CheckCircleIcon,
  AlertIcon,
  PlusIcon,
  SettingsIcon,
  DragIcon,
  TrashIcon
} from "../icons";
import type {
  RoutingTier,
  ProviderBinding
} from "../../features/routing/routingTypes";
import type { Provider, ProviderTier } from "../../features/providers/providerTypes";

interface ProviderSelectionMatrixProps {
  tiers: RoutingTier[];
  providers: Provider[];
  onUpdateTierProvider: (tierIndex: number, providerIndex: number, updates: Partial<ProviderBinding>) => void;
  onAddProviderToTier: (tierIndex: number, providerId: string) => void;
  onRemoveProviderFromTier: (tierIndex: number, providerIndex: number) => void;
  onReorderProviders?: (tierIndex: number, fromIndex: number, toIndex: number) => void;
}

export function ProviderSelectionMatrix({
  tiers,
  providers,
  onUpdateTierProvider,
  onAddProviderToTier,
  onRemoveProviderFromTier,
  onReorderProviders
}: ProviderSelectionMatrixProps) {
  const [selectedTier, setSelectedTier] = useState<number | null>(null);
  const [showProviderSelector, setShowProviderSelector] = useState(false);

  // Group providers by tier for easier selection
  const providersByTier = useMemo(() => {
    return providers.reduce((acc, provider) => {
      if (!acc[provider.tier]) {
        acc[provider.tier] = [];
      }
      acc[provider.tier].push(provider);
      return acc;
    }, {} as Record<ProviderTier, Provider[]>);
  }, [providers]);

  // Get available providers for a tier (not already assigned)
  const getAvailableProviders = useCallback((tierIndex: number) => {
    const tier = tiers[tierIndex];
    const assignedProviderIds = tier.providers.map(p => p.providerId);
    return providers.filter(p => !assignedProviderIds.includes(p.id));
  }, [tiers, providers]);

  const handleAddProvider = useCallback((tierIndex: number) => {
    setSelectedTier(tierIndex);
    setShowProviderSelector(true);
  }, []);

  const handleSelectProvider = useCallback((providerId: string) => {
    if (selectedTier !== null) {
      onAddProviderToTier(selectedTier, providerId);
      setShowProviderSelector(false);
      setSelectedTier(null);
    }
  }, [selectedTier, onAddProviderToTier]);

  return (
    <div className="provider-selection-matrix">
      <div className="matrix-header">
        <h3>Provider Assignment Matrix</h3>
        <p>Configure which providers are available in each routing tier</p>
      </div>

      <div className="matrix-content">
        {/* Tier Headers */}
        <div className="matrix-tiers">
          {tiers.map((tier, tierIndex) => (
            <div key={tier.id} className="matrix-tier">
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
                <button
                  className="button-secondary button-sm"
                  onClick={() => handleAddProvider(tierIndex)}
                  title="Add provider to tier"
                >
                  <PlusIcon className="button-icon" />
                </button>
              </div>

              <div className="tier-providers">
                {tier.providers.length === 0 ? (
                  <div className="empty-tier">
                    <p>No providers assigned</p>
                    <button
                      className="button-primary button-sm"
                      onClick={() => handleAddProvider(tierIndex)}
                    >
                      Add Provider
                    </button>
                  </div>
                ) : (
                  <div className="provider-list">
                    {tier.providers.map((providerBinding, providerIndex) => {
                      const provider = providers.find(p => p.id === providerBinding.providerId);
                      return (
                        <ProviderMatrixItem
                          key={providerIndex}
                          binding={providerBinding}
                          provider={provider}
                          onUpdate={(updates) => onUpdateTierProvider(tierIndex, providerIndex, updates)}
                          onRemove={() => onRemoveProviderFromTier(tierIndex, providerIndex)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Provider Pool */}
        <div className="provider-pool">
          <h4>Available Providers</h4>
          <div className="provider-pool-content">
            {Object.entries(providersByTier).map(([tierName, tierProviders]) => (
              <div key={tierName} className="provider-tier-group">
                <div className="tier-group-header">
                  <StatusBadge variant="neutral" size="sm">
                    {tierName}
                  </StatusBadge>
                  <span className="provider-count">
                    {tierProviders.length} provider{tierProviders.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="provider-grid">
                  {tierProviders.map(provider => (
                    <ProviderPoolItem
                      key={provider.id}
                      provider={provider}
                      isAssigned={tiers.some(tier =>
                        tier.providers.some(p => p.providerId === provider.id)
                      )}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Provider Selection Modal */}
      {showProviderSelector && selectedTier !== null && (
        <ProviderSelectorModal
          availableProviders={getAvailableProviders(selectedTier)}
          onSelect={handleSelectProvider}
          onClose={() => {
            setShowProviderSelector(false);
            setSelectedTier(null);
          }}
        />
      )}
    </div>
  );
}

// Provider matrix item component
interface ProviderMatrixItemProps {
  binding: ProviderBinding;
  provider?: Provider;
  onUpdate: (updates: Partial<ProviderBinding>) => void;
  onRemove: () => void;
}

function ProviderMatrixItem({ binding, provider, onUpdate, onRemove }: ProviderMatrixItemProps) {
  return (
    <div className={`provider-matrix-item ${binding.isEnabled ? 'enabled' : 'disabled'}`}>
      <div className="provider-info">
        <div className="provider-name">
          {provider?.displayName || binding.providerId}
        </div>
        <div className="provider-meta">
          {provider && (
            <StatusBadge
              variant={
                provider.healthStatus === 'healthy' ? 'success' :
                provider.healthStatus === 'degraded' ? 'warning' : 'danger'
              }
              size="xs"
            >
              {provider.healthStatus}
            </StatusBadge>
          )}
        </div>
      </div>

      <div className="provider-config">
        <div className="config-row">
          <div className="config-item">
            <label>Weight</label>
            <input
              type="number"
              min="0"
              max="100"
              value={binding.weight}
              onChange={(e) => onUpdate({ weight: parseInt(e.target.value) || 0 })}
              className="weight-input"
            />
            <span className="weight-unit">%</span>
          </div>

          <div className="config-item">
            <label>
              <input
                type="checkbox"
                checked={binding.isEnabled}
                onChange={(e) => onUpdate({ isEnabled: e.target.checked })}
              />
              <span>Enabled</span>
            </label>
          </div>
        </div>

        {binding.modelOverride && (
          <div className="config-row">
            <div className="config-item">
              <label>Model Override</label>
              <input
                type="text"
                value={binding.modelOverride}
                onChange={(e) => onUpdate({ modelOverride: e.target.value || undefined })}
                placeholder="Optional model override..."
              />
            </div>
          </div>
        )}
      </div>

      <div className="provider-actions">
        <button
          className="button-danger button-sm"
          onClick={onRemove}
          title="Remove from tier"
        >
          <TrashIcon className="button-icon" />
        </button>
      </div>
    </div>
  );
}

// Provider pool item component
interface ProviderPoolItemProps {
  provider: Provider;
  isAssigned: boolean;
}

function ProviderPoolItem({ provider, isAssigned }: ProviderPoolItemProps) {
  return (
    <div className={`provider-pool-item ${isAssigned ? 'assigned' : 'available'}`}>
      <div className="provider-info">
        <div className="provider-name">{provider.displayName}</div>
        <div className="provider-meta">
          <StatusBadge variant="neutral" size="xs">
            {provider.tier}
          </StatusBadge>
          <StatusBadge
            variant={
              provider.healthStatus === 'healthy' ? 'success' :
              provider.healthStatus === 'degraded' ? 'warning' : 'danger'
            }
            size="xs"
          >
            {provider.healthStatus}
          </StatusBadge>
        </div>
      </div>

      <div className="provider-status">
        {isAssigned ? (
          <StatusBadge variant="accent" size="xs">
            Assigned
          </StatusBadge>
        ) : (
          <StatusBadge variant="neutral" size="xs">
            Available
          </StatusBadge>
        )}
      </div>
    </div>
  );
}

// Provider selector modal
interface ProviderSelectorModalProps {
  availableProviders: Provider[];
  onSelect: (providerId: string) => void;
  onClose: () => void;
}

function ProviderSelectorModal({ availableProviders, onSelect, onClose }: ProviderSelectorModalProps) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card provider-selector-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Add Provider to Tier</h3>
          <p>Select a provider to add to this routing tier</p>
        </div>

        <div className="modal-content">
          {availableProviders.length === 0 ? (
            <div className="no-providers">
              <p>All available providers are already assigned to this tier.</p>
            </div>
          ) : (
            <div className="provider-selection-grid">
              {availableProviders.map(provider => (
                <div
                  key={provider.id}
                  className="provider-selection-item"
                  onClick={() => onSelect(provider.id)}
                >
                  <div className="provider-info">
                    <div className="provider-name">{provider.displayName}</div>
                    <div className="provider-meta">
                      <StatusBadge variant="neutral" size="xs">
                        {provider.tier}
                      </StatusBadge>
                      <StatusBadge
                        variant={
                          provider.healthStatus === 'healthy' ? 'success' :
                          provider.healthStatus === 'degraded' ? 'warning' : 'danger'
                        }
                        size="xs"
                      >
                        {provider.healthStatus}
                      </StatusBadge>
                    </div>
                  </div>

                  <div className="provider-config-status">
                    <StatusBadge
                      variant={provider.configured ? "success" : "warning"}
                      size="xs"
                    >
                      {provider.configured ? "Configured" : "Not configured"}
                    </StatusBadge>
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