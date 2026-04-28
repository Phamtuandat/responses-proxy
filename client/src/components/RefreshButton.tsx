type RefreshButtonProps = {
  onClick: () => void;
  label?: string;
};

export function RefreshButton({ onClick, label = "Refresh" }: RefreshButtonProps) {
  return (
    <button className="refresh-button" onClick={onClick} type="button">
      {label}
    </button>
  );
}
