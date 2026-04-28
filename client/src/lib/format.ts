export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function formatNumber(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "Not reported";
}

export function formatPercent(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(value % 1 === 0 ? 0 : 1)}%` : "Not reported";
}

export function formatDateTime(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return "Not reported";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

export function formatUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value.trim() || "Not reported";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toLocaleString();
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return "Not reported";
}
