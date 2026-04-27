import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

type Database = InstanceType<typeof BetterSqlite3>;

export type AuditEventName =
  | "user.created"
  | "workspace.created"
  | "api_key.created"
  | "api_key.revealed"
  | "api_key.rotated"
  | "api_key.revoked"
  | "api_key.suspended"
  | "api_key.activated"
  | "subscription.granted"
  | "subscription.renewed"
  | "renewal.requested";

export type AuditActorType = "system" | "admin" | "customer" | "bot";

export type AuditActor = {
  type: AuditActorType;
  id?: string;
};

export type AuditLogRecord = {
  id: string;
  event: AuditEventName;
  actorType: AuditActorType;
  actorId?: string;
  subjectType?: string;
  subjectId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type AuditLogRow = {
  id: string;
  event: string;
  actor_type: string;
  actor_id: string | null;
  subject_type: string | null;
  subject_id: string | null;
  metadata_json: string;
  created_at: string;
};

export class AuditLogRepository {
  private constructor(private readonly db: Database) {}

  static create(dbFile: string): AuditLogRepository {
    mkdirSync(path.dirname(dbFile), { recursive: true });
    const db = new BetterSqlite3(dbFile);
    ensureAuditLogSchema(db);
    return new AuditLogRepository(db);
  }

  record(input: {
    event: AuditEventName;
    actor?: AuditActor;
    subjectType?: string;
    subjectId?: string;
    metadata?: Record<string, unknown>;
    now?: Date;
  }): AuditLogRecord {
    const id = randomUUID();
    const now = (input.now ?? new Date()).toISOString();
    this.db
      .prepare(
        `INSERT INTO audit_log (
          id,
          event,
          actor_type,
          actor_id,
          subject_type,
          subject_id,
          metadata_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.event,
        input.actor?.type ?? "system",
        input.actor?.id ?? null,
        input.subjectType ?? null,
        input.subjectId ?? null,
        JSON.stringify(sanitizeMetadata(input.metadata ?? {})),
        now,
      );
    return this.listEvents({ limit: 1, subjectId: input.subjectId, event: input.event })[0] as AuditLogRecord;
  }

  listEvents(filter: {
    event?: AuditEventName;
    subjectId?: string;
    limit?: number;
  } = {}): AuditLogRecord[] {
    const conditions: string[] = [];
    const values: unknown[] = [];
    if (filter.event) {
      conditions.push("event = ?");
      values.push(filter.event);
    }
    if (filter.subjectId) {
      conditions.push("subject_id = ?");
      values.push(filter.subjectId);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ? `LIMIT ${Math.max(1, Math.trunc(filter.limit))}` : "";
    const rows = this.db
      .prepare(
        `SELECT * FROM audit_log
         ${where}
         ORDER BY created_at DESC
         ${limit}`,
      )
      .all(...values) as AuditLogRow[];
    return rows.map(mapAuditLogRow);
  }
}

function ensureAuditLogSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_id TEXT,
      subject_type TEXT,
      subject_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_event_created_at
      ON audit_log(event, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_audit_log_subject
      ON audit_log(subject_type, subject_id, created_at DESC);
  `);
}

function mapAuditLogRow(row: AuditLogRow): AuditLogRecord {
  return {
    id: row.id,
    event: normalizeEventName(row.event),
    actorType: normalizeActorType(row.actor_type),
    actorId: row.actor_id ?? undefined,
    subjectType: row.subject_type ?? undefined,
    subjectId: row.subject_id ?? undefined,
    metadata: parseMetadata(row.metadata_json),
    createdAt: row.created_at,
  };
}

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeMetadata(value: unknown, keyName?: string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeMetadata(entry));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeMetadata(entry, key)]),
    );
  }
  if (typeof value === "string" && keyName && /(api[_-]?key|token|authorization)/i.test(keyName)) {
    return "[redacted]";
  }
  return value;
}

function normalizeEventName(value: string): AuditEventName {
  return (
    [
      "user.created",
      "workspace.created",
      "api_key.created",
      "api_key.revealed",
      "api_key.rotated",
      "api_key.revoked",
      "api_key.suspended",
      "api_key.activated",
      "subscription.granted",
      "subscription.renewed",
      "renewal.requested",
    ] as AuditEventName[]
  ).includes(value as AuditEventName)
    ? (value as AuditEventName)
    : "renewal.requested";
}

function normalizeActorType(value: string): AuditActorType {
  return value === "admin" || value === "customer" || value === "bot" ? value : "system";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
