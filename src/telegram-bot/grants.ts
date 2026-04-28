import type { BillingRepository } from "../billing.js";
import type { CustomerKeyRepository } from "../customer-keys.js";
import type { AuditActor, AuditLogRepository } from "../audit-log.js";
import type { BotIdentityRepository } from "./bot-identity-repository.js";
import type { CustomerWorkspaceRepository } from "./customer-workspace-repository.js";
import type { ResponsesProxyClient } from "./proxy-client.js";

export type CustomerAccessProvisionMode =
  | "existing_key_reactivated"
  | "new_key_created"
  | "existing_key_already_active"
  | "existing_key_replaced";

export type CustomerAccessProvisionResult = {
  mode: CustomerAccessProvisionMode;
  workspaceId: string;
  clientRoute: string;
  keyId: string;
  keyPreview: string;
  apiKey?: string;
  subscriptionEndsAt: string;
};

export function assertWorkspaceApiKeyCapacity(args: {
  workspaceId: string;
  billing: BillingRepository;
  customerKeys: CustomerKeyRepository;
  ignoredKeyIds?: string[];
}): void {
  const entitlement = args.billing.getActiveEntitlementForWorkspace(args.workspaceId);
  if (!entitlement) {
    throw new Error("No active entitlement was found for this customer workspace.");
  }

  const ignored = new Set(args.ignoredKeyIds ?? []);
  const occupiedKeys = args.customerKeys.listKeysByWorkspace(args.workspaceId).filter((record) => {
    if (ignored.has(record.id)) {
      return false;
    }
    return record.status === "active" || record.status === "suspended";
  });

  if (occupiedKeys.length >= entitlement.maxApiKeys) {
    throw new Error(
      `API key limit reached for this workspace (${occupiedKeys.length}/${entitlement.maxApiKeys}). Revoke or rotate an existing key first.`,
    );
  }
}

export async function grantCustomerAccess(args: {
  telegramUserId: string;
  planId: string;
  days: number;
  defaultClientRoute: string;
  identities: BotIdentityRepository;
  workspaces: CustomerWorkspaceRepository;
  customerKeys: CustomerKeyRepository;
  billing: BillingRepository;
  proxyClient: ResponsesProxyClient;
  auditLog?: AuditLogRepository;
  actor?: AuditActor;
}): Promise<CustomerAccessProvisionResult> {
  return provisionCustomerAccess({
    ...args,
    action: "grant",
  });
}

export async function renewCustomerAccess(args: {
  telegramUserId: string;
  planId: string;
  days: number;
  defaultClientRoute: string;
  identities: BotIdentityRepository;
  workspaces: CustomerWorkspaceRepository;
  customerKeys: CustomerKeyRepository;
  billing: BillingRepository;
  proxyClient: ResponsesProxyClient;
  replaceKey?: boolean;
  auditLog?: AuditLogRepository;
  actor?: AuditActor;
}): Promise<CustomerAccessProvisionResult> {
  return provisionCustomerAccess({
    ...args,
    action: "renew",
  });
}

