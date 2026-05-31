import React from 'react';
import { ProviderSummary, ProviderHealth, ProviderServiceKind } from '../../api/types';
import { ProviderTierBadge } from './ProviderTierBadge';
import { ProviderHealthIndicator } from './ProviderHealthIndicator';

interface EnhancedProviderCardProps {
  provider: ProviderSummary & {
    metadata?: {
      tier: 'subscription' | 'cheap' | 'free' | 'custom';
      serviceKinds: ProviderServiceKind[];
      vendor: string;
      features: string[];
      description?: string;
    };
  };
  health?: ProviderHealth;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  className?: string;
}

const serviceKindIcons: Record<ProviderServiceKind, string> = {
  chat: '💬',
  embedding: '🔗',
  tts: '🔊',
  stt: '🎤',
  image: '🖼️',
  vision: '👁️',
  video: '🎥',
  web_search: '🔍',
  web_fetch: '🌐'
};

function formatLastUsed(timestamp?: string): string {
  if (!timestamp) return 'Never';

  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function getProviderStatus(provider: ProviderSummary): { label: string; variant: 'success' | 'warning' | 'neutral' } {
  if (provider.current) {
    return { label: 'Active', variant: 'success' };
  }

  const hasKeys = provider.providerApiKeysCount && provider.providerApiKeysCount > 0;
  const hasOAuth = provider.authMode === 'chatgpt_oauth' && provider.chatgptAccountId;

  if (hasKeys || hasOAuth) {
    return { label: 'Ready', variant: 'neutral' };
  }

  return { label: 'Needs Setup', variant: 'warning' };
}

export function EnhancedProviderCard({
  provider,
  health,
  onEdit,
  onDelete,
  onTest,
  className = ""
}: EnhancedProviderCardProps) {
  const status = getProviderStatus(provider);
  const tier = provider.metadata?.tier || 'custom';
  const serviceKinds = provider.metadata?.serviceKinds || ['chat'];
  const vendor = provider.metadata?.vendor || 'Unknown';
  const features = provider.metadata?.features || [];
  const description = provider.metadata?.description;

  return (
    <div className={`enhanced-provider-card ${className}`}>
      {/* Header */}
      <div className="enhanced-provider-card-header">
        <div className="enhanced-provider-card-title-section">
          <div className="enhanced-provider-card-title">
            <h3 className="enhanced-provider-card-name">{provider.name}</h3>
            <span className="enhanced-provider-card-vendor">{vendor}</span>
          </div>
          <div className="enhanced-provider-card-badges">
            <ProviderTierBadge tier={tier} size="sm" />
            {health && (
              <ProviderHealthIndicator health={health} compact />
            )}
          </div>
        </div>

        <div className="enhanced-provider-card-status">
          <span className={`status-badge status-badge-${status.variant}`}>
            {status.label}
          </span>
        </div>
      </div>

      {/* Description */}
      {description && (
        <div className="enhanced-provider-card-description">
          {description}
        </div>
      )}

      {/* Service Kinds */}
      <div className="enhanced-provider-card-services">
        <div className="enhanced-provider-card-services-label">Services:</div>
        <div className="enhanced-provider-card-services-list">
          {serviceKinds.map((kind) => (
            <span
              key={kind}
              className="enhanced-provider-card-service-icon"
              title={kind.replace('_', ' ')}
            >
              {serviceKindIcons[kind]}
            </span>
          ))}
        </div>
      </div>

      {/* Features */}
      {features.length > 0 && (
        <div className="enhanced-provider-card-features">
          <div className="enhanced-provider-card-features-label">Features:</div>
          <div className="enhanced-provider-card-features-list">
            {features.slice(0, 3).map((feature) => (
              <span key={feature} className="enhanced-provider-card-feature-tag">
                {feature}
              </span>
            ))}
            {features.length > 3 && (
              <span className="enhanced-provider-card-feature-more">
                +{features.length - 3} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Quota Usage Bar */}
      {health?.quotaUsed !== undefined && health?.quotaLimit !== undefined && (
        <div className="enhanced-provider-card-quota">
          <div className="enhanced-provider-card-quota-label">
            Quota Usage: {health.quotaUsed.toLocaleString()} / {health.quotaLimit.toLocaleString()}
          </div>
          <div className="enhanced-provider-card-quota-bar">
            <div
              className="enhanced-provider-card-quota-fill"
              style={{
                width: `${Math.min((health.quotaUsed / health.quotaLimit) * 100, 100)}%`
              }}
            />
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="enhanced-provider-card-metadata">
        <div className="enhanced-provider-card-metadata-item">
          <span className="enhanced-provider-card-metadata-label">Auth:</span>
          <span className="enhanced-provider-card-metadata-value">
            {provider.authMode === 'chatgpt_oauth' ? 'OAuth' : 'API Key'}
          </span>
        </div>

        <div className="enhanced-provider-card-metadata-item">
          <span className="enhanced-provider-card-metadata-label">Keys:</span>
          <span className="enhanced-provider-card-metadata-value">
            {provider.providerApiKeysCount || 0}
          </span>
        </div>

        <div className="enhanced-provider-card-metadata-item">
          <span className="enhanced-provider-card-metadata-label">Last Used:</span>
          <span className="enhanced-provider-card-metadata-value">
            {formatLastUsed(provider.updatedAt)}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="enhanced-provider-card-actions">
        <button
          className="enhanced-provider-card-action-button enhanced-provider-card-action-test"
          onClick={() => onTest(provider.id)}
          title="Test Connection"
        >
          Test
        </button>
        <button
          className="enhanced-provider-card-action-button enhanced-provider-card-action-edit"
          onClick={() => onEdit(provider.id)}
          title="Edit Provider"
        >
          Edit
        </button>
        <button
          className="enhanced-provider-card-action-button enhanced-provider-card-action-delete"
          onClick={() => onDelete(provider.id)}
          title="Delete Provider"
        >
          Delete
        </button>
      </div>
    </div>
  );
}