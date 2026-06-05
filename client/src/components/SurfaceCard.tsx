import type { ReactNode, CSSProperties } from "react";

type SurfaceCardProps = {
  title?: string;
  description?: string;
  children?: ReactNode;
  className?: string;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "info";
  style?: CSSProperties;
};

export function SurfaceCard({
  title,
  description,
  children,
  className = "",
  actions,
  eyebrow,
  tone = "default",
  style,
}: SurfaceCardProps) {
  const cardClassName = [
    "surface-card",
    tone !== "default" ? `surface-card-${tone}` : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={cardClassName} style={style}>
      {(title || eyebrow || actions) && (
        <div className="surface-card-header">
          <div className="surface-card-title-group">
            {eyebrow && <div className="surface-card-eyebrow">{eyebrow}</div>}
            {title && <h2>{title}</h2>}
          </div>
          {actions && <div className="surface-card-actions">{actions}</div>}
        </div>
      )}
      {description && <p className="surface-card-desc">{description}</p>}
      {children && <div className="surface-card-body">{children}</div>}
    </section>
  );
}
