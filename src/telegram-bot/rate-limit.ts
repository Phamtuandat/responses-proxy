import { mkdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import type { Context, MiddlewareFn } from "grammy";

type Database = InstanceType<typeof BetterSqlite3>;

type RateLimitRow = {
  user_id: string;
  window_started_at: number;
  hit_count: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

export class SqliteRateLimiter {
  private constructor(
    private readonly db: Database,
    private readonly windowMs: number,
    private readonly maxRequests: number,
  ) {}

  static create(dbFile: string, options: { windowMs: number; maxRequests: number }): SqliteRateLimiter {
    mkdirSync(path.dirname(dbFile), { recursive: true });
    const db = new BetterSqlite3(dbFile);
    ensureRateLimitSchema(db);
    return new SqliteRateLimiter(db, options.windowMs, options.maxRequests);
  }

  consume(userId: string, nowMs = Date.now()): RateLimitResult {
    this.pruneExpired(nowMs);
    const row = this.db
      .prepare(
        `SELECT user_id, window_started_at, hit_count
         FROM telegram_bot_rate_limits
         WHERE user_id = ?`,
      )
      .get(userId) as RateLimitRow | undefined;

    if (!row || nowMs - row.window_started_at >= this.windowMs) {
      this.db
        .prepare(
          `INSERT INTO telegram_bot_rate_limits (user_id, window_started_at, hit_count)
           VALUES (?, ?, 1)
           ON CONFLICT(user_id) DO UPDATE SET
             window_started_at = excluded.window_started_at,
             hit_count = excluded.hit_count`,
        )
        .run(userId, nowMs);
      return {
        allowed: true,
        remaining: Math.max(this.maxRequests - 1, 0),
        retryAfterMs: 0,
      };
    }

    if (row.hit_count >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(this.windowMs - (nowMs - row.window_started_at), 0),
      };
    }

    const nextCount = row.hit_count + 1;
    this.db
      .prepare("UPDATE telegram_bot_rate_limits SET hit_count = ? WHERE user_id = ?")
      .run(nextCount, userId);
    return {
      allowed: true,
      remaining: Math.max(this.maxRequests - nextCount, 0),
      retryAfterMs: 0,
    };
  }

  private pruneExpired(nowMs: number): void {
    this.db
      .prepare("DELETE FROM telegram_bot_rate_limits WHERE (? - window_started_at) >= ?")
      .run(nowMs, this.windowMs);
  }
}

export function createRateLimitMiddleware(rateLimiter: SqliteRateLimiter): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const userId = ctx.from?.id?.toString();
    if (!userId) {
      await next();
      return;
    }

    const result = rateLimiter.consume(userId);
    if (result.allowed) {
      await next();
      return;
    }

    const retryAfterSeconds = Math.max(Math.ceil(result.retryAfterMs / 1000), 1);
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({
        text: `Rate limit exceeded. Try again in ${retryAfterSeconds}s.`,
        show_alert: true,
      });
      return;
    }

    await ctx.reply(`Rate limit exceeded. Try again in ${retryAfterSeconds}s.`);
  };
}

function ensureRateLimitSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_bot_rate_limits (
      user_id TEXT PRIMARY KEY,
      window_started_at INTEGER NOT NULL,
      hit_count INTEGER NOT NULL
    );
  `);
}
