import { randomUUID } from "node:crypto";
import type BetterSqlite3 from "better-sqlite3";

type Database = InstanceType<typeof BetterSqlite3>;

// Types matching the frontend routing types
export type RoutingCombo = {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  isDefault: boolean;
  tiers: RoutingTier[];
  policies: RoutingPolicies;
  clientRoutes: string[];
  createdAt: string;
  updatedAt: string;
};

export type RoutingTier = {
  id: string;
  name: string;
  priority: number;
  tier: 'subscription' | 'cheap' | 'free' | 'custom';
  isEnabled: boolean;
  fallbackDelay: number;
  maxRetries: number;
  healthThreshold?: ('healthy' | 'degraded' | 'rate_limited')[];
  providers: ProviderBinding[];
};

export type ProviderBinding = {
  id: string;
  providerId: string;
  weight: number;
  isEnabled: boolean;
  modelOverride?: string;
};

export type RoutingPolicies = {
  loadBalancing: 'round_robin' | 'weighted' | 'health_based' | 'cost_optimized' | 'least_connections' | 'random';
  failoverStrategy: 'immediate' | 'delayed' | 'circuit_breaker' | 'health_check' | 'manual';
  tokenBudgetMode: 'per_route' | 'per_provider' | 'shared' | 'unlimited';
  quotaManagement?: QuotaPolicy;
  costOptimization?: CostOptimizationPolicy;
  retryPolicy?: RetryPolicy;
};

export type QuotaPolicy = {
  enabled: boolean;
  softLimit: number;
  hardLimit: number;
  resetStrategy: 'daily' | 'weekly' | 'monthly' | 'rolling';
  alertThreshold: number;
  fallbackOnExhaustion: boolean;
};

export type CostOptimizationPolicy = {
  enabled: boolean;
  preferCheapProviders: boolean;
  maxCostPerRequest?: number;
  costThreshold: number;
  budgetLimit: number;
  budgetPeriod: 'daily' | 'weekly' | 'monthly';
};

export type RetryPolicy = {
  enabled: boolean;
  maxRetries: number;
  backoffStrategy: 'linear' | 'exponential' | 'fixed';
  baseDelay: number;
  maxDelay: number;
  retryableErrors: string[];
};

export type RoutingComboInput = Omit<RoutingCombo, 'id' | 'createdAt' | 'updatedAt'>;

// Database row types
type RoutingComboRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: number;
  is_default: number;
  created_at: string;
  updated_at: string;
};

type RoutingTierRow = {
  id: string;
  combo_id: string;
  name: string;
  priority: number;
  tier: string;
  is_enabled: number;
  fallback_delay: number;
  max_retries: number;
  health_threshold: string | null;
};

type RoutingTierProviderRow = {
  id: string;
  tier_id: string;
  provider_id: string;
  weight: number;
  is_enabled: number;
  model_override: string | null;
};

type RoutingComboPolicyRow = {
  combo_id: string;
  load_balancing: string;
  failover_strategy: string;
  token_budget_mode: string;
  quota_management: string | null;
  cost_optimization: string | null;
  retry_policy: string | null;
};

type RoutingComboClientRouteRow = {
  combo_id: string;
  client_route: string;
};

export class RoutingComboRepository {
  constructor(private readonly db: Database) {}

  // Get all routing combos with summary stats
  async getAllCombos(): Promise<RoutingCombo[]> {
    const comboRows = this.db.prepare(`
      SELECT id, name, description, is_active, is_default, created_at, updated_at
      FROM routing_combos
      ORDER BY created_at DESC
    `).all() as RoutingComboRow[];

    const combos: RoutingCombo[] = [];
    for (const row of comboRows) {
      const combo = await this.getComboById(row.id);
      if (combo) {
        combos.push(combo);
      }
    }

    return combos;
  }

