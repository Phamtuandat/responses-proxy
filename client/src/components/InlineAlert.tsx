type InlineAlertProps = {
  variant?: "success" | "error";
  title?: string;
  message: string;
};

export function InlineAlert({ variant = "success", title, message }: InlineAlertProps) {
  return (
    <div className={variant === "error" ? "inline-alert inline-alert-error" : "inline-alert inline-alert-success"} role="status">
      {title ? <strong>{title}</strong> : null}
      <span>{message}</span>
    </div>
  );
}
