import React from 'react';
import { ProviderHealthStatus } from '../../api/types';

interface ProviderHealthIndicatorProps {
  health: {
    status: ProviderHealthStatus;
    lastChecked?: string;
    responseTimeMs?: number;
    errorRate?: number;
    quotaUsed?: number;
    quotaLimit?: number;
    message?: string;
  };
  showMetrics?: boolean;
  compact?: boolean;
  className?: string;
}

const healthConfig = {
  healthy: {
    label: 'Healthy',
    className: 'provider-health-healthy',
    icon: '●',
    description: 'Provider is operating normally'
  },
  degraded: {
    label: 'Degraded',
    className: 'provider-health-degraded',
    icon: '●',
    description: 'Provider is experiencing performance issues'
  },
  quota_exhausted: {
    label: 'Quota Exhausted',
    className: 'provider-health-quota-exhausted',
    icon: '⚠',
    description: 'Provider has reached its usage quota'
  },
  auth_expired: {
    label: 'Auth Expired',
    className: 'provider-health-auth-expired',
    icon: '🔑',
    description: 'Provider authentication has expired'
  },
  rate_limited: {
    label: 'Rate Limited',
    className: 'provider-health-rate-limited',
    icon: '⏱',
    description: 'Provider is being rate limited'
  },
  disabled: {
    label: 'Disabled',
    className: 'provider-health-disabled',
    icon: '⏸',
    description: 'Provider has been manually disabled'
  },
  not_configured: {
    label: 'Not Configured',
    className: 'provider-health-not-configured',
    icon: '⚙',
    description: 'Provider requires configuration'
  },
  unknown: {
    label: 'Unknown',
    className: 'provider-health-unknown',
    icon: '?',
    description: 'Provider status is unknown'
  }
};

function formatResponseTime(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatErrorRate(rate?: number): string {
  if (rate === undefined) return '';
  return `${(rate * 100).toFixed(1)}%`;
}

function formatQuotaUsage(used?: number, limit?: number): string {
  if (used === undefined || limit === undefined) return '';
  const percentage = (used / limit) * 100;
  return `${percentage.toFixed(0)}% (${used.toLocaleString()}/${limit.toLocaleString()})`;
}

function formatLastChecked(timestamp?: string): string {
  if (!timestamp) return '';
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

export function ProviderHealthIndicator({
  health,
  showMetrics = false,
  compact = false,
  className = ""
}: ProviderHealthIndicatorProps) {
  const config = healthConfig[health.status];

  return (
    <div className={`provider-health-indicator ${compact ? 'provider-health-compact' : ''} ${className}`}>
      <div className="provider-health-status">
        <span className={`provider-health-dot ${config.className}`} title={config.description}>
          {config.icon}
        </span>
        {!compact && (
          <span className="provider-health-label">{config.label}</span>
        )}
      </div>

      {showMetrics && !compact && (
        <div className="provider-health-metrics">
          {health.responseTimeMs && (
            <div className="provider-health-metric">
              <span className="provider-health-metric-label">Response:</span>
              <span className="provider-health-metric-value">
                {formatResponseTime(health.responseTimeMs)}
              </span>
            </div>
          )}

          {health.errorRate !== undefined && (
            <div className="provider-health-metric">
              <span className="provider-health-metric-label">Error Rate:</span>
              <span className="provider-health-metric-value">
                {formatErrorRate(health.errorRate)}
              </span>
            </div>
          )}

          {health.quotaUsed !== undefined && health.quotaLimit !== undefined && (
            <div className="provider-health-metric">
              <span className="provider-health-metric-label">Quota:</span>
              <span className="provider-health-metric-value">
                {formatQuotaUsage(health.quotaUsed, health.quotaLimit)}
              </span>
            </div>
          )}

          {health.lastChecked && (
            <div className="provider-health-metric">
              <span className="provider-health-metric-label">Checked:</span>
              <span className="provider-health-metric-value">
                {formatLastChecked(health.lastChecked)}
              </span>
            </div>
          )}
        </div>
      )}

      {health.message && !compact && (
        <div className="provider-health-message" title={health.message}>
          {health.message}
        </div>
      )}
    </div>
  );
}