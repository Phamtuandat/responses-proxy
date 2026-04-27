import type { BillingRepository } from "./billing.js";
import type { CustomerKeyRepository } from "./customer-keys.js";
import type { AuditLogRepository } from "./audit-log.js";
import type { CustomerWorkspaceRepository } from "./telegram-bot/customer-workspace-repository.js";

export type BillingExpirationSummary = {
  expiredEntitlements: number;
  suspendedWorkspaces: number;
  suspendedKeys: number;
  notificationsSent: number;
  notificationsFailed: number;
};

export async function runBillingExpiration(args: {
  billing: BillingRepository;
  customerKeys: CustomerKeyRepository;
  workspaces: CustomerWorkspaceRepository;
  auditLog?: AuditLogRepository;
  now?: Date;
  notifyCustomer?: (input: { telegramUserId: string; text: string }) => Promise<void>;
}): Promise<BillingExpirationSummary> {
  const now = args.now ?? new Date();
  const expiredEntitlements = args.billing.expireEntitlements(now);
  let suspendedWorkspaces = 0;
  let suspendedKeys = 0;
  let notificationsSent = 0;
  let notificationsFailed = 0;

  for (const workspace of args.workspaces.listWorkspaces()) {
    const activeEntitlement = args.billing.getActiveEntitlementForWorkspace(workspace.id, now);
    if (activeEntitlement) {
      continue;
    }

    const latestEntitlement = args.billing.getLatestEntitlementForWorkspace(workspace.id);
    if (!latestEntitlement) {
      continue;
    }

    let workspaceChanged = false;
    if (workspace.status !== "suspended") {
      args.workspaces.setStatus(workspace.id, "suspended", now);
      suspendedWorkspaces += 1;
      workspaceChanged = true;
    }

    let workspaceSuspendedKeys = 0;
    for (const key of args.customerKeys.listKeysByWorkspace(workspace.id)) {
      if (key.status !== "active") {
        continue;
      }
      args.customerKeys.setStatus(key.id, "suspended", { now });
      args.auditLog?.record({
        event: "api_key.suspended",
        actor: { type: "system", id: "billing-expiration-worker" },
        subjectType: "customer_api_key",
        subjectId: key.id,
        metadata: {
          workspaceId: workspace.id,
          telegramUserId: workspace.ownerTelegramUserId,
          keyPreview: key.apiKeyPreview,
          reason: "no_active_entitlement",
        },
      });
      suspendedKeys += 1;
      workspaceSuspendedKeys += 1;
    }

    if ((workspaceChanged || workspaceSuspendedKeys > 0) && args.notifyCustomer) {
      try {
        await args.notifyCustomer({
          telegramUserId: workspace.ownerTelegramUserId,
          text: [
            "Your Responses access has expired.",
            `workspace_id: ${workspace.id}`,
            `client_route: ${workspace.defaultClientRoute}`,
            `expired_at: ${latestEntitlement.validUntil}`,
            "Contact admin to renew your plan.",
          ].join("\n"),
        });
        notificationsSent += 1;
      } catch {
        notificationsFailed += 1;
      }
    }
  }

  return {
    expiredEntitlements,
    suspendedWorkspaces,
    suspendedKeys,
    notificationsSent,
    notificationsFailed,
  };
}