async function provisionCustomerAccess(args: {
  telegramUserId: string;
  planId: string;
  days: number;
  defaultClientRoute: string;
  identities: BotIdentityRepository;
  workspaces: CustomerWorkspaceRepository;
  customerKeys: CustomerKeyRepository;
  billing: BillingRepository;
  proxyClient: ResponsesProxyClient;
  replaceKey?: boolean;
  auditLog?: AuditLogRepository;
  actor?: AuditActor;
  action: "grant" | "renew";
}): Promise<CustomerAccessProvisionResult> {
  const existingUser = args.identities.getUser(args.telegramUserId);
  args.identities.upsertUser({
    telegramUserId: args.telegramUserId,
    defaultRole: "customer",
    defaultStatus: "active",
  });
  args.identities.setUserStatus(args.telegramUserId, "active");
  if (!existingUser) {
    args.auditLog?.record({
      event: "user.created",
      actor: args.actor,
      subjectType: "telegram_user",
      subjectId: args.telegramUserId,
      metadata: {
        telegramUserId: args.telegramUserId,
      },
    });
  }

  const existingWorkspace = args.workspaces.getDefaultWorkspace(args.telegramUserId);
  const workspace = args.workspaces.ensureDefaultWorkspace({
    ownerTelegramUserId: args.telegramUserId,
    defaultClientRoute: args.defaultClientRoute,
    status: "active",
  });
  if (!existingWorkspace) {
    args.auditLog?.record({
      event: "workspace.created",
      actor: args.actor,
      subjectType: "workspace",
      subjectId: workspace.id,
      metadata: {
        workspaceId: workspace.id,
        telegramUserId: args.telegramUserId,
        clientRoute: workspace.defaultClientRoute,
      },
    });
  }
  if (workspace.status !== "active") {
    args.workspaces.setStatus(workspace.id, "active");
  }

  const { subscription } = args.billing.grantSubscription({
    workspaceId: workspace.id,
    planId: args.planId,
    days: args.days,
  });
  args.auditLog?.record({
    event: args.action === "grant" ? "subscription.granted" : "subscription.renewed",
    actor: args.actor,
    subjectType: "workspace",
    subjectId: workspace.id,
    metadata: {
      workspaceId: workspace.id,
      telegramUserId: args.telegramUserId,
      planId: args.planId,
      days: args.days,
      subscriptionEndsAt: subscription.currentPeriodEnd,
    },
  });

  let mode: CustomerAccessProvisionMode;
  let keyRecord = args.customerKeys.getActiveKeyForUser(args.telegramUserId);
  let apiKey: string | undefined;

  if (args.replaceKey) {
    const latestKey = args.customerKeys.getLatestKeyForUser(args.telegramUserId);
    const ignoredKeyIds = keyRecord
      ? [keyRecord.id]
      : latestKey && latestKey.status !== "revoked"
        ? [latestKey.id]
        : [];
    assertWorkspaceApiKeyCapacity({
      workspaceId: workspace.id,
      billing: args.billing,
      customerKeys: args.customerKeys,
      ignoredKeyIds,
    });
    if (keyRecord) {
      args.customerKeys.setStatus(keyRecord.id, "revoked");
      args.auditLog?.record({
        event: "api_key.revoked",
        actor: args.actor,
        subjectType: "customer_api_key",
        subjectId: keyRecord.id,
        metadata: {
          telegramUserId: args.telegramUserId,
          workspaceId: workspace.id,
          keyPreview: keyRecord.apiKeyPreview,
          reason: "rotation",
        },
      });
    } else if (latestKey && latestKey.status !== "revoked") {
      args.customerKeys.setStatus(latestKey.id, "revoked");
      args.auditLog?.record({
        event: "api_key.revoked",
        actor: args.actor,
        subjectType: "customer_api_key",
        subjectId: latestKey.id,
        metadata: {
          telegramUserId: args.telegramUserId,
          workspaceId: workspace.id,
          keyPreview: latestKey.apiKeyPreview,
          reason: "rotation",
        },
      });
    }

    const created = args.customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: args.telegramUserId,
      clientRoute: workspace.defaultClientRoute,
    });
    keyRecord = created.record;
    apiKey = created.apiKey;
    mode = latestKey ? "existing_key_replaced" : "new_key_created";
    args.auditLog?.record({
      event: "api_key.created",
      actor: args.actor,
      subjectType: "customer_api_key",
      subjectId: keyRecord.id,
      metadata: {
        telegramUserId: args.telegramUserId,
        workspaceId: workspace.id,
        clientRoute: keyRecord.clientRoute,
        keyPreview: keyRecord.apiKeyPreview,
      },
    });
    if (latestKey) {
      args.auditLog?.record({
        event: "api_key.rotated",
        actor: args.actor,
        subjectType: "customer_api_key",
        subjectId: keyRecord.id,
        metadata: {
          telegramUserId: args.telegramUserId,
          workspaceId: workspace.id,
          oldKeyId: latestKey.id,
          newKeyId: keyRecord.id,
          newKeyPreview: keyRecord.apiKeyPreview,
        },
      });
    }
  } else {
    if (keyRecord) {
      mode = "existing_key_already_active";
    } else {
      const latestKey = args.customerKeys.getLatestKeyForUser(args.telegramUserId);
      if (latestKey && latestKey.status !== "revoked") {
        keyRecord = args.customerKeys.setStatus(latestKey.id, "active");
        mode = "existing_key_reactivated";
        if (keyRecord) {
          args.auditLog?.record({
            event: "api_key.activated",
            actor: args.actor,
            subjectType: "customer_api_key",
            subjectId: keyRecord.id,
            metadata: {
              telegramUserId: args.telegramUserId,
              workspaceId: workspace.id,
              keyPreview: keyRecord.apiKeyPreview,
            },
          });
        }
      } else {
        assertWorkspaceApiKeyCapacity({
          workspaceId: workspace.id,
          billing: args.billing,
          customerKeys: args.customerKeys,
        });
        const created = args.customerKeys.createKey({
          workspaceId: workspace.id,
          telegramUserId: args.telegramUserId,
          clientRoute: workspace.defaultClientRoute,
        });
        keyRecord = created.record;
        apiKey = created.apiKey;
        mode = "new_key_created";
        args.auditLog?.record({
          event: "api_key.created",
          actor: args.actor,
          subjectType: "customer_api_key",
          subjectId: keyRecord.id,
          metadata: {
            telegramUserId: args.telegramUserId,
            workspaceId: workspace.id,
            clientRoute: keyRecord.clientRoute,
            keyPreview: keyRecord.apiKeyPreview,
          },
        });
      }
    }
  }

  if (!keyRecord) {
    throw new Error("Customer key could not be created or reactivated");
  }

  const clientConfigs = await args.proxyClient.getClientConfigs();
  const currentKeys = readClientRouteKeys(clientConfigs, workspace.defaultClientRoute);
  const nextKeys = apiKey ? [...new Set([...currentKeys, apiKey])] : currentKeys;
  if (apiKey) {
    await args.proxyClient.setClientRouteApiKeys({
      client: workspace.defaultClientRoute,
      apiKeys: nextKeys,
    });
  }

  return {
    mode,
    workspaceId: workspace.id,
    clientRoute: workspace.defaultClientRoute,
    keyId: keyRecord.id,
    keyPreview: keyRecord.apiKeyPreview,
    apiKey,
    subscriptionEndsAt: subscription.currentPeriodEnd,
  };
}

function readClientRouteKeys(payload: any, clientRoute: string): string[] {
  const routes = [
    ...(Array.isArray(payload?.clientRoutes) ? payload.clientRoutes : []),
    ...Object.values(payload?.clients ?? {})
      .map((entry: any) => entry?.route)
      .filter(Boolean),
  ];
  const route = routes.find((entry: any) => entry?.key === clientRoute);
  return Array.isArray(route?.apiKeys)
    ? route.apiKeys.filter(
        (entry: unknown): entry is string => typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
}
