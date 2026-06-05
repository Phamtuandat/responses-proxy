import type { ComponentType, ReactNode, SVGProps } from "react";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
};

export function PageHeader({ eyebrow, title, description, actions, icon: Icon }: PageHeaderProps) {
  return (
    <section className="page-header" aria-labelledby="page-title">
      <div className="page-header-copy">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <div className="page-header-title-row" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          {Icon && (
            <span className="page-header-icon-container" aria-hidden="true" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon className="page-header-icon" style={{ width: "1.75rem", height: "1.75rem", color: "var(--accent)" }} />
            </span>
          )}
          <h1 id="page-title" style={{ margin: 0 }}>{title}</h1>
        </div>
        <p>{description}</p>
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </section>
  );
}

