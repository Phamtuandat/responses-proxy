type ErrorStateProps = {
  title: string;
  description: string;
  onRetry?: () => void;
};

export function ErrorState({ title, description, onRetry }: ErrorStateProps) {
  return (
    <section className="error-state">
      <p className="eyebrow">Read-only endpoint</p>
      <h2>{title}</h2>
      <p>{description}</p>
      {onRetry ? (
        <button className="button-link" onClick={onRetry} type="button">
          Retry
        </button>
      ) : null}
    </section>
  );
}
