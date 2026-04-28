type ConfirmDialogProps = {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  isSubmitting?: boolean;
};

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  isSubmitting = false,
}: ConfirmDialogProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div aria-modal="true" className="modal-card modal-card-sm" role="dialog">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Confirm action</p>
            <h2>{title}</h2>
          </div>
        </div>
        <p className="modal-copy">{description}</p>
        <div className="modal-actions">
          <button className="button-link" disabled={isSubmitting} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="button-link button-danger" disabled={isSubmitting} onClick={onConfirm} type="button">
            {isSubmitting ? "Deleting..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
