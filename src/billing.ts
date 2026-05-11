import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import BetterSqlite3 from "better-sqlite3";

type Database = InstanceType<typeof BetterSqlite3>;

export type PlanRecord = {
  id: string;
  name: string;
  status: "active" | "archived";
  priceCents: number;
  currency: string;
  billingInterval: "month" | "year" | "one_time";
  monthlyTokenLimit: number;
  maxApiKeys: number;
  allowedModels: string[];
  metadataJson: string;
  createdAt: string;
  updatedAt: string;
};

export type CreatePlanInput = {
  id: string;
  name: string;
  priceCents?: number;
  currency?: string;
  billingInterval?: "month" | "year" | "one_time";
  monthlyTokenLimit: number;
  maxApiKeys: number;
  allowedModels?: string[];
  metadataJson?: string;
  status?: "active" | "archived";
  now?: Date;
};

export type SubscriptionRecord = {
  id: string;
  workspaceId: string;
  planId: string;
  status: "trialing" | "active" | "past_due" | "canceled" | "expired";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  provider?: string;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  createdAt: string;
  updatedAt: string;
};

export type EntitlementRecord = {
  id: string;
  workspaceId: string;
  subscriptionId?: string;
  monthlyTokenLimit: number;
  remainingTokens?: number;
  allowedModels: string[];
  maxApiKeys: number;
  validFrom: string;
  validUntil: string;
  status: "active" | "expired" | "suspended";
  createdAt: string;
  updatedAt: string;
};

export type EntitlementUsageRecord = {
  entitlementId: string;
  workspaceId: string;
  customerApiKeyId?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  createdAt: string;
  updatedAt: string;
};

export type EntitlementLotUsage = {
  entitlement: EntitlementRecord;
  usage: EntitlementUsageRecord;
  remainingTokens: number;
};

export type RenewalRequestKind = "renewal" | "token_topup";
export type RenewalRequestStatus = "open" | "payment_confirmed" | "approved" | "closed";

