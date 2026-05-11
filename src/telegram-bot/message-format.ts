export function formatMessage(title: string, lines: Array<string | undefined | false | null>): string {
  return [title, ...lines.filter(Boolean)].join("\n");
}

export function formatSection(title: string, lines: Array<string | undefined | false | null>): string {
  const visibleLines = lines.filter(Boolean);
  return visibleLines.length > 0 ? [title, ...visibleLines].join("\n") : title;
}

export function formatField(label: string, value: unknown): string {
  return `• ${label}: ${value ?? "none"}`;
}

const DISPLAY_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("vi-VN", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "none";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  const parts = DISPLAY_DATE_TIME_FORMATTER.formatToParts(date);
  const lookup = new Map(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const day = lookup.get("day");
  const month = lookup.get("month");
  const year = lookup.get("year");
  const hour = lookup.get("hour");
  const minute = lookup.get("minute");
  if (!day || !month || !year || !hour || !minute) {
    return DISPLAY_DATE_TIME_FORMATTER.format(date);
  }
  return `${day}/${month}/${year} ${hour}:${minute}`;
}

export function formatRawField(label: string, value: unknown): string {
  return `${label}: ${value ?? "none"}`;
}

export function formatEmptyState(title: string, hint: string): string {
  return [title, hint].join("\n");
}
