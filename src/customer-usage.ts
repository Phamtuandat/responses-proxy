import type { BillingRepository, EntitlementUsageRecord } from "./billing.js";
import { extractUsageTotals } from "./client-token-limits.js";

export function recordCustomerUsageFromPayload(args: {
  billingRepository: BillingRepository;
  usagePayload: unknown;
  access:
    | {
        kind: "customer";
        workspace: { id: string };
        entitlement: { id: string };
        customerKey: { id: string };
      }
    | { kind: "operator" };
}): EntitlementUsageRecord | undefined {
  if (args.access.kind !== "customer") {
    return undefined;
  }

  const usage = extractUsageTotals(args.usagePayload);
  if (!usage) {
    return undefined;
  }

  return args.billingRepository.incrementEntitlementUsage({
    entitlementId: args.access.entitlement.id,
    workspaceId: args.access.workspace.id,
    customerApiKeyId: args.access.customerKey.id,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0,
  });
}