export type RenewalRequestRecord = {
  id: string;
  workspaceId: string;
  telegramUserId: string;
  kind: RenewalRequestKind;
  requestedPlanId?: string;
  requestedDays?: number;
  requestedTokenDelta?: number;
  requestedTokenLotDays?: number;
  priceVnd?: number;
  status: RenewalRequestStatus;
  resolution?: string;
  approvedPlanId?: string;
  approvedDays?: number;
  approvedTokenDelta?: number;
  approvedTokenLotDays?: number;
  requestedAt: string;
  closedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type PlanRow = {
  id: string;
  name: string;
  status: string;
  price_cents: number;
  currency: string;
  billing_interval: string;
  monthly_token_limit: number;
  max_api_keys: number;
  allowed_models_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type SubscriptionRow = {
  id: string;
  workspace_id: string;
  plan_id: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: number;
  provider: string | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  created_at: string;
  updated_at: string;
};

type EntitlementRow = {
  id: string;
  workspace_id: string;
  subscription_id: string | null;
  monthly_token_limit: number;
  remaining_tokens: number | null;
  allowed_models_json: string;
  max_api_keys: number;
  valid_from: string;
  valid_until: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type EntitlementUsageRow = {
  entitlement_id: string;
  workspace_id: string;
  customer_api_key_id: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  created_at: string;
  updated_at: string;
};

type RenewalRequestRow = {
  id: string;
  workspace_id: string;
  telegram_user_id: string;
  request_kind: string | null;
  requested_plan_id: string | null;
  requested_days: number | null;
  requested_token_delta: number | null;
  requested_token_lot_days: number | null;
  price_vnd: number | null;
  status: string;
  resolution: string | null;
  approved_plan_id: string | null;
  approved_days: number | null;
  approved_token_delta: number | null;
  approved_token_lot_days: number | null;
  requested_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

export class BillingRepository {
  private constructor(private readonly db: Database) {}

  static create(dbFile: string): BillingRepository {
    mkdirSync(path.dirname(dbFile), { recursive: true });
    const db = new BetterSqlite3(dbFile);
    ensureBillingSchema(db);
    const repository = new BillingRepository(db);
    repository.seedDefaultPlans();
    return repository;
  }

  seedDefaultPlans(now: Date = new Date()): void {
    const timestamp = now.toISOString();
    const insertPlan = this.db.prepare(
      `INSERT INTO plans (
        id,
        name,
        status,
        price_cents,
        currency,
        billing_interval,
        monthly_token_limit,
        max_api_keys,
        allowed_models_json,
        metadata_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, 'active', ?, 'VND', 'month', ?, ?, '[]', '{}', ?, ?)
      ON CONFLICT(id) DO NOTHING`,
    );

    insertPlan.run("basic", "Basic", 5_000, 10_000_000, 1, timestamp, timestamp);
  }

  listPlans(): PlanRecord[] {
    const rows = this.db.prepare("SELECT * FROM plans ORDER BY id").all() as PlanRow[];
    return rows.map(mapPlanRow);
  }

  getPlan(planId: string): PlanRecord | undefined {
    const row = this.db.prepare("SELECT * FROM plans WHERE id = ?").get(planId) as PlanRow | undefined;
    return row ? mapPlanRow(row) : undefined;
  }

  createPlan(input: CreatePlanInput): PlanRecord {
    const now = input.now ?? new Date();
    const timestamp = now.toISOString();
    const status = input.status ?? "active";
    const currency = (input.currency ?? "USD").toUpperCase();
    const billingInterval = input.billingInterval ?? "month";

    this.db
      .prepare(
        `INSERT INTO plans (
          id,
          name,
          status,
          price_cents,
          currency,
          billing_interval,
          monthly_token_limit,
          max_api_keys,
          allowed_models_json,
          metadata_json,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        status,
        input.priceCents ?? 0,
        currency,
        billingInterval,
        input.monthlyTokenLimit,
        input.maxApiKeys,
        JSON.stringify(input.allowedModels ?? []),
        input.metadataJson ?? "{}",
        timestamp,
        timestamp,
      );

    const plan = this.getPlan(input.id);
    if (!plan) {
      throw new Error(`Plan not found after create: ${input.id}`);
    }
    return plan;
  }

  grantSubscription(input: {
    workspaceId: string;
    planId: string;
    days: number;
    now?: Date;
  }): { subscription: SubscriptionRecord; entitlement: EntitlementRecord } {
    const plan = this.getPlan(input.planId);
    if (!plan) {
      throw new Error(`Plan not found: ${input.planId}`);
    }

    const now = input.now ?? new Date();
    const nowIso = now.toISOString();
    const currentSubscription = this.getLatestSubscriptionForWorkspace(input.workspaceId);
    const periodStart =
      currentSubscription &&
      (currentSubscription.status === "active" || currentSubscription.status === "trialing") &&
      new Date(currentSubscription.currentPeriodEnd).getTime() > now.getTime()
        ? new Date(currentSubscription.currentPeriodEnd)
        : now;
    const periodStartIso = periodStart.toISOString();
    const periodEnd = new Date(periodStart.getTime() + input.days * 24 * 60 * 60 * 1000);

    const subscriptionId = currentSubscription?.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO subscriptions (
          id,
          workspace_id,
          plan_id,
          status,
          current_period_start,
          current_period_end,
          cancel_at_period_end,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          plan_id = excluded.plan_id,
          status = excluded.status,
          current_period_start = excluded.current_period_start,
          current_period_end = excluded.current_period_end,
          updated_at = excluded.updated_at`,
      )
      .run(
        subscriptionId,
        input.workspaceId,
        plan.id,
        plan.id === "trial" ? "trialing" : "active",
        periodStartIso,
        periodEnd.toISOString(),
        currentSubscription?.createdAt ?? nowIso,
        nowIso,
      );

    const entitlementId = randomUUID();
    this.db
      .prepare(
        `INSERT INTO entitlements (
          id,
          workspace_id,
          subscription_id,
          monthly_token_limit,
          remaining_tokens,
          allowed_models_json,
          max_api_keys,
          valid_from,
          valid_until,
          status,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(
        entitlementId,
        input.workspaceId,
        subscriptionId,
        plan.monthlyTokenLimit,
        plan.monthlyTokenLimit,
        JSON.stringify(plan.allowedModels),
        plan.maxApiKeys,
        periodStartIso,
        periodEnd.toISOString(),
        nowIso,
        nowIso,
      );

    return {
      subscription: this.getLatestSubscriptionForWorkspace(input.workspaceId) as SubscriptionRecord,
      entitlement: this.getLatestEntitlementForWorkspace(input.workspaceId) as EntitlementRecord,
    };
  }

  getLatestSubscriptionForWorkspace(workspaceId: string): SubscriptionRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM subscriptions
         WHERE workspace_id = ?
         ORDER BY current_period_end DESC, updated_at DESC
         LIMIT 1`,
      )
      .get(workspaceId) as SubscriptionRow | undefined;
    return row ? mapSubscriptionRow(row) : undefined;
  }

  getActiveEntitlementForWorkspace(
    workspaceId: string,
    now: Date = new Date(),
  ): EntitlementRecord | undefined {
    const nowIso = now.toISOString();
    const row = this.db
      .prepare(
        `SELECT * FROM entitlements
         WHERE workspace_id = ?
           AND status = 'active'
           AND valid_from <= ?
           AND valid_until >= ?
         ORDER BY valid_until DESC, updated_at DESC
         LIMIT 1`,
      )
      .get(workspaceId, nowIso, nowIso) as EntitlementRow | undefined;
    return row ? mapEntitlementRow(row) : undefined;
  }

  getActiveEntitlementLotsForWorkspace(
    workspaceId: string,
    now: Date = new Date(),
  ): EntitlementLotUsage[] {
    const nowIso = now.toISOString();
    const rows = this.db
      .prepare(
        `SELECT * FROM entitlements
         WHERE workspace_id = ?
           AND status = 'active'
           AND valid_from <= ?
           AND valid_until >= ?
         ORDER BY valid_until ASC, created_at ASC`,
      )
      .all(workspaceId, nowIso, nowIso) as EntitlementRow[];
    return rows.map((row) => {
      const entitlement = mapEntitlementRow(row);
      const usage = this.getEntitlementUsage(entitlement.id) ?? buildEmptyUsage(entitlement.id, entitlement.workspaceId);
      return {
        entitlement,
        usage,
        remainingTokens: Math.max(0, entitlement.monthlyTokenLimit - usage.totalTokens),
      };
    });
  }

  getUsableActiveEntitlementForWorkspace(
    workspaceId: string,
    now: Date = new Date(),
  ): EntitlementRecord | undefined {
    return this.getActiveEntitlementLotsForWorkspace(workspaceId, now)
      .find((lot) => lot.remainingTokens > 0)
      ?.entitlement;
  }

  consumeWorkspaceUsage(input: {
    workspaceId: string;
    customerApiKeyId?: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    now?: Date;
  }): EntitlementUsageRecord[] {
    const totalTokens = Math.max(0, Math.trunc(input.totalTokens));
    if (totalTokens <= 0) {
      return [];
    }

    const now = input.now ?? new Date();
    let remaining = totalTokens;
    let remainingInput = Math.max(0, Math.trunc(input.inputTokens));
    let remainingOutput = Math.max(0, Math.trunc(input.outputTokens));
    const updates: EntitlementUsageRecord[] = [];
    const lots = this.getActiveEntitlementLotsForWorkspace(input.workspaceId, now)
      .filter((lot) => lot.remainingTokens > 0)
      .sort((left, right) => new Date(left.entitlement.validUntil).getTime() - new Date(right.entitlement.validUntil).getTime());

    const available = lots.reduce((sum, lot) => sum + lot.remainingTokens, 0);
    if (available < totalTokens) {
      throw new Error(`Token lot quota exceeded for workspace ${input.workspaceId}.`);
    }

    for (let index = 0; index < lots.length; index += 1) {
      const lot = lots[index];
      if (remaining <= 0) {
        break;
      }
      const consumed = Math.min(remaining, lot.remainingTokens);
      const isLast = index === lots.length - 1 || remaining === consumed;
      const inputTokens = isLast ? remainingInput : Math.min(remainingInput, Math.round((remainingInput * consumed) / remaining));
      const outputTokens = isLast ? remainingOutput : Math.min(remainingOutput, Math.round((remainingOutput * consumed) / remaining));
      remainingInput -= inputTokens;
      remainingOutput -= outputTokens;
      updates.push(
        this.incrementEntitlementUsage({
          entitlementId: lot.entitlement.id,
          workspaceId: input.workspaceId,
          customerApiKeyId: input.customerApiKeyId,
          inputTokens,
          outputTokens,
          totalTokens: consumed,
          now,
        }),
      );
      remaining -= consumed;
    }

    return updates;
  }

  getLatestEntitlementForWorkspace(workspaceId: string): EntitlementRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM entitlements
         WHERE workspace_id = ?
         ORDER BY valid_until DESC, updated_at DESC
         LIMIT 1`,
      )
      .get(workspaceId) as EntitlementRow | undefined;
    return row ? mapEntitlementRow(row) : undefined;
  }

  createTokenTopUpLot(input: {
    workspaceId: string;
    tokenDelta: number;
    days: number;
    allowedModels?: string[];
    maxApiKeys?: number;
    sourceRequestId?: string;
    now?: Date;
  }): EntitlementRecord {
    const tokenDelta = Math.max(0, Math.trunc(input.tokenDelta));
    const days = Math.max(1, Math.trunc(input.days));
    if (tokenDelta <= 0) {
      throw new Error("Token top-up amount must be positive.");
    }

    const now = input.now ?? new Date();
    const validFrom = now.toISOString();
    const validUntil = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
    const id = randomUUID();
    const latest = this.getLatestEntitlementForWorkspace(input.workspaceId);
    this.db
      .prepare(
        `INSERT INTO entitlements (
          id,
          workspace_id,
          subscription_id,
          monthly_token_limit,
          remaining_tokens,
          allowed_models_json,
          max_api_keys,
          valid_from,
          valid_until,
          status,
          created_at,
          updated_at
        )
        VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(
        id,
        input.workspaceId,
        tokenDelta,
        tokenDelta,
        JSON.stringify(input.allowedModels ?? latest?.allowedModels ?? []),
        input.maxApiKeys ?? latest?.maxApiKeys ?? 1,
        validFrom,
        validUntil,
        validFrom,
        validFrom,
      );

    return this.getEntitlementById(id) as EntitlementRecord;
  }

  getEntitlementById(id: string): EntitlementRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM entitlements
         WHERE id = ?`,
      )
      .get(id) as EntitlementRow | undefined;
    return row ? mapEntitlementRow(row) : undefined;
  }

  getEntitlementUsage(entitlementId: string): EntitlementUsageRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM entitlement_usage
         WHERE entitlement_id = ?`,
      )
      .get(entitlementId) as EntitlementUsageRow | undefined;
    return row ? mapEntitlementUsageRow(row) : undefined;
  }

  incrementEntitlementUsage(input: {
    entitlementId: string;
    workspaceId: string;
    customerApiKeyId?: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    now?: Date;
  }): EntitlementUsageRecord {
    const now = (input.now ?? new Date()).toISOString();
    this.db
      .prepare(
        `INSERT INTO entitlement_usage (
          entitlement_id,
          workspace_id,
          customer_api_key_id,
          input_tokens,
          output_tokens,
          total_tokens,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entitlement_id) DO UPDATE SET
          workspace_id = excluded.workspace_id,
          customer_api_key_id = COALESCE(excluded.customer_api_key_id, entitlement_usage.customer_api_key_id),
          input_tokens = entitlement_usage.input_tokens + excluded.input_tokens,
          output_tokens = entitlement_usage.output_tokens + excluded.output_tokens,
          total_tokens = entitlement_usage.total_tokens + excluded.total_tokens,
          updated_at = excluded.updated_at`,
      )
      .run(
        input.entitlementId,
        input.workspaceId,
        input.customerApiKeyId ?? null,
        Math.max(0, Math.trunc(input.inputTokens)),
        Math.max(0, Math.trunc(input.outputTokens)),
        Math.max(0, Math.trunc(input.totalTokens)),
        now,
        now,
      );

    return this.getEntitlementUsage(input.entitlementId) as EntitlementUsageRecord;
  }

  createRenewalRequest(input: {
    workspaceId: string;
    telegramUserId: string;
    kind?: RenewalRequestKind;
    requestedPlanId?: string;
    requestedDays?: number;
    requestedTokenDelta?: number;
    requestedTokenLotDays?: number;
    priceVnd?: number;
    now?: Date;
  }): { request: RenewalRequestRecord; created: boolean } {
    const kind = input.kind ?? "renewal";
    const existing = this.getOpenRenewalRequestForWorkspace(input.workspaceId, kind);
    if (existing) {
      return { request: existing, created: false };
    }

    const now = (input.now ?? new Date()).toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO renewal_requests (
          id,
          workspace_id,
          telegram_user_id,
          request_kind,
          requested_plan_id,
          requested_days,
          requested_token_delta,
          requested_token_lot_days,
          price_vnd,
          status,
          requested_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.telegramUserId,
        kind,
        input.requestedPlanId ?? null,
        input.requestedDays ?? null,
        input.requestedTokenDelta ?? null,
        input.requestedTokenLotDays ?? null,
        input.priceVnd ?? null,
        now,
        now,
        now,
      );

    return {
      request: this.getRenewalRequest(id) as RenewalRequestRecord,
      created: true,
    };
  }

  getRenewalRequest(id: string): RenewalRequestRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM renewal_requests
         WHERE id = ?`,
      )
      .get(id) as RenewalRequestRow | undefined;
    return row ? mapRenewalRequestRow(row) : undefined;
  }

  getOpenRenewalRequestForWorkspace(workspaceId: string, kind: RenewalRequestKind = "renewal"): RenewalRequestRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM renewal_requests
         WHERE workspace_id = ?
           AND request_kind = ?
           AND status IN ('open', 'payment_confirmed')
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(workspaceId, kind) as RenewalRequestRow | undefined;
    return row ? mapRenewalRequestRow(row) : undefined;
  }

  listRenewalRequests(status?: RenewalRequestStatus): RenewalRequestRecord[] {
    const rows = status
      ? ((this.db
          .prepare(
            `SELECT * FROM renewal_requests
             WHERE status = ?
             ORDER BY created_at DESC`,
          )
          .all(status) as RenewalRequestRow[]))
      : ((this.db
          .prepare(
            `SELECT * FROM renewal_requests
             ORDER BY created_at DESC`,
          )
          .all() as RenewalRequestRow[]));
    return rows.map(mapRenewalRequestRow);
  }

  confirmRenewalPayment(input: {
    id: string;
    resolution?: string;
    expectedStatus?: RenewalRequestStatus;
    now?: Date;
  }): RenewalRequestRecord | undefined {
    return this.setRenewalRequestStatus({
      id: input.id,
      status: "payment_confirmed",
      resolution: input.resolution ?? "payment_confirmed_manual",
      expectedStatus: input.expectedStatus ?? "open",
      now: input.now,
    });
  }

  closeRenewalRequest(input: {
    id: string;
    resolution?: string;
    expectedStatus?: RenewalRequestStatus;
    now?: Date;
  }): RenewalRequestRecord | undefined {
    return this.setRenewalRequestStatus({
      id: input.id,
      status: "closed",
      resolution: input.resolution,
      expectedStatus: input.expectedStatus,
      now: input.now,
    });
  }

  approveRenewalRequest(input: {
    id: string;
    approvedPlanId: string;
    approvedDays: number;
    resolution?: string;
    expectedStatus?: RenewalRequestStatus;
    now?: Date;
  }): RenewalRequestRecord | undefined {
    return this.setRenewalRequestStatus({
      id: input.id,
      status: "approved",
      resolution: input.resolution,
      approvedPlanId: input.approvedPlanId,
      approvedDays: input.approvedDays,
      expectedStatus: input.expectedStatus ?? "payment_confirmed",
      now: input.now,
    });
  }

  approveTokenTopUpRequest(input: {
    id: string;
    approvedTokenDelta: number;
    approvedTokenLotDays: number;
    resolution?: string;
    expectedStatus?: RenewalRequestStatus;
    now?: Date;
  }): RenewalRequestRecord | undefined {
    return this.setRenewalRequestStatus({
      id: input.id,
      status: "approved",
      resolution: input.resolution,
      approvedTokenDelta: input.approvedTokenDelta,
      approvedTokenLotDays: input.approvedTokenLotDays,
      expectedStatus: input.expectedStatus ?? "payment_confirmed",
      now: input.now,
    });
  }

  approveTokenTopUpAtomically(input: {
    requestId: string;
    workspaceId: string;
    tokenDelta: number;
    lotDays: number;
    resolution?: string;
    allowedModels?: string[];
    maxApiKeys?: number;
    now?: Date;
  }): { request: RenewalRequestRecord; lot: EntitlementRecord } | undefined {
    return this.db.transaction(() => {
      const transitioned = this.setRenewalRequestStatus({
        id: input.requestId,
        status: "approved",
        resolution: input.resolution,
        approvedTokenDelta: input.tokenDelta,
        approvedTokenLotDays: input.lotDays,
        expectedStatus: "payment_confirmed",
        now: input.now,
      });
      if (!transitioned) {
        return undefined;
      }
      const lot = this.createTokenTopUpLot({
        workspaceId: input.workspaceId,
        tokenDelta: input.tokenDelta,
        days: input.lotDays,
        allowedModels: input.allowedModels,
        maxApiKeys: input.maxApiKeys,
        sourceRequestId: input.requestId,
        now: input.now,
      });
      return { request: transitioned, lot };
    })();
  }

  private setRenewalRequestStatus(input: {
    id: string;
    status: RenewalRequestStatus;
    resolution?: string;
    approvedPlanId?: string;
    approvedDays?: number;
    approvedTokenDelta?: number;
    approvedTokenLotDays?: number;
    expectedStatus?: RenewalRequestStatus;
    now?: Date;
  }): RenewalRequestRecord | undefined {
    const now = (input.now ?? new Date()).toISOString();
    const query = input.expectedStatus
      ? `UPDATE renewal_requests
         SET status = ?,
             resolution = COALESCE(?, resolution),
             approved_plan_id = COALESCE(?, approved_plan_id),
             approved_days = COALESCE(?, approved_days),
             approved_token_delta = COALESCE(?, approved_token_delta),
             approved_token_lot_days = COALESCE(?, approved_token_lot_days),
             closed_at = CASE WHEN ? IN ('approved', 'closed') THEN ? ELSE closed_at END,
             updated_at = ?
         WHERE id = ?
           AND status = ?`
      : `UPDATE renewal_requests
         SET status = ?,
             resolution = COALESCE(?, resolution),
             approved_plan_id = COALESCE(?, approved_plan_id),
             approved_days = COALESCE(?, approved_days),
             approved_token_delta = COALESCE(?, approved_token_delta),
             approved_token_lot_days = COALESCE(?, approved_token_lot_days),
             closed_at = CASE WHEN ? IN ('approved', 'closed') THEN ? ELSE closed_at END,
             updated_at = ?
         WHERE id = ?`;
    const params: unknown[] = [
      input.status,
      input.resolution ?? null,
      input.approvedPlanId ?? null,
      input.approvedDays ?? null,
      input.approvedTokenDelta ?? null,
      input.approvedTokenLotDays ?? null,
      input.status,
      now,
      now,
      input.id,
    ];
    if (input.expectedStatus) {
      params.push(input.expectedStatus);
    }
    const result = this.db.prepare(query).run(...params);
    if (result.changes === 0) {
      return undefined;
    }
    return this.getRenewalRequest(input.id);
  }

  expireEntitlements(now: Date = new Date()): number {
    const nowIso = now.toISOString();
    const result = this.db
      .prepare(
        `UPDATE entitlements
         SET status = 'expired',
             updated_at = ?
         WHERE status = 'active'
           AND valid_until < ?`,
      )
      .run(nowIso, nowIso);

    this.db
      .prepare(
        `UPDATE subscriptions
         SET status = 'expired',
             updated_at = ?
         WHERE status IN ('active', 'trialing')
           AND current_period_end < ?`,
      )
      .run(nowIso, nowIso);

    return result.changes;
  }
}

function ensureBillingSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      price_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      billing_interval TEXT NOT NULL,
      monthly_token_limit INTEGER NOT NULL,
      max_api_keys INTEGER NOT NULL DEFAULT 1,
      allowed_models_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      status TEXT NOT NULL,
      current_period_start TEXT NOT NULL,
      current_period_end TEXT NOT NULL,
      cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
      provider TEXT,
      provider_customer_id TEXT,
      provider_subscription_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entitlements (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      subscription_id TEXT,
      monthly_token_limit INTEGER NOT NULL,
      remaining_tokens INTEGER,
      allowed_models_json TEXT NOT NULL DEFAULT '[]',
      max_api_keys INTEGER NOT NULL DEFAULT 1,
      valid_from TEXT NOT NULL,
      valid_until TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_entitlements_workspace_valid_until
      ON entitlements(workspace_id, status, valid_until, created_at);

    CREATE TABLE IF NOT EXISTS entitlement_usage (
      entitlement_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      customer_api_key_id TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (entitlement_id) REFERENCES entitlements(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS renewal_requests (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      telegram_user_id TEXT NOT NULL,
      request_kind TEXT NOT NULL DEFAULT 'renewal',
      requested_plan_id TEXT,
      requested_days INTEGER,
      requested_token_delta INTEGER,
      requested_token_lot_days INTEGER,
      price_vnd INTEGER,
      status TEXT NOT NULL DEFAULT 'open',
      resolution TEXT,
      approved_plan_id TEXT,
      approved_days INTEGER,
      approved_token_delta INTEGER,
      approved_token_lot_days INTEGER,
      requested_at TEXT NOT NULL,
      closed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace_status
      ON subscriptions(workspace_id, status, current_period_end);

    CREATE INDEX IF NOT EXISTS idx_entitlements_workspace_status
      ON entitlements(workspace_id, status, valid_until);

    CREATE INDEX IF NOT EXISTS idx_entitlement_usage_workspace
      ON entitlement_usage(workspace_id, updated_at);

    CREATE INDEX IF NOT EXISTS idx_renewal_requests_workspace_status
      ON renewal_requests(workspace_id, status, created_at);
  `);

  ensureBillingColumn(db, "renewal_requests", "request_kind", "TEXT NOT NULL DEFAULT 'renewal'");
  ensureBillingColumn(db, "renewal_requests", "requested_token_delta", "INTEGER");
  ensureBillingColumn(db, "renewal_requests", "requested_token_lot_days", "INTEGER");
  ensureBillingColumn(db, "renewal_requests", "price_vnd", "INTEGER");
  ensureBillingColumn(db, "renewal_requests", "approved_token_delta", "INTEGER");
  ensureBillingColumn(db, "renewal_requests", "approved_token_lot_days", "INTEGER");
}

