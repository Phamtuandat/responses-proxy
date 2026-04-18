import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
import type { AppConfig } from "./config.js";

const moduleRequire = createRequire(import.meta.url);
let sqlJsPromise: Promise<SqlJsStatic> | undefined;

export type RuntimeProviderPreset = {
  id: string;
  name: string;
  baseUrl: string;
  responsesUrl: string;
  apiKeys: string[];
  createdAt?: string;
  updatedAt?: string;
};

export const BUILTIN_CLIENT_ROUTE_KEYS = ["default"] as const;
export type ClientRouteKey = string;
export type ClientRouteMap = Record<string, string>;
export type ClientModelOverrideMap = Record<string, string>;

type RuntimeProviderState = {
  providers: RuntimeProviderPreset[];
  activeProviderId?: string;
  modelOverride?: string;
  modelOverrides?: ClientModelOverrideMap;
  clientRoutes?: ClientRouteMap;
};

export type RuntimeProviderInput = {
  name?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  apiKeys?: unknown;
};

export type RuntimeProviderView = {
  id: string;
  name: string;
  baseUrl: string;
  hasApiKey: boolean;
  apiKeys: string[];
  apiKeysCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ClientRouteView = {
  key: ClientRouteKey;
  providerId: string | null;
  providerName: string | null;
  modelOverride: string | null;
};

type ValidatedProviderInput = {
  name: string;
  baseUrl: string;
  apiKeys: string[];
};

type RuntimeProviderRepositoryOptions = {
  dbFile: string;
  legacyStateFile: string;
  baseProviders: RuntimeProviderPreset[];
};

type ProviderRow = {
  id: string;
  name: string;
  base_url: string;
  responses_url: string;
  created_at: string | null;
  updated_at: string | null;
};

type ApiKeyRow = {
  provider_id: string;
  api_key: string;
};

type RouteRow = {
  client_route: string;
  provider_id: string;
};

type ModelOverrideRow = {
  client_route: string;
  model: string;
};

type AppStateRow = {
  key: string;
  value: string;
};

export class RuntimeProviderError extends Error {
  constructor(
    readonly statusCode: number,
    readonly body: {
      type: string;
      code: string;
      message: string;
    },
  ) {
    super(body.message);
  }
}

export class RuntimeProviderRepository {
  private providerPresets: RuntimeProviderPreset[];
  private activeProviderId: string;
  private modelOverrides: ClientModelOverrideMap;
  private clientRoutes: ClientRouteMap;

  private constructor(
    private readonly dbFile: string,
    private readonly legacyStateFile: string,
    private readonly db: Database,
    state: RuntimeProviderState,
    baseProviders: RuntimeProviderPreset[],
  ) {
    const seededProviders = state.providers.length
      ? mergeBaseProviders(state.providers, baseProviders)
      : [...baseProviders];
    this.providerPresets = ensureUniqueProviderIds(
      seededProviders.map((provider) => migrateLegacyProvider(provider)),
    );
    this.activeProviderId = this.resolveActiveProviderId(state.activeProviderId);
    this.modelOverrides = this.resolveModelOverrides(state.modelOverrides, state.modelOverride);
    this.clientRoutes = this.resolveClientRoutes(state.clientRoutes);
  }

  static async create(
    options: RuntimeProviderRepositoryOptions,
  ): Promise<RuntimeProviderRepository> {
    const SQL = await loadSqlJs();
    const db = openDatabase(SQL, options.dbFile);
    ensureSchema(db);

    const stateFromDb = readStateFromDatabase(db);
    const hasDbState = stateFromDb.providers.length > 0;
    const legacyState = hasDbState ? undefined : loadLegacyState(options.legacyStateFile);
    const initialState = hasDbState ? stateFromDb : legacyState ?? { providers: [] };

    const repository = new RuntimeProviderRepository(
      options.dbFile,
      options.legacyStateFile,
      db,
      initialState,
      options.baseProviders,
    );

    if (!hasDbState || shouldPersistSeededProviders(initialState.providers, repository.providerPresets)) {
      repository.persistRuntimeState();
    }

    return repository;
  }

  getActiveProviderId(): string {
    return this.activeProviderId;
  }

  getModelOverride(client: ClientRouteKey = "default"): string | undefined {
    return this.modelOverrides[client];
  }

  getClientRoutesForUi(): ClientRouteView[] {
    return this.listClientRouteKeys().map((key) => {
      const providerId = this.clientRoutes[key] ?? null;
      const provider = providerId ? this.getProvider(providerId) : undefined;
      return {
        key,
        providerId,
        providerName: provider?.name ?? null,
        modelOverride: this.getModelOverride(key) ?? null,
      };
    });
  }

  getProviderIdForClient(client: ClientRouteKey): string {
    const preferredId = this.clientRoutes[client] ?? this.activeProviderId;
    return this.resolveActiveProviderId(preferredId);
  }

  getProviderForClient(client: ClientRouteKey): RuntimeProviderPreset | undefined {
    return this.getProvider(this.getProviderIdForClient(client));
  }

  setClientRoute(client: ClientRouteKey, providerId?: string): string {
    const routeKey = normalizeClientRouteKey(client);
    const normalizedProviderId = typeof providerId === "string" ? providerId.trim() : "";
    if (normalizedProviderId) {
      this.getProviderOrThrow(normalizedProviderId);
      this.clientRoutes[routeKey] = normalizedProviderId;
    } else {
      delete this.clientRoutes[routeKey];
    }
    this.persistRuntimeState();
    return this.getProviderIdForClient(routeKey);
  }

  setModelOverride(client: ClientRouteKey, model?: string): string | undefined {
    const routeKey = normalizeClientRouteKey(client);
    const normalized = model?.trim() ? model.trim() : undefined;
    if (normalized) {
      this.modelOverrides[routeKey] = normalized;
    } else {
      delete this.modelOverrides[routeKey];
    }
    this.persistRuntimeState();
    return this.getModelOverride(routeKey);
  }

  addClientRoute(client: ClientRouteKey, providerId?: string): string {
    const routeKey = normalizeClientRouteKey(client);
    if (this.listClientRouteKeys().includes(routeKey)) {
      throw new RuntimeProviderError(409, {
        type: "validation_error",
        code: "CLIENT_ROUTE_ALREADY_EXISTS",
        message: "Client route already exists",
      });
    }
    return this.setClientRoute(routeKey, providerId || this.activeProviderId);
  }

  private listClientRouteKeys(): string[] {
    return [
      ...new Set([
        ...BUILTIN_CLIENT_ROUTE_KEYS,
        ...Object.keys(this.clientRoutes),
        ...Object.keys(this.modelOverrides),
      ]),
    ];
  }

  listProviders(): RuntimeProviderPreset[] {
    return [...this.providerPresets];
  }

  listProvidersForUi(): RuntimeProviderView[] {
    return this.providerPresets.map((provider) => this.serializeProviderForUi(provider));
  }

  getProvider(id?: string): RuntimeProviderPreset | undefined {
    return this.providerPresets.find((provider) => provider.id === id);
  }

  findProviderByApiKey(apiKey?: string): RuntimeProviderPreset | undefined {
    const normalized = typeof apiKey === "string" ? apiKey.trim() : "";
    if (!normalized) {
      return undefined;
    }
    return this.providerPresets.find((provider) => provider.apiKeys.includes(normalized));
  }

  getProviderOrThrow(id?: string): RuntimeProviderPreset {
    const provider = this.getProvider(id);
    if (!provider) {
      throw new RuntimeProviderError(404, {
        type: "not_found",
        code: "PROVIDER_NOT_FOUND",
        message: "Provider was not found",
      });
    }
    return provider;
  }

  getProviderForUiOrThrow(id?: string): RuntimeProviderView {
    return this.serializeProviderForUi(this.getProviderOrThrow(id));
  }

  getActiveProvider(): RuntimeProviderPreset | undefined {
    return this.getProviderForClient("default");
  }

  getFallbackProvider(): RuntimeProviderPreset | undefined {
    return this.providerPresets.find((provider) => provider.id !== this.activeProviderId);
  }

  selectProvider(id?: string): RuntimeProviderPreset {
    const provider = this.getProvider(id);
    if (!provider) {
      throw new RuntimeProviderError(400, {
        type: "validation_error",
        code: "INVALID_PROVIDER_ID",
        message: "providerId must match one of the configured runtime providers",
      });
    }
    this.activeProviderId = provider.id;
    this.clientRoutes.default = provider.id;
    this.persistRuntimeState();
    return provider;
  }

  createProvider(input: RuntimeProviderInput): RuntimeProviderPreset {
    const validated = this.parseProviderInput(input);
    this.ensureNoDuplicate(validated);
    const now = new Date().toISOString();
    const provider: RuntimeProviderPreset = {
      id: `custom-${randomUUID().slice(0, 8)}`,
      name: validated.name,
      baseUrl: validated.baseUrl,
      responsesUrl: toResponsesUrl(validated.baseUrl),
      apiKeys: validated.apiKeys,
      createdAt: now,
      updatedAt: now,
    };
    this.providerPresets = [...this.providerPresets, provider];
    this.activeProviderId = provider.id;
    this.clientRoutes.default = provider.id;
    this.persistRuntimeState();
    return provider;
  }

  updateProvider(id: string, input: RuntimeProviderInput): RuntimeProviderPreset {
    const existing = this.getProviderOrThrow(id);
    const validated = this.parseProviderInput(input);
    this.ensureNoDuplicate(validated, id);
    const updated: RuntimeProviderPreset = {
      ...existing,
      name: validated.name,
      baseUrl: validated.baseUrl,
      responsesUrl: toResponsesUrl(validated.baseUrl),
      apiKeys: validated.apiKeys,
      updatedAt: new Date().toISOString(),
    };
    this.providerPresets = this.providerPresets.map((provider) =>
      provider.id === id ? updated : provider,
    );
    this.activeProviderId = id;
    this.clientRoutes.default = id;
    this.persistRuntimeState();
    return updated;
  }

  deleteProvider(id: string): string {
    this.getProviderOrThrow(id);
    this.providerPresets = this.providerPresets.filter((provider) => provider.id !== id);
    for (const key of this.listClientRouteKeys()) {
      if (this.clientRoutes[key] === id) {
        delete this.clientRoutes[key];
      }
    }
    if (this.activeProviderId === id) {
      this.activeProviderId = this.resolveActiveProviderId();
      if (this.activeProviderId) {
        this.clientRoutes.default = this.activeProviderId;
      } else {
        delete this.clientRoutes.default;
      }
    }
    this.persistRuntimeState();
    return this.activeProviderId;
  }

  private ensureNoDuplicate(input: ValidatedProviderInput, ignoreId?: string): void {
    const duplicate = this.providerPresets.find(
      (provider) =>
        provider.id !== ignoreId &&
        (provider.baseUrl === input.baseUrl ||
          normalizeProviderName(provider.name) === normalizeProviderName(input.name)),
    );
    if (duplicate) {
      throw new RuntimeProviderError(409, {
        type: "validation_error",
        code: "PROVIDER_ALREADY_EXISTS",
        message: "A provider with the same name or base URL already exists",
      });
    }

    const conflictingApiKey = input.apiKeys.find((apiKey) =>
      this.providerPresets.some(
        (provider) => provider.id !== ignoreId && provider.apiKeys.includes(apiKey),
      ),
    );
    if (conflictingApiKey) {
      throw new RuntimeProviderError(409, {
        type: "validation_error",
        code: "API_KEY_ALREADY_EXISTS",
        message: "An API key is already assigned to another provider",
      });
    }
  }

  private parseProviderInput(body: RuntimeProviderInput): ValidatedProviderInput {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    const apiKeys = normalizeApiKeysInput(body.apiKeys, body.apiKey);

    if (!name) {
      throw new RuntimeProviderError(400, {
        type: "validation_error",
        code: "INVALID_NAME",
        message: "name is required",
      });
    }

    let parsedBaseUrl: URL;
    try {
      parsedBaseUrl = new URL(baseUrl);
    } catch {
      throw new RuntimeProviderError(400, {
        type: "validation_error",
        code: "INVALID_BASE_URL",
        message: "baseUrl must be a valid URL",
      });
    }

    return {
      name,
      baseUrl: parsedBaseUrl.toString().replace(/\/+$/, ""),
      apiKeys,
    };
  }

  private serializeProviderForUi(provider: RuntimeProviderPreset): RuntimeProviderView {
    return {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      hasApiKey: provider.apiKeys.length > 0,
      apiKeys: [...provider.apiKeys],
      apiKeysCount: provider.apiKeys.length,
      createdAt: provider.createdAt ?? null,
      updatedAt: provider.updatedAt ?? null,
    };
  }

  private resolveActiveProviderId(preferredId?: string): string {
    if (preferredId && this.providerPresets.some((provider) => provider.id === preferredId)) {
      return preferredId;
    }
    return this.providerPresets[0]?.id ?? "";
  }

  private resolveClientRoutes(routes?: ClientRouteMap): ClientRouteMap {
    const resolved = sanitizeClientRoutes(routes);
    if (!resolved.default && this.activeProviderId) {
      resolved.default = this.activeProviderId;
    }
    return Object.fromEntries(
      Object.entries(resolved).filter(([, providerId]) =>
        typeof providerId === "string" &&
        this.providerPresets.some((provider) => provider.id === providerId),
      ),
    ) as ClientRouteMap;
  }

  private resolveModelOverrides(
    overrides?: ClientModelOverrideMap,
    legacyDefault?: string,
  ): ClientModelOverrideMap {
    const resolved = sanitizeModelOverrides(overrides);
    if (!resolved.default && typeof legacyDefault === "string" && legacyDefault.trim()) {
      resolved.default = legacyDefault.trim();
    }
    return resolved;
  }

  private persistRuntimeState(): void {
    this.db.run("BEGIN");
    try {
      this.db.run("DELETE FROM provider_api_keys");
      this.db.run("DELETE FROM providers");
      this.db.run("DELETE FROM client_routes");
      this.db.run("DELETE FROM model_overrides");
      this.db.run("DELETE FROM app_state");

      const insertProvider = this.db.prepare(`
        INSERT INTO providers (id, name, base_url, responses_url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const insertApiKey = this.db.prepare(`
        INSERT INTO provider_api_keys (provider_id, api_key, position)
        VALUES (?, ?, ?)
      `);
      const insertClientRoute = this.db.prepare(`
        INSERT INTO client_routes (client_route, provider_id)
        VALUES (?, ?)
      `);
      const insertModelOverride = this.db.prepare(`
        INSERT INTO model_overrides (client_route, model)
        VALUES (?, ?)
      `);
      const insertAppState = this.db.prepare(`
        INSERT INTO app_state (key, value)
        VALUES (?, ?)
      `);

      for (const provider of this.providerPresets) {
        insertProvider.run([
          provider.id,
          provider.name,
          provider.baseUrl,
          provider.responsesUrl,
          provider.createdAt ?? null,
          provider.updatedAt ?? null,
        ]);
        provider.apiKeys.forEach((apiKey, index) => {
          insertApiKey.run([provider.id, apiKey, index]);
        });
      }

      Object.entries(this.clientRoutes).forEach(([clientRoute, providerId]) => {
        insertClientRoute.run([clientRoute, providerId]);
      });

      Object.entries(this.modelOverrides).forEach(([clientRoute, model]) => {
        insertModelOverride.run([clientRoute, model]);
      });

      insertAppState.run(["active_provider_id", this.activeProviderId]);
      insertAppState.run(["model_override", this.modelOverrides.default ?? ""]);

      insertProvider.free();
      insertApiKey.free();
      insertClientRoute.free();
      insertModelOverride.free();
      insertAppState.free();

      this.db.run("COMMIT");
      persistDatabaseFile(this.dbFile, this.db);
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }
  }
}

export function buildBuiltinProviderPresets(config: AppConfig): RuntimeProviderPreset[] {
  const primaryIdentity = inferProviderIdentity(config.UPSTREAM_BASE_URL, "upstream");
  const presets: RuntimeProviderPreset[] = [
    {
      id: primaryIdentity.id,
      name: primaryIdentity.name,
      baseUrl: config.UPSTREAM_BASE_URL,
      responsesUrl: config.upstreamResponsesUrl,
      apiKeys: normalizeApiKeys(config.UPSTREAM_API_KEY ? [config.UPSTREAM_API_KEY] : []),
    },
  ];

  if (config.fallback) {
    const fallbackBaseUrl = config.fallback.responsesUrl.replace(/\/responses$/, "");
    const fallbackIdentity = inferProviderIdentity(fallbackBaseUrl, config.fallback.name);
    presets.push({
      id: fallbackIdentity.id,
      name: fallbackIdentity.name,
      baseUrl: fallbackBaseUrl,
      responsesUrl: config.fallback.responsesUrl,
      apiKeys: [],
    });
  }

  return ensureUniqueProviderIds(presets);
}

async function loadSqlJs(): Promise<SqlJsStatic> {
  sqlJsPromise ??= initSqlJs({
    locateFile: (file: string) => moduleRequire.resolve(`sql.js/dist/${file}`),
  });
  return sqlJsPromise;
}

function openDatabase(SQL: SqlJsStatic, dbFile: string): Database {
  mkdirSync(path.dirname(dbFile), { recursive: true });
  if (existsSync(dbFile)) {
    return new SQL.Database(readFileSync(dbFile));
  }
  return new SQL.Database();
}

function ensureSchema(db: Database): void {
  db.run("PRAGMA foreign_keys = ON");
  db.run(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      responses_url TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS provider_api_keys (
      provider_id TEXT NOT NULL,
      api_key TEXT NOT NULL UNIQUE,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (provider_id, api_key),
      FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS client_routes (
      client_route TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS model_overrides (
      client_route TEXT PRIMARY KEY,
      model TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function readStateFromDatabase(db: Database): RuntimeProviderState {
  const providerRows = queryRows<ProviderRow>(
    db,
    "SELECT id, name, base_url, responses_url, created_at, updated_at FROM providers ORDER BY name, id",
  );
  const apiKeyRows = queryRows<ApiKeyRow>(
    db,
    "SELECT provider_id, api_key FROM provider_api_keys ORDER BY provider_id, position, api_key",
  );
  const clientRouteRows = queryRows<RouteRow>(
    db,
    "SELECT client_route, provider_id FROM client_routes ORDER BY client_route",
  );
  const modelOverrideRows = queryRows<ModelOverrideRow>(
    db,
    "SELECT client_route, model FROM model_overrides ORDER BY client_route",
  );
  const appStateRows = queryRows<AppStateRow>(
    db,
    "SELECT key, value FROM app_state ORDER BY key",
  );

  const apiKeysByProvider = new Map<string, string[]>();
  for (const row of apiKeyRows) {
    const current = apiKeysByProvider.get(row.provider_id) ?? [];
    current.push(row.api_key);
    apiKeysByProvider.set(row.provider_id, current);
  }

  const providers = providerRows.map((row) => ({
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    responsesUrl: row.responses_url,
    apiKeys: apiKeysByProvider.get(row.id) ?? [],
    createdAt: row.created_at ?? undefined,
    updatedAt: row.updated_at ?? undefined,
  }));

  const appState = new Map(appStateRows.map((row) => [row.key, row.value]));
  const clientRoutes = Object.fromEntries(
    clientRouteRows.map((row) => [row.client_route, row.provider_id]),
  ) as ClientRouteMap;
  const modelOverrides = Object.fromEntries(
    modelOverrideRows.map((row) => [row.client_route, row.model]),
  ) as ClientModelOverrideMap;

  const modelOverride = appState.get("model_override");

  return {
    providers,
    activeProviderId: appState.get("active_provider_id"),
    modelOverride: modelOverride?.trim() ? modelOverride : undefined,
    modelOverrides,
    clientRoutes,
  };
}

function queryRows<T extends Record<string, unknown>>(db: Database, sql: string): T[] {
  const result = db.exec(sql);
  if (result.length === 0) {
    return [];
  }
  const [table] = result;
  const columns = table.columns;
  return table.values.map((values: Array<string | number | null>) =>
    Object.fromEntries(columns.map((column: string, index: number) => [column, values[index]])) as T,
  );
}

function persistDatabaseFile(dbFile: string, db: Database): void {
  mkdirSync(path.dirname(dbFile), { recursive: true });
  writeFileSync(dbFile, Buffer.from(db.export()));
}

function loadLegacyState(stateFile: string): RuntimeProviderState | undefined {
  try {
    const raw = readFileSync(stateFile, "utf8");
    const parsed = JSON.parse(raw) as Partial<RuntimeProviderState>;
    const providers = Array.isArray(parsed.providers)
      ? parsed.providers
          .map((item) => sanitizeProvider(item))
          .filter((item): item is RuntimeProviderPreset => Boolean(item))
      : Array.isArray((parsed as { customProviders?: unknown[] }).customProviders)
        ? ((parsed as { customProviders?: unknown[] }).customProviders ?? [])
          .map((item) => sanitizeCustomProvider(item))
          .filter((item): item is RuntimeProviderPreset => Boolean(item))
        : [];

    return {
      providers,
      activeProviderId:
        typeof parsed.activeProviderId === "string" && parsed.activeProviderId.trim()
          ? parsed.activeProviderId.trim()
          : undefined,
      modelOverride:
        typeof parsed.modelOverride === "string" && parsed.modelOverride.trim()
          ? parsed.modelOverride.trim()
          : undefined,
      modelOverrides: sanitizeModelOverrides(parsed.modelOverrides),
      clientRoutes: sanitizeClientRoutes(parsed.clientRoutes),
    };
  } catch {
    return undefined;
  }
}

function sanitizeCustomProvider(value: unknown): RuntimeProviderPreset | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const baseUrl = typeof record.baseUrl === "string" ? record.baseUrl.trim() : "";
  const apiKeys = normalizeApiKeysInput(record.apiKeys, record.apiKey);
  const createdAt =
    typeof record.createdAt === "string" && record.createdAt.trim()
      ? record.createdAt.trim()
      : undefined;
  const updatedAt =
    typeof record.updatedAt === "string" && record.updatedAt.trim()
      ? record.updatedAt.trim()
      : undefined;

  if (!id || !name || !baseUrl) {
    return undefined;
  }

  try {
    const parsedBaseUrl = new URL(baseUrl);
    const normalizedBaseUrl = parsedBaseUrl.toString().replace(/\/+$/, "");
    return {
      id,
      name,
      baseUrl: normalizedBaseUrl,
      responsesUrl: toResponsesUrl(normalizedBaseUrl),
      apiKeys,
      createdAt,
      updatedAt,
    };
  } catch {
    return undefined;
  }
}

function sanitizeProvider(value: unknown): RuntimeProviderPreset | undefined {
  return sanitizeCustomProvider(value);
}

function sanitizeClientRoutes(value: unknown): ClientRouteMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  const next: ClientRouteMap = {};
  const legacyDefault = typeof record.default === "string" ? record.default.trim() : "";
  if (legacyDefault) {
    next.default = legacyDefault;
  }
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = normalizeClientRouteKey(rawKey);
    const providerId = typeof rawValue === "string" ? rawValue.trim() : "";
    if (providerId) {
      next[key] = providerId;
    }
  }
  return next;
}

function sanitizeModelOverrides(value: unknown): ClientModelOverrideMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  const next: ClientModelOverrideMap = {};
  const legacyDefault = typeof record.default === "string" ? record.default.trim() : "";
  if (legacyDefault) {
    next.default = legacyDefault;
  }
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = normalizeClientRouteKey(rawKey);
    const model = typeof rawValue === "string" ? rawValue.trim() : "";
    if (model) {
      next[key] = model;
    }
  }
  return next;
}

function normalizeApiKeysInput(apiKeysValue: unknown, legacyApiKeyValue?: unknown): string[] {
  if (Array.isArray(apiKeysValue)) {
    return normalizeApiKeys(apiKeysValue);
  }

  if (typeof apiKeysValue === "string") {
    return normalizeApiKeys(apiKeysValue.split(/\r?\n|,/g));
  }

  if (typeof legacyApiKeyValue === "string" && legacyApiKeyValue.trim()) {
    return normalizeApiKeys([legacyApiKeyValue]);
  }

  return [];
}

function normalizeApiKeys(values: unknown[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean),
    ),
  ];
}

export function normalizeClientRouteKey(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new RuntimeProviderError(400, {
      type: "validation_error",
      code: "INVALID_CLIENT_ROUTE",
      message: "client route is required",
    });
  }
  if (normalized === "codex" || normalized === "hermes" || normalized === "openclaw") {
    return "default";
  }
  return normalized;
}

function migrateLegacyProvider(provider: RuntimeProviderPreset): RuntimeProviderPreset {
  if (provider.id !== "primary" && provider.id !== "fallback") {
    return provider;
  }
  const identity = inferProviderIdentity(provider.baseUrl, provider.name);
  return {
    ...provider,
    id: identity.id,
    name: identity.name,
  };
}

function inferProviderIdentity(
  baseUrl: string,
  fallbackName: string,
): {
  id: string;
  name: string;
} {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    if (hostname === "api.krouter.net" || hostname === "krouter.net") {
      return {
        id: "krouter",
        name: "krouter",
      };
    }

    const normalizedHost = hostname
      .replace(/^api\./, "")
      .replace(/^www\./, "")
      .replace(/\.[a-z]+$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const normalizedName = normalizeProviderName(fallbackName || normalizedHost || "provider");
    return {
      id: normalizedName.replace(/[^a-z0-9]+/g, "-"),
      name: normalizedName,
    };
  } catch {
    const normalizedName = normalizeProviderName(fallbackName || "provider");
    return {
      id: normalizedName.replace(/[^a-z0-9]+/g, "-"),
      name: normalizedName,
    };
  }
}

function ensureUniqueProviderIds(providers: RuntimeProviderPreset[]): RuntimeProviderPreset[] {
  const usedIds = new Map<string, number>();
  return providers.map((provider) => {
    const baseId = provider.id.trim() || "provider";
    const seen = usedIds.get(baseId) ?? 0;
    usedIds.set(baseId, seen + 1);
    if (seen === 0) {
      return provider;
    }
    return {
      ...provider,
      id: `${baseId}-${seen + 1}`,
    };
  });
}

function mergeBaseProviders(
  runtimeProviders: RuntimeProviderPreset[],
  baseProviders: RuntimeProviderPreset[],
): RuntimeProviderPreset[] {
  const merged = [...runtimeProviders];
  for (const baseProvider of baseProviders) {
    const exists = merged.some(
      (provider) =>
        provider.baseUrl === baseProvider.baseUrl ||
        normalizeProviderName(provider.name) === normalizeProviderName(baseProvider.name),
    );
    if (!exists) {
      merged.push(baseProvider);
    }
  }
  return merged;
}

function shouldPersistSeededProviders(
  originalProviders: RuntimeProviderPreset[],
  nextProviders: RuntimeProviderPreset[],
): boolean {
  if (originalProviders.length !== nextProviders.length) {
    return true;
  }
  return nextProviders.some((provider, index) => {
    const original = originalProviders[index];
    return (
      !original ||
      original.id !== provider.id ||
      original.name !== provider.name ||
      original.baseUrl !== provider.baseUrl ||
      JSON.stringify(original.apiKeys) !== JSON.stringify(provider.apiKeys)
    );
  });
}

function normalizeProviderName(value: string): string {
  return value.trim().toLowerCase();
}

function toResponsesUrl(baseUrl: string): string {
  return baseUrl.endsWith("/v1") ? `${baseUrl}/responses` : `${baseUrl}/v1/responses`;
}
