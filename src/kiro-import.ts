import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

type Database = InstanceType<typeof BetterSqlite3>;

/**
 * Schema for the `providerConnections` table, mirroring the one 9router creates.
 * Used to materialize a resproxy-owned copy of the Kiro accounts so the proxy can
 * own token refresh (write-back) without sharing 9router's live database.
 */
export const PROVIDER_CONNECTIONS_DDL = `
CREATE TABLE IF NOT EXISTS providerConnections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  authType TEXT NOT NULL,
  name TEXT,
  email TEXT,
  priority INTEGER,
  isActive INTEGER DEFAULT 1,
  data TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pc_provider ON providerConnections(provider);
CREATE INDEX IF NOT EXISTS idx_pc_provider_active ON providerConnections(provider, isActive);
CREATE INDEX IF NOT EXISTS idx_pc_priority ON providerConnections(provider, priority);
`;

export type KiroImportResult = {
  source: string;
  dest: string;
  imported: number;
  ids: string[];
};

type RawConnectionRow = {
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

export class KiroImportError extends Error {}

/**
 * Copies the OAuth accounts for a provider (default `kiro`) from a source 9router
 * SQLite database into a resproxy-owned destination database, preserving every
 * field verbatim. Existing rows in the destination are upserted by id, so a
 * re-import re-syncs from 9router (overwriting any tokens the proxy refreshed).
 *
 * The source is opened read-only; the destination is created if missing.
 */
export function importKiroAccounts(args: {
  sourceDbPath: string;
  destDbPath: string;
  provider?: string;
}): KiroImportResult {
  const provider = args.provider ?? "kiro";
  const sourceDbPath = path.resolve(args.sourceDbPath);
  const destDbPath = path.resolve(args.destDbPath);

  if (!existsSync(sourceDbPath)) {
    throw new KiroImportError(`Source 9router DB not found at ${sourceDbPath}`);
  }
  if (sourceDbPath === destDbPath) {
    throw new KiroImportError("Source and destination databases must be different files");
  }

  const source = new BetterSqlite3(sourceDbPath, { fileMustExist: true, readonly: true });
  let rows: RawConnectionRow[];
  try {
    rows = source
      .prepare(
        `SELECT id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt
         FROM providerConnections
         WHERE provider = ?
         ORDER BY priority IS NULL, priority, createdAt`,
      )
      .all(provider) as RawConnectionRow[];
  } finally {
    source.close();
  }

  mkdirSync(path.dirname(destDbPath), { recursive: true });
  const dest: Database = new BetterSqlite3(destDbPath);
  try {
    dest.pragma("journal_mode = WAL");
    dest.exec(PROVIDER_CONNECTIONS_DDL);
    const upsert = dest.prepare(
      `INSERT INTO providerConnections
         (id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
       VALUES
         (@id, @provider, @authType, @name, @email, @priority, @isActive, @data, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         provider = excluded.provider,
         authType = excluded.authType,
         name = excluded.name,
         email = excluded.email,
         priority = excluded.priority,
         isActive = excluded.isActive,
         data = excluded.data,
         createdAt = excluded.createdAt,
         updatedAt = excluded.updatedAt`,
    );
    const runAll = dest.transaction((items: RawConnectionRow[]) => {
      for (const row of items) {
        upsert.run(row);
      }
    });
    runAll(rows);
  } finally {
    dest.close();
  }

  return {
    source: sourceDbPath,
    dest: destDbPath,
    imported: rows.length,
    ids: rows.map((row) => row.id),
  };
}
