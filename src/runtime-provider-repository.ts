import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";
import type { AppConfig } from "./config.js";
import {
  cloneProviderRequestParameterPolicy,
  parseProviderRequestParameterPolicyInput,
  resolveMaxOutputTokensRule,
  type ProviderRequestParameterPolicy,
} from "./provider-request-parameters.js";
import {
  cloneRtkLayerPolicy,
  parseRtkLayerPolicyInput,
  type RtkLayerPolicy,
} from "./rtk-layer.js";
import { resolveClientTokenWindowStart } from "./client-token-limits.js";
export { resolveClientTokenWindowStart } from "./client-token-limits.js";
type Database = InstanceType<typeof BetterSqlite3>;

export type RuntimeProviderCapabilities = {
  ownedBy?: string;
  systemManaged?: boolean;
  accountPlatform?: string;
  accountPoolRequired?: boolean;
  usageCheckEnabled: boolean;
  usageCheckUrl?: string;
  stripMaxOutputTokens: boolean;
  requestParameterPolicy: ProviderRequestParameterPolicy;
  sanitizeReasoningSummary: boolean;
  stripModelPrefixes: string[];
  modelAliases?: Record<string, string>;
  rtkPolicy?: RtkLayerPolicy;
  errorPolicy?: ProviderErrorPolicy;
};

export type ProviderErrorPolicyRule = {
  statusCodes?: number[];
  upstreamCodes?: string[];
  upstreamTypes?: string[];
  messageIncludes?: string[];
  bodyIncludes?: string[];
  code?: string;
  message?: string;
  retryable?: boolean;
};

export type ProviderErrorPolicy = {
  rules: ProviderErrorPolicyRule[];
};

export type RuntimeProviderPreset = {
  id: string;
  name: string;
  baseUrl: string;
  responsesUrl: string;
  authMode?: RuntimeProviderAuthMode;
  chatgptAccountId?: string;
  providerApiKeys: string[];
  clientApiKeys: string[];
  capabilities: RuntimeProviderCapabilities;
  createdAt?: string;
  updatedAt?: string;
};

export type RuntimeProviderAuthMode = "api_key" | "chatgpt_oauth";

export const BUILTIN_CLIENT_ROUTE_KEYS = ["default"] as const;
export type ClientRouteKey = string;
export type ClientRouteMap = Record<string, string>;
export type ClientModelOverrideMap = Record<string, string>;
export type ClientRtkPolicyMap = Record<string, RtkLayerPolicy>;
export type ClientRouteApiKeyMap = Record<string, string[]>;
export type ClientTokenWindowType = "daily" | "weekly" | "monthly" | "fixed";

