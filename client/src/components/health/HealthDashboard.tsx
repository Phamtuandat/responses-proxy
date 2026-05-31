// Health Monitoring Dashboard Component
// Displays real-time provider health status and monitoring controls

import React, { useState, useMemo } from "react";
import { SurfaceCard } from "../SurfaceCard";
import { StatCard } from "../StatCard";
import { StatusBadge } from "../StatusBadge";
import { RefreshButton } from "../RefreshButton";
import { EmptyState } from "../EmptyState";
import { LoadingState } from "../LoadingState";
import {
  CheckCircleIcon,
  AlertIcon,
  ClockIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  PlayIcon,
  PauseIcon,
  SettingsIcon
} from "../icons";
import type { ProviderHealthUpdate, HealthMonitorStats } from "../../features/health/healthMonitor";
import {
  useHealthMonitoring,
  useHealthAlerts,
  useAutoHealthMonitoring
} from "../../features/health/healthHooks";

interface HealthDashboardProps {
  autoStart?: boolean;
  showControls?: boolean;
  compact?: boolean;
}

export function HealthDashboard({ autoStart = true, showControls = true, compact = false }: HealthDashboardProps) {
  const [showSettings, setShowSettings] = useState(false);

  // Auto-start health monitoring
  useAutoHealthMonitoring(autoStart);

  const {
    healthUpdates,
    stats,
    healthSummary,
    isMonitoring,
    error,
    startMonitoring,
    stopMonitoring,
    refreshAllHealth,
    checkProviderHealth
  } = useHealthMonitoring();

  const {
    alerts,
    criticalAlerts,
    warningAlerts,
    dismissAlert,
    clearAllAlerts,
    hasCriticalAlerts,
    hasWarningAlerts
  } = useHealthAlerts();

  // Sort providers by health priority
  const sortedHealthUpdates = useMemo(() => {
    const updates = Array.from(healthUpdates.values());
    return updates.sort((a, b) => {
      const priorityOrder = {
        'quota_exhausted': 0,
        'auth_expired': 1,
        'not_configured': 2,
        'disabled': 3,
        'rate_limited': 4,
        'degraded': 5,
        'unknown': 6,
        'healthy': 7
      };

      const aPriority = priorityOrder[a.healthStatus] ?? 8;
      const bPriority = priorityOrder[b.healthStatus] ?? 8;

      return aPriority - bPriority;
    });
  }, [healthUpdates]);

  const formatHealthAge = (lastCheckAt: string) => {
    const checkTime = new Date(lastCheckAt);
    const now = new Date();
    const ageMs = now.getTime() - checkTime.getTime();
    const ageMinutes = Math.floor(ageMs / (1000 * 60));

    if (ageMinutes < 1) return 'Just now';
    if (ageMinutes < 60) return `${ageMinutes}m ago`;
    const ageHours = Math.floor(ageMinutes / 60);
    if (ageHours < 24) return `${ageHours}h ago`;
    const ageDays = Math.floor(ageHours / 24);
    return `${ageDays}d ago`;
  };

  const getHealthStatusVariant = (status: string) => {
    switch (status) {
      case 'healthy': return 'success';
      case 'degraded': case 'rate_limited': return 'warning';
      case 'quota_exhausted': case 'auth_expired': case 'not_configured': case 'disabled': return 'danger';
      default: return 'neutral';
    }
  };

  const renderHealthSummaryStats = () => (
    <div className="health-stats-row">
      <StatCard
        title="Total Providers"
        value={healthSummary.total.toString()}
        caption="Being monitored"
        trend="neutral"
      />
      <StatCard
        title="Healthy"
        value={healthSummary.healthy.toString()}
        caption="Operating normally"
        trend={healthSummary.healthy > 0 ? "up" : "neutral"}
      />
      <StatCard
        title="Issues"
        value={(healthSummary.degraded + healthSummary.critical).toString()}
        caption="Need attention"
        trend={healthSummary.critical > 0 ? "down" : healthSummary.degraded > 0 ? "neutral" : "up"}
      />
      <StatCard
        title="Unknown"
        value={healthSummary.unknown.toString()}
        caption="Status pending"
        trend="neutral"
      />
    </div>
  );

  const renderMonitoringControls = () => (
    <SurfaceCard
      title="Monitoring Controls"
      description="Manage real-time health monitoring"
      actions={
        <div className="monitoring-actions">
          <RefreshButton onClick={refreshAllHealth} disabled={!isMonitoring} />
          <button
            className="button-secondary"
            onClick={() => setShowSettings(!showSettings)}
          >
            <SettingsIcon className="button-icon" />
            Settings
          </button>
        </div>
      }
    >
      <div className="monitoring-controls">
        <div className="monitoring-status">
          <div className="status-indicator">
            <StatusBadge variant={isMonitoring ? "success" : "neutral"} size="sm">
              {isMonitoring ? "Active" : "Stopped"}
            </StatusBadge>
            <span className="status-text">
              {isMonitoring ? "Real-time monitoring active" : "Monitoring stopped"}
            </span>
          </div>
          <button
            className={`button-${isMonitoring ? 'secondary' : 'primary'}`}
            onClick={isMonitoring ? stopMonitoring : startMonitoring}
          >
            {isMonitoring ? (
              <>
                <PauseIcon className="button-icon" />
                Stop Monitoring
              </>
            ) : (
              <>
                <PlayIcon className="button-icon" />
                Start Monitoring
              </>
            )}
          </button>
        </div>

        {stats && (
          <div className="monitoring-stats">
            <div className="stat-item">
              <span className="stat-label">Checks Performed</span>
              <span className="stat-value">{stats.checksPerformed}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Avg Check Time</span>
              <span className="stat-value">{Math.round(stats.averageCheckTime)}ms</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Error Rate</span>
              <span className="stat-value">
                {stats.checksPerformed > 0
                  ? `${((stats.errorsEncountered / stats.checksPerformed) * 100).toFixed(1)}%`
                  : '0%'
                }
              </span>
            </div>
            {stats.lastUpdateAt && (
              <div className="stat-item">
                <span className="stat-label">Last Update</span>
                <span className="stat-value">{formatHealthAge(stats.lastUpdateAt)}</span>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="monitoring-error">
            <AlertIcon className="error-icon" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </SurfaceCard>
  );

  const renderHealthAlerts = () => {
    if (alerts.length === 0) return null;

    return (
      <SurfaceCard
        title="Health Alerts"
        description={`${criticalAlerts.length} critical, ${warningAlerts.length} warnings`}
        badge={alerts.length > 0 ? alerts.length.toString() : undefined}
        actions={
          alerts.length > 0 && (
            <button className="button-secondary button-sm" onClick={clearAllAlerts}>
              Clear All
            </button>
          )
        }
      >
        <div className="health-alerts">
          {alerts.slice(0, compact ? 3 : 10).map(alert => (
            <div key={alert.id} className={`health-alert alert-${alert.type}`}>
              <div className="alert-content">
                <div className="alert-header">
                  <StatusBadge
                    variant={alert.type === 'critical' ? 'danger' : 'warning'}
                    size="xs"
                  >
                    {alert.type}
                  </StatusBadge>
                  <span className="alert-title">{alert.title}</span>
                  <span className="alert-time">{formatHealthAge(alert.timestamp)}</span>
                </div>
                <div className="alert-message">{alert.message}</div>
              </div>
              {alert.dismissible && (
                <button
                  className="alert-dismiss"
                  onClick={() => dismissAlert(alert.id)}
                  title="Dismiss alert"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </SurfaceCard>
    );
  };

  const renderProviderHealthList = () => (
    <SurfaceCard
      title="Provider Health Status"
      description="Real-time health monitoring for all providers"
      badge={sortedHealthUpdates.length > 0 ? sortedHealthUpdates.length.toString() : undefined}
    >
      {sortedHealthUpdates.length === 0 ? (
        <EmptyState
          title="No health data"
          description="Start monitoring to see provider health status"
          actionLabel={isMonitoring ? "Refresh" : "Start Monitoring"}
          onClick={isMonitoring ? refreshAllHealth : startMonitoring}
        />
      ) : (
        <div className="provider-health-list">
          {sortedHealthUpdates.slice(0, compact ? 5 : undefined).map(update => (
            <div key={update.providerId} className="provider-health-item">
              <div className="provider-health-main">
                <div className="provider-info">
                  <span className="provider-name">{update.providerId}</span>
                  <StatusBadge
                    variant={getHealthStatusVariant(update.healthStatus)}
                    size="sm"
                  >
                    {update.healthStatus.replace('_', ' ')}
                  </StatusBadge>
                </div>
                <div className="provider-health-details">
                  {update.healthMessage && (
                    <div className="health-message">{update.healthMessage}</div>
                  )}
                  <div className="health-meta">
                    <ClockIcon className="meta-icon" />
                    <span>Checked {formatHealthAge(update.lastHealthCheckAt)}</span>
                    {update.quota && (
                      <>
                        <span className="meta-separator">•</span>
                        <span>
                          {update.quota.usagePercent !== undefined
                            ? `${update.quota.usagePercent.toFixed(1)}% quota used`
                            : 'Quota unknown'
                          }
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="provider-health-actions">
                <button
                  className="button-secondary button-sm"
                  onClick={() => checkProviderHealth(update.providerId)}
                  title="Check health now"
                >
                  <RefreshButton onClick={() => checkProviderHealth(update.providerId)} />
                </button>
              </div>
            </div>
          ))}
          {compact && sortedHealthUpdates.length > 5 && (
            <div className="provider-health-more">
              <span>+{sortedHealthUpdates.length - 5} more providers</span>
            </div>
          )}
        </div>
      )}
    </SurfaceCard>
  );

  if (compact) {
    return (
      <div className="health-dashboard health-dashboard-compact">
        {renderHealthSummaryStats()}
        {renderHealthAlerts()}
        {renderProviderHealthList()}
      </div>
    );
  }

  return (
    <div className="health-dashboard">
      {renderHealthSummaryStats()}

      <div className="health-dashboard-grid">
        <div className="health-dashboard-main">
          {renderHealthAlerts()}
          {renderProviderHealthList()}
        </div>

        {showControls && (
          <div className="health-dashboard-sidebar">
            {renderMonitoringControls()}
          </div>
        )}
      </div>
    </div>
  );
}

// Compact health status indicator for use in other components
export function HealthStatusIndicator({ providerId }: { providerId: string }) {
  const { healthUpdates } = useHealthMonitoring();
  const healthUpdate = healthUpdates.get(providerId);

  if (!healthUpdate) {
    return (
      <StatusBadge variant="neutral" size="xs">
        unknown
      </StatusBadge>
    );
  }

  return (
    <StatusBadge
      variant={getHealthStatusVariant(healthUpdate.healthStatus)}
      size="xs"
      title={`${healthUpdate.healthStatus} - Last checked ${formatHealthAge(healthUpdate.lastHealthCheckAt)}`}
    >
      {healthUpdate.healthStatus.replace('_', ' ')}
    </StatusBadge>
  );
}

// Helper function for health status variants
function getHealthStatusVariant(status: string) {
  switch (status) {
    case 'healthy': return 'success';
    case 'degraded': case 'rate_limited': return 'warning';
    case 'quota_exhausted': case 'auth_expired': case 'not_configured': case 'disabled': return 'danger';
    default: return 'neutral';
  }
}

// Helper function for formatting health check age
function formatHealthAge(lastCheckAt: string) {
  const checkTime = new Date(lastCheckAt);
  const now = new Date();
  const ageMs = now.getTime() - checkTime.getTime();
  const ageMinutes = Math.floor(ageMs / (1000 * 60));

  if (ageMinutes < 1) return 'just now';
  if (ageMinutes < 60) return `${ageMinutes}m ago`;
  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) return `${ageHours}h ago`;
  const ageDays = Math.floor(ageHours / 24);
  return `${ageDays}d ago`;
}