import type { ReactNode } from "react";

type SurfaceCardProps = {
  title?: string;
  description?: string;
  children?: ReactNode;
};

export function SurfaceCard({ title, description, children }: SurfaceCardProps) {
  return (
    <section className="surface-card">
      {title ? <h2>{title}</h2> : null}
      {description ? <p>{description}</p> : null}
      {children ? <div className="surface-card-body">{children}</div> : null}
    </section>
  );
}
