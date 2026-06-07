import type { ComponentType, SVGProps } from "react";
import { LineChart, type LineChartDataPoint } from "../charts/LineChart";

export type MetricCardProps = {
  title: string;
  value: string | number;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  trend?: {
    direction: 'up' | 'down' | 'neutral';
    percentage: number;
    period?: string;
  };
  sparklineData?: LineChartDataPoint[];
  status?: 'healthy' | 'warning' | 'error' | 'neutral';
  description?: string;
  className?: string;
};

export function MetricCard({
  title,
  value,
  icon: Icon,
  trend,
  sparklineData,
  status = 'neutral',
  description,
  className = '',
}: MetricCardProps) {
  const getTrendColor = () => {
    switch (trend?.direction) {
      case 'up': return 'var(--success)';
      case 'down': return 'var(--danger)';
      default: return 'var(--text-muted)';
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'healthy': return 'var(--status-healthy)';
      case 'warning': return 'var(--status-warning)';
      case 'error': return 'var(--status-error)';
      default: return 'var(--text-muted)';
    }
  };

  /** Resolve a CSS variable to its computed value for canvas-based charts. */
  const resolveColor = (cssVar: string): string => {
    if (!cssVar.startsWith('var(')) return cssVar;
    const prop = cssVar.slice(4, -1).trim();
    const resolved = getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
    return resolved || '#6366f1'; // fallback indigo
  };

  return (
    <div className={`metric-card metric-card-${status} ${className}`}>
      <div className="metric-card-header">
        <div className="metric-card-title-row">
          {Icon && (
            <div className="metric-card-icon">
              <Icon aria-hidden="true" />
            </div>
          )}
          <h3 className="metric-card-title">{title}</h3>
          {status !== 'neutral' && (
            <div
              className="metric-card-status-indicator"
              style={{ backgroundColor: getStatusColor() }}
              aria-label={`Status: ${status}`}
            />
          )}
        </div>
        {description && (
          <p className="metric-card-description">{description}</p>
        )}
      </div>

      <div className="metric-card-content">
        <div className="metric-card-value-section">
          <div className="metric-card-value">{value}</div>
          {trend && (
            <div className="metric-card-trend" style={{ color: getTrendColor() }}>
              <span className={`trend-arrow trend-${trend.direction}`}>
                {trend.direction === 'up' ? '↗' : trend.direction === 'down' ? '↘' : '→'}
              </span>
              <span className="trend-percentage">
                {trend.percentage > 0 ? '+' : ''}{trend.percentage}%
              </span>
              {trend.period && (
                <span className="trend-period">{trend.period}</span>
              )}
            </div>
          )}
        </div>

        {sparklineData && sparklineData.length > 0 && (
          <div className="metric-card-sparkline">
            <LineChart
              data={sparklineData}
              height={60}
              color={resolveColor(getStatusColor())}
              fill={true}
              showGrid={false}
              valueFormatter={() => ''}
            />
          </div>
        )}
      </div>
    </div>
  );
}