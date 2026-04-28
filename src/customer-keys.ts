import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

type Database = InstanceType<typeof BetterSqlite3>;

export type CustomerApiKeyStatus = "active" | "suspended" | "revoked" | "expired";

export type CustomerApiKeyRecord = {
  id: string;
  workspaceId: string;
  telegramUserId?: string;
  telegramChatId?: string;
  clientRoute: string;
  apiKeyHash: string;
  apiKeyPreview: string;
  apiKeySecret?: string;
  name?: string;
  status: CustomerApiKeyStatus;
  expiresAt?: string;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
};

export type CreatedCustomerApiKey = {
  record: CustomerApiKeyRecord;
  apiKey: string;
};

type CustomerApiKeyRow = {
  id: string;
  workspace_id: string;
  telegram_user_id: string | null;
  telegram_chat_id: string | null;
  client_route: string;
  api_key_hash: string;
  api_key_preview: string;
  api_key_secret: string | null;
  name: string | null;
  status: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
};

export class CustomerKeyRepository {
  private constructor(private readonly db: Database) {}

  static create(dbFile: string): CustomerKeyRepository {
    mkdirSync(path.dirname(dbFile), { recursive: true });
    const db = new BetterSqlite3(dbFile);
    ensureCustomerKeySchema(db);
    return new CustomerKeyRepository(db);
  }

  createKey(input: {
    workspaceId: string;
    telegramUserId?: string;
    telegramChatId?: string;
    clientRoute: string;
    apiKey?: string;
    name?: string;
    status?: CustomerApiKeyStatus;
    expiresAt?: string;
    now?: Date;
  }): CreatedCustomerApiKey {
    const apiKey = input.apiKey?.trim() || generateCustomerApiKey();
    const now = (input.now ?? new Date()).toISOString();
    const status = normalizeStatus(input.status ?? "active");
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO customer_api_keys (
          id,
          workspace_id,
          telegram_user_id,
          telegram_chat_id,
          client_route,
          api_key_hash,
          api_key_preview,
          api_key_secret,
          name,
          status,
          expires_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.telegramUserId ?? null,
        input.telegramChatId ?? null,
        normalizeClientRoute(input.clientRoute),
        hashApiKey(apiKey),
        previewApiKey(apiKey),
        apiKey,
        input.name ?? null,
        status,
        input.expiresAt ?? null,
        now,
        now,
      );

    return {
      record: this.getById(id) as CustomerApiKeyRecord,
      apiKey,
    };
  }

  getById(id: string): CustomerApiKeyRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT *
         FROM customer_api_keys
         WHERE id = ?`,
      )
      .get(id) as CustomerApiKeyRow | undefined;
    return row ? mapCustomerApiKeyRow(row) : undefined;
  }

  getByApiKey(apiKey: string): CustomerApiKeyRecord | undefined {
    return this.getByHash(hashApiKey(apiKey));
  }

  getByHash(apiKeyHash: string): CustomerApiKeyRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT *
         FROM customer_api_keys
         WHERE api_key_hash = ?`,
      )
      .get(apiKeyHash) as CustomerApiKeyRow | undefined;
    return row ? mapCustomerApiKeyRow(row) : undefined;
  }

  getApiKeySecret(id: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT api_key_secret
         FROM customer_api_keys
         WHERE id = ?`,
      )
      .get(id) as { api_key_secret: string | null } | undefined;
    return row?.api_key_secret ?? undefined;
  }

  getActiveKeyForUser(telegramUserId: string): CustomerApiKeyRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT *
         FROM customer_api_keys
         WHERE telegram_user_id = ?
           AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(telegramUserId) as CustomerApiKeyRow | undefined;
    return row ? mapCustomerApiKeyRow(row) : undefined;
  }

  getLatestKeyForUser(telegramUserId: string): CustomerApiKeyRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT *
         FROM customer_api_keys
         WHERE telegram_user_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(telegramUserId) as CustomerApiKeyRow | undefined;
    return row ? mapCustomerApiKeyRow(row) : undefined;
  }

  listKeysByUser(telegramUserId: string): CustomerApiKeyRecord[] {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM customer_api_keys
         WHERE telegram_user_id = ?
         ORDER BY created_at DESC`,
      )
      .all(telegramUserId) as CustomerApiKeyRow[];
    return rows.map(mapCustomerApiKeyRow);
  }

  listKeysByWorkspace(workspaceId: string): CustomerApiKeyRecord[] {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM customer_api_keys
         WHERE workspace_id = ?
         ORDER BY created_at DESC`,
      )
      .all(workspaceId) as CustomerApiKeyRow[];
    return rows.map(mapCustomerApiKeyRow);
  }

  listRecentKeys(limit = 10): CustomerApiKeyRecord[] {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM customer_api_keys
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(Math.max(1, Math.min(50, Math.floor(limit)))) as CustomerApiKeyRow[];
    return rows.map(mapCustomerApiKeyRow);
  }

  setStatus(
    id: string,
    status: CustomerApiKeyStatus,
    options: { now?: Date } = {},
  ): CustomerApiKeyRecord | undefined {
    const now = (options.now ?? new Date()).toISOString();
    this.db
      .prepare(
        `UPDATE customer_api_keys
         SET status = ?,
             updated_at = ?,
             revoked_at = CASE WHEN ? = 'revoked' THEN ? ELSE revoked_at END
         WHERE id = ?`,
      )
      .run(status, now, status, now, id);
    return this.getById(id);
  }

  markUsed(id: string, now = new Date()): void {
    this.db
      .prepare(
        `UPDATE customer_api_keys
         SET last_used_at = ?,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(now.toISOString(), now.toISOString(), id);
  }
}

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

function generateCustomerApiKey(): string {
  return `sk-customer-${randomBytes(24).toString("hex")}`;
}

function previewApiKey(apiKey: string): string {
  return `${apiKey.slice(0, 12)}...${apiKey.slice(-6)}`;
}

function normalizeClientRoute(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "customers"
  );
}

function ensureCustomerKeySchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_api_keys (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      telegram_user_id TEXT,
      telegram_chat_id TEXT,
      client_route TEXT NOT NULL,
      api_key_hash TEXT NOT NULL UNIQUE,
      api_key_preview TEXT NOT NULL,
      api_key_secret TEXT,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      expires_at TEXT,
      last_used_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_customer_api_keys_user_status
      ON customer_api_keys(telegram_user_id, status, created_at);

    CREATE INDEX IF NOT EXISTS idx_customer_api_keys_workspace
      ON customer_api_keys(workspace_id, status);
  `);
  const columns = db.prepare("PRAGMA table_info(customer_api_keys)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "api_key_secret")) {
    db.prepare("ALTER TABLE customer_api_keys ADD COLUMN api_key_secret TEXT").run();
  }
}

function mapCustomerApiKeyRow(row: CustomerApiKeyRow): CustomerApiKeyRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    telegramUserId: row.telegram_user_id ?? undefined,
    telegramChatId: row.telegram_chat_id ?? undefined,
    clientRoute: row.client_route,
    apiKeyHash: row.api_key_hash,
    apiKeyPreview: row.api_key_preview,
    apiKeySecret: row.api_key_secret ?? undefined,
    name: row.name ?? undefined,
    status: normalizeStatus(row.status),
    expiresAt: row.expires_at ?? undefined,
    lastUsedAt: row.last_used_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    revokedAt: row.revoked_at ?? undefined,
  };
}

function normalizeStatus(value: string): CustomerApiKeyStatus {
  return value === "active" || value === "suspended" || value === "revoked" || value === "expired"
    ? value
    : "suspended";
}
