import { appendFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

type SessionLogEntry = Record<string, unknown>;
export type SessionLogCacheMetricsStore = {
  recordCacheResult(
    sessionKey: string,
    cachedTokens: number | undefined,
  ): { cacheHit: boolean; consecutiveCacheHits: number } | undefined;
};
const LATEST_DIR_NAME = "latest";
const DATE_DIR_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_HIT_STREAK_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_CACHE_HIT_STREAK_SESSIONS = 2000;

let lastCleanupStartedAt = 0;
let cleanupPromise: Promise<void> | undefined;
const cacheHitStreakBySession = new Map<string, { count: number; updatedAt: number }>();

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
  options?: {
    cacheMetricsStore?: SessionLogCacheMetricsStore;
  },
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
      const enrichedEntry = enrichCacheMetrics(
        sessionKey,
        entry,
        options?.cacheMetricsStore,
      );
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
  cacheMetricsStore?: SessionLogCacheMetricsStore,
): SessionLogEntry {
  const cachedTokens = typeof entry.cachedTokens === "number" ? entry.cachedTokens : undefined;
  if (cachedTokens === undefined) {
    return entry;
  }

  const persistedState = cacheMetricsStore?.recordCacheResult(sessionKey, cachedTokens);
  if (persistedState) {
    return {
      ...entry,
      cacheHit: persistedState.cacheHit,
      consecutiveCacheHits: persistedState.consecutiveCacheHits,
    };
  }

  pruneCacheHitStreaks();
  const cacheHit = cachedTokens > 0;
  const now = Date.now();
  const consecutiveCacheHits = cacheHit
    ? (cacheHitStreakBySession.get(sessionKey)?.count ?? 0) + 1
    : 0;
  cacheHitStreakBySession.set(sessionKey, {
    count: consecutiveCacheHits,
    updatedAt: now,
  });

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

function pruneCacheHitStreaks(): void {
  const now = Date.now();
  for (const [sessionKey, state] of cacheHitStreakBySession) {
    if (now - state.updatedAt > CACHE_HIT_STREAK_TTL_MS) {
      cacheHitStreakBySession.delete(sessionKey);
    }
  }

  if (cacheHitStreakBySession.size <= MAX_CACHE_HIT_STREAK_SESSIONS) {
    return;
  }

  const overflow = cacheHitStreakBySession.size - MAX_CACHE_HIT_STREAK_SESSIONS;
  let removed = 0;
  for (const sessionKey of cacheHitStreakBySession.keys()) {
    cacheHitStreakBySession.delete(sessionKey);
    removed += 1;
    if (removed >= overflow) {
      break;
    }
  }
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
