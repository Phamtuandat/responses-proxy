import { mkdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

type Database = InstanceType<typeof BetterSqlite3>;

export type CustomerApiKeyRecord = {
  userId: string;
  clientRoute: string;
  apiKey: string;
  createdByUserId: string;
  createdAt: string;
};

type CustomerApiKeyRow = {
  user_id: string;
  client_route: string;
  api_key: string;
  created_by_user_id: string;
  created_at: string;
};

export class CustomerApiKeyStore {
  private constructor(private readonly db: Database) {}

  static create(dbFile: string): CustomerApiKeyStore {
    mkdirSync(path.dirname(dbFile), { recursive: true });
    const db = new BetterSqlite3(dbFile);
    ensureCustomerApiKeySchema(db);
    return new CustomerApiKeyStore(db);
  }

  get(userId: string): CustomerApiKeyRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT user_id, client_route, api_key, created_by_user_id, created_at
         FROM telegram_customer_api_keys
         WHERE user_id = ?`,
      )
      .get(userId) as CustomerApiKeyRow | undefined;
    return row ? mapCustomerApiKeyRow(row) : undefined;
  }

  upsert(input: {
    userId: string;
    clientRoute: string;
    apiKey: string;
    createdByUserId: string;
    now?: Date;
  }): CustomerApiKeyRecord {
    const createdAt = (input.now ?? new Date()).toISOString();
    this.db
      .prepare(
        `INSERT INTO telegram_customer_api_keys (
           user_id,
           client_route,
           api_key,
           created_by_user_id,
           created_at
         )
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           client_route = excluded.client_route,
           api_key = excluded.api_key,
           created_by_user_id = excluded.created_by_user_id,
           created_at = excluded.created_at`,
      )
      .run(input.userId, input.clientRoute, input.apiKey, input.createdByUserId, createdAt);
    return {
      userId: input.userId,
      clientRoute: input.clientRoute,
      apiKey: input.apiKey,
      createdByUserId: input.createdByUserId,
      createdAt,
    };
  }
}

function ensureCustomerApiKeySchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_customer_api_keys (
      user_id TEXT PRIMARY KEY,
      client_route TEXT NOT NULL,
      api_key TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
}

function mapCustomerApiKeyRow(row: CustomerApiKeyRow): CustomerApiKeyRecord {
  return {
    userId: row.user_id,
    clientRoute: row.client_route,
    apiKey: row.api_key,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
  };
}
