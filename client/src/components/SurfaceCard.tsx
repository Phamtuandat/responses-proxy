import type { ReactNode } from "react";

type SurfaceCardProps = {
  title?: string;
  description?: string;
  children?: ReactNode;
  className?: string;
};

export function SurfaceCard({ title, description, children, className }: SurfaceCardProps) {
  return (
    <section className={className ? `surface-card ${className}` : "surface-card"}>
      {title ? <h2>{title}</h2> : null}
      {description ? <p>{description}</p> : null}
      {children ? <div className="surface-card-body">{children}</div> : null}
    </section>
  );
}
