import type { BillingRepository, EntitlementRecord, EntitlementUsageRecord } from "../billing.js";
import type { CustomerKeyRepository, CustomerApiKeyRecord } from "../customer-keys.js";
import type { CustomerWorkspaceRepository, CustomerWorkspaceRecord } from "./customer-workspace-repository.js";

export type CustomerBillingOverview = {
  workspace?: CustomerWorkspaceRecord;
  apiKey?: CustomerApiKeyRecord;
  entitlement?: EntitlementRecord;
  usage: EntitlementUsageRecord;
  entitlementStatus: "active" | "expired" | "suspended" | "none";
  remainingTokens: number | null;
};

export function readCustomerBillingOverview(args: {
  telegramUserId: string;
  workspaces: CustomerWorkspaceRepository;
  customerKeys: CustomerKeyRepository;
  billing: BillingRepository;
  now?: Date;
}): CustomerBillingOverview {
  const now = args.now ?? new Date();
  const workspace = args.workspaces.getDefaultWorkspace(args.telegramUserId);
  const apiKey =
    args.customerKeys.getActiveKeyForUser(args.telegramUserId) ??
    args.customerKeys.getLatestKeyForUser(args.telegramUserId);
  const entitlement = workspace
    ? args.billing.getActiveEntitlementForWorkspace(workspace.id, now) ??
      args.billing.getLatestEntitlementForWorkspace(workspace.id)
    : undefined;
  const usage = entitlement
    ? args.billing.getEntitlementUsage(entitlement.id) ?? buildEmptyUsage(entitlement.id, workspace?.id)
    : buildEmptyUsage(undefined, workspace?.id);
  const entitlementStatus = resolveEntitlementStatus(entitlement, now);
  const remainingTokens =
    entitlement && entitlementStatus === "active"
      ? Math.max(0, entitlement.monthlyTokenLimit - usage.totalTokens)
      : entitlement
        ? 0
        : null;

  return {
    workspace,
    apiKey,
    entitlement,
    usage,
    entitlementStatus,
    remainingTokens,
  };
}

function resolveEntitlementStatus(
  entitlement: EntitlementRecord | undefined,
  now: Date,
): "active" | "expired" | "suspended" | "none" {
  if (!entitlement) {
    return "none";
  }
  if (entitlement.status === "suspended") {
    return "suspended";
  }
  if (entitlement.status === "expired" || new Date(entitlement.validUntil).getTime() < now.getTime()) {
    return "expired";
  }
  return "active";
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
