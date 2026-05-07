import { createHash, randomBytes, randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

type Database = InstanceType<typeof BetterSqlite3>;

type DashboardAuthChallengeRow = {
  id: string;
  telegram_user_id: string;
  otp_hash: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

type DashboardAuthSessionRow = {
  id: string;
  session_hash: string;
  telegram_user_id: string;
  role: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type DashboardAuthSession = {
  id: string;
  telegramUserId: string;
  role: "admin";
  expiresAt: string;
};

export type DashboardLoginChallenge = {
  id: string;
  telegramUserId: string;
  otp: string;
  expiresAt: string;
};

export class DashboardAuthRepository {
  private constructor(private readonly db: Database) {}

  static create(dbFile: string): DashboardAuthRepository {
    mkdirSync(path.dirname(dbFile), { recursive: true });
    const db = new BetterSqlite3(dbFile);
    ensureDashboardAuthSchema(db);
    return new DashboardAuthRepository(db);
  }

  createChallenge(input: { telegramUserId: string; ttlMs: number; now?: Date }): DashboardLoginChallenge {
    const now = input.now ?? new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + input.ttlMs).toISOString();
    const id = randomBytes(16).toString("hex");
    const otp = randomInt(0, 1_000_000).toString().padStart(6, "0");
    this.db
      .prepare(
        `INSERT INTO dashboard_auth_challenges (
          id,
          telegram_user_id,
          otp_hash,
          expires_at,
          created_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.telegramUserId, hashOtp(id, otp), expiresAt, createdAt);
    return { id, telegramUserId: input.telegramUserId, otp, expiresAt };
  }

  consumeChallenge(input: { telegramUserId: string; otp: string; now?: Date }): { ok: true; challengeId: string } | { ok: false; reason: "invalid" | "expired" } {
    const now = input.now ?? new Date();
    const rows = this.db
      .prepare(
        `SELECT * FROM dashboard_auth_challenges
         WHERE telegram_user_id = ?
           AND consumed_at IS NULL
         ORDER BY created_at DESC
         LIMIT 5`,
      )
      .all(input.telegramUserId) as DashboardAuthChallengeRow[];

    for (const row of rows) {
      if (hashOtp(row.id, input.otp) !== row.otp_hash) {
        continue;
      }
      if (new Date(row.expires_at).getTime() < now.getTime()) {
        return { ok: false, reason: "expired" };
      }
      this.db
        .prepare(
          `UPDATE dashboard_auth_challenges
           SET consumed_at = ?
           WHERE id = ?`,
        )
        .run(now.toISOString(), row.id);
      return { ok: true, challengeId: row.id };
    }

    return { ok: false, reason: "invalid" };
  }

  createSession(input: { telegramUserId: string; ttlMs: number; now?: Date }): { token: string; session: DashboardAuthSession } {
    const now = input.now ?? new Date();
    const timestamp = now.toISOString();
    const expiresAt = new Date(now.getTime() + input.ttlMs).toISOString();
    const id = randomBytes(16).toString("hex");
    const token = randomBytes(32).toString("base64url");
    this.db
      .prepare(
        `INSERT INTO dashboard_auth_sessions (
          id,
          session_hash,
          telegram_user_id,
          role,
          expires_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, 'admin', ?, ?, ?)`,
      )
      .run(id, hashSessionToken(token), input.telegramUserId, expiresAt, timestamp, timestamp);
    return {
      token,
      session: {
        id,
        telegramUserId: input.telegramUserId,
        role: "admin",
        expiresAt,
      },
    };
  }

  getSessionByToken(token: string | undefined, now: Date = new Date()): DashboardAuthSession | undefined {
    if (!token) {
      return undefined;
    }
    const row = this.db
      .prepare(
        `SELECT * FROM dashboard_auth_sessions
         WHERE session_hash = ?
           AND revoked_at IS NULL
         LIMIT 1`,
      )
      .get(hashSessionToken(token)) as DashboardAuthSessionRow | undefined;
    if (!row || new Date(row.expires_at).getTime() < now.getTime()) {
      return undefined;
    }
    return {
      id: row.id,
      telegramUserId: row.telegram_user_id,
      role: "admin",
      expiresAt: row.expires_at,
    };
  }

  revokeSessionByToken(token: string | undefined, now: Date = new Date()): boolean {
    if (!token) {
      return false;
    }
    const timestamp = now.toISOString();
    const result = this.db
      .prepare(
        `UPDATE dashboard_auth_sessions
         SET revoked_at = ?, updated_at = ?
         WHERE session_hash = ?
           AND revoked_at IS NULL`,
      )
      .run(timestamp, timestamp, hashSessionToken(token));
    return result.changes > 0;
  }
}

function ensureDashboardAuthSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dashboard_auth_challenges (
      id TEXT PRIMARY KEY,
      telegram_user_id TEXT NOT NULL,
      otp_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_dashboard_auth_challenges_user
      ON dashboard_auth_challenges(telegram_user_id, consumed_at, created_at);

    CREATE TABLE IF NOT EXISTS dashboard_auth_sessions (
      id TEXT PRIMARY KEY,
      session_hash TEXT NOT NULL UNIQUE,
      telegram_user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_dashboard_auth_sessions_hash
      ON dashboard_auth_sessions(session_hash, revoked_at, expires_at);
  `);
}

function hashOtp(challengeId: string, otp: string): string {
  return createHash("sha256").update(`${challengeId}:${otp}`).digest("hex");
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
