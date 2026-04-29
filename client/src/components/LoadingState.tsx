type LoadingStateProps = {
  title?: string;
  description?: string;
  cards?: number;
};

export function LoadingState({
  title = "Loading data",
  description = "Reading live service data and workspace settings.",
  cards = 4,
}: LoadingStateProps) {
  return (
    <section className="loading-state">
      <div className="loading-copy">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="stat-grid">
        {Array.from({ length: cards }).map((_, index) => (
          <div className="skeleton-card" key={index}>
            <div className="skeleton-line skeleton-line-sm" />
            <div className="skeleton-line skeleton-line-lg" />
            <div className="skeleton-line skeleton-line-md" />
          </div>
        ))}
      </div>
    </section>
  );
}
