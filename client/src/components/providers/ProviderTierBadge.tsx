import React from 'react';
import { ProviderTier } from '../../api/types';

interface ProviderTierBadgeProps {
  tier: ProviderTier;
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
  className?: string;
}

const tierConfig = {
  subscription: {
    label: 'Subscription',
    className: 'provider-tier-badge-subscription',
    icon: '👑',
    description: 'Premium providers with guaranteed availability'
  },
  cheap: {
    label: 'Budget',
    className: 'provider-tier-badge-cheap',
    icon: '💰',
    description: 'Cost-effective providers with good performance'
  },
  free: {
    label: 'Free',
    className: 'provider-tier-badge-free',
    icon: '🎁',
    description: 'Free tier providers with usage limits'
  },
  custom: {
    label: 'Custom',
    className: 'provider-tier-badge-custom',
    icon: '⚙️',
    description: 'Custom configured providers'
  }
};

export function ProviderTierBadge({
  tier,
  size = "md",
  showIcon = true,
  className = ""
}: ProviderTierBadgeProps) {
  const config = tierConfig[tier];

  return (
    <span
      className={`provider-tier-badge provider-tier-badge-${size} ${config.className} ${className}`}
      title={config.description}
    >
      {showIcon && <span className="provider-tier-badge-icon">{config.icon}</span>}
      <span className="provider-tier-badge-label">{config.label}</span>
    </span>
  );
}