  // Get specific combo by ID with full configuration
  async getComboById(id: string): Promise<RoutingCombo | null> {
    const comboRow = this.db.prepare(`
      SELECT id, name, description, is_active, is_default, created_at, updated_at
      FROM routing_combos
      WHERE id = ?
    `).get(id) as RoutingComboRow | undefined;

    if (!comboRow) {
      return null;
    }

    // Get tiers
    const tierRows = this.db.prepare(`
      SELECT id, combo_id, name, priority, tier, is_enabled, fallback_delay, max_retries, health_threshold
      FROM routing_tiers
      WHERE combo_id = ?
      ORDER BY priority ASC
    `).all(id) as RoutingTierRow[];

    const tiers: RoutingTier[] = [];
    for (const tierRow of tierRows) {
      // Get providers for this tier
      const providerRows = this.db.prepare(`
        SELECT id, tier_id, provider_id, weight, is_enabled, model_override
        FROM routing_tier_providers
        WHERE tier_id = ?
        ORDER BY weight DESC
      `).all(tierRow.id) as RoutingTierProviderRow[];

      const providers: ProviderBinding[] = providerRows.map(row => ({
        id: row.id,
        providerId: row.provider_id,
        weight: row.weight,
        isEnabled: Boolean(row.is_enabled),
        modelOverride: row.model_override || undefined
      }));

      tiers.push({
        id: tierRow.id,
        name: tierRow.name,
        priority: tierRow.priority,
        tier: tierRow.tier as RoutingTier['tier'],
        isEnabled: Boolean(tierRow.is_enabled),
        fallbackDelay: tierRow.fallback_delay,
        maxRetries: tierRow.max_retries,
        healthThreshold: tierRow.health_threshold ? JSON.parse(tierRow.health_threshold) : undefined,
        providers
      });
    }

    // Get policies
    const policyRow = this.db.prepare(`
      SELECT combo_id, load_balancing, failover_strategy, token_budget_mode, quota_management, cost_optimization, retry_policy
      FROM routing_combo_policies
      WHERE combo_id = ?
    `).get(id) as RoutingComboPolicyRow | undefined;

    const policies: RoutingPolicies = {
      loadBalancing: (policyRow?.load_balancing as RoutingPolicies['loadBalancing']) || 'weighted',
      failoverStrategy: (policyRow?.failover_strategy as RoutingPolicies['failoverStrategy']) || 'immediate',
      tokenBudgetMode: (policyRow?.token_budget_mode as RoutingPolicies['tokenBudgetMode']) || 'per_route',
      quotaManagement: policyRow?.quota_management ? JSON.parse(policyRow.quota_management) : undefined,
      costOptimization: policyRow?.cost_optimization ? JSON.parse(policyRow.cost_optimization) : undefined,
      retryPolicy: policyRow?.retry_policy ? JSON.parse(policyRow.retry_policy) : undefined
    };

    // Get client routes
    const clientRouteRows = this.db.prepare(`
      SELECT client_route
      FROM routing_combo_client_routes
      WHERE combo_id = ?
    `).all(id) as RoutingComboClientRouteRow[];

    const clientRoutes = clientRouteRows.map(row => row.client_route);

    return {
      id: comboRow.id,
      name: comboRow.name,
      description: comboRow.description || undefined,
      isActive: Boolean(comboRow.is_active),
      isDefault: Boolean(comboRow.is_default),
      tiers,
      policies,
      clientRoutes,
      createdAt: comboRow.created_at,
      updatedAt: comboRow.updated_at
    };
  }

