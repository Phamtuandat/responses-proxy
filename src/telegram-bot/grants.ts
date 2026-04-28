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
  maxApiKeysIfNoEntitlement?: number;
}): void {
  const entitlement = args.billing.getActiveEntitlementForWorkspace(args.workspaceId);
  const maxApiKeys = entitlement?.maxApiKeys ?? args.maxApiKeysIfNoEntitlement;
  if (!maxApiKeys) {
    throw new Error("No active entitlement was found for this customer workspace.");
  }

  const ignored = new Set(args.ignoredKeyIds ?? []);
  const occupiedKeys = args.customerKeys.listKeysByWorkspace(args.workspaceId).filter((record) => {
    if (ignored.has(record.id)) {
      return false;
    }
    return record.status === "active" || record.status === "suspended";
  });

  if (occupiedKeys.length >= maxApiKeys) {
    throw new Error(
      `API key limit reached for this workspace (${occupiedKeys.length}/${maxApiKeys}). Revoke or rotate an existing key first.`,
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

  const plan = args.billing.getPlan(args.planId);
  if (!plan) {
    throw new Error(`Plan not found: ${args.planId}`);
  }

  let mode: CustomerAccessProvisionMode;
  let keyRecord = args.customerKeys.getActiveKeyForUser(args.telegramUserId);
  let apiKey: string | undefined;
  let createdKeyId: string | undefined;
  let keyToRevokeAfterSync: typeof keyRecord | undefined;

  if (args.replaceKey || (keyRecord && !args.customerKeys.getApiKeySecret(keyRecord.id))) {
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
      maxApiKeysIfNoEntitlement: plan.maxApiKeys,
    });
    keyToRevokeAfterSync = keyRecord ?? (latestKey && latestKey.status !== "revoked" ? latestKey : undefined);

    const created = args.customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: args.telegramUserId,
      clientRoute: workspace.defaultClientRoute,
      status: "suspended",
    });
    keyRecord = created.record;
    apiKey = created.apiKey;
    createdKeyId = created.record.id;
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
      apiKey = args.customerKeys.getApiKeySecret(keyRecord.id);
    } else {
      const latestKey = args.customerKeys.getLatestKeyForUser(args.telegramUserId);
      const latestKeySecret = latestKey ? args.customerKeys.getApiKeySecret(latestKey.id) : undefined;
      if (latestKey && latestKey.status !== "revoked" && latestKeySecret) {
        keyRecord = args.customerKeys.setStatus(latestKey.id, "active");
        mode = "existing_key_reactivated";
        if (keyRecord) {
          apiKey = latestKeySecret;
        }
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
      } else if (latestKey && latestKey.status !== "revoked") {
        assertWorkspaceApiKeyCapacity({
          workspaceId: workspace.id,
          billing: args.billing,
          customerKeys: args.customerKeys,
          ignoredKeyIds: [latestKey.id],
          maxApiKeysIfNoEntitlement: plan.maxApiKeys,
        });
        keyToRevokeAfterSync = latestKey;
        const created = args.customerKeys.createKey({
          workspaceId: workspace.id,
          telegramUserId: args.telegramUserId,
          clientRoute: workspace.defaultClientRoute,
          status: "suspended",
        });
        keyRecord = created.record;
        apiKey = created.apiKey;
        createdKeyId = created.record.id;
        mode = "existing_key_replaced";
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
            reason: "legacy_key_secret_unavailable",
          },
        });
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
            reason: "legacy_key_secret_unavailable",
          },
        });
      } else {
        assertWorkspaceApiKeyCapacity({
          workspaceId: workspace.id,
          billing: args.billing,
          customerKeys: args.customerKeys,
          maxApiKeysIfNoEntitlement: plan.maxApiKeys,
        });
        const created = args.customerKeys.createKey({
          workspaceId: workspace.id,
          telegramUserId: args.telegramUserId,
          clientRoute: workspace.defaultClientRoute,
          status: "suspended",
        });
        keyRecord = created.record;
        apiKey = created.apiKey;
        createdKeyId = created.record.id;
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

  if (apiKey && createdKeyId) {
    try {
      await syncNewRouteApiKey(args.proxyClient, workspace.defaultClientRoute, apiKey);
      const activated = args.customerKeys.setStatus(createdKeyId, "active");
      if (activated) {
        keyRecord = activated;
        args.auditLog?.record({
          event: "api_key.activated",
          actor: args.actor,
          subjectType: "customer_api_key",
          subjectId: activated.id,
          metadata: {
            telegramUserId: args.telegramUserId,
            workspaceId: workspace.id,
            keyPreview: activated.apiKeyPreview,
            reason: "proxy_sync_succeeded",
          },
        });
      }
      if (keyToRevokeAfterSync) {
        args.customerKeys.setStatus(keyToRevokeAfterSync.id, "revoked");
        args.auditLog?.record({
          event: "api_key.revoked",
          actor: args.actor,
          subjectType: "customer_api_key",
          subjectId: keyToRevokeAfterSync.id,
          metadata: {
            telegramUserId: args.telegramUserId,
            workspaceId: workspace.id,
            keyPreview: keyToRevokeAfterSync.apiKeyPreview,
            reason: "rotation",
          },
        });
      }
    } catch (error) {
      args.customerKeys.setStatus(createdKeyId, "revoked");
      args.auditLog?.record({
        event: "api_key.revoked",
        actor: { type: "system", id: "proxy-sync-rollback" },
        subjectType: "customer_api_key",
        subjectId: createdKeyId,
        metadata: {
          telegramUserId: args.telegramUserId,
          workspaceId: workspace.id,
          keyPreview: keyRecord.apiKeyPreview,
          reason: "proxy_sync_failed",
        },
      });
      throw error;
    }
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

async function syncNewRouteApiKey(
  proxyClient: ResponsesProxyClient,
  clientRoute: string,
  apiKey: string,
): Promise<void> {
  const clientConfigs = await proxyClient.getClientConfigs();
  const currentKeys = readClientRouteKeys(clientConfigs, clientRoute);
  const nextKeys = [...new Set([...currentKeys, apiKey])];
  await proxyClient.setClientRouteApiKeys({
    client: clientRoute,
    apiKeys: nextKeys,
  });
}
