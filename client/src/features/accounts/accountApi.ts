// Unified Account Management API Layer
// Handles ChatGPT OAuth, Kiro tokens, and API key accounts for providers

import { apiGet, apiSend } from "../../api/client";
import type {
  ProviderAuthType,
  ProviderAccountSummary,
  ProviderAccountRoutingMode,
  ProviderQuota,
  ProviderTestResult
} from "../providers/providerTypes";

// Enhanced account connection interface
export interface AccountConnection {
  id: string;
  providerId: string;
  authType: ProviderAuthType;
  status: AccountConnectionStatus;
  label: string;
  email?: string;
  username?: string;
  routingMode: ProviderAccountRoutingMode;
  quota?: ProviderQuota;
  lastUsedAt?: string;
  lastError?: string;
  metadata?: AccountMetadata;
  tokenStatus?: TokenStatus;
  expiresAt?: string;
  refreshable?: boolean;
}

export type AccountConnectionStatus =
  | "connected"
  | "expired"
  | "invalid"
  | "disabled"
  | "needs_reconnect"
  | "connecting"
  | "unknown";

export type TokenStatus = "valid" | "expired" | "expiring" | "missing";

export interface AccountMetadata {
  // ChatGPT OAuth specific
  accountId?: string;
  idToken?: string;

  // Kiro specific
  profileArn?: string;
  region?: string;
  clientId?: string;
  authMethod?: string;
  startUrl?: string;

  // API Key specific
  keyPrefix?: string;
  keyName?: string;

  // Common
  priority?: number;
  isActive?: boolean;
  raw?: Record<string, unknown>;
}

export interface ConnectionFlow {
  type: "oauth" | "kiro" | "api_key";
  authUrl?: string;
  state?: string;
  instructions?: string;
  requiresCallback?: boolean;
}

export interface AccountTestSuite {
  authenticationTest: TestResult;
  quotaCheckTest?: TestResult;
  modelAccessTest?: TestResult;
  routingTest?: TestResult;
}

export interface TestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
}

// Core account management functions

export async function fetchProviderAccounts(providerId: string): Promise<AccountConnection[]> {
  try {
    // First get the provider to understand its auth mode
    const providerResponse = await apiGet(`/api/providers/${providerId}`);
    const provider = providerResponse.provider;

    if (!provider) {
      throw new Error('Provider not found');
    }

    const accounts: AccountConnection[] = [];

    // Handle different auth modes
    switch (provider.authMode) {
      case 'chatgpt_oauth':
        const oauthAccounts = await fetchChatGptOAuthAccounts(providerId, provider);
        accounts.push(...oauthAccounts);
        break;

      case 'kiro':
        const kiroAccounts = await fetchKiroAccounts(providerId, provider);
        accounts.push(...kiroAccounts);
        break;

      case 'api_key':
        const apiKeyAccounts = await fetchApiKeyAccounts(providerId, provider);
        accounts.push(...apiKeyAccounts);
        break;

      default:
        console.warn(`Unknown auth mode: ${provider.authMode}`);
    }

    return accounts;
  } catch (error) {
    console.error(`Failed to fetch accounts for provider ${providerId}:`, error);
    throw new Error('Failed to load provider accounts');
  }
}

async function fetchChatGptOAuthAccounts(providerId: string, provider: any): Promise<AccountConnection[]> {
  try {
    const response = await apiGet('/api/chatgpt-oauth/status');
    const accounts: AccountConnection[] = [];

    // If provider has a specific account ID, filter to that account
    if (provider.chatgptAccountId) {
      const account = response.accounts?.find((acc: any) => acc.accountId === provider.chatgptAccountId);
      if (account) {
        accounts.push(mapChatGptOAuthAccount(providerId, account));
      }
    } else {
      // Include all available OAuth accounts
      response.accounts?.forEach((account: any) => {
        accounts.push(mapChatGptOAuthAccount(providerId, account));
      });
    }

    return accounts;
  } catch (error) {
    console.error('Failed to fetch ChatGPT OAuth accounts:', error);
    return [];
  }
}