  // Create new routing combo
  async createCombo(input: RoutingComboInput): Promise<RoutingCombo> {
    const id = randomUUID();
    const now = new Date().toISOString();

    const transaction = this.db.transaction(() => {
      // Insert combo
      this.db.prepare(`
        INSERT INTO routing_combos (id, name, description, is_active, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.name, input.description || null, input.isActive ? 1 : 0, input.isDefault ? 1 : 0, now, now);

      // Insert tiers
      for (const tier of input.tiers) {
        const tierId = randomUUID();
        this.db.prepare(`
          INSERT INTO routing_tiers (id, combo_id, name, priority, tier, is_enabled, fallback_delay, max_retries, health_threshold)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          tierId,
          id,
          tier.name,
          tier.priority,
          tier.tier,
          tier.isEnabled ? 1 : 0,
          tier.fallbackDelay,
          tier.maxRetries,
          tier.healthThreshold ? JSON.stringify(tier.healthThreshold) : null
        );

        // Insert tier providers
        for (const provider of tier.providers) {
          const providerId = randomUUID();
          this.db.prepare(`
            INSERT INTO routing_tier_providers (id, tier_id, provider_id, weight, is_enabled, model_override)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            providerId,
            tierId,
            provider.providerId,
            provider.weight,
            provider.isEnabled ? 1 : 0,
            provider.modelOverride || null
          );
        }
      }

      // Insert policies
      this.db.prepare(`
        INSERT INTO routing_combo_policies (combo_id, load_balancing, failover_strategy, token_budget_mode, quota_management, cost_optimization, retry_policy)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.policies.loadBalancing,
        input.policies.failoverStrategy,
        input.policies.tokenBudgetMode,
        input.policies.quotaManagement ? JSON.stringify(input.policies.quotaManagement) : null,
        input.policies.costOptimization ? JSON.stringify(input.policies.costOptimization) : null,
        input.policies.retryPolicy ? JSON.stringify(input.policies.retryPolicy) : null
      );

      // Insert client routes
      for (const clientRoute of input.clientRoutes) {
        this.db.prepare(`
          INSERT INTO routing_combo_client_routes (combo_id, client_route)
          VALUES (?, ?)
        `).run(id, clientRoute);
      }
    });

    transaction();

    const combo = await this.getComboById(id);
    if (!combo) {
      throw new Error('Failed to create routing combo');
    }

    return combo;
  }

  // Update existing routing combo
  async updateCombo(id: string, input: RoutingComboInput): Promise<RoutingCombo> {
    const now = new Date().toISOString();

    const transaction = this.db.transaction(() => {
      // Update combo
      this.db.prepare(`
        UPDATE routing_combos
        SET name = ?, description = ?, is_active = ?, is_default = ?, updated_at = ?
        WHERE id = ?
      `).run(input.name, input.description || null, input.isActive ? 1 : 0, input.isDefault ? 1 : 0, now, id);

      // Delete existing tiers and their providers (cascade will handle providers)
      this.db.prepare(`DELETE FROM routing_tiers WHERE combo_id = ?`).run(id);

      // Delete existing policies
      this.db.prepare(`DELETE FROM routing_combo_policies WHERE combo_id = ?`).run(id);

      // Delete existing client routes
      this.db.prepare(`DELETE FROM routing_combo_client_routes WHERE combo_id = ?`).run(id);

      // Insert new tiers
      for (const tier of input.tiers) {
        const tierId = randomUUID();
        this.db.prepare(`
          INSERT INTO routing_tiers (id, combo_id, name, priority, tier, is_enabled, fallback_delay, max_retries, health_threshold)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          tierId,
          id,
          tier.name,
          tier.priority,
          tier.tier,
          tier.isEnabled ? 1 : 0,
          tier.fallbackDelay,
          tier.maxRetries,
          tier.healthThreshold ? JSON.stringify(tier.healthThreshold) : null
        );

        // Insert tier providers
        for (const provider of tier.providers) {
          const providerId = randomUUID();
          this.db.prepare(`
            INSERT INTO routing_tier_providers (id, tier_id, provider_id, weight, is_enabled, model_override)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            providerId,
            tierId,
            provider.providerId,
            provider.weight,
            provider.isEnabled ? 1 : 0,
            provider.modelOverride || null
          );
        }
      }

      // Insert new policies
      this.db.prepare(`
        INSERT INTO routing_combo_policies (combo_id, load_balancing, failover_strategy, token_budget_mode, quota_management, cost_optimization, retry_policy)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.policies.loadBalancing,
        input.policies.failoverStrategy,
        input.policies.tokenBudgetMode,
        input.policies.quotaManagement ? JSON.stringify(input.policies.quotaManagement) : null,
        input.policies.costOptimization ? JSON.stringify(input.policies.costOptimization) : null,
        input.policies.retryPolicy ? JSON.stringify(input.policies.retryPolicy) : null
      );

      // Insert new client routes
      for (const clientRoute of input.clientRoutes) {
        this.db.prepare(`
          INSERT INTO routing_combo_client_routes (combo_id, client_route)
          VALUES (?, ?)
        `).run(id, clientRoute);
      }
    });

    transaction();

    const combo = await this.getComboById(id);
    if (!combo) {
      throw new Error('Failed to update routing combo');
    }

    return combo;
  }

  // Delete routing combo
  async deleteCombo(id: string): Promise<void> {
    const combo = await this.getComboById(id);
    if (!combo) {
      throw new Error('Routing combo not found');
    }

    // Safety check: prevent deleting active combos
    if (combo.isActive) {
      throw new Error('Cannot delete active routing combo. Deactivate it first.');
    }

    // Safety check: prevent deleting default combo
    if (combo.isDefault) {
      throw new Error('Cannot delete default routing combo. Set another combo as default first.');
    }

    this.db.prepare(`DELETE FROM routing_combos WHERE id = ?`).run(id);
  }

  // Get combo statistics
  async getComboStats(): Promise<{
    total: number;
    active: number;
    totalClientRoutes: number;
    averageTiersPerCombo: number;
  }> {
    const totalResult = this.db.prepare(`SELECT COUNT(*) as count FROM routing_combos`).get() as { count: number };
    const activeResult = this.db.prepare(`SELECT COUNT(*) as count FROM routing_combos WHERE is_active = 1`).get() as { count: number };
    const clientRoutesResult = this.db.prepare(`SELECT COUNT(*) as count FROM routing_combo_client_routes`).get() as { count: number };
    const tiersResult = this.db.prepare(`SELECT COUNT(*) as count FROM routing_tiers`).get() as { count: number };

    return {
      total: totalResult.count,
      active: activeResult.count,
      totalClientRoutes: clientRoutesResult.count,
      averageTiersPerCombo: totalResult.count > 0 ? tiersResult.count / totalResult.count : 0
    };
  }

  // Set default combo
  async setDefaultCombo(id: string): Promise<void> {
    const transaction = this.db.transaction(() => {
      // Clear existing default
      this.db.prepare(`UPDATE routing_combos SET is_default = 0`).run();

      // Set new default
      this.db.prepare(`UPDATE routing_combos SET is_default = 1 WHERE id = ?`).run(id);
    });

    transaction();
  }

  // Get default combo
  async getDefaultCombo(): Promise<RoutingCombo | null> {
    // Only an ACTIVE default combo should be used for routing. Filtering here
    // (not just at the call site) keeps the getter honest for all callers.
    const row = this.db.prepare(`
      SELECT id FROM routing_combos WHERE is_default = 1 AND is_active = 1 LIMIT 1
    `).get() as { id: string } | undefined;

    if (!row) {
      return null;
    }

    return this.getComboById(row.id);
  }

  // Client route assignment methods

  // Get routing combo assigned to a client route
  async getClientRouteCombo(clientRoute: string): Promise<string | null> {
    const row = this.db.prepare(`
      SELECT combo_id FROM routing_combo_client_routes WHERE client_route = ?
    `).get(clientRoute) as { combo_id: string } | undefined;

    return row?.combo_id || null;
  }

  // Assign routing combo to client route
  async assignClientRouteCombo(clientRoute: string, comboId: string): Promise<void> {
    // Verify combo exists
    const combo = await this.getComboById(comboId);
    if (!combo) {
      throw new Error(`Routing combo ${comboId} not found`);
    }

    // A client route maps to at most one combo. The table PK is
    // (combo_id, client_route), so INSERT OR REPLACE would only replace the exact
    // pair and leave any prior route→otherCombo row in place — making
    // getClientRouteCombo nondeterministic. Clear existing rows for this route
    // first, then insert, inside a transaction.
    const replace = this.db.transaction((route: string, combo: string) => {
      this.db.prepare(`DELETE FROM routing_combo_client_routes WHERE client_route = ?`).run(route);
      this.db.prepare(
        `INSERT INTO routing_combo_client_routes (combo_id, client_route) VALUES (?, ?)`,
      ).run(combo, route);
    });
    replace(clientRoute, comboId);
  }

  // Remove routing combo assignment from client route
  async unassignClientRouteCombo(clientRoute: string): Promise<void> {
    this.db.prepare(`
      DELETE FROM routing_combo_client_routes WHERE client_route = ?
    `).run(clientRoute);
  }

  // Get all client routes assigned to a combo
  async getComboClientRoutes(comboId: string): Promise<string[]> {
    const rows = this.db.prepare(`
      SELECT client_route FROM routing_combo_client_routes WHERE combo_id = ?
    `).all(comboId) as { client_route: string }[];

    return rows.map(row => row.client_route);
  }

  // Get all client route assignments
  async getAllClientRouteAssignments(): Promise<{ clientRoute: string; comboId: string; comboName: string }[]> {
    const rows = this.db.prepare(`
      SELECT
        rcr.client_route,
        rcr.combo_id,
        rc.name as combo_name
      FROM routing_combo_client_routes rcr
      JOIN routing_combos rc ON rcr.combo_id = rc.id
      ORDER BY rcr.client_route
    `).all() as { client_route: string; combo_id: string; combo_name: string }[];

    return rows.map(row => ({
      clientRoute: row.client_route,
      comboId: row.combo_id,
      comboName: row.combo_name
    }));
  }
}