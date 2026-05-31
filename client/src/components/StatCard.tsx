import type { ComponentType, SVGProps } from "react";

type StatCardTone = "default" | "success" | "warning" | "danger";

type StatCardProps = {
  label: string;
  value: string;
  caption?: string;
  tone?: StatCardTone;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
};

export function StatCard({ label, value, caption, tone = "default", icon: Icon }: StatCardProps) {
  const className = tone === "default" ? "stat-card" : `stat-card stat-card-${tone}`;

  return (
    <article className={className}>
      <div className="stat-card-head">
        <span>{label}</span>
        {Icon ? (
          <span className="stat-card-icon" aria-hidden="true">
            <Icon />
          </span>
        ) : null}
      </div>
      <strong>{value}</strong>
      {caption ? <p>{caption}</p> : null}
    </article>
  );
}