async function fetchKiroAccounts(providerId: string, provider: any): Promise<AccountConnection[]> {
  try {
    const response = await apiGet('/api/kiro/accounts');
    const accounts: AccountConnection[] = [];

    response.accounts?.forEach((account: any) => {
      accounts.push(mapKiroAccount(providerId, account));
    });

    return accounts;
  } catch (error) {
    console.error('Failed to fetch Kiro accounts:', error);
    return [];
  }
}

async function fetchApiKeyAccounts(providerId: string, provider: any): Promise<AccountConnection[]> {
  const accounts: AccountConnection[] = [];

  // Create account entries for each API key
  provider.providerApiKeys?.forEach((key: string, index: number) => {
    accounts.push({
      id: `api-key-${index}`,
      providerId,
      authType: 'api_key',
      status: 'connected',
      label: `API Key ${index + 1}`,
      routingMode: 'round_robin',
      metadata: {
        keyPrefix: key.substring(0, 8) + '...',
        keyName: `Key ${index + 1}`,
        priority: index
      }
    });
  });

  return accounts;
}

function mapChatGptOAuthAccount(providerId: string, account: any): AccountConnection {
  const now = new Date();
  const expiresAt = account.expiresAt ? new Date(account.expiresAt) : null;
  const isExpired = expiresAt && expiresAt < now;
  const isExpiring = expiresAt && (expiresAt.getTime() - now.getTime()) < 7 * 24 * 60 * 60 * 1000; // 7 days

  let status: AccountConnectionStatus = 'connected';
  let tokenStatus: TokenStatus = 'valid';

  if (account.disabled) {
    status = 'disabled';
  } else if (isExpired) {
    status = 'expired';
    tokenStatus = 'expired';
  } else if (isExpiring) {
    tokenStatus = 'expiring';
  }

  return {
    id: account.accountId || account.id,
    providerId,
    authType: 'oauth',
    status,
    label: account.email || 'OAuth Account',
    email: account.email,
    routingMode: 'priority', // Default for OAuth accounts
    tokenStatus,
    expiresAt: account.expiresAt,
    refreshable: true,
    lastUsedAt: account.lastRefreshAt,
    metadata: {
      accountId: account.accountId,
      idToken: account.idToken ? '[REDACTED]' : undefined
    }
  };
}

function mapKiroAccount(providerId: string, account: any): AccountConnection {
  const tokenStatus = account.tokenStatus || 'unknown';
  let status: AccountConnectionStatus = 'connected';

  if (!account.isActive) {
    status = 'disabled';
  } else if (tokenStatus === 'expired') {
    status = 'expired';
  } else if (tokenStatus === 'missing') {
    status = 'invalid';
  }

  return {
    id: account.id,
    providerId,
    authType: 'oauth',
    status,
    label: account.name || 'Kiro Account',
    routingMode: 'round_robin', // Default for Kiro accounts
    tokenStatus: tokenStatus as TokenStatus,
    expiresAt: account.expiresAt,
    refreshable: true,
    lastUsedAt: account.updatedAt,
    metadata: {
      profileArn: account.providerSpecificData?.profileArn,
      region: account.providerSpecificData?.region,
      clientId: account.providerSpecificData?.clientId,
      authMethod: account.providerSpecificData?.authMethod,
      startUrl: account.providerSpecificData?.startUrl,
      priority: account.priority,
      isActive: account.isActive
    }
  };
}

