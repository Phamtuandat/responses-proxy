import { appendFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

type SessionLogEntry = Record<string, unknown>;
const LATEST_DIR_NAME = "latest";
const DATE_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

let lastCleanupStartedAt = 0;
let cleanupPromise: Promise<void> | undefined;
const cacheHitStreakBySession = new Map<string, number>();

export type SessionLogContext = {
  sessionKey: string;
  sessionFileFor(date?: Date): string;
  latestSessionFile(): string;
  write(entry: SessionLogEntry): Promise<void>;
};

export function deriveSessionKey(
  body: Record<string, unknown>,
  traceContext: Record<string, unknown>,
): string {
  const promptCacheKey = readString(traceContext.promptCacheKey) ?? readString(body.prompt_cache_key);
  if (promptCacheKey) {
    return promptCacheKey;
  }

  const metadataUserId = readString(traceContext.metadataUserId);
  if (metadataUserId) {
    return metadataUserId;
  }

  const previousResponseId = readString(body.previous_response_id);
  if (previousResponseId) {
    return previousResponseId;
  }

  const user = readString(body.user);
  if (user) {
    return user;
  }

  return "unknown-session";
}

export function createSessionLogContext(
  logDir: string,
  sessionKey: string,
  retentionDays = 14,
): SessionLogContext {
  const fileName = `${sanitizeFileName(sessionKey)}.jsonl`;
  const sessionFileFor = (date = new Date()): string =>
    path.join(logDir, formatLocalDate(date), fileName);
  const latestSessionFile = (): string => path.join(logDir, LATEST_DIR_NAME, fileName);

  return {
    sessionKey,
    sessionFileFor,
    latestSessionFile,
    async write(entry: SessionLogEntry): Promise<void> {
      const now = new Date();
      const sessionFile = sessionFileFor(now);
      const latestFile = latestSessionFile();
      await Promise.all([
        mkdir(path.dirname(sessionFile), { recursive: true }),
        mkdir(path.dirname(latestFile), { recursive: true }),
      ]);
      const enrichedEntry = enrichCacheMetrics(sessionKey, entry);
      const payload = JSON.stringify({
        ts: now.toISOString(),
        sessionKey,
        ...enrichedEntry,
      });
      await Promise.all([
        appendFile(sessionFile, `${payload}\n`, "utf8"),
        appendFile(latestFile, `${payload}\n`, "utf8"),
      ]);
      scheduleRetentionCleanup(logDir, retentionDays);
    },
  };
}

function enrichCacheMetrics(
  sessionKey: string,
  entry: SessionLogEntry,
): SessionLogEntry {
  const cachedTokens = typeof entry.cachedTokens === "number" ? entry.cachedTokens : undefined;
  if (cachedTokens === undefined) {
    return entry;
  }

  const cacheHit = cachedTokens > 0;
  const consecutiveCacheHits = cacheHit
    ? (cacheHitStreakBySession.get(sessionKey) ?? 0) + 1
    : 0;
  cacheHitStreakBySession.set(sessionKey, consecutiveCacheHits);

  return {
    ...entry,
    cacheHit,
    consecutiveCacheHits,
  };
}

function scheduleRetentionCleanup(logDir: string, retentionDays: number): void {
  if (retentionDays <= 0) {
    return;
  }

  const now = Date.now();
  if (cleanupPromise) {
    return;
  }
  if (now - lastCleanupStartedAt < 60_000) {
    return;
  }

  lastCleanupStartedAt = now;
  cleanupPromise = cleanupOldLogDirs(logDir, retentionDays).finally(() => {
    cleanupPromise = undefined;
  });
}

async function cleanupOldLogDirs(logDir: string, retentionDays: number): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(logDir);
  } catch (error) {
    if (isMissingPathError(error)) {
      return;
    }
    throw error;
  }

  const cutoff = startOfLocalDay(new Date());
  cutoff.setDate(cutoff.getDate() - retentionDays);

  await Promise.all(
    entries
      .filter((entry) => entry !== LATEST_DIR_NAME && DATE_DIR_PATTERN.test(entry))
      .filter((entry) => {
        const parsed = parseLocalDate(entry);
        return parsed !== undefined && parsed.getTime() < cutoff.getTime();
      })
      .map((entry) => rm(path.join(logDir, entry), { recursive: true, force: true })),
  );
}

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function parseLocalDate(value: string): Date | undefined {
  const match = DATE_DIR_PATTERN.exec(value);
  if (!match) {
    return undefined;
  }

  const [year, month, day] = value.split("-").map((part) => Number(part));
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return undefined;
  }
  return parsed;
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function sanitizeFileName(value: string): string {
  const compact = value.trim().replace(/[^\w.-]+/g, "_");
  const sanitized = compact.replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized || "unknown-session";
}

function formatLocalDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
