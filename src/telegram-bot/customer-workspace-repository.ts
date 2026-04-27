import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

type Database = InstanceType<typeof BetterSqlite3>;

export type CustomerWorkspaceStatus = "active" | "pending_approval" | "suspended" | "closed";

export type CustomerWorkspaceRecord = {
  id: string;
  ownerTelegramUserId: string;
  telegramChatId?: string;
  name?: string;
  defaultClientRoute: string;
  status: CustomerWorkspaceStatus;
  createdAt: string;
  updatedAt: string;
};

type CustomerWorkspaceRow = {
  id: string;
  owner_telegram_user_id: string;
  telegram_chat_id: string | null;
  name: string | null;
  default_client_route: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export class CustomerWorkspaceRepository {
  private constructor(private readonly db: Database) {}

  static create(dbFile: string): CustomerWorkspaceRepository {
    mkdirSync(path.dirname(dbFile), { recursive: true });
    const db = new BetterSqlite3(dbFile);
    ensureWorkspaceSchema(db);
    return new CustomerWorkspaceRepository(db);
  }

  getDefaultWorkspace(ownerTelegramUserId: string): CustomerWorkspaceRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT
          id,
          owner_telegram_user_id,
          telegram_chat_id,
          name,
          default_client_route,
          status,
          created_at,
          updated_at
        FROM customer_workspaces
        WHERE owner_telegram_user_id = ?
        ORDER BY created_at ASC
        LIMIT 1`,
      )
      .get(ownerTelegramUserId) as CustomerWorkspaceRow | undefined;
    return row ? mapWorkspaceRow(row) : undefined;
  }

  getById(id: string): CustomerWorkspaceRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT
          id,
          owner_telegram_user_id,
          telegram_chat_id,
          name,
          default_client_route,
          status,
          created_at,
          updated_at
        FROM customer_workspaces
        WHERE id = ?`,
      )
      .get(id) as CustomerWorkspaceRow | undefined;
    return row ? mapWorkspaceRow(row) : undefined;
  }

  listWorkspaces(): CustomerWorkspaceRecord[] {
    const rows = this.db
      .prepare(
        `SELECT
          id,
          owner_telegram_user_id,
          telegram_chat_id,
          name,
          default_client_route,
          status,
          created_at,
          updated_at
        FROM customer_workspaces
        ORDER BY created_at ASC`,
      )
      .all() as CustomerWorkspaceRow[];
    return rows.map(mapWorkspaceRow);
  }

  ensureDefaultWorkspace(input: {
    ownerTelegramUserId: string;
    telegramChatId?: string;
    defaultClientRoute: string;
    status: CustomerWorkspaceStatus;
    name?: string;
    now?: Date;
  }): CustomerWorkspaceRecord {
    const existing = this.getDefaultWorkspace(input.ownerTelegramUserId);
    if (existing) {
      return existing;
    }

    const now = (input.now ?? new Date()).toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO customer_workspaces (
          id,
          owner_telegram_user_id,
          telegram_chat_id,
          name,
          default_client_route,
          status,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.ownerTelegramUserId,
        input.telegramChatId ?? null,
        input.name ?? null,
        input.defaultClientRoute,
        input.status,
        now,
        now,
      );

    return this.getDefaultWorkspace(input.ownerTelegramUserId) as CustomerWorkspaceRecord;
  }

  setStatus(
    id: string,
    status: CustomerWorkspaceStatus,
    now: Date = new Date(),
  ): CustomerWorkspaceRecord | undefined {
    this.db
      .prepare(
        `UPDATE customer_workspaces
         SET status = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(status, now.toISOString(), id);
    return this.getById(id);
  }
}

function ensureWorkspaceSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_workspaces (
      id TEXT PRIMARY KEY,
      owner_telegram_user_id TEXT NOT NULL,
      telegram_chat_id TEXT,
      name TEXT,
      default_client_route TEXT NOT NULL DEFAULT 'customers',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_customer_workspaces_owner
      ON customer_workspaces(owner_telegram_user_id, created_at);
  `);
}

function mapWorkspaceRow(row: CustomerWorkspaceRow): CustomerWorkspaceRecord {
  return {
    id: row.id,
    ownerTelegramUserId: row.owner_telegram_user_id,
    telegramChatId: row.telegram_chat_id ?? undefined,
    name: row.name ?? undefined,
    defaultClientRoute: row.default_client_route,
    status: normalizeStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeStatus(value: string): CustomerWorkspaceStatus {
  return value === "active" ||
    value === "pending_approval" ||
    value === "suspended" ||
    value === "closed"
    ? value
    : "active";
}
