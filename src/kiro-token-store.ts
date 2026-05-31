import { existsSync } from "node:fs";
import BetterSqlite3 from "better-sqlite3";

type Database = InstanceType<typeof BetterSqlite3>;

export type KiroProviderSpecificData = {
  profileArn?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  region?: string | null;
  authMethod?: string | null;
  startUrl?: string | null;
};

export type KiroAccount = {
  id: string;
  name: string;
  priority: number;
  isActive: boolean;
  accessToken: string;
  refreshToken: string;
  expiresAt: string | null;
  expiresIn: number | null;
  providerSpecificData: KiroProviderSpecificData;
  raw: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type KiroTokenUpdate = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  expiresIn?: number;
};

type ConnectionRow = {
  id: string;
  provider: string;
  authType: string;
  name: string | null;
  email: string | null;
  priority: number | null;
  isActive: number | null;
  data: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Reads (and optionally writes back) Kiro/CodeWhisperer OAuth accounts stored by
 * the 9router app in its own SQLite database (providerConnections table).
 *
 * The same database is owned by a live 9router process, so write-back is scoped
 * to only the token fields and preserves every other key 9router manages.
 */
export class KiroTokenStore {
  private constructor(
    private readonly db: Database,
    private readonly writeBackEnabled: boolean,
  ) {}

  static open(dbFile: string, options: { writeBack?: boolean } = {}): KiroTokenStore {
    if (!existsSync(dbFile)) {
      throw new KiroTokenStoreError(`9router database not found at ${dbFile}`);
    }
    const writeBack = options.writeBack !== false;
    // When write-back is disabled, open read-only so we never touch a database the
    // live 9router process owns (not even the journal_mode pragma, which is a write).
    // SQLite can read a WAL database read-only as long as the -wal/-shm files exist.
    const db = new BetterSqlite3(dbFile, { fileMustExist: true, readonly: !writeBack });
    if (writeBack) {
      // 9router runs in WAL mode; match it so our reads see committed writes and
      // our write-backs cooperate with its connection instead of blocking it.
      db.pragma("journal_mode = WAL");
      db.pragma("busy_timeout = 4000");
    }
    return new KiroTokenStore(db, writeBack);
  }

  listAccounts(): KiroAccount[] {
    const rows = this.db
      .prepare(
        `SELECT id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt
         FROM providerConnections
         WHERE provider = 'kiro'
         ORDER BY priority IS NULL, priority, createdAt`,
      )
      .all() as ConnectionRow[];
    return rows
      .map((row) => mapConnectionRow(row))
      .filter((account): account is KiroAccount => account !== undefined);
  }

  listAvailableAccounts(): KiroAccount[] {
    return this.listAccounts().filter((account) => account.isActive);
  }

  getAccount(id: string): KiroAccount | undefined {
    const row = this.db
      .prepare(
        `SELECT id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt
         FROM providerConnections
         WHERE provider = 'kiro' AND id = ?`,
      )
      .get(id) as ConnectionRow | undefined;
    return row ? mapConnectionRow(row) : undefined;
  }

  /**
   * Persists refreshed tokens back into 9router's database. Re-reads the current
   * row inside a transaction so we merge onto whatever 9router last wrote rather
   * than clobbering concurrent updates. No-op when write-back is disabled.
   */
  updateTokens(id: string, update: KiroTokenUpdate, now: Date = new Date()): KiroAccount | undefined {
    if (!this.writeBackEnabled) {
      return this.getAccount(id);
    }
    const persist = this.db.transaction((accountId: string, patch: KiroTokenUpdate) => {
      const row = this.db
        .prepare(`SELECT data FROM providerConnections WHERE provider = 'kiro' AND id = ?`)
        .get(accountId) as { data: string } | undefined;
      if (!row) {
        return false;
      }
      const data = safeParseObject(row.data);
      data.accessToken = patch.accessToken;
      if (patch.refreshToken) {
        data.refreshToken = patch.refreshToken;
      }
      data.expiresAt = patch.expiresAt;
      if (typeof patch.expiresIn === "number") {
        data.expiresIn = patch.expiresIn;
      }
      // Clear transient error markers 9router sets so a successful refresh is reflected.
      data.lastError = null;
      data.lastErrorAt = null;
      this.db
        .prepare(
          `UPDATE providerConnections SET data = ?, updatedAt = ? WHERE provider = 'kiro' AND id = ?`,
        )
        .run(JSON.stringify(data), now.toISOString(), accountId);
      return true;
    });

    const ok = persist(id, update);
    return ok ? this.getAccount(id) : undefined;
  }

  /**
   * Updates account properties (name, priority, isActive). Only works when write-back is enabled.
   */
  updateAccount(id: string, updates: { name?: string; priority?: number; isActive?: boolean }, now: Date = new Date()): KiroAccount | undefined {
    if (!this.writeBackEnabled) {
      throw new KiroTokenStoreError("Cannot update account: write-back is disabled");
    }

    const updateTransaction = this.db.transaction((accountId: string, patch: typeof updates) => {
      const row = this.db
        .prepare(`SELECT name, priority, isActive, data FROM providerConnections WHERE provider = 'kiro' AND id = ?`)
        .get(accountId) as { name: string | null; priority: number | null; isActive: number | null; data: string } | undefined;

      if (!row) {
        return false;
      }

      const updateFields: string[] = [];
      const updateValues: unknown[] = [];

      if (patch.name !== undefined) {
        updateFields.push("name = ?");
        updateValues.push(patch.name);
      }

      if (patch.priority !== undefined) {
        updateFields.push("priority = ?");
        updateValues.push(patch.priority);
      }

      if (patch.isActive !== undefined) {
        updateFields.push("isActive = ?");
        updateValues.push(patch.isActive ? 1 : 0);
      }

      if (updateFields.length === 0) {
        return true; // No updates needed
      }

      updateFields.push("updatedAt = ?");
      updateValues.push(now.toISOString());
      updateValues.push(accountId);

      const sql = `UPDATE providerConnections SET ${updateFields.join(", ")} WHERE provider = 'kiro' AND id = ?`;
      this.db.prepare(sql).run(...updateValues);
      return true;
    });

    const ok = updateTransaction(id, updates);
    return ok ? this.getAccount(id) : undefined;
  }

  /**
   * Deletes a Kiro account. Only works when write-back is enabled.
   */
  deleteAccount(id: string): boolean {
    if (!this.writeBackEnabled) {
      throw new KiroTokenStoreError("Cannot delete account: write-back is disabled");
    }

    const result = this.db
      .prepare(`DELETE FROM providerConnections WHERE provider = 'kiro' AND id = ?`)
      .run(id);

    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}

export class KiroTokenStoreError extends Error {}

function mapConnectionRow(row: ConnectionRow): KiroAccount | undefined {
  const data = safeParseObject(row.data);
  const accessToken = typeof data.accessToken === "string" ? data.accessToken : "";
  const refreshToken = typeof data.refreshToken === "string" ? data.refreshToken : "";
  if (!accessToken && !refreshToken) {
    return undefined;
  }
  const psdRaw =
    typeof data.providerSpecificData === "object" && data.providerSpecificData !== null
      ? (data.providerSpecificData as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    name: row.name?.trim() ? row.name.trim() : row.id,
    priority: typeof row.priority === "number" ? row.priority : Number.MAX_SAFE_INTEGER,
    isActive: row.isActive !== 0,
    accessToken,
    refreshToken,
    expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : null,
    expiresIn: typeof data.expiresIn === "number" ? data.expiresIn : null,
    providerSpecificData: {
      profileArn: optionalString(psdRaw.profileArn),
      clientId: optionalString(psdRaw.clientId),
      clientSecret: optionalString(psdRaw.clientSecret),
      region: optionalString(psdRaw.region),
      authMethod: optionalString(psdRaw.authMethod),
      startUrl: optionalString(psdRaw.startUrl),
    },
    raw: data,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function safeParseObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
