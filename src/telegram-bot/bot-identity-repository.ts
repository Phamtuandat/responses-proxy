import { mkdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

type Database = InstanceType<typeof BetterSqlite3>;

export type TelegramUserRole = "owner" | "admin" | "support" | "customer";
export type TelegramUserStatus = "active" | "pending_approval" | "blocked";

export type TelegramUserIdentityInput = {
  telegramUserId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  defaultRole?: TelegramUserRole;
  defaultStatus?: TelegramUserStatus;
  now?: Date;
};

export type TelegramChatIdentityInput = {
  telegramChatId: string;
  chatType: string;
  title?: string;
  now?: Date;
};

export type TelegramUserRecord = {
  telegramUserId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  role: TelegramUserRole;
  status: TelegramUserStatus;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
};

export type TelegramChatRecord = {
  telegramChatId: string;
  chatType: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
};

type TelegramUserRow = {
  telegram_user_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  language_code: string | null;
  role: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
};

type TelegramChatRow = {
  telegram_chat_id: string;
  chat_type: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
};

export class BotIdentityRepository {
  private constructor(private readonly db: Database) {}

  static create(dbFile: string): BotIdentityRepository {
    mkdirSync(path.dirname(dbFile), { recursive: true });
    const db = new BetterSqlite3(dbFile);
    ensureIdentitySchema(db);
    return new BotIdentityRepository(db);
  }

  upsertUser(input: TelegramUserIdentityInput): TelegramUserRecord {
    const now = (input.now ?? new Date()).toISOString();
    const existing = this.getUser(input.telegramUserId);
    const role = existing?.role ?? input.defaultRole ?? "customer";
    const status = existing?.status ?? input.defaultStatus ?? "active";

    this.db
      .prepare(
        `INSERT INTO telegram_users (
          telegram_user_id,
          username,
          first_name,
          last_name,
          language_code,
          role,
          status,
          created_at,
          updated_at,
          last_seen_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(telegram_user_id) DO UPDATE SET
          username = excluded.username,
          first_name = excluded.first_name,
          last_name = excluded.last_name,
          language_code = excluded.language_code,
          updated_at = excluded.updated_at,
          last_seen_at = excluded.last_seen_at`,
      )
      .run(
        input.telegramUserId,
        input.username ?? null,
        input.firstName ?? null,
        input.lastName ?? null,
        input.languageCode ?? null,
        role,
        status,
        existing?.createdAt ?? now,
        now,
        now,
      );

    return this.getUser(input.telegramUserId) as TelegramUserRecord;
  }

  getUser(telegramUserId: string): TelegramUserRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT
          telegram_user_id,
          username,
          first_name,
          last_name,
          language_code,
          role,
          status,
          created_at,
          updated_at,
          last_seen_at
        FROM telegram_users
        WHERE telegram_user_id = ?`,
      )
      .get(telegramUserId) as TelegramUserRow | undefined;
    return row ? mapTelegramUserRow(row) : undefined;
  }

  setUserStatus(telegramUserId: string, status: TelegramUserStatus, now = new Date()): void {
    this.db
      .prepare(
        `UPDATE telegram_users
         SET status = ?, updated_at = ?
         WHERE telegram_user_id = ?`,
      )
      .run(status, now.toISOString(), telegramUserId);
  }

  upsertChat(input: TelegramChatIdentityInput): TelegramChatRecord {
    const now = (input.now ?? new Date()).toISOString();
    const existing = this.getChat(input.telegramChatId);
    this.db
      .prepare(
        `INSERT INTO telegram_chats (
          telegram_chat_id,
          chat_type,
          title,
          created_at,
          updated_at,
          last_seen_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(telegram_chat_id) DO UPDATE SET
          chat_type = excluded.chat_type,
          title = excluded.title,
          updated_at = excluded.updated_at,
          last_seen_at = excluded.last_seen_at`,
      )
      .run(
        input.telegramChatId,
        input.chatType,
        input.title ?? null,
        existing?.createdAt ?? now,
        now,
        now,
      );

    return this.getChat(input.telegramChatId) as TelegramChatRecord;
  }

  getChat(telegramChatId: string): TelegramChatRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT
          telegram_chat_id,
          chat_type,
          title,
          created_at,
          updated_at,
          last_seen_at
        FROM telegram_chats
        WHERE telegram_chat_id = ?`,
      )
      .get(telegramChatId) as TelegramChatRow | undefined;
    return row ? mapTelegramChatRow(row) : undefined;
  }

  upsertMembership(input: {
    telegramUserId: string;
    telegramChatId: string;
    role?: string;
    now?: Date;
  }): void {
    const now = (input.now ?? new Date()).toISOString();
    const role = input.role?.trim() || "member";
    this.db
      .prepare(
        `INSERT INTO telegram_chat_memberships (
          telegram_user_id,
          telegram_chat_id,
          role,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(telegram_user_id, telegram_chat_id) DO UPDATE SET
          role = excluded.role,
          updated_at = excluded.updated_at`,
      )
      .run(input.telegramUserId, input.telegramChatId, role, now, now);
  }
}

function ensureIdentitySchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_users (
      telegram_user_id TEXT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      language_code TEXT,
      role TEXT NOT NULL DEFAULT 'customer',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT
    );

    CREATE TABLE IF NOT EXISTS telegram_chats (
      telegram_chat_id TEXT PRIMARY KEY,
      chat_type TEXT NOT NULL,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT
    );

    CREATE TABLE IF NOT EXISTS telegram_chat_memberships (
      telegram_user_id TEXT NOT NULL,
      telegram_chat_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (telegram_user_id, telegram_chat_id)
    );
  `);
}

function mapTelegramUserRow(row: TelegramUserRow): TelegramUserRecord {
  return {
    telegramUserId: row.telegram_user_id,
    username: row.username ?? undefined,
    firstName: row.first_name ?? undefined,
    lastName: row.last_name ?? undefined,
    languageCode: row.language_code ?? undefined,
    role: normalizeRole(row.role),
    status: normalizeStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at ?? undefined,
  };
}

function mapTelegramChatRow(row: TelegramChatRow): TelegramChatRecord {
  return {
    telegramChatId: row.telegram_chat_id,
    chatType: row.chat_type,
    title: row.title ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at ?? undefined,
  };
}

function normalizeRole(value: string): TelegramUserRole {
  return value === "owner" || value === "admin" || value === "support" || value === "customer"
    ? value
    : "customer";
}

function normalizeStatus(value: string): TelegramUserStatus {
  return value === "active" || value === "pending_approval" || value === "blocked"
    ? value
    : "active";
}
