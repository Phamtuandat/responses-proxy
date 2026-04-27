import {
  CustomerKeyRepository,
  type CustomerApiKeyRecord,
  type CustomerApiKeyStatus,
} from "./customer-keys.js";
import {
  CustomerWorkspaceRepository,
  type CustomerWorkspaceRecord,
} from "./telegram-bot/customer-workspace-repository.js";
import {
  normalizeClientRouteKey,
  RuntimeProviderRepository,
  type ClientRouteKey,
  type RuntimeProviderPreset,
} from "./runtime-provider-repository.js";
import { BillingRepository, type EntitlementRecord } from "./billing.js";

export type CustomerRoutingAccess =
  | {
      kind: "customer";
      customerKey: CustomerApiKeyRecord;
      workspace: CustomerWorkspaceRecord;
      entitlement: EntitlementRecord;
      clientRoute: ClientRouteKey;
      providers: RuntimeProviderPreset[];
    }
  | {
      kind: "operator";
      clientRoute: ClientRouteKey;
      providers: RuntimeProviderPreset[];
    }
  | {
      error: {
        statusCode: number;
        body: {
          error: {
            type: string;
            code: string;
            message: string;
            retryable: boolean;
          };
        };
      };
    };

export function resolveCustomerRoutingAccess(args: {
  routingApiKey?: string;
  resolvedClientRoute: ClientRouteKey;
  providerRepository: RuntimeProviderRepository;
  customerKeyRepository: CustomerKeyRepository;
  workspaceRepository: CustomerWorkspaceRepository;
  billingRepository: BillingRepository;
}): CustomerRoutingAccess {
  const customerKey = args.routingApiKey
    ? args.customerKeyRepository.getByApiKey(args.routingApiKey)
    : undefined;

  if (!customerKey) {
    return {
      kind: "operator",
      clientRoute: args.resolvedClientRoute,
      providers: args.providerRepository.findProvidersByAccessKey(args.routingApiKey),
    };
  }

  if (customerKey.status !== "active") {
    return {
      error: {
        statusCode: 403,
        body: buildCustomerKeyError(customerKey.status),
      },
    };
  }

  const workspace = args.workspaceRepository.getById(customerKey.workspaceId);
  if (!workspace) {
    return {
      error: {
        statusCode: 404,
        body: {
          error: {
            type: "not_found_error",
            code: "CUSTOMER_WORKSPACE_NOT_FOUND",
            message: "Customer workspace was not found for this API key.",
            retryable: false,
          },
        },
      },
    };
  }

  if (workspace.status !== "active") {
    return {
      error: {
        statusCode: 403,
        body: {
          error: {
            type: "authentication_error",
            code: "CUSTOMER_WORKSPACE_SUSPENDED",
            message: "This customer workspace is not active.",
            retryable: false,
          },
        },
      },
    };
  }

  const entitlement = args.billingRepository.getActiveEntitlementForWorkspace(workspace.id);
  if (!entitlement) {
    return {
      error: {
        statusCode: 403,
        body: {
          error: {
            type: "billing_error",
            code: "SUBSCRIPTION_REQUIRED",
            message: "No active entitlement was found for this customer API key.",
            retryable: false,
          },
        },
      },
    };
  }

  const clientRoute = normalizeClientRouteKey(customerKey.clientRoute);
  const provider = args.providerRepository.getProviderForClient(clientRoute);
  if (!provider) {
    return {
      error: {
        statusCode: 403,
        body: {
          error: {
            type: "authentication_error",
            code: "CUSTOMER_CLIENT_ROUTE_UNBOUND",
            message: "This customer API key is not bound to an active provider route.",
            retryable: false,
          },
        },
      },
    };
  }

  return {
    kind: "customer",
    customerKey,
    workspace,
    entitlement,
    clientRoute,
    providers: [provider],
  };
}

function buildCustomerKeyError(status: CustomerApiKeyStatus): {
  error: {
    type: string;
    code: string;
    message: string;
    retryable: boolean;
  };
} {
  if (status === "revoked") {
    return {
      error: {
        type: "authentication_error",
        code: "API_KEY_REVOKED",
        message: "This customer API key has been revoked.",
        retryable: false,
      },
    };
  }
  if (status === "expired") {
    return {
      error: {
        type: "billing_error",
        code: "SUBSCRIPTION_EXPIRED",
        message: "This customer API key has expired.",
        retryable: false,
      },
    };
  }
  return {
    error: {
      type: "authentication_error",
      code: "API_KEY_SUSPENDED",
      message: "This customer API key is suspended.",
      retryable: false,
    },
  };
}
