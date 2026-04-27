import { mkdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import type { ChatGptTokenBundle } from "./chatgpt-oauth.js";

type Database = InstanceType<typeof BetterSqlite3>;

export type ChatGptOAuthAccount = {
  id: string;
  email: string;
  accountId: string;
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  lastRefreshAt: string | null;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ChatGptOAuthAccountView = Omit<
  ChatGptOAuthAccount,
  "idToken" | "accessToken" | "refreshToken"
>;

export type ChatGptOAuthSession = {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  expiresAt: string;
};

export type ChatGptOAuthRotationMode = "round_robin" | "random" | "first_available";

type AccountRow = {
  id: string;
  email: string | null;
  account_id: string | null;
  id_token: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  last_refresh_at: string | null;
  disabled: number;
  created_at: string;
  updated_at: string;
};

type SessionRow = {
  state: string;
  code_verifier: string;
  redirect_uri: string;
  status: string;
  error_message: string | null;
  created_at: string;
  expires_at: string;
};

export class ChatGptOAuthStore {
  private constructor(private readonly db: Database) {}

  static create(dbFile: string): ChatGptOAuthStore {
    mkdirSync(path.dirname(dbFile), { recursive: true });
    const db = new BetterSqlite3(dbFile);
    ensureChatGptOAuthSchema(db);
    return new ChatGptOAuthStore(db);
  }

  createSession(input: {
    state: string;
    codeVerifier: string;
    redirectUri: string;
    ttlMs?: number;
    now?: Date;
  }): ChatGptOAuthSession {
    this.ensureSchema();
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + (input.ttlMs ?? 10 * 60 * 1000)).toISOString();
    this.db
      .prepare(
        `INSERT INTO chatgpt_oauth_sessions
          (state, code_verifier, redirect_uri, status, error_message, created_at, expires_at)
         VALUES (?, ?, ?, 'pending', NULL, ?, ?)`,
      )
      .run(input.state, input.codeVerifier, input.redirectUri, now.toISOString(), expiresAt);
    return {
      state: input.state,
      codeVerifier: input.codeVerifier,
      redirectUri: input.redirectUri,
      status: "pending",
      errorMessage: null,
      createdAt: now.toISOString(),
      expiresAt,
    };
  }

  consumeSession(state: string, now = new Date()): ChatGptOAuthSession {
    this.ensureSchema();
    const row = this.db
      .prepare("SELECT * FROM chatgpt_oauth_sessions WHERE state = ?")
      .get(state) as SessionRow | undefined;
    if (!row) {
      throw new Error("Unknown or expired ChatGPT OAuth state");
    }
    const session = mapSessionRow(row);
    if (session.status !== "pending") {
      throw new Error("ChatGPT OAuth session is not pending");
    }
    if (Date.parse(session.expiresAt) <= now.getTime()) {
      this.markSessionError(state, "OAuth session expired");
      throw new Error("ChatGPT OAuth session expired");
    }
    this.db
      .prepare("UPDATE chatgpt_oauth_sessions SET status = 'consumed' WHERE state = ?")
      .run(state);
    return session;
  }

  markSessionError(state: string, message: string): void {
    this.ensureSchema();
    this.db
      .prepare(
        `UPDATE chatgpt_oauth_sessions
         SET status = 'error', error_message = ?
         WHERE state = ? AND status = 'pending'`,
      )
      .run(message, state);
  }

  upsertAccount(bundle: ChatGptTokenBundle, now = new Date()): ChatGptOAuthAccount {
    this.ensureSchema();
    const id = buildAccountId(bundle);
    const existing = this.getAccount(id);
    const createdAt = existing?.createdAt ?? now.toISOString();
    const updatedAt = now.toISOString();
    this.db
      .prepare(
        `INSERT INTO chatgpt_oauth_accounts
          (id, email, account_id, id_token, access_token, refresh_token, expires_at,
           last_refresh_at, disabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           email = excluded.email,
           account_id = excluded.account_id,
           id_token = excluded.id_token,
           access_token = excluded.access_token,
           refresh_token = excluded.refresh_token,
           expires_at = excluded.expires_at,
           last_refresh_at = excluded.last_refresh_at,
           disabled = 0,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        bundle.email,
        bundle.accountId,
        bundle.idToken,
        bundle.accessToken,
        bundle.refreshToken,
        bundle.expiresAt,
        bundle.lastRefreshAt,
        createdAt,
        updatedAt,
      );
    return this.getAccountOrThrow(id);
  }

  updateTokens(id: string, bundle: ChatGptTokenBundle, now = new Date()): ChatGptOAuthAccount {
    this.ensureSchema();
    this.db
      .prepare(
        `UPDATE chatgpt_oauth_accounts
         SET email = ?, account_id = ?, id_token = ?, access_token = ?, refresh_token = ?,
             expires_at = ?, last_refresh_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        bundle.email,
        bundle.accountId,
        bundle.idToken,
        bundle.accessToken,
        bundle.refreshToken,
        bundle.expiresAt,
        bundle.lastRefreshAt,
        now.toISOString(),
        id,
      );
    return this.getAccountOrThrow(id);
  }

  listAccountsForUi(): ChatGptOAuthAccountView[] {
    this.ensureSchema();
    return this.listAccounts().map(redactAccount);
  }

  getRotationMode(): ChatGptOAuthRotationMode {
    this.ensureSchema();
    const row = this.db
      .prepare("SELECT value FROM chatgpt_oauth_settings WHERE key = 'rotation_mode'")
      .get() as { value?: unknown } | undefined;
    return parseRotationMode(row?.value);
  }

  setRotationMode(value: unknown): ChatGptOAuthRotationMode {
    this.ensureSchema();
    const mode = parseRotationMode(value);
    this.db
      .prepare(
        `INSERT INTO chatgpt_oauth_settings (key, value)
         VALUES ('rotation_mode', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(mode);
    return mode;
  }

  listAvailableAccounts(): ChatGptOAuthAccount[] {
    return this.listAccounts().filter((account) => !account.disabled);
  }

  getAccount(id: string): ChatGptOAuthAccount | undefined {
    this.ensureSchema();
    const row = this.db
      .prepare("SELECT * FROM chatgpt_oauth_accounts WHERE id = ?")
      .get(id) as AccountRow | undefined;
    return row ? mapAccountRow(row) : undefined;
  }

  disableAccount(id: string): boolean {
    this.ensureSchema();
    const result = this.db
      .prepare("UPDATE chatgpt_oauth_accounts SET disabled = 1, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    return result.changes > 0;
  }

  enableAccount(id: string): boolean {
    this.ensureSchema();
    const result = this.db
      .prepare("UPDATE chatgpt_oauth_accounts SET disabled = 0, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    return result.changes > 0;
  }

  deleteAccount(id: string): boolean {
    this.ensureSchema();
    const result = this.db.prepare("DELETE FROM chatgpt_oauth_accounts WHERE id = ?").run(id);
    return result.changes > 0;
  }

  private getAccountOrThrow(id: string): ChatGptOAuthAccount {
    const account = this.getAccount(id);
    if (!account) {
      throw new Error(`ChatGPT OAuth account ${id} not found`);
    }
    return account;
  }

  private listAccounts(): ChatGptOAuthAccount[] {
    this.ensureSchema();
    const rows = this.db
      .prepare("SELECT * FROM chatgpt_oauth_accounts ORDER BY email, account_id, id")
      .all() as AccountRow[];
    return rows.map(mapAccountRow);
  }

  private ensureSchema(): void {
    ensureChatGptOAuthSchema(this.db);
  }
}

export function redactAccount(account: ChatGptOAuthAccount): ChatGptOAuthAccountView {
  const { idToken: _idToken, accessToken: _accessToken, refreshToken: _refreshToken, ...view } = account;
  return view;
}

function ensureChatGptOAuthSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chatgpt_oauth_accounts (
      id TEXT PRIMARY KEY,
      email TEXT,
      account_id TEXT,
      id_token TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_refresh_at TEXT,
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_chatgpt_oauth_accounts_account_id
      ON chatgpt_oauth_accounts(account_id)
      WHERE account_id IS NOT NULL AND account_id != '';

    CREATE TABLE IF NOT EXISTS chatgpt_oauth_sessions (
      state TEXT PRIMARY KEY,
      code_verifier TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chatgpt_oauth_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function parseRotationMode(value: unknown): ChatGptOAuthRotationMode {
  return value === "random" || value === "first_available" ? value : "round_robin";
}

function buildAccountId(bundle: ChatGptTokenBundle): string {
  const stableId = bundle.accountId || bundle.email;
  if (stableId) {
    return `chatgpt-oauth:${stableId}`;
  }
  return `chatgpt-oauth:${bundle.accessToken.slice(0, 16)}`;
}

function mapAccountRow(row: AccountRow): ChatGptOAuthAccount {
  return {
    id: row.id,
    email: row.email ?? "",
    accountId: row.account_id ?? "",
    idToken: row.id_token,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: row.expires_at,
    lastRefreshAt: row.last_refresh_at,
    disabled: row.disabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSessionRow(row: SessionRow): ChatGptOAuthSession {
  return {
    state: row.state,
    codeVerifier: row.code_verifier,
    redirectUri: row.redirect_uri,
    status: row.status,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
