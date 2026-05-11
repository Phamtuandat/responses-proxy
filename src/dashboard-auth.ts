import { createHash, randomBytes, randomInt } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

type Database = InstanceType<typeof BetterSqlite3>;

type DashboardAuthChallengeRow = {
  id: string;
  challenge_group_id: string | null;
  telegram_user_id: string;
  otp_hash: string;
  poll_token_hash: string | null;
  expires_at: string;
  consumed_at: string | null;
  approved_at: string | null;
  approved_by_telegram_user_id: string | null;
  rejected_at: string | null;
  rejected_by_telegram_user_id: string | null;
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

export type DashboardApprovalChallenge = {
  id: string;
  displayCode: string;
  pollToken: string;
  expiresAt: string;
};

export type DashboardApprovalChallengeStatus =
  | { ok: true; status: "pending"; challengeId: string; expiresAt: string }
  | {
      ok: true;
      status: "approved";
      challengeId: string;
      expiresAt: string;
      telegramUserId: string;
    }
  | {
      ok: true;
      status: "rejected" | "expired" | "consumed";
      challengeId: string;
      expiresAt: string;
    }
  | { ok: false; reason: "invalid" };

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

  createApprovalChallenge(input: { telegramUserIds: string[]; ttlMs: number; now?: Date }): DashboardApprovalChallenge {
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + input.ttlMs).toISOString();
    const id = randomBytes(16).toString("hex");
    const displayCode = randomInt(10, 100).toString().padStart(2, "0");
    const pollToken = randomBytes(24).toString("base64url");
    const telegramUserIds = Array.from(new Set(input.telegramUserIds.filter(Boolean)));

    if (telegramUserIds.length === 0) {
      throw new Error("Cannot create dashboard approval challenge without Telegram admins.");
    }

    const insert = this.db.prepare(
      `INSERT INTO dashboard_auth_challenges (
        id,
        challenge_group_id,
        telegram_user_id,
        otp_hash,
        poll_token_hash,
        expires_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    const createdAt = now.toISOString();
    for (const telegramUserId of telegramUserIds) {
      const rowId = randomBytes(16).toString("hex");
      insert.run(rowId, id, telegramUserId, hashOtp(rowId, displayCode), hashPollToken(pollToken), expiresAt, createdAt);
    }

    return { id, displayCode, pollToken, expiresAt };
  }

  getApprovalChallengeStatus(input: { challengeId: string; pollToken: string; now?: Date }): DashboardApprovalChallengeStatus {
    const now = input.now ?? new Date();
    const row = this.getApprovalChallengeRow(input.challengeId, input.pollToken);
    if (!row) {
      return { ok: false, reason: "invalid" };
    }
    if (row.approved_at) {
      return {
        ok: true,
        status: "approved",
        challengeId: input.challengeId,
        expiresAt: row.expires_at,
        telegramUserId: row.approved_by_telegram_user_id ?? row.telegram_user_id,
      };
    }
    if (row.rejected_at) {
      return { ok: true, status: "rejected", challengeId: input.challengeId, expiresAt: row.expires_at };
    }
    if (new Date(row.expires_at).getTime() < now.getTime()) {
      return { ok: true, status: "expired", challengeId: input.challengeId, expiresAt: row.expires_at };
    }
    if (row.consumed_at) {
      return { ok: true, status: "consumed", challengeId: input.challengeId, expiresAt: row.expires_at };
    }
    return { ok: true, status: "pending", challengeId: input.challengeId, expiresAt: row.expires_at };
  }

  resolveApprovalChoice(input: {
    challengeId: string;
    telegramUserId: string;
    selectedCode: string;
    now?: Date;
  }): { ok: true; status: "approved" | "rejected" } | { ok: false; reason: "invalid" | "expired" | "consumed" } {
    const now = input.now ?? new Date();
    const row = this.getAdminChallengeRow(input.challengeId, input.telegramUserId);
    if (!row) {
      return { ok: false, reason: "invalid" };
    }
    if (row.consumed_at) {
      return { ok: false, reason: "consumed" };
    }
    if (new Date(row.expires_at).getTime() < now.getTime()) {
      return { ok: false, reason: "expired" };
    }
    if (row.approved_at || row.rejected_at) {
      return { ok: false, reason: "consumed" };
    }

    if (hashOtp(row.id, input.selectedCode) === row.otp_hash) {
      this.db
        .prepare(
          `UPDATE dashboard_auth_challenges
           SET approved_at = ?, approved_by_telegram_user_id = ?
           WHERE challenge_group_id = ?`,
        )
        .run(now.toISOString(), input.telegramUserId, input.challengeId);
      return { ok: true, status: "approved" };
    }

    this.db
      .prepare(
        `UPDATE dashboard_auth_challenges
         SET rejected_at = ?, rejected_by_telegram_user_id = ?
         WHERE challenge_group_id = ?`,
      )
      .run(now.toISOString(), input.telegramUserId, input.challengeId);
    return { ok: true, status: "rejected" };
  }

  consumeApprovedChallenge(input: { challengeId: string; pollToken: string; now?: Date }): { ok: true; telegramUserId: string; expiresAt: string } | { ok: false; reason: "invalid" | "expired" | "pending" | "rejected" | "consumed" } {
    const now = input.now ?? new Date();
    const row = this.getApprovalChallengeRow(input.challengeId, input.pollToken);
    if (!row) {
      return { ok: false, reason: "invalid" };
    }
    if (row.rejected_at) {
      return { ok: false, reason: "rejected" };
    }
    if (new Date(row.expires_at).getTime() < now.getTime()) {
      return { ok: false, reason: "expired" };
    }
    if (!row.approved_at) {
      return { ok: false, reason: "pending" };
    }
    if (row.consumed_at) {
      return { ok: false, reason: "consumed" };
    }

    this.db
      .prepare(
        `UPDATE dashboard_auth_challenges
         SET consumed_at = ?
         WHERE challenge_group_id = ?`,
      )
      .run(now.toISOString(), input.challengeId);

    return {
      ok: true,
      telegramUserId: row.approved_by_telegram_user_id ?? row.telegram_user_id,
      expiresAt: row.expires_at,
    };
  }

  consumeChallenge(input: { telegramUserId: string; otp: string; now?: Date }): { ok: true; challengeId: string; telegramUserId: string } | { ok: false; reason: "invalid" | "expired" } {
    return this.consumeChallengeForUsers({ telegramUserIds: [input.telegramUserId], otp: input.otp, now: input.now });
  }

  consumeChallengeForUsers(input: { telegramUserIds: string[]; otp: string; now?: Date }): { ok: true; challengeId: string; telegramUserId: string } | { ok: false; reason: "invalid" | "expired" } {
    const now = input.now ?? new Date();
    const userIds = Array.from(new Set(input.telegramUserIds.filter(Boolean)));
    if (userIds.length === 0) {
      return { ok: false, reason: "invalid" };
    }

    const placeholders = userIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT * FROM dashboard_auth_challenges
         WHERE telegram_user_id IN (${placeholders})
           AND consumed_at IS NULL
         ORDER BY created_at DESC
         LIMIT 20`,
      )
      .all(...userIds) as DashboardAuthChallengeRow[];

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
      return { ok: true, challengeId: row.id, telegramUserId: row.telegram_user_id };
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

  private getApprovalChallengeRow(challengeId: string, pollToken: string): DashboardAuthChallengeRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM dashboard_auth_challenges
         WHERE challenge_group_id = ?
           AND poll_token_hash = ?
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .get(challengeId, hashPollToken(pollToken)) as DashboardAuthChallengeRow | undefined;
  }

  private getAdminChallengeRow(challengeId: string, telegramUserId: string): DashboardAuthChallengeRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM dashboard_auth_challenges
         WHERE challenge_group_id = ?
           AND telegram_user_id = ?
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .get(challengeId, telegramUserId) as DashboardAuthChallengeRow | undefined;
  }
}

function ensureDashboardAuthSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dashboard_auth_challenges (
      id TEXT PRIMARY KEY,
      challenge_group_id TEXT,
      telegram_user_id TEXT NOT NULL,
      otp_hash TEXT NOT NULL,
      poll_token_hash TEXT,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      approved_at TEXT,
      approved_by_telegram_user_id TEXT,
      rejected_at TEXT,
      rejected_by_telegram_user_id TEXT,
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

  ensureColumn(db, "dashboard_auth_challenges", "challenge_group_id", "TEXT");
  ensureColumn(db, "dashboard_auth_challenges", "poll_token_hash", "TEXT");
  ensureColumn(db, "dashboard_auth_challenges", "approved_at", "TEXT");
  ensureColumn(db, "dashboard_auth_challenges", "approved_by_telegram_user_id", "TEXT");
  ensureColumn(db, "dashboard_auth_challenges", "rejected_at", "TEXT");
  ensureColumn(db, "dashboard_auth_challenges", "rejected_by_telegram_user_id", "TEXT");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_dashboard_auth_challenges_group
      ON dashboard_auth_challenges(challenge_group_id, telegram_user_id, created_at);
  `);
}

function hashOtp(challengeId: string, otp: string): string {
  return createHash("sha256").update(`${challengeId}:${otp}`).digest("hex");
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashPollToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function ensureColumn(db: Database, tableName: string, columnName: string, columnDefinition: string): void {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}
