import { RefreshIcon } from "./icons";

type RefreshButtonProps = {
  onClick: () => void;
  label?: string;
  isRefreshing?: boolean;
};

export function RefreshButton({ onClick, label = "Refresh", isRefreshing = false }: RefreshButtonProps) {
  return (
    <button
      className="refresh-button"
      onClick={onClick}
      type="button"
      data-refreshing={isRefreshing ? "true" : "false"}
      disabled={isRefreshing}
      aria-busy={isRefreshing}
    >
      <span className="refresh-icon" aria-hidden="true">
        <RefreshIcon width={16} height={16} />
      </span>
      <span>{isRefreshing ? "Refreshing…" : label}</span>
    </button>
  );
}