function mapPlanRow(row: PlanRow): PlanRecord {
  return {
    id: row.id,
    name: row.name,
    status: row.status === "archived" ? "archived" : "active",
    priceCents: row.price_cents,
    currency: row.currency,
    billingInterval:
      row.billing_interval === "year" || row.billing_interval === "one_time"
        ? row.billing_interval
        : "month",
    monthlyTokenLimit: row.monthly_token_limit,
    maxApiKeys: row.max_api_keys,
    allowedModels: parseStringArray(row.allowed_models_json),
    metadataJson: row.metadata_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSubscriptionRow(row: SubscriptionRow): SubscriptionRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    planId: row.plan_id,
    status:
      row.status === "trialing" ||
      row.status === "active" ||
      row.status === "past_due" ||
      row.status === "canceled" ||
      row.status === "expired"
        ? row.status
        : "expired",
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end !== 0,
    provider: row.provider ?? undefined,
    providerCustomerId: row.provider_customer_id ?? undefined,
    providerSubscriptionId: row.provider_subscription_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEntitlementRow(row: EntitlementRow): EntitlementRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    subscriptionId: row.subscription_id ?? undefined,
    monthlyTokenLimit: row.monthly_token_limit,
    remainingTokens: row.remaining_tokens ?? undefined,
    allowedModels: parseStringArray(row.allowed_models_json),
    maxApiKeys: row.max_api_keys,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    status: row.status === "expired" || row.status === "suspended" ? row.status : "active",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEntitlementUsageRow(row: EntitlementUsageRow): EntitlementUsageRecord {
  return {
    entitlementId: row.entitlement_id,
    workspaceId: row.workspace_id,
    customerApiKeyId: row.customer_api_key_id ?? undefined,
    inputTokens: Math.max(0, Number(row.input_tokens ?? 0)),
    outputTokens: Math.max(0, Number(row.output_tokens ?? 0)),
    totalTokens: Math.max(0, Number(row.total_tokens ?? 0)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRenewalRequestRow(row: RenewalRequestRow): RenewalRequestRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    telegramUserId: row.telegram_user_id,
    kind: row.request_kind === "token_topup" ? "token_topup" : "renewal",
    requestedPlanId: row.requested_plan_id ?? undefined,
    requestedDays: row.requested_days ?? undefined,
    requestedTokenDelta: row.requested_token_delta ?? undefined,
    requestedTokenLotDays: row.requested_token_lot_days ?? undefined,
    priceVnd: row.price_vnd ?? undefined,
    status:
      row.status === "payment_confirmed" || row.status === "approved" || row.status === "closed"
        ? row.status
        : "open",
    resolution: row.resolution ?? undefined,
    approvedPlanId: row.approved_plan_id ?? undefined,
    approvedDays: row.approved_days ?? undefined,
    approvedTokenDelta: row.approved_token_delta ?? undefined,
    approvedTokenLotDays: row.approved_token_lot_days ?? undefined,
    requestedAt: row.requested_at,
    closedAt: row.closed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildEmptyUsage(
  entitlementId: string | undefined,
  workspaceId: string | undefined,
): EntitlementUsageRecord {
  const timestamp = new Date(0).toISOString();
  return {
    entitlementId: entitlementId ?? "none",
    workspaceId: workspaceId ?? "none",
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function ensureBillingColumn(db: Database, tableName: string, columnName: string, columnDefinition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}