export async function testProviderAccount(providerId: string, accountId: string): Promise<ProviderTestResult> {
  try {
    // Get provider info to determine test approach
    const providerResponse = await apiGet(`/api/providers/${providerId}`);
    const provider = providerResponse.provider;

    if (!provider) {
      throw new Error('Provider not found');
    }

    let testResult: any;

    // Test based on auth mode
    switch (provider.authMode) {
      case 'chatgpt_oauth':
        testResult = await testChatGptOAuthAccount(accountId);
        break;

      case 'kiro':
        testResult = await testKiroAccount(accountId);
        break;

      case 'api_key':
        testResult = await testApiKeyAccount(providerId, accountId);
        break;

      default:
        throw new Error(`Unsupported auth mode: ${provider.authMode}`);
    }

    return {
      providerId,
      accountId,
      status: testResult.success ? 'success' : 'failed',
      testedAt: new Date().toISOString(),
      latencyMs: testResult.latencyMs,
      authOk: testResult.authOk !== false,
      quotaOk: testResult.quotaOk !== false,
      modelOk: testResult.modelOk !== false,
      routingOk: testResult.routingOk !== false,
      testedModel: testResult.testedModel,
      errorCode: testResult.errorCode,
      errorMessage: testResult.errorMessage,
      suggestedFix: testResult.suggestedFix
    };
  } catch (error) {
    return {
      providerId,
      accountId,
      status: 'failed',
      testedAt: new Date().toISOString(),
      authOk: false,
      quotaOk: false,
      modelOk: false,
      routingOk: false,
      errorMessage: error instanceof Error ? error.message : 'Test failed',
      suggestedFix: 'Check account configuration and try again'
    };
  }
}

async function testChatGptOAuthAccount(accountId: string): Promise<any> {
  try {
    const response = await apiSend(`/api/account-auth/accounts/${accountId}/test`, 'POST', {});
    return response;
  } catch (error) {
    return {
      success: false,
      authOk: false,
      errorMessage: error instanceof Error ? error.message : 'OAuth test failed',
      suggestedFix: 'Try refreshing the account tokens'
    };
  }
}

async function testKiroAccount(accountId: string): Promise<any> {
  try {
    const response = await apiSend(`/api/kiro/accounts/${accountId}/test`, 'POST', {});
    return response;
  } catch (error) {
    return {
      success: false,
      authOk: false,
      errorMessage: error instanceof Error ? error.message : 'Kiro test failed',
      suggestedFix: 'Check Kiro account configuration and refresh tokens'
    };
  }
}

async function testApiKeyAccount(providerId: string, accountId: string): Promise<any> {
  try {
    const response = await apiSend(`/api/providers/${providerId}/test`, 'POST', {
      accountId
    });
    return response;
  } catch (error) {
    return {
      success: false,
      authOk: false,
      errorMessage: error instanceof Error ? error.message : 'API key test failed',
      suggestedFix: 'Verify API key is valid and has necessary permissions'
    };
  }
}

export async function updateAccountRoutingMode(
  providerId: string,
  accountId: string,
  mode: ProviderAccountRoutingMode
): Promise<void> {
  try {
    // Get provider to determine auth mode
    const providerResponse = await apiGet(`/api/providers/${providerId}`);
    const provider = providerResponse.provider;

    if (!provider) {
      throw new Error('Provider not found');
    }

    // Update routing mode based on auth type
    switch (provider.authMode) {
      case 'chatgpt_oauth':
        await apiSend(`/api/chatgpt-oauth/settings`, 'PATCH', {
          rotationMode: mapRoutingModeToRotationMode(mode)
        });
        break;

      case 'kiro':
        await apiSend(`/api/kiro/accounts/${accountId}`, 'PATCH', {
          routingMode: mode
        });
        break;

      case 'api_key':
        // API keys don't have individual routing modes
        console.warn('API key accounts do not support individual routing modes');
        break;

      default:
        throw new Error(`Unsupported auth mode: ${provider.authMode}`);
    }
  } catch (error) {
    console.error(`Failed to update routing mode for account ${accountId}:`, error);
    throw new Error('Failed to update account routing mode');
  }
}

