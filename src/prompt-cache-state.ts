import { mkdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

type Database = InstanceType<typeof BetterSqlite3>;

const DEFAULT_CACHE_HIT_STREAK_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_CACHE_HIT_STREAK_SESSIONS = 2000;

export type PromptCacheObservation = {
  requestId: string;
  providerId?: string;
  clientRoute?: string;
  model?: string;
  familyId?: string;
  staticKey?: string;
  requestKey?: string;
  promptCacheKey?: string;
  promptCacheRetention?: string;
  upstreamTarget?: string;
  truncation?: string;
  reasoningEffort?: string;
  reasoningSummary?: string;
  textVerbosity?: string;
  cachedTokens?: number;
  cacheSavedPercent?: number;
  cacheHit?: boolean;
  consecutiveCacheHits?: number;
  stream: boolean;
  timestamp: string;
};

type PromptCacheObservationRow = {
  scope: string;
  payload: string;
  updated_at: string;
};

type PromptCacheSessionRow = {
  session_key: string;
  consecutive_cache_hits: number;
  updated_at: number;
};

export class PromptCacheStateStore {
  private constructor(private readonly db: Database) {}

  static create(dbFile: string): PromptCacheStateStore {
    mkdirSync(path.dirname(dbFile), { recursive: true });
    const db = new BetterSqlite3(dbFile);
    ensureSchema(db);
    return new PromptCacheStateStore(db);
  }

  loadLatestObservations(): {
    latest?: PromptCacheObservation;
    byProvider: Map<string, PromptCacheObservation>;
  } {
    const rows = this.db
      .prepare(
        `SELECT scope, payload, updated_at
         FROM prompt_cache_observations
         ORDER BY updated_at DESC, scope ASC`,
      )
      .all() as PromptCacheObservationRow[];

    const byProvider = new Map<string, PromptCacheObservation>();
    let latest: PromptCacheObservation | undefined;

    for (const row of rows) {
      const observation = parseObservation(row.payload);
      if (!observation) {
        continue;
      }

      if (!latest || observation.timestamp > latest.timestamp) {
        latest = observation;
      }

      if (row.scope.startsWith("provider:") && observation.providerId) {
        const existing = byProvider.get(observation.providerId);
        if (!existing || observation.timestamp > existing.timestamp) {
          byProvider.set(observation.providerId, observation);
        }
      }
    }

    return {
      latest,
      byProvider,
    };
  }

  saveLatestObservation(observation: PromptCacheObservation): void {
    const payload = JSON.stringify(observation);
    const upsert = this.db.prepare(`
      INSERT INTO prompt_cache_observations (scope, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(scope) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `);

    this.db.exec("BEGIN");
    try {
      upsert.run("latest", payload, observation.timestamp);
      if (observation.providerId) {
        upsert.run(`provider:${observation.providerId}`, payload, observation.timestamp);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  recordCacheResult(
    sessionKey: string,
    cachedTokens: number | undefined,
    options: {
      nowMs?: number;
      ttlMs?: number;
      maxSessions?: number;
    } = {},
  ): { cacheHit: boolean; consecutiveCacheHits: number } | undefined {
    if (cachedTokens === undefined) {
      return undefined;
    }

    const nowMs = options.nowMs ?? Date.now();
    const ttlMs = options.ttlMs ?? DEFAULT_CACHE_HIT_STREAK_TTL_MS;
    const maxSessions = options.maxSessions ?? DEFAULT_MAX_CACHE_HIT_STREAK_SESSIONS;
    const cacheHit = cachedTokens > 0;

    this.pruneExpiredSessionStates(nowMs, ttlMs);

    const existing = this.db
      .prepare(
        `SELECT session_key, consecutive_cache_hits, updated_at
         FROM prompt_cache_sessions
         WHERE session_key = ?`,
      )
      .get(sessionKey) as PromptCacheSessionRow | undefined;

    const previousHits =
      existing && nowMs - existing.updated_at <= ttlMs ? existing.consecutive_cache_hits : 0;
    const consecutiveCacheHits = cacheHit ? previousHits + 1 : 0;

    this.db
      .prepare(
        `INSERT INTO prompt_cache_sessions (session_key, consecutive_cache_hits, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(session_key) DO UPDATE SET
           consecutive_cache_hits = excluded.consecutive_cache_hits,
           updated_at = excluded.updated_at`,
      )
      .run(sessionKey, consecutiveCacheHits, nowMs);

    this.trimOverflowSessions(maxSessions);

    return {
      cacheHit,
      consecutiveCacheHits,
    };
  }

  private pruneExpiredSessionStates(nowMs: number, ttlMs: number): void {
    this.db
      .prepare("DELETE FROM prompt_cache_sessions WHERE updated_at < ?")
      .run(nowMs - ttlMs);
  }

  private trimOverflowSessions(maxSessions: number): void {
    const row = this.db
      .prepare("SELECT COUNT(*) AS total FROM prompt_cache_sessions")
      .get() as { total: number };
    const overflow = row.total - maxSessions;
    if (overflow <= 0) {
      return;
    }

    this.db
      .prepare(
        `DELETE FROM prompt_cache_sessions
         WHERE session_key IN (
           SELECT session_key
           FROM prompt_cache_sessions
           ORDER BY updated_at ASC, session_key ASC
           LIMIT ?
         )`,
      )
      .run(overflow);
  }
}

function ensureSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_cache_observations (
      scope TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompt_cache_sessions (
      session_key TEXT PRIMARY KEY,
      consecutive_cache_hits INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_prompt_cache_sessions_updated_at
    ON prompt_cache_sessions(updated_at);
  `);
}

function parseObservation(value: string): PromptCacheObservation | undefined {
  try {
    const parsed = JSON.parse(value) as PromptCacheObservation;
    return parsed && typeof parsed.requestId === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}