export type ClientTokenLimitConfig = {
  clientRoute: ClientRouteKey;
  enabled: boolean;
  tokenLimit: number;
  windowType: ClientTokenWindowType;
  windowSizeSeconds?: number;
  hardBlock: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ClientTokenUsageSnapshot = {
  clientRoute: ClientRouteKey;
  windowStart: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  updatedAt: string;
};

export type ClientTokenUsageDelta = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type ClientTokenLimitView = {
  clientRoute: ClientRouteKey;
  config: ClientTokenLimitConfig | null;
  usage: ClientTokenUsageSnapshot;
};

type RuntimeProviderState = {
  providers: RuntimeProviderPreset[];
  activeProviderId?: string;
  modelOverride?: string;
  modelOverrides?: ClientModelOverrideMap;
  clientRoutes?: ClientRouteMap;
  clientRouteRtkPolicies?: ClientRtkPolicyMap;
  clientRouteApiKeys?: ClientRouteApiKeyMap;
};

export type RuntimeProviderInput = {
  id?: unknown;
  name?: unknown;
  baseUrl?: unknown;
  apiKey?: unknown;
  apiKeys?: unknown;
  providerApiKeys?: unknown;
  clientApiKeys?: unknown;
  authMode?: unknown;
  chatgptAccountId?: unknown;
  capabilities?: unknown;
};

export type RuntimeProviderView = {
  id: string;
  name: string;
  baseUrl: string;
  hasProviderApiKey: boolean;
  providerApiKeys: string[];
  providerApiKeysCount: number;
  authMode: RuntimeProviderAuthMode;
  chatgptAccountId: string | null;
  capabilities: RuntimeProviderCapabilities;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ClientRouteView = {
  key: ClientRouteKey;
  providerId: string | null;
  providerName: string | null;
  modelOverride: string | null;
  rtkPolicy: RtkLayerPolicy | null;
  apiKeys: string[];
};

type ValidatedProviderInput = {
  id?: string;
  name: string;
  baseUrl: string;
  authMode: RuntimeProviderAuthMode;
  chatgptAccountId?: string;
  providerApiKeys: string[];
  clientApiKeys: string[];
  capabilities: RuntimeProviderCapabilities;
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
  auth_mode: string | null;
  chatgpt_account_id: string | null;
  owned_by: string | null;
  usage_check_enabled: number | null;
  usage_check_url: string | null;
  strip_max_output_tokens: number | null;
  request_parameter_policy: string | null;
  sanitize_reasoning_summary: number | null;
  strip_model_prefixes: string | null;
  model_aliases: string | null;
  rtk_policy: string | null;
  error_policy: string | null;
  system_managed: number | null;
  account_platform: string | null;
  account_pool_required: number | null;
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

type ClientRouteRtkPolicyRow = {
  client_route: string;
  policy: string;
};

type AppStateRow = {
  key: string;
  value: string;
};

type ClientTokenLimitRow = {
  client_route: string;
  enabled: number | null;
  token_limit: number | null;
  window_type: string | null;
  window_size_seconds: number | null;
  hard_block: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type ClientTokenUsageRow = {
  client_route: string;
  window_start: string;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  updated_at: string | null;
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
  private clientRouteRtkPolicies: ClientRtkPolicyMap;
  private clientRouteApiKeys: ClientRouteApiKeyMap;

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
    this.clientRouteRtkPolicies = this.resolveClientRouteRtkPolicies(state.clientRouteRtkPolicies);
    this.clientRouteApiKeys = this.resolveClientRouteApiKeys(state.clientRouteApiKeys);
  }

  static async create(
    options: RuntimeProviderRepositoryOptions,
  ): Promise<RuntimeProviderRepository> {
    const db = openDatabase(options.dbFile);
    ensureSchema(db);
    backfillLegacyRequestParameterPolicies(db);

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
        rtkPolicy: cloneRtkLayerPolicy(this.getClientRouteRtkPolicy(key)) ?? null,
        apiKeys: [...(this.clientRouteApiKeys[key] ?? [])],
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

  getClientRouteRtkPolicy(client: ClientRouteKey = "default"): RtkLayerPolicy | undefined {
    return this.clientRouteRtkPolicies[normalizeClientRouteKey(client)];
  }

  getClientRouteApiKeys(client: ClientRouteKey = "default"): string[] {
    return [...(this.clientRouteApiKeys[normalizeClientRouteKey(client)] ?? [])];
  }

  getClientTokenLimit(client: ClientRouteKey): ClientTokenLimitConfig | undefined {
    const row = this.db
      .prepare(
        `SELECT
          client_route,
          enabled,
          token_limit,
          window_type,
          window_size_seconds,
          hard_block,
          created_at,
          updated_at
        FROM client_token_limits
        WHERE client_route = ?`,
      )
      .get(normalizeClientRouteKey(client)) as ClientTokenLimitRow | undefined;
    return row ? mapClientTokenLimitRow(row) : undefined;
  }

  getClientTokenUsage(client: ClientRouteKey, now: Date = new Date()): ClientTokenUsageSnapshot {
    const clientRoute = normalizeClientRouteKey(client);
    const config = this.getClientTokenLimit(clientRoute);
    const windowStart = resolveClientTokenWindowStart(now, {
      windowType: config?.windowType ?? "daily",
      windowSizeSeconds: config?.windowSizeSeconds,
    });
    const row = this.db
      .prepare(
        `SELECT
          client_route,
          window_start,
          input_tokens,
          output_tokens,
          total_tokens,
          updated_at
        FROM client_token_usage
        WHERE client_route = ? AND window_start = ?`,
      )
      .get(clientRoute, windowStart) as ClientTokenUsageRow | undefined;
    return (
      row ? mapClientTokenUsageRow(row) : buildEmptyClientTokenUsageSnapshot(clientRoute, windowStart)
    );
  }

  listClientTokenLimitsForUi(now: Date = new Date()): ClientTokenLimitView[] {
    const rows = queryRows<ClientTokenLimitRow>(
      this.db,
      `SELECT
        client_route,
        enabled,
        token_limit,
        window_type,
        window_size_seconds,
        hard_block,
        created_at,
        updated_at
      FROM client_token_limits
      ORDER BY client_route`,
    );
    const configByClientRoute = new Map(rows.map((row) => {
      const config = mapClientTokenLimitRow(row);
      return [config.clientRoute, config] as const;
    }));
    return this.listClientRouteKeys().map((clientRoute) => {
      const config = configByClientRoute.get(clientRoute) ?? null;
      return {
        clientRoute,
        config,
        usage: this.getClientTokenUsage(clientRoute, now),
      };
    });
  }

  setClientTokenLimit(
    client: ClientRouteKey,
    input: {
      enabled: boolean;
      tokenLimit: number;
      windowType: ClientTokenWindowType;
      windowSizeSeconds?: number;
      hardBlock: boolean;
    },
  ): ClientTokenLimitConfig {
    const clientRoute = normalizeClientRouteKey(client);
    const tokenLimit = Math.max(1, Math.floor(input.tokenLimit));
    const windowType = normalizeClientTokenWindowType(input.windowType);
    const windowSizeSeconds =
      windowType === "fixed" && input.windowSizeSeconds && input.windowSizeSeconds > 0
        ? Math.floor(input.windowSizeSeconds)
        : undefined;
    const now = new Date().toISOString();
    const existing = this.getClientTokenLimit(clientRoute);

    this.db
      .prepare(
        `INSERT INTO client_token_limits (
          client_route,
          enabled,
          token_limit,
          window_type,
          window_size_seconds,
          hard_block,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(client_route) DO UPDATE SET
          enabled = excluded.enabled,
          token_limit = excluded.token_limit,
          window_type = excluded.window_type,
          window_size_seconds = excluded.window_size_seconds,
          hard_block = excluded.hard_block,
          updated_at = excluded.updated_at`,
      )
      .run(
        clientRoute,
        input.enabled ? 1 : 0,
        tokenLimit,
        windowType,
        windowSizeSeconds ?? null,
        input.hardBlock ? 1 : 0,
        existing?.createdAt ?? now,
        now,
      );

    return this.getClientTokenLimit(clientRoute)!;
  }

  deleteClientTokenLimit(client: ClientRouteKey): boolean {
    const result = this.db
      .prepare("DELETE FROM client_token_limits WHERE client_route = ?")
      .run(normalizeClientRouteKey(client));
    return result.changes > 0;
  }

  incrementClientTokenUsage(
    client: ClientRouteKey,
    usage: ClientTokenUsageDelta,
    now: Date = new Date(),
  ): ClientTokenUsageSnapshot {
    const clientRoute = normalizeClientRouteKey(client);
    const config = this.getClientTokenLimit(clientRoute);
    const windowStart = resolveClientTokenWindowStart(now, {
      windowType: config?.windowType ?? "daily",
      windowSizeSeconds: config?.windowSizeSeconds,
    });
    const inputTokens = normalizeNonNegativeInteger(usage.inputTokens);
    const outputTokens = normalizeNonNegativeInteger(usage.outputTokens);
    const totalTokens = normalizeNonNegativeInteger(usage.totalTokens);
    const updatedAt = now.toISOString();

    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO client_token_usage (
            client_route,
            window_start,
            input_tokens,
            output_tokens,
            total_tokens,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(client_route, window_start) DO UPDATE SET
            input_tokens = input_tokens + excluded.input_tokens,
            output_tokens = output_tokens + excluded.output_tokens,
            total_tokens = total_tokens + excluded.total_tokens,
            updated_at = excluded.updated_at`,
        )
        .run(clientRoute, windowStart, inputTokens, outputTokens, totalTokens, updatedAt);
    })();

    return this.getClientTokenUsage(clientRoute, now);
  }

  resetClientTokenUsage(client: ClientRouteKey, now: Date = new Date()): ClientTokenUsageSnapshot {
    const clientRoute = normalizeClientRouteKey(client);
    const config = this.getClientTokenLimit(clientRoute);
    const windowStart = resolveClientTokenWindowStart(now, {
      windowType: config?.windowType ?? "daily",
      windowSizeSeconds: config?.windowSizeSeconds,
    });
    const updatedAt = now.toISOString();

    this.db.transaction(() => {
      this.db
        .prepare(
          `DELETE FROM client_token_usage
          WHERE client_route = ? AND window_start = ?`,
        )
        .run(clientRoute, windowStart);
      this.db
        .prepare(
          `INSERT INTO client_token_usage (
            client_route,
            window_start,
            input_tokens,
            output_tokens,
            total_tokens,
            updated_at
          ) VALUES (?, ?, 0, 0, 0, ?)`,
        )
        .run(clientRoute, windowStart, updatedAt);
    })();

    return this.getClientTokenUsage(clientRoute, now);
  }

  findClientRouteByApiKey(apiKey?: string): ClientRouteKey | undefined {
    const normalizedApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
    if (!normalizedApiKey) {
      return undefined;
    }

    for (const clientRoute of this.listClientRouteKeys()) {
      if ((this.clientRouteApiKeys[clientRoute] ?? []).includes(normalizedApiKey)) {
        return clientRoute;
      }
    }

    return undefined;
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

  setClientRouteRtkPolicy(
    client: ClientRouteKey,
    policy?: RtkLayerPolicy,
  ): RtkLayerPolicy | undefined {
    const routeKey = normalizeClientRouteKey(client);
    const normalized = cloneRtkLayerPolicy(policy);
    if (
      normalized &&
      (normalized.enabled !== undefined ||
        normalized.toolOutputEnabled !== undefined ||
        normalized.maxChars !== undefined ||
        normalized.maxLines !== undefined)
    ) {
      this.clientRouteRtkPolicies[routeKey] = normalized;
    } else {
      delete this.clientRouteRtkPolicies[routeKey];
    }
    this.persistRuntimeState();
    return this.getClientRouteRtkPolicy(routeKey);
  }

  setClientRouteApiKeys(client: ClientRouteKey, apiKeys?: string[]): string[] {
    const routeKey = normalizeClientRouteKey(client);
    const normalized = normalizeApiKeys(apiKeys ?? []);
    if (normalized.length > 0) {
      this.clientRouteApiKeys[routeKey] = normalized;
    } else {
      delete this.clientRouteApiKeys[routeKey];
    }
    this.persistRuntimeState();
    return this.getClientRouteApiKeys(routeKey);
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

  deleteClientRoute(client: ClientRouteKey): void {
    const routeKey = normalizeClientRouteKey(client);
    if (routeKey === "default") {
      throw new RuntimeProviderError(400, {
        type: "validation_error",
        code: "DEFAULT_CLIENT_ROUTE_REQUIRED",
        message: "The default client route cannot be deleted",
      });
    }
    delete this.clientRoutes[routeKey];
    delete this.modelOverrides[routeKey];
    delete this.clientRouteRtkPolicies[routeKey];
    delete this.clientRouteApiKeys[routeKey];
    this.persistRuntimeState();
  }

  private listClientRouteKeys(): string[] {
    return [
      ...new Set([
        ...BUILTIN_CLIENT_ROUTE_KEYS,
        ...Object.keys(this.clientRoutes),
        ...Object.keys(this.modelOverrides),
        ...Object.keys(this.clientRouteRtkPolicies),
        ...Object.keys(this.clientRouteApiKeys),
      ]),
    ];
  }

  private buildFallbackRouteOrder(currentClient: ClientRouteKey): string[] {
    const normalizedCurrent = normalizeClientRouteKey(currentClient);
    const prioritizedRoutes =
      normalizedCurrent === "codex"
        ? ["default", "hermes", "codex"]
        : normalizedCurrent === "default"
          ? ["codex", "hermes", "default"]
          : ["codex", "default", "hermes"];

    return [
      ...new Set(
        [...prioritizedRoutes, ...this.listClientRouteKeys()].filter((routeKey) => routeKey !== normalizedCurrent),
      ),
    ];
  }

  private resolveClientRouteApiKeys(value?: ClientRouteApiKeyMap): ClientRouteApiKeyMap {
    const next = sanitizeClientRouteApiKeys(value);
    delete next.default;
    return next;
  }

  listProviders(): RuntimeProviderPreset[] {
    return [...this.providerPresets];
  }

  listProvidersForUi(): RuntimeProviderView[] {
    return this.providerPresets
      .filter((provider) => !provider.capabilities.systemManaged)
      .map((provider) => this.serializeProviderForUi(provider));
  }

  listProviderOptionsForClientSetup(): RuntimeProviderView[] {
    return this.providerPresets.map((provider) => this.serializeProviderOptionForClientSetup(provider));
  }

  getProvider(id?: string): RuntimeProviderPreset | undefined {
    return this.providerPresets.find((provider) => provider.id === id);
  }

  findProviderByProviderApiKey(apiKey?: string): RuntimeProviderPreset | undefined {
    const normalized = typeof apiKey === "string" ? apiKey.trim() : "";
    if (!normalized) {
      return undefined;
    }
    return this.providerPresets.find((provider) => provider.providerApiKeys.includes(normalized));
  }

  findProviderByAccessKey(apiKey?: string): RuntimeProviderPreset | undefined {
    return this.findProvidersByAccessKey(apiKey)[0];
  }

  findProvidersByAccessKey(apiKey?: string): RuntimeProviderPreset[] {
    const normalized = typeof apiKey === "string" ? apiKey.trim() : "";
    if (!normalized) {
      return [];
    }
    const clientRoute = this.findClientRouteByApiKey(normalized);
    if (clientRoute) {
      const provider = this.getProviderForClient(clientRoute);
      return provider ? [provider] : [];
    }
    return this.providerPresets.filter((provider) => provider.providerApiKeys.includes(normalized));
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

  getFallbackProvider(client: ClientRouteKey = "default", primaryProviderId?: string): RuntimeProviderPreset | undefined {
    const preferredRouteOrder = this.buildFallbackRouteOrder(client);
    const excludedProviderIds = new Set<string>();
    const normalizedPrimaryProviderId = typeof primaryProviderId === "string" ? primaryProviderId.trim() : "";
    if (normalizedPrimaryProviderId) {
      excludedProviderIds.add(normalizedPrimaryProviderId);
    }

    for (const routeKey of preferredRouteOrder) {
      const provider = this.getProviderForClient(routeKey);
      if (!provider || excludedProviderIds.has(provider.id)) {
        continue;
      }
      return provider;
    }
    return undefined;
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
      id: validated.id ?? `custom-${randomUUID().slice(0, 8)}`,
      name: validated.name,
      baseUrl: validated.baseUrl,
      responsesUrl: toResponsesUrl(validated.baseUrl),
      authMode: validated.authMode,
      chatgptAccountId: validated.chatgptAccountId,
      providerApiKeys: validated.providerApiKeys,
      clientApiKeys: validated.clientApiKeys,
      capabilities: validated.capabilities,
      createdAt: now,
      updatedAt: now,
    };
    this.providerPresets = [...this.providerPresets, provider];
    if (!this.activeProviderId) {
      this.activeProviderId = provider.id;
    }
    if (!this.clientRoutes.default && this.activeProviderId) {
      this.clientRoutes.default = this.activeProviderId;
    }
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
      authMode: validated.authMode,
      chatgptAccountId: validated.chatgptAccountId,
      providerApiKeys: validated.providerApiKeys,
      clientApiKeys: validated.clientApiKeys,
      capabilities: validated.capabilities,
      updatedAt: new Date().toISOString(),
    };
    this.providerPresets = this.providerPresets.map((provider) =>
      provider.id === id ? updated : provider,
    );
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

    const conflictingProviderApiKey = input.providerApiKeys.find((apiKey) =>
      this.providerPresets.some(
        (provider) => provider.id !== ignoreId && provider.providerApiKeys.includes(apiKey),
      ),
    );
    if (conflictingProviderApiKey) {
      throw new RuntimeProviderError(409, {
        type: "validation_error",
        code: "PROVIDER_API_KEY_ALREADY_EXISTS",
        message: "A provider API key is already assigned to another provider",
      });
    }

  }

  private parseProviderInput(body: RuntimeProviderInput): ValidatedProviderInput {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const id = typeof body.id === "string" && body.id.trim() ? body.id.trim() : undefined;
    const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    const providerApiKeys = normalizeApiKeysInput(
      body.providerApiKeys,
      body.apiKeys,
      body.apiKey,
    );
    const authMode = parseRuntimeProviderAuthMode(body.authMode);
    const chatgptAccountId =
      typeof body.chatgptAccountId === "string" && body.chatgptAccountId.trim()
        ? body.chatgptAccountId.trim()
        : undefined;
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
      id,
      baseUrl: parsedBaseUrl.toString().replace(/\/+$/, ""),
      authMode,
      chatgptAccountId,
      providerApiKeys,
      clientApiKeys: [],
      capabilities: parseProviderCapabilitiesInput(body.capabilities),
    };
  }

  private serializeProviderForUi(provider: RuntimeProviderPreset): RuntimeProviderView {
    return {
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      hasProviderApiKey: provider.providerApiKeys.length > 0,
      providerApiKeys: [...provider.providerApiKeys],
      providerApiKeysCount: provider.providerApiKeys.length,
      authMode: parseRuntimeProviderAuthMode(provider.authMode),
      chatgptAccountId: provider.chatgptAccountId ?? null,
      capabilities: cloneCapabilities(provider.capabilities),
      createdAt: provider.createdAt ?? null,
      updatedAt: provider.updatedAt ?? null,
    };
  }

  private serializeProviderOptionForClientSetup(provider: RuntimeProviderPreset): RuntimeProviderView {
    const view = this.serializeProviderForUi(provider);
    return {
      ...view,
      providerApiKeys: [],
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

  private resolveClientRouteRtkPolicies(
    policies?: ClientRtkPolicyMap,
  ): ClientRtkPolicyMap {
    if (!policies) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(policies)
        .map(([clientRoute, policy]) => [normalizeClientRouteKey(clientRoute), cloneRtkLayerPolicy(policy)] as const)
        .filter((entry): entry is [string, RtkLayerPolicy] => Boolean(entry[1])),
    );
  }

  private persistRuntimeState(): void {
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM provider_api_keys");
      this.db.exec("DELETE FROM client_api_keys");
      this.db.exec("DELETE FROM providers");
      this.db.exec("DELETE FROM client_routes");
      this.db.exec("DELETE FROM model_overrides");
      this.db.exec("DELETE FROM client_route_rtk_policies");
      this.db.exec("DELETE FROM app_state");

      const insertProvider = this.db.prepare(`
        INSERT INTO providers (
          id,
          name,
          base_url,
          responses_url,
          auth_mode,
          chatgpt_account_id,
          owned_by,
          usage_check_enabled,
          usage_check_url,
          strip_max_output_tokens,
          request_parameter_policy,
          sanitize_reasoning_summary,
          strip_model_prefixes,
          model_aliases,
          rtk_policy,
          error_policy,
          system_managed,
          account_platform,
          account_pool_required,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      const insertClientRouteRtkPolicy = this.db.prepare(`
        INSERT INTO client_route_rtk_policies (client_route, policy)
        VALUES (?, ?)
      `);
      const insertAppState = this.db.prepare(`
        INSERT INTO app_state (key, value)
        VALUES (?, ?)
      `);

      for (const provider of this.providerPresets) {
        insertProvider.run(
          provider.id,
          provider.name,
          provider.baseUrl,
          provider.responsesUrl,
          parseRuntimeProviderAuthMode(provider.authMode),
          provider.chatgptAccountId ?? null,
          provider.capabilities.ownedBy ?? null,
          provider.capabilities.usageCheckEnabled ? 1 : 0,
          provider.capabilities.usageCheckUrl ?? null,
          provider.capabilities.stripMaxOutputTokens ? 1 : 0,
          JSON.stringify(
            cloneProviderRequestParameterPolicy(provider.capabilities.requestParameterPolicy),
          ),
          provider.capabilities.sanitizeReasoningSummary ? 1 : 0,
          JSON.stringify(provider.capabilities.stripModelPrefixes),
          JSON.stringify(provider.capabilities.modelAliases ?? {}),
          JSON.stringify(cloneRtkLayerPolicy(provider.capabilities.rtkPolicy) ?? {}),
          JSON.stringify(cloneProviderErrorPolicy(provider.capabilities.errorPolicy) ?? {}),
          provider.capabilities.systemManaged ? 1 : 0,
          provider.capabilities.accountPlatform ?? null,
          provider.capabilities.accountPoolRequired ? 1 : 0,
          provider.createdAt ?? null,
          provider.updatedAt ?? null,
        );
        provider.providerApiKeys.forEach((apiKey, index) => {
          insertApiKey.run(provider.id, apiKey, index);
        });
      }

      Object.entries(this.clientRoutes).forEach(([clientRoute, providerId]) => {
        insertClientRoute.run(clientRoute, providerId);
      });

      Object.entries(this.modelOverrides).forEach(([clientRoute, model]) => {
        insertModelOverride.run(clientRoute, model);
      });
      Object.entries(this.clientRouteRtkPolicies).forEach(([clientRoute, policy]) => {
        insertClientRouteRtkPolicy.run(
          clientRoute,
          JSON.stringify(cloneRtkLayerPolicy(policy) ?? {}),
        );
      });

      insertAppState.run("active_provider_id", this.activeProviderId);
      insertAppState.run("model_override", this.modelOverrides.default ?? "");
      insertAppState.run("client_route_api_keys", JSON.stringify(this.clientRouteApiKeys));

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function buildBuiltinProviderPresets(config: AppConfig): RuntimeProviderPreset[] {
  const primaryIdentity = inferProviderIdentity(config.UPSTREAM_BASE_URL, "");
  return ensureUniqueProviderIds([
    {
      id: primaryIdentity.id,
      name: primaryIdentity.name,
      baseUrl: config.UPSTREAM_BASE_URL,
      responsesUrl: config.upstreamResponsesUrl,
      authMode: "api_key",
      providerApiKeys: normalizeApiKeys(config.UPSTREAM_API_KEY ? [config.UPSTREAM_API_KEY] : []),
      clientApiKeys: [],
      capabilities: buildDefaultCapabilitiesFromConfig(config),
    },
  ]);
}

function openDatabase(dbFile: string): Database {
  mkdirSync(path.dirname(dbFile), { recursive: true });
  return new BetterSqlite3(dbFile);
}

function ensureSchema(db: Database): void {
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      responses_url TEXT NOT NULL,
      auth_mode TEXT NOT NULL DEFAULT 'api_key',
      chatgpt_account_id TEXT,
      owned_by TEXT,
      usage_check_enabled INTEGER NOT NULL DEFAULT 0,
      usage_check_url TEXT,
      strip_max_output_tokens INTEGER NOT NULL DEFAULT 0,
      request_parameter_policy TEXT NOT NULL DEFAULT '{}',
      sanitize_reasoning_summary INTEGER NOT NULL DEFAULT 0,
      strip_model_prefixes TEXT NOT NULL DEFAULT '[]',
      model_aliases TEXT NOT NULL DEFAULT '{}',
      rtk_policy TEXT NOT NULL DEFAULT '{}',
      error_policy TEXT NOT NULL DEFAULT '{}',
      system_managed INTEGER NOT NULL DEFAULT 0,
      account_platform TEXT,
      account_pool_required INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS provider_api_keys (
      provider_id TEXT NOT NULL,
      api_key TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (provider_id, api_key),
      FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS client_api_keys (
      provider_id TEXT NOT NULL,
      api_key TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS client_route_rtk_policies (
      client_route TEXT PRIMARY KEY,
      policy TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS client_token_limits (
      client_route TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      token_limit INTEGER NOT NULL,
      window_type TEXT NOT NULL,
      window_size_seconds INTEGER,
      hard_block INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS client_token_usage (
      client_route TEXT NOT NULL,
      window_start TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (client_route, window_start)
    );
  `);
  ensureProvidersColumn(db, "owned_by", "TEXT");
  ensureProvidersColumn(db, "auth_mode", "TEXT NOT NULL DEFAULT 'api_key'");
  ensureProvidersColumn(db, "chatgpt_account_id", "TEXT");
  ensureProvidersColumn(db, "usage_check_enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureProvidersColumn(db, "usage_check_url", "TEXT");
  ensureProvidersColumn(db, "strip_max_output_tokens", "INTEGER NOT NULL DEFAULT 0");
  ensureProvidersColumn(db, "request_parameter_policy", "TEXT NOT NULL DEFAULT '{}'");
  ensureProvidersColumn(db, "sanitize_reasoning_summary", "INTEGER NOT NULL DEFAULT 0");
  ensureProvidersColumn(db, "strip_model_prefixes", "TEXT NOT NULL DEFAULT '[]'");
  ensureProvidersColumn(db, "model_aliases", "TEXT NOT NULL DEFAULT '{}'");
  ensureProvidersColumn(db, "rtk_policy", "TEXT NOT NULL DEFAULT '{}'");
  ensureProvidersColumn(db, "error_policy", "TEXT NOT NULL DEFAULT '{}'");
  ensureProvidersColumn(db, "system_managed", "INTEGER NOT NULL DEFAULT 0");
  ensureProvidersColumn(db, "account_platform", "TEXT");
  ensureProvidersColumn(db, "account_pool_required", "INTEGER NOT NULL DEFAULT 0");
  ensureSharedApiKeyTable(db, "provider_api_keys");
  ensureSharedApiKeyTable(db, "client_api_keys");
}

function readStateFromDatabase(db: Database): RuntimeProviderState {
  const providerRows = queryRows<ProviderRow>(
    db,
    `SELECT
      id,
      name,
      base_url,
      responses_url,
      auth_mode,
      chatgpt_account_id,
      owned_by,
      usage_check_enabled,
      usage_check_url,
      strip_max_output_tokens,
      request_parameter_policy,
      sanitize_reasoning_summary,
      strip_model_prefixes,
      model_aliases,
      rtk_policy,
      error_policy,
      system_managed,
      account_platform,
      account_pool_required,
      created_at,
      updated_at
    FROM providers
    ORDER BY name, id`,
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
  const clientRouteRtkPolicyRows = queryRows<ClientRouteRtkPolicyRow>(
    db,
    "SELECT client_route, policy FROM client_route_rtk_policies ORDER BY client_route",
  );
  const appStateRows = queryRows<AppStateRow>(
    db,
    "SELECT key, value FROM app_state ORDER BY key",
  );

  const providerApiKeysByProvider = new Map<string, string[]>();
  for (const row of apiKeyRows) {
    const current = providerApiKeysByProvider.get(row.provider_id) ?? [];
    current.push(row.api_key);
    providerApiKeysByProvider.set(row.provider_id, current);
  }

  const providers = providerRows.map((row) => ({
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    responsesUrl: row.responses_url,
    authMode: parseRuntimeProviderAuthMode(row.auth_mode),
    chatgptAccountId: row.chatgpt_account_id?.trim() ? row.chatgpt_account_id.trim() : undefined,
    providerApiKeys: providerApiKeysByProvider.get(row.id) ?? [],
    clientApiKeys: [],
    capabilities: {
      ownedBy: row.owned_by ?? undefined,
      systemManaged: row.system_managed === 1,
      accountPlatform: row.account_platform?.trim() ? row.account_platform.trim() : undefined,
      accountPoolRequired: row.account_pool_required === 1,
      usageCheckEnabled: row.usage_check_enabled === 1,
      usageCheckUrl: row.usage_check_url?.trim() ? row.usage_check_url.trim() : undefined,
      stripMaxOutputTokens: row.strip_max_output_tokens === 1,
      requestParameterPolicy: normalizeStoredRequestParameterPolicy(
        row.request_parameter_policy,
        row.strip_max_output_tokens === 1,
      ),
      sanitizeReasoningSummary: row.sanitize_reasoning_summary === 1,
      stripModelPrefixes: normalizeStringList(row.strip_model_prefixes),
      modelAliases: normalizeStringMap(row.model_aliases),
      rtkPolicy: parseRtkLayerPolicyInput(safeJsonParse(row.rtk_policy ?? "{}")),
      errorPolicy: parseProviderErrorPolicyInput(safeJsonParse(row.error_policy ?? "{}")),
    },
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
  const clientRouteRtkPolicies = Object.fromEntries(
    clientRouteRtkPolicyRows
      .map((row) => [row.client_route, parseRtkLayerPolicyInput(safeJsonParse(row.policy))] as const)
      .filter((entry): entry is [string, RtkLayerPolicy] => Boolean(entry[1])),
  ) as ClientRtkPolicyMap;

  const modelOverride = appState.get("model_override");
  const clientRouteApiKeys = sanitizeClientRouteApiKeys(
    safeJsonParse(appState.get("client_route_api_keys") ?? "{}"),
  );

  return {
    providers,
    activeProviderId: appState.get("active_provider_id"),
    modelOverride: modelOverride?.trim() ? modelOverride : undefined,
    modelOverrides,
    clientRoutes,
    clientRouteRtkPolicies,
    clientRouteApiKeys,
  };
}

function queryRows<T extends Record<string, unknown>>(db: Database, sql: string): T[] {
  return db.prepare(sql).all() as T[];
}

function mapClientTokenLimitRow(row: ClientTokenLimitRow): ClientTokenLimitConfig {
  return {
    clientRoute: normalizeClientRouteKey(row.client_route),
    enabled: row.enabled === 1,
    tokenLimit: Math.max(0, Number(row.token_limit ?? 0)),
    windowType: normalizeClientTokenWindowType(row.window_type),
    windowSizeSeconds:
      typeof row.window_size_seconds === "number" && row.window_size_seconds > 0
        ? row.window_size_seconds
        : undefined,
    hardBlock: row.hard_block !== 0,
    createdAt: row.created_at ?? new Date(0).toISOString(),
    updatedAt: row.updated_at ?? row.created_at ?? new Date(0).toISOString(),
  };
}

function mapClientTokenUsageRow(row: ClientTokenUsageRow): ClientTokenUsageSnapshot {
  return {
    clientRoute: normalizeClientRouteKey(row.client_route),
    windowStart: row.window_start,
    inputTokens: Math.max(0, Number(row.input_tokens ?? 0)),
    outputTokens: Math.max(0, Number(row.output_tokens ?? 0)),
    totalTokens: Math.max(0, Number(row.total_tokens ?? 0)),
    updatedAt: row.updated_at ?? new Date(0).toISOString(),
  };
}

function buildEmptyClientTokenUsageSnapshot(
  clientRoute: ClientRouteKey,
  windowStart: string,
): ClientTokenUsageSnapshot {
  return {
    clientRoute,
    windowStart,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    updatedAt: windowStart,
  };
}

function normalizeClientTokenWindowType(value: unknown): ClientTokenWindowType {
  switch (value) {
    case "weekly":
    case "monthly":
    case "fixed":
      return value;
    case "daily":
    default:
      return "daily";
  }
}

function normalizeNonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function ensureSharedApiKeyTable(db: Database, tableName: "provider_api_keys" | "client_api_keys"): void {
  const tableSql = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .get(tableName) as { sql?: string } | undefined;

  if (!tableSql?.sql?.includes("api_key TEXT NOT NULL UNIQUE")) {
    return;
  }

  const tempTableName = `${tableName}_legacy_unique`;
  db.exec(`
    ALTER TABLE ${tableName} RENAME TO ${tempTableName};

    CREATE TABLE ${tableName} (
      provider_id TEXT NOT NULL,
      api_key TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (provider_id, api_key),
      FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
    );

    INSERT OR IGNORE INTO ${tableName} (provider_id, api_key, position)
    SELECT provider_id, api_key, position
    FROM ${tempTableName};

    DROP TABLE ${tempTableName};
  `);
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
      clientRouteRtkPolicies: sanitizeClientRouteRtkPolicies(parsed.clientRouteRtkPolicies),
      clientRouteApiKeys: sanitizeClientRouteApiKeys(parsed.clientRouteApiKeys),
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
  const providerApiKeys = normalizeApiKeysInput(
    record.providerApiKeys,
    record.apiKeys,
    record.apiKey,
  );
  const createdAt =
    typeof record.createdAt === "string" && record.createdAt.trim()
      ? record.createdAt.trim()
      : undefined;
  const updatedAt =
    typeof record.updatedAt === "string" && record.updatedAt.trim()
      ? record.updatedAt.trim()
      : undefined;
  const capabilities = parseProviderCapabilitiesInput(record.capabilities);
  const authMode = parseRuntimeProviderAuthMode(record.authMode);
  const chatgptAccountId =
    typeof record.chatgptAccountId === "string" && record.chatgptAccountId.trim()
      ? record.chatgptAccountId.trim()
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
      authMode,
      chatgptAccountId,
      providerApiKeys,
      clientApiKeys: [],
      capabilities,
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

function sanitizeClientRouteRtkPolicies(value: unknown): ClientRtkPolicyMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  const next: ClientRtkPolicyMap = {};
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = normalizeClientRouteKey(rawKey);
    const policy = parseRtkLayerPolicyInput(rawValue);
    if (policy) {
      next[key] = policy;
    }
  }
  return next;
}

function sanitizeClientRouteApiKeys(value: unknown): ClientRouteApiKeyMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const record = value as Record<string, unknown>;
  const next: ClientRouteApiKeyMap = {};
  for (const [rawKey, rawValue] of Object.entries(record)) {
    const key = normalizeClientRouteKey(rawKey);
    const apiKeys = normalizeApiKeysInput(rawValue);
    if (apiKeys.length > 0) {
      next[key] = apiKeys;
    }
  }
  return next;
}

function normalizeApiKeysInput(...values: unknown[]): string[] {
  for (const value of values) {
    if (Array.isArray(value)) {
      return normalizeApiKeys(value);
    }

    if (typeof value === "string") {
      return normalizeApiKeys(value.split(/\r?\n|,/g));
    }
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

function parseRuntimeProviderAuthMode(value: unknown): RuntimeProviderAuthMode {
  return value === "chatgpt_oauth" ? "chatgpt_oauth" : "api_key";
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
  return normalized;
}

function migrateLegacyProvider(provider: RuntimeProviderPreset): RuntimeProviderPreset {
  const migrated = {
    ...provider,
    authMode: parseRuntimeProviderAuthMode(provider.authMode),
    chatgptAccountId: provider.chatgptAccountId?.trim() || undefined,
  };
  if (provider.id !== "primary" && provider.id !== "fallback") {
    return migrated;
  }
  const identity = inferProviderIdentity(provider.baseUrl, provider.name);
  return {
    ...migrated,
    id: identity.id,
    name: identity.name,
    capabilities: cloneCapabilities(provider.capabilities),
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
    const matchingIndex = merged.findIndex(
      (provider) =>
        provider.id === baseProvider.id ||
        provider.baseUrl === baseProvider.baseUrl ||
        normalizeProviderName(provider.name) === normalizeProviderName(baseProvider.name),
    );
    if (matchingIndex === -1) {
      merged.push(baseProvider);
      continue;
    }

    const existing = merged[matchingIndex];
    if (isUnmodifiedSeededProvider(existing)) {
      merged[matchingIndex] = {
        ...baseProvider,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      };
    }
  }
  return merged;
}

function isUnmodifiedSeededProvider(provider: RuntimeProviderPreset): boolean {
  return !provider.createdAt && !provider.updatedAt;
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
      original.authMode !== provider.authMode ||
      original.chatgptAccountId !== provider.chatgptAccountId ||
      JSON.stringify(original.providerApiKeys) !== JSON.stringify(provider.providerApiKeys) ||
      JSON.stringify(cloneCapabilities(original.capabilities)) !==
        JSON.stringify(cloneCapabilities(provider.capabilities))
    );
  });
}

function normalizeProviderName(value: string): string {
  return value.trim().toLowerCase();
}

function toResponsesUrl(baseUrl: string): string {
  return baseUrl.endsWith("/v1") ? `${baseUrl}/responses` : `${baseUrl}/v1/responses`;
}

function buildDefaultCapabilitiesFromConfig(config: AppConfig): RuntimeProviderCapabilities {
  const requestParameterPolicyInput =
    config.MAX_OUTPUT_TOKENS_PARAMETER_MODE_FOR_PROVIDER
      ? {
          maxOutputTokens: {
            mode: config.MAX_OUTPUT_TOKENS_PARAMETER_MODE_FOR_PROVIDER,
            ...(config.MAX_OUTPUT_TOKENS_PARAMETER_MODE_FOR_PROVIDER === "rename" &&
            config.MAX_OUTPUT_TOKENS_PARAMETER_TARGET_FOR_PROVIDER?.trim()
              ? {
                  target: config.MAX_OUTPUT_TOKENS_PARAMETER_TARGET_FOR_PROVIDER.trim(),
                }
              : {}),
          },
        }
      : {};
  const maxOutputTokensRule = resolveMaxOutputTokensRule({
    stripMaxOutputTokens: config.STRIP_MAX_OUTPUT_TOKENS_FOR_PROVIDER ?? false,
    requestParameterPolicy: requestParameterPolicyInput,
  });
  const requestParameterPolicy = cloneProviderRequestParameterPolicy({
    maxOutputTokens: maxOutputTokensRule,
  });
  return {
    usageCheckEnabled: Boolean(
      config.PROVIDER_USAGE_CHECK_ENABLED && config.PROVIDER_USAGE_CHECK_URL,
    ),
    usageCheckUrl: config.PROVIDER_USAGE_CHECK_URL,
    stripMaxOutputTokens: maxOutputTokensRule.mode === "strip",
    requestParameterPolicy,
    sanitizeReasoningSummary: config.SANITIZE_REASONING_SUMMARY_FOR_PROVIDER ?? false,
    stripModelPrefixes: [],
    rtkPolicy: cloneRtkLayerPolicy({
      enabled: config.RTK_LAYER_ENABLED,
      toolOutputEnabled: config.RTK_LAYER_TOOL_OUTPUT_ENABLED,
      maxChars: config.RTK_LAYER_TOOL_OUTPUT_MAX_CHARS,
      maxLines: config.RTK_LAYER_TOOL_OUTPUT_MAX_LINES,
      tailLines: config.RTK_LAYER_TOOL_OUTPUT_TAIL_LINES,
      tailChars: config.RTK_LAYER_TOOL_OUTPUT_TAIL_CHARS,
      detectFormat: config.RTK_LAYER_TOOL_OUTPUT_DETECT_FORMAT,
    }),
    errorPolicy: inferDefaultProviderErrorPolicy(config.UPSTREAM_BASE_URL),
  };
}

function parseProviderCapabilitiesInput(value: unknown): RuntimeProviderCapabilities {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      usageCheckEnabled: false,
      stripMaxOutputTokens: false,
      requestParameterPolicy: {},
      sanitizeReasoningSummary: false,
      stripModelPrefixes: [],
    };
  }

  const record = value as Record<string, unknown>;
  const ownedBy =
    typeof record.ownedBy === "string" && record.ownedBy.trim()
      ? record.ownedBy.trim()
      : undefined;
  const accountPlatform =
    typeof record.accountPlatform === "string" && record.accountPlatform.trim()
      ? record.accountPlatform.trim()
      : typeof record.account_platform === "string" && record.account_platform.trim()
        ? record.account_platform.trim()
        : undefined;
  const usageCheckUrl =
    typeof record.usageCheckUrl === "string" && record.usageCheckUrl.trim()
      ? normalizeOptionalUrl(record.usageCheckUrl)
      : undefined;
  const requestParameterPolicy = parseProviderRequestParameterPolicyInput(
    record.requestParameterPolicy ?? record.request_parameter_policy,
  );
  const maxOutputTokensRule = resolveMaxOutputTokensRule({
    stripMaxOutputTokens: coerceBoolean(record.stripMaxOutputTokens),
    requestParameterPolicy,
  });
  return {
    ownedBy,
    systemManaged: coerceBoolean(record.systemManaged ?? record.system_managed),
    accountPlatform,
    accountPoolRequired: coerceBoolean(record.accountPoolRequired ?? record.account_pool_required),
    usageCheckEnabled: coerceBoolean(record.usageCheckEnabled),
    usageCheckUrl,
    stripMaxOutputTokens: maxOutputTokensRule.mode === "strip",
    requestParameterPolicy,
    sanitizeReasoningSummary: coerceBoolean(record.sanitizeReasoningSummary),
    stripModelPrefixes: normalizeStringList(record.stripModelPrefixes),
    modelAliases: normalizeStringMap(record.modelAliases ?? record.model_aliases),
    rtkPolicy: parseRtkLayerPolicyInput(record.rtkPolicy ?? record.rtk_policy),
    errorPolicy: parseProviderErrorPolicyInput(record.errorPolicy ?? record.error_policy),
  };
}

function cloneCapabilities(
  capabilities?: RuntimeProviderCapabilities,
): RuntimeProviderCapabilities {
  const maxOutputTokensRule = resolveMaxOutputTokensRule(capabilities);
  return {
    ownedBy: capabilities?.ownedBy,
    systemManaged: capabilities?.systemManaged ?? false,
    accountPlatform: capabilities?.accountPlatform,
    accountPoolRequired: capabilities?.accountPoolRequired ?? false,
    usageCheckEnabled: capabilities?.usageCheckEnabled ?? false,
    usageCheckUrl: capabilities?.usageCheckUrl,
    stripMaxOutputTokens: maxOutputTokensRule.mode === "strip",
    requestParameterPolicy: cloneProviderRequestParameterPolicy({
      maxOutputTokens: maxOutputTokensRule,
    }),
    sanitizeReasoningSummary: capabilities?.sanitizeReasoningSummary ?? false,
    stripModelPrefixes: [...(capabilities?.stripModelPrefixes ?? [])],
    modelAliases: { ...(capabilities?.modelAliases ?? {}) },
    rtkPolicy: cloneRtkLayerPolicy(capabilities?.rtkPolicy),
    errorPolicy: cloneProviderErrorPolicy(capabilities?.errorPolicy),
  };
}

function normalizeOptionalUrl(value: string): string {
  try {
    return new URL(value.trim()).toString();
  } catch {
    throw new RuntimeProviderError(400, {
      type: "validation_error",
      code: "INVALID_PROVIDER_CAPABILITIES",
      message: "capabilities.usageCheckUrl must be a valid URL",
    });
  }
}

function coerceBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function normalizeStringList(value: unknown): string[] {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return normalizeStringList(parsed);
      }
    } catch {
      return normalizeApiKeys(value.split(/\r?\n|,/g));
    }
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean),
    ),
  ];
}

function normalizeStringMap(value: unknown): Record<string, string> | undefined {
  const parsed =
    typeof value === "string"
      ? safeJsonParse(value)
      : value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }

  const entries = Object.entries(parsed)
    .map(([key, rawValue]) => [
      typeof key === "string" ? key.trim() : "",
      typeof rawValue === "string" ? rawValue.trim() : "",
    ] as const)
    .filter(([key, mapped]) => key && mapped);

  if (!entries.length) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function normalizeStoredRequestParameterPolicy(
  raw: string | null,
  stripMaxOutputTokens: boolean,
): ProviderRequestParameterPolicy {
  const parsed = raw?.trim() ? safeJsonParse(raw) : undefined;
  const parsedPolicy = parseProviderRequestParameterPolicyInput(parsed);
  return cloneProviderRequestParameterPolicy(
    parsedPolicy.maxOutputTokens
      ? parsedPolicy
      : parseProviderRequestParameterPolicyInput({
      maxOutputTokens: stripMaxOutputTokens ? "strip" : "forward",
        }),
  );
}

function cloneProviderErrorPolicy(policy?: ProviderErrorPolicy): ProviderErrorPolicy | undefined {
  if (!policy || !Array.isArray(policy.rules) || policy.rules.length === 0) {
    return undefined;
  }
  return {
    rules: policy.rules.map((rule) => ({
      statusCodes:
        Array.isArray(rule.statusCodes) && rule.statusCodes.length > 0
          ? rule.statusCodes.filter((value) => Number.isInteger(value))
          : undefined,
      upstreamCodes: normalizeStringList(rule.upstreamCodes),
      upstreamTypes: normalizeStringList(rule.upstreamTypes),
      messageIncludes: normalizeStringList(rule.messageIncludes),
      bodyIncludes: normalizeStringList(rule.bodyIncludes),
      code: typeof rule.code === "string" && rule.code.trim() ? rule.code.trim() : undefined,
      message:
        typeof rule.message === "string" && rule.message.trim() ? rule.message.trim() : undefined,
      retryable: typeof rule.retryable === "boolean" ? rule.retryable : undefined,
    })),
  };
}

function parseProviderErrorPolicyInput(value: unknown): ProviderErrorPolicy | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const rulesInput = Array.isArray(record.rules) ? record.rules : [];
  const rules = rulesInput
    .map((item) => parseProviderErrorPolicyRuleInput(item))
    .filter((item): item is ProviderErrorPolicyRule => Boolean(item));
  if (rules.length === 0) {
    return undefined;
  }
  return { rules };
}

function parseProviderErrorPolicyRuleInput(value: unknown): ProviderErrorPolicyRule | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const statusCodes = normalizeIntegerList(record.statusCodes ?? record.status_codes);
  const upstreamCodes = normalizeStringList(record.upstreamCodes ?? record.upstream_codes);
  const upstreamTypes = normalizeStringList(record.upstreamTypes ?? record.upstream_types);
  const messageIncludes = normalizeStringList(record.messageIncludes ?? record.message_includes);
  const bodyIncludes = normalizeStringList(record.bodyIncludes ?? record.body_includes);
  const code = typeof record.code === "string" && record.code.trim() ? record.code.trim() : undefined;
  const message =
    typeof record.message === "string" && record.message.trim() ? record.message.trim() : undefined;
  const retryable = typeof record.retryable === "boolean" ? record.retryable : undefined;

  if (
    statusCodes.length === 0 &&
    upstreamCodes.length === 0 &&
    upstreamTypes.length === 0 &&
    messageIncludes.length === 0 &&
    bodyIncludes.length === 0
  ) {
    return undefined;
  }

  return {
    statusCodes: statusCodes.length > 0 ? statusCodes : undefined,
    upstreamCodes: upstreamCodes.length > 0 ? upstreamCodes : undefined,
    upstreamTypes: upstreamTypes.length > 0 ? upstreamTypes : undefined,
    messageIncludes: messageIncludes.length > 0 ? messageIncludes : undefined,
    bodyIncludes: bodyIncludes.length > 0 ? bodyIncludes : undefined,
    code,
    message,
    retryable,
  };
}

function normalizeIntegerList(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((item) => Number.isInteger(item)).map((item) => Number(item)))];
}

function inferDefaultProviderErrorPolicy(baseUrl: string): ProviderErrorPolicy | undefined {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    if (hostname === "krouter.net" || hostname === "api.krouter.net") {
      return {
        rules: [
          {
            statusCodes: [413],
            code: "UPSTREAM_REQUEST_TOO_LARGE",
            message:
              "Upstream rejected the request because the serialized prompt body is too large",
            retryable: false,
          },
          {
            bodyIncludes: ["request body is too large"],
            code: "UPSTREAM_REQUEST_TOO_LARGE",
            message:
              "Upstream rejected the request because the serialized prompt body is too large",
            retryable: false,
          },
          {
            statusCodes: [429],
            code: "UPSTREAM_RATE_LIMITED",
            message: "Upstream rate limit reached",
            retryable: true,
          },
        ],
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function ensureProvidersColumn(db: Database, columnName: string, sqlDefinition: string): void {
  const columns = db.prepare("PRAGMA table_info(providers)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE providers ADD COLUMN ${columnName} ${sqlDefinition}`);
  }
}

function backfillLegacyRequestParameterPolicies(db: Database): void {
  db.exec(`
    UPDATE providers
    SET request_parameter_policy = CASE
      WHEN strip_max_output_tokens = 1
        THEN '{"maxOutputTokens":{"mode":"strip"}}'
      ELSE '{"maxOutputTokens":{"mode":"forward"}}'
    END
    WHERE request_parameter_policy IS NULL
      OR TRIM(request_parameter_policy) = ''
      OR TRIM(request_parameter_policy) = '{}'
  `);
}
