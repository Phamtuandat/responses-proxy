import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

type Database = InstanceType<typeof BetterSqlite3>;

export type TelegramBotSession =
  | {
      kind: "awaiting_test_prompt";
      model?: string;
    }
  | {
      kind: "awaiting_oauth_callback";
    }
  | {
      kind: "awaiting_apply_model_input";
      client: "hermes" | "codex";
      providerId: string;
      providerName?: string;
      models: string[];
    }
  | {
      kind: "awaiting_renewal_custom_days";
      requestId: string;
      sourceChatId: string;
      sourceMessageId: number;
    }
  | {
      kind: "awaiting_renewal_reject_reason";
      requestId: string;
      sourceChatId: string;
      sourceMessageId: number;
    };

type SessionRow = {
  session_scope: string;
  session_json: string;
  expires_at: number;
};

type CallbackStateRow = {
  token: string;
  payload_json: string;
  expires_at: number;
};

export type TelegramBotCallbackPayload =
  | {
      kind: "account_action";
      action: "refresh" | "disable" | "enable" | "delete";
      accountId: string;
    }
  | {
      kind: "renewal_plan";
      planId: string;
      days: number;
    }
  | {
      kind: "renewal_request_action";
      action:
        | "approve"
        | "approve_rotate"
        | "approve_override"
        | "close"
        | "view_customer"
        | "show_reject_reasons"
        | "reject_reason"
        | "show_main_actions"
        | "prompt_custom_days"
        | "prompt_custom_reason";
      requestId: string;
      overrideDays?: number;
      resolution?: string;
    };

export interface TelegramBotStateStore {
  get(sessionScope: string, nowMs?: number): TelegramBotSession | undefined;
  set(sessionScope: string, session: TelegramBotSession, nowMs?: number): void;
  clear(sessionScope: string): void;
  issueCallbackToken(payload: TelegramBotCallbackPayload, nowMs?: number): string;
  readCallbackToken(token: string, nowMs?: number): TelegramBotCallbackPayload | undefined;
  clearCallbackToken(token: string): void;
}

export class SqliteSessionStore implements TelegramBotStateStore {
  private constructor(
    private readonly db: Database,
    private readonly ttlMs: number,
  ) {}

  static create(dbFile: string, ttlMs: number): SqliteSessionStore {
    mkdirSync(path.dirname(dbFile), { recursive: true });
    const db = new BetterSqlite3(dbFile);
    ensureSessionSchema(db);
    return new SqliteSessionStore(db, ttlMs);
  }

  get(sessionScope: string, nowMs = Date.now()): TelegramBotSession | undefined {
    this.pruneExpired(nowMs);
    const row = this.db
      .prepare(
        `SELECT session_scope, session_json, expires_at
         FROM telegram_bot_sessions
         WHERE session_scope = ?`,
      )
      .get(sessionScope) as SessionRow | undefined;
    if (!row) {
      return undefined;
    }
    if (row.expires_at <= nowMs) {
      this.clear(sessionScope);
      return undefined;
    }
    return parseSessionJson(row.session_json);
  }

  set(sessionScope: string, session: TelegramBotSession, nowMs = Date.now()): void {
    this.pruneExpired(nowMs);
    this.db
      .prepare(
        `INSERT INTO telegram_bot_sessions (session_scope, session_json, expires_at)
         VALUES (?, ?, ?)
         ON CONFLICT(session_scope) DO UPDATE SET
           session_json = excluded.session_json,
           expires_at = excluded.expires_at`,
      )
      .run(sessionScope, JSON.stringify(session), nowMs + this.ttlMs);
  }

  clear(sessionScope: string): void {
    this.db.prepare("DELETE FROM telegram_bot_sessions WHERE session_scope = ?").run(sessionScope);
  }

  issueCallbackToken(payload: TelegramBotCallbackPayload, nowMs = Date.now()): string {
    this.pruneExpired(nowMs);
    const token = randomBytes(9).toString("base64url");
    this.db
      .prepare(
        `INSERT INTO telegram_bot_callback_states (token, payload_json, expires_at)
         VALUES (?, ?, ?)`,
      )
      .run(token, JSON.stringify(payload), nowMs + this.ttlMs);
    return token;
  }

  readCallbackToken(token: string, nowMs = Date.now()): TelegramBotCallbackPayload | undefined {
    this.pruneExpired(nowMs);
    const row = this.db
      .prepare(
        `SELECT token, payload_json, expires_at
         FROM telegram_bot_callback_states
         WHERE token = ?`,
      )
      .get(token) as CallbackStateRow | undefined;
    if (!row) {
      return undefined;
    }
    if (row.expires_at <= nowMs) {
      this.clearCallbackToken(token);
      return undefined;
    }
    return parseCallbackPayloadJson(row.payload_json);
  }

  clearCallbackToken(token: string): void {
    this.db.prepare("DELETE FROM telegram_bot_callback_states WHERE token = ?").run(token);
  }

  private pruneExpired(nowMs: number): void {
    this.db.prepare("DELETE FROM telegram_bot_sessions WHERE expires_at <= ?").run(nowMs);
    this.db.prepare("DELETE FROM telegram_bot_callback_states WHERE expires_at <= ?").run(nowMs);
  }
}

function ensureSessionSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_bot_sessions (
      session_scope TEXT PRIMARY KEY,
      session_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS telegram_bot_callback_states (
      token TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
}

function parseSessionJson(raw: string): TelegramBotSession | undefined {
  try {
    const parsed = JSON.parse(raw) as TelegramBotSession;
    return parsed && typeof parsed === "object" && typeof parsed.kind === "string"
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function parseCallbackPayloadJson(raw: string): TelegramBotCallbackPayload | undefined {
  try {
    const parsed = JSON.parse(raw) as TelegramBotCallbackPayload;
    if (!parsed || typeof parsed !== "object" || typeof parsed.kind !== "string") {
      return undefined;
    }
    if (parsed.kind === "account_action") {
      if (
        parsed.action !== "refresh" &&
        parsed.action !== "disable" &&
        parsed.action !== "enable" &&
        parsed.action !== "delete"
      ) {
        return undefined;
      }
      return typeof parsed.accountId === "string" && parsed.accountId
        ? parsed
        : undefined;
    }
    if (parsed.kind === "renewal_plan") {
      return typeof parsed.planId === "string" &&
        parsed.planId &&
        typeof parsed.days === "number" &&
        Number.isInteger(parsed.days) &&
        parsed.days > 0
        ? parsed
        : undefined;
    }
    if (parsed.kind === "renewal_request_action") {
      if (
        parsed.action !== "approve" &&
        parsed.action !== "approve_rotate" &&
        parsed.action !== "approve_override" &&
        parsed.action !== "close" &&
        parsed.action !== "view_customer" &&
        parsed.action !== "show_reject_reasons" &&
        parsed.action !== "reject_reason" &&
        parsed.action !== "show_main_actions" &&
        parsed.action !== "prompt_custom_days" &&
        parsed.action !== "prompt_custom_reason"
      ) {
        return undefined;
      }
      if (typeof parsed.requestId !== "string" || !parsed.requestId) {
        return undefined;
      }
      if (parsed.action === "approve_override") {
        return typeof parsed.overrideDays === "number" &&
          Number.isInteger(parsed.overrideDays) &&
          parsed.overrideDays > 0
          ? parsed
          : undefined;
      }
      if (parsed.action === "reject_reason") {
        return typeof parsed.resolution === "string" && parsed.resolution
          ? parsed
          : undefined;
      }
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function buildTelegramSessionScope(chatId: string, userId: string): string {
  return `${chatId}:${userId}`;
}
