export type LoadingSkeletonProps = {
  variant?: 'text' | 'card' | 'table-row' | 'metric-card';
  lines?: number;
  height?: string;
  width?: string;
  className?: string;
};

export function LoadingSkeleton({
  variant = 'text',
  lines = 3,
  height,
  width,
  className = '',
}: LoadingSkeletonProps) {
  if (variant === 'text') {
    return (
      <div className={`skeleton-container ${className}`}>
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className="skeleton skeleton-text"
            style={{ width: i === lines - 1 ? '60%' : '100%' }}
          />
        ))}
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div className={`skeleton skeleton-card ${className}`} style={{ height, width }} />
    );
  }

  if (variant === 'table-row') {
    return (
      <div className={`skeleton skeleton-table-row ${className}`} style={{ height, width }} />
    );
  }

  if (variant === 'metric-card') {
    return (
      <div className={`skeleton-metric-card ${className}`}>
        <div className="skeleton skeleton-text" style={{ width: '40%', height: '14px' }} />
        <div className="skeleton skeleton-text" style={{ width: '60%', height: '32px', marginTop: '8px' }} />
        <div className="skeleton skeleton-text" style={{ width: '30%', height: '12px', marginTop: '4px' }} />
      </div>
    );
  }

  return (
    <div className={`skeleton ${className}`} style={{ height, width }} />
  );
}