function mapRoutingModeToRotationMode(mode: ProviderAccountRoutingMode): string {
  switch (mode) {
    case 'round_robin':
      return 'round_robin';
    case 'priority':
      return 'first_available';
    case 'sticky':
      return 'first_available'; // Closest equivalent
    case 'failover_only':
      return 'first_available';
    default:
      return 'round_robin';
  }
}

export async function refreshProviderAccount(providerId: string, accountId: string): Promise<AccountConnection> {
  try {
    // Get provider to determine auth mode
    const providerResponse = await apiGet(`/api/providers/${providerId}`);
    const provider = providerResponse.provider;

    if (!provider) {
      throw new Error('Provider not found');
    }

    // Refresh based on auth mode
    switch (provider.authMode) {
      case 'chatgpt_oauth':
        await apiSend(`/api/account-auth/accounts/${accountId}/refresh`, 'POST', {});
        break;

      case 'kiro':
        await apiSend(`/api/kiro/accounts/${accountId}/refresh`, 'POST', {});
        break;

      case 'api_key':
        throw new Error('API key accounts do not support token refresh');

      default:
        throw new Error(`Unsupported auth mode: ${provider.authMode}`);
    }

    // Fetch updated account info
    const accounts = await fetchProviderAccounts(providerId);
    const refreshedAccount = accounts.find(acc => acc.id === accountId);

    if (!refreshedAccount) {
      throw new Error('Account not found after refresh');
    }

    return refreshedAccount;
  } catch (error) {
    console.error(`Failed to refresh account ${accountId}:`, error);
    throw new Error('Failed to refresh account');
  }
}

export async function deleteProviderAccount(providerId: string, accountId: string): Promise<void> {
  try {
    // Get provider to determine auth mode
    const providerResponse = await apiGet(`/api/providers/${providerId}`);
    const provider = providerResponse.provider;

    if (!provider) {
      throw new Error('Provider not found');
    }

    // Delete based on auth mode
    switch (provider.authMode) {
      case 'chatgpt_oauth':
        await apiSend(`/api/account-auth/accounts/${accountId}`, 'DELETE', {});
        break;

      case 'kiro':
        await apiSend(`/api/kiro/accounts/${accountId}`, 'DELETE', {});
        break;

      case 'api_key':
        throw new Error('API key deletion not yet implemented');

      default:
        throw new Error(`Unsupported auth mode: ${provider.authMode}`);
    }
  } catch (error) {
    console.error(`Failed to delete account ${accountId}:`, error);
    throw new Error('Failed to delete account');
  }
}

export async function startAccountConnection(providerId: string, authType: ProviderAuthType): Promise<ConnectionFlow> {
  try {
    switch (authType) {
      case 'oauth':
        // Determine if this is ChatGPT OAuth or Kiro based on provider
        const providerResponse = await apiGet(`/api/providers/${providerId}`);
        const provider = providerResponse.provider;

        if (provider?.authMode === 'chatgpt_oauth') {
          const response = await apiSend('/api/chatgpt-oauth/start', 'POST', {});
          return {
            type: 'oauth',
            authUrl: response.authUrl,
            state: response.state,
            instructions: 'Click the link to authorize with ChatGPT, then paste the callback URL below.',
            requiresCallback: true
          };
        } else if (provider?.authMode === 'kiro') {
          return {
            type: 'kiro',
            instructions: 'Kiro account connection requires importing from 9router. Use the import function in the Kiro management screen.',
            requiresCallback: false
          };
        }
        break;

      case 'api_key':
        return {
          type: 'api_key',
          instructions: 'Enter your API key below. Make sure it has the necessary permissions for this provider.',
          requiresCallback: false
        };

      default:
        throw new Error(`Unsupported auth type: ${authType}`);
    }

    throw new Error('Unable to start connection flow');
  } catch (error) {
    console.error(`Failed to start connection flow for ${authType}:`, error);
    throw new Error('Failed to start account connection');
  }
}