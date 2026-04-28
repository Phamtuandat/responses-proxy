type StatusBadgeProps = {
  variant?: "neutral" | "success" | "warning" | "danger" | "accent";
  children: string;
};

export function StatusBadge({ variant = "neutral", children }: StatusBadgeProps) {
  return <span className={`status-badge status-badge-${variant}`}>{children}</span>;
}
