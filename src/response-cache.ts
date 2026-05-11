import { mkdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

export type ResponseCacheEntry = {
  requestKey: string;
  providerId: string;
  payload: unknown;
  createdAt: number;
  expiresAt: number;
};

export class ResponseCacheStore {
  private constructor(private readonly db: InstanceType<typeof BetterSqlite3>) {}

  static create(dbFile: string): ResponseCacheStore {
    mkdirSync(path.dirname(dbFile), { recursive: true });
    const db = new BetterSqlite3(dbFile);
    db.exec(`
      CREATE TABLE IF NOT EXISTS response_cache (
        request_key TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (request_key, provider_id)
      );
      CREATE INDEX IF NOT EXISTS idx_response_cache_expires
        ON response_cache(expires_at);
    `);
    return new ResponseCacheStore(db);
  }

  get(requestKey: string, providerId: string): unknown | undefined {
    const nowMs = Date.now();
    const row = this.db
      .prepare(
        `SELECT payload FROM response_cache
         WHERE request_key = ? AND provider_id = ? AND expires_at > ?`,
      )
      .get(requestKey, providerId, nowMs) as { payload: string } | undefined;
    if (!row) {
      return undefined;
    }
    try {
      return JSON.parse(row.payload);
    } catch {
      return undefined;
    }
  }

  set(requestKey: string, providerId: string, payload: unknown, ttlMs: number): void {
    const nowMs = Date.now();
    this.db
      .prepare(
        `INSERT INTO response_cache (request_key, provider_id, payload, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(request_key, provider_id) DO UPDATE SET
           payload = excluded.payload,
           created_at = excluded.created_at,
           expires_at = excluded.expires_at`,
      )
      .run(requestKey, providerId, JSON.stringify(payload), nowMs, nowMs + ttlMs);
  }

  prune(): number {
    const result = this.db
      .prepare("DELETE FROM response_cache WHERE expires_at <= ?")
      .run(Date.now());
    return result.changes;
  }

  stats(): { totalEntries: number; expiredEntries: number; estimatedBytes: number } {
    const nowMs = Date.now();
    const total = (this.db.prepare("SELECT COUNT(*) AS n FROM response_cache").get() as { n: number }).n;
    const expired = (
      this.db.prepare("SELECT COUNT(*) AS n FROM response_cache WHERE expires_at <= ?").get(nowMs) as { n: number }
    ).n;
    const bytes = (this.db.prepare("SELECT COALESCE(SUM(LENGTH(payload)), 0) AS b FROM response_cache").get() as { b: number }).b;
    return { totalEntries: total, expiredEntries: expired, estimatedBytes: bytes };
  }

  flush(): number {
    return this.db.prepare("DELETE FROM response_cache").run().changes;
  }
}
