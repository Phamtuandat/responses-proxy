/**
 * Simple model combo repository — 9Router-style.
 *
 * A "model combo" is a named, ordered list of model strings (e.g.
 * "cc/claude-opus-4-7", "kr/claude-sonnet-4.5") with simple fallback semantics.
 * When a request specifies a combo name as the model, the proxy tries each model
 * in order until one succeeds.
 *
 * This is intentionally simpler than the advanced routing combo system
 * (RoutingComboRepository) which uses tiers, weights, health checks, etc.
 */

import { randomUUID } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";

type Database = InstanceType<typeof BetterSqlite3>;

export type ModelCombo = {
  id: string;
  name: string;
  kind: string | null;
  models: string[];
  roundRobin: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ModelComboInput = {
  name: string;
  kind?: string | null;
  models?: string[];
  roundRobin?: boolean;
};

// Validate combo name: only a-z, A-Z, 0-9, -, _, .
const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

export class ModelComboRepository {
  constructor(private readonly db: Database) {
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS model_combos (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        kind TEXT,
        models TEXT NOT NULL DEFAULT '[]',
        round_robin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_model_combos_name ON model_combos(name);
    `);
  }

  /** Get all model combos, optionally filtered by kind */
  getAll(kind?: string | null): ModelCombo[] {
    let rows: ModelComboRow[];
    if (kind === undefined || kind === null) {
      rows = this.db.prepare(
        `SELECT * FROM model_combos ORDER BY created_at ASC`,
      ).all() as ModelComboRow[];
    } else {
      rows = this.db.prepare(
        `SELECT * FROM model_combos WHERE kind = ? ORDER BY created_at ASC`,
      ).all(kind) as ModelComboRow[];
    }
    return rows.map(rowToCombo);
  }

  /** Get combos without a kind (LLM combos) */
  getLlmCombos(): ModelCombo[] {
    const rows = this.db.prepare(
      `SELECT * FROM model_combos WHERE kind IS NULL ORDER BY created_at ASC`,
    ).all() as ModelComboRow[];
    return rows.map(rowToCombo);
  }

  getById(id: string): ModelCombo | null {
    const row = this.db.prepare(
      `SELECT * FROM model_combos WHERE id = ?`,
    ).get(id) as ModelComboRow | undefined;
    return row ? rowToCombo(row) : null;
  }

  getByName(name: string): ModelCombo | null {
    const row = this.db.prepare(
      `SELECT * FROM model_combos WHERE name = ?`,
    ).get(name) as ModelComboRow | undefined;
    return row ? rowToCombo(row) : null;
  }

  create(input: ModelComboInput): ModelCombo {
    if (!input.name || !input.name.trim()) {
      throw new ModelComboValidationError("Name is required");
    }
    if (!VALID_NAME_REGEX.test(input.name)) {
      throw new ModelComboValidationError(
        "Name can only contain letters, numbers, -, _ and .",
      );
    }
    const existing = this.getByName(input.name);
    if (existing) {
      throw new ModelComboValidationError("Combo name already exists");
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const models = input.models || [];
    const roundRobin = input.roundRobin ? 1 : 0;

    this.db.prepare(`
      INSERT INTO model_combos (id, name, kind, models, round_robin, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.name, input.kind || null, JSON.stringify(models), roundRobin, now, now);

    return this.getById(id)!;
  }

  update(id: string, input: Partial<ModelComboInput>): ModelCombo {
    const existing = this.getById(id);
    if (!existing) {
      throw new ModelComboNotFoundError(id);
    }

    if (input.name !== undefined) {
      if (!input.name.trim()) {
        throw new ModelComboValidationError("Name is required");
      }
      if (!VALID_NAME_REGEX.test(input.name)) {
        throw new ModelComboValidationError(
          "Name can only contain letters, numbers, -, _ and .",
        );
      }
      // Check uniqueness if name changed
      if (input.name !== existing.name) {
        const conflict = this.getByName(input.name);
        if (conflict) {
          throw new ModelComboValidationError("Combo name already exists");
        }
      }
    }

    const now = new Date().toISOString();
    const name = input.name ?? existing.name;
    const kind = input.kind !== undefined ? input.kind : existing.kind;
    const models = input.models ?? existing.models;
    const roundRobin = input.roundRobin !== undefined ? (input.roundRobin ? 1 : 0) : (existing.roundRobin ? 1 : 0);

    this.db.prepare(`
      UPDATE model_combos
      SET name = ?, kind = ?, models = ?, round_robin = ?, updated_at = ?
      WHERE id = ?
    `).run(name, kind || null, JSON.stringify(models), roundRobin, now, id);

    return this.getById(id)!;
  }

  delete(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM model_combos WHERE id = ?`).run(id);
    return (result.changes ?? 0) > 0;
  }
}

// ─── Row mapping ──────────────────────────────────────────────────────────────

type ModelComboRow = {
  id: string;
  name: string;
  kind: string | null;
  models: string;
  round_robin: number;
  created_at: string;
  updated_at: string;
};

function rowToCombo(row: ModelComboRow): ModelCombo {
  let models: string[];
  try {
    models = JSON.parse(row.models);
  } catch {
    models = [];
  }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models,
    roundRobin: Boolean(row.round_robin),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class ModelComboValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelComboValidationError";
  }
}

export class ModelComboNotFoundError extends Error {
  constructor(id: string) {
    super(`Model combo not found: ${id}`);
    this.name = "ModelComboNotFoundError";
  }
}
