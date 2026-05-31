import React, { useState } from 'react';
import { ProviderSummary, ProviderHealth, ProviderTier } from '../../api/types';
import { ProviderTierBadge } from './ProviderTierBadge';
import { EnhancedProviderCard } from './EnhancedProviderCard';

interface TierSectionProps {
  tier: ProviderTier;
  providers: (ProviderSummary & {
    metadata?: {
      tier: ProviderTier;
      serviceKinds: any[];
      vendor: string;
      features: string[];
      description?: string;
    };
  })[];
  health: Record<string, ProviderHealth>;
  onProviderAction: (action: string, providerId: string) => void;
  defaultExpanded?: boolean;
  className?: string;
}

const tierDescriptions = {
  subscription: 'Premium providers with guaranteed availability and SLA',
  cheap: 'Cost-effective providers with good performance and reliability',
  free: 'Free tier providers with usage limits and basic features',
  custom: 'Custom configured providers for specific use cases'
};

const tierPriority = {
  subscription: 1,
  cheap: 2,
  free: 3,
  custom: 4
};

export function TierSection({
  tier,
  providers,
  health,
  onProviderAction,
  defaultExpanded = true,
  className = ""
}: TierSectionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const handleProviderEdit = (providerId: string) => {
    onProviderAction('edit', providerId);
  };

  const handleProviderDelete = (providerId: string) => {
    onProviderAction('delete', providerId);
  };

  const handleProviderTest = (providerId: string) => {
    onProviderAction('test', providerId);
  };

  const healthyCount = providers.filter(p => {
    const providerHealth = health[p.id];
    return providerHealth?.status === 'healthy';
  }).length;

  const hasProviders = providers.length > 0;

  return (
    <div className={`tier-section ${className}`}>
      {/* Tier Header */}
      <div className="tier-section-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="tier-section-header-content">
          <div className="tier-section-title">
            <ProviderTierBadge tier={tier} size="md" />
            <div className="tier-section-info">
              <h3 className="tier-section-name">
                {tier.charAt(0).toUpperCase() + tier.slice(1)} Providers
              </h3>
              <p className="tier-section-description">
                {tierDescriptions[tier]}
              </p>
            </div>
          </div>

          <div className="tier-section-stats">
            <div className="tier-section-stat">
              <span className="tier-section-stat-value">{providers.length}</span>
              <span className="tier-section-stat-label">Total</span>
            </div>
            {providers.length > 0 && (
              <div className="tier-section-stat">
                <span className="tier-section-stat-value tier-section-stat-healthy">
                  {healthyCount}
                </span>
                <span className="tier-section-stat-label">Healthy</span>
              </div>
            )}
          </div>
        </div>

        <div className="tier-section-toggle">
          <span className={`tier-section-chevron ${isExpanded ? 'tier-section-chevron-expanded' : ''}`}>
            ▼
          </span>
        </div>
      </div>

      {/* Tier Content */}
      {isExpanded && (
        <div className="tier-section-content">
          {hasProviders ? (
            <div className="tier-section-providers">
              {providers.map((provider) => (
                <EnhancedProviderCard
                  key={provider.id}
                  provider={provider}
                  health={health[provider.id]}
                  onEdit={handleProviderEdit}
                  onDelete={handleProviderDelete}
                  onTest={handleProviderTest}
                />
              ))}
            </div>
          ) : (
            <div className="tier-section-empty">
              <div className="tier-section-empty-icon">
                {tier === 'subscription' && '👑'}
                {tier === 'cheap' && '💰'}
                {tier === 'free' && '🎁'}
                {tier === 'custom' && '⚙️'}
              </div>
              <div className="tier-section-empty-content">
                <h4 className="tier-section-empty-title">
                  No {tier} providers configured
                </h4>
                <p className="tier-section-empty-description">
                  {tier === 'subscription' && 'Add premium providers with guaranteed availability'}
                  {tier === 'cheap' && 'Add cost-effective providers for budget-conscious routing'}
                  {tier === 'free' && 'Add free tier providers for basic usage'}
                  {tier === 'custom' && 'Add custom providers for specific use cases'}
                </p>
                <button
                  className="tier-section-empty-action"
                  onClick={() => onProviderAction('create', tier)}
                >
                  Add {tier.charAt(0).toUpperCase() + tier.slice(1)} Provider
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}