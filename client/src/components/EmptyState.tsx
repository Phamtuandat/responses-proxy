type EmptyStateProps = {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
};

export function EmptyState({
  title,
  description,
  actionHref,
  actionLabel,
}: EmptyStateProps) {
  return (
    <section className="empty-state">
      <p className="eyebrow">Workspace</p>
      <h2>{title}</h2>
      <p>{description}</p>
      {actionHref && actionLabel ? (
        <a className="button-link" href={actionHref}>
          {actionLabel}
        </a>
      ) : null}
    </section>
  );
}
