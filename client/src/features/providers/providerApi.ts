// Provider API Integration Layer
// Maps backend RuntimeProviderPreset to frontend Provider types

import { apiGet, apiSend } from "../../api/client";
import type { Provider, ProviderTier, ProviderHealthStatus, ProviderAuthType, ProviderServiceKind, ProviderAccountSummary, ProviderQuota } from "./providerTypes";

// Backend types (subset of what we need for mapping)
interface RuntimeProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  responsesUrl: string;
  authMode?: "api_key" | "chatgpt_oauth" | "kiro";
  chatgptAccountId?: string;
  providerApiKeys?: string[];
  clientApiKeys?: string[];
  capabilities: {
    ownedBy?: string;
    systemManaged?: boolean;
    accountPlatform?: string;
    accountPoolRequired?: boolean;
    usageCheckEnabled: boolean;
    usageCheckUrl?: string;
    stripMaxOutputTokens: boolean;
    sanitizeReasoningSummary: boolean;
    preserveMessagesPayload?: boolean;
    preserveRawRequestBody?: boolean;
    transportMode?: "responses" | "chat_completions" | "codewhisperer";
    stripModelPrefixes: string[];
    modelAliases?: Record<string, string>;
  };
  createdAt?: string;
  updatedAt?: string;
}

interface ProviderUsageInfo {
  providerId: string;
  usageCheckEnabled: boolean;
  lastCheckAt?: string;
  quotaExhausted?: boolean;
  errorMessage?: string;
  accountsStatus?: Array<{
    accountId: string;
    status: string;
    lastUsedAt?: string;
    errorMessage?: string;
  }>;
}

// Provider tier classification based on name patterns
function classifyProviderTier(providerName: string): ProviderTier {
  const name = providerName.toLowerCase();

  // Subscription tier - premium services
  if (name.includes('claude-code') || name.includes('copilot') || name.includes('cursor') ||
      name.includes('subscription') || name.includes('premium') || name.includes('pro')) {
    return 'subscription';
  }

  // Free tier - free services
  if (name.includes('free') || name.includes('trial') || name.includes('demo') ||
      name.includes('kiro-free') || name.includes('huggingface-free')) {
    return 'free';
  }

  // Cheap tier - cost-effective services
  if (name.includes('deepseek') || name.includes('groq') || name.includes('together') ||
      name.includes('cheap') || name.includes('budget')) {
    return 'cheap';
  }

  // Custom tier - everything else
  return 'custom';
}

// Map auth mode to auth types
function mapAuthTypes(authMode?: string): ProviderAuthType[] {
  switch (authMode) {
    case 'api_key':
      return ['api_key'];
    case 'chatgpt_oauth':
      return ['oauth'];
    case 'kiro':
      return ['oauth'];
    default:
      return ['api_key']; // Default fallback
  }
}

// Determine service kinds based on provider name and capabilities
function determineServiceKinds(providerName: string, capabilities: any): ProviderServiceKind[] {
  const name = providerName.toLowerCase();
  const kinds: ProviderServiceKind[] = [];

  // Most providers support chat
  kinds.push('chat');

  // Vision support
  if (name.includes('claude') || name.includes('gpt-4') || name.includes('vision')) {
    kinds.push('vision');
  }

  // Image generation
  if (name.includes('dall-e') || name.includes('midjourney') || name.includes('stable-diffusion')) {
    kinds.push('image');
  }

  // Embedding services
  if (name.includes('embedding') || name.includes('text-embedding')) {
    kinds.push('embedding');
  }

  return kinds;
}

// Compute health status from provider state and usage info
function computeHealthStatus(
  provider: RuntimeProviderPreset,
  usageInfo?: ProviderUsageInfo
): ProviderHealthStatus {
  // Check if provider has any API keys configured
  const hasApiKeys = Array.isArray(provider.providerApiKeys) && provider.providerApiKeys.length > 0;
  const hasOAuthAccount = provider.chatgptAccountId;
  const isConfigured = hasApiKeys || hasOAuthAccount;

  if (!isConfigured) {
    return 'not_configured';
  }

  // Check usage/quota status
  if (usageInfo?.quotaExhausted) {
    return 'quota_exhausted';
  }

  if (usageInfo?.errorMessage) {
    if (usageInfo.errorMessage.includes('auth') || usageInfo.errorMessage.includes('unauthorized')) {
      return 'auth_expired';
    }
    if (usageInfo.errorMessage.includes('rate') || usageInfo.errorMessage.includes('limit')) {
      return 'rate_limited';
    }
    return 'degraded';
  }

  // Check account status
  if (usageInfo?.accountsStatus?.some(acc => acc.status === 'error' || acc.status === 'expired')) {
    return 'auth_expired';
  }

  return 'healthy';
}

// Generate provider display name
function getProviderDisplayName(name: string): string {
  const displayNames: Record<string, string> = {
    'claude-code': 'Claude Code',
    'chatgpt-web': 'ChatGPT Web',
    'deepseek': 'DeepSeek',
    'groq': 'Groq',
    'together': 'Together AI',
    'kiro-free': 'Kiro Free',
    'anthropic': 'Anthropic',
    'openai': 'OpenAI',
  };

  return displayNames[name] || name.split('-').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');
}

import { getProviderById } from "./providerCatalog";

// Map backend RuntimeProviderPreset to frontend Provider
export function mapBackendToFrontendProvider(
  backend: RuntimeProviderPreset,
  usageInfo?: ProviderUsageInfo
): Provider {
  const isCatalog = !!getProviderById(backend.id);
  const tier = isCatalog ? classifyProviderTier(backend.name) : 'custom';
  const authTypes = mapAuthTypes(backend.authMode);
  const serviceKinds = determineServiceKinds(backend.name, backend.capabilities);
  const healthStatus = computeHealthStatus(backend, usageInfo);

  const displayName = isCatalog ? getProviderDisplayName(backend.name) : backend.name;
  const description = isCatalog ? `${displayName} provider` : `Custom endpoint: ${backend.baseUrl}`;

  // Create account summaries
  const accounts: ProviderAccountSummary[] = [];

  if (backend.chatgptAccountId) {
    accounts.push({
      id: backend.chatgptAccountId,
      label: 'OAuth Account',
      authType: 'oauth',
      status: healthStatus === 'auth_expired' ? 'expired' : 'connected',
      routingMode: 'priority'
    });
  }

  if (Array.isArray(backend.providerApiKeys) && backend.providerApiKeys.length > 0) {
    backend.providerApiKeys.forEach((key, index) => {
      accounts.push({
        id: `api-key-${index}`,
        label: `API Key ${index + 1}`,
        authType: 'api_key',
        status: 'connected',
        routingMode: 'round_robin'
      });
    });
  }

  // Create basic quota info if usage checking is enabled
  let quota: ProviderQuota | undefined;
  if (backend.capabilities.usageCheckEnabled && usageInfo) {
    quota = {
      quotaType: 'unknown',
      usagePercent: usageInfo.quotaExhausted ? 100 : undefined,
      hardLimitReached: usageInfo.quotaExhausted
    };
  }

  return {
    id: backend.id,
    name: backend.name,
    displayName,
    description,
    tier,
    serviceKinds,
    authTypes,
    preferredAuthType: authTypes[0],
    enabled: true, // Assume enabled if it exists in the database
    configured: accounts.length > 0,
    healthStatus,
    priority: tier === 'subscription' ? 1 : tier === 'cheap' ? 2 : tier === 'free' ? 3 : 4,
    fallbackEligible: healthStatus === 'healthy' && accounts.length > 0,
    accounts,
    quota,
    providerApiKeys: backend.providerApiKeys,
    transportMode: backend.capabilities?.transportMode,
    models: [], // Will be populated separately if needed
    createdAt: backend.createdAt,
    updatedAt: backend.updatedAt
  };
}

// API functions
export async function fetchProviders(): Promise<Provider[]> {
  try {
    // Fetch providers from backend
    const providersResponse = await apiGet('/api/providers');
    const providers: RuntimeProviderPreset[] = providersResponse.providers || [];

    // Fetch usage info for all providers
    const usagePromises = providers.map(async (provider) => {
      try {
        const usageResponse = await apiGet(`/api/providers/${provider.id}/usage`);
        return {
          providerId: provider.id,
          ...usageResponse
        } as ProviderUsageInfo;
      } catch (error) {
        // If usage check fails, return basic info
        return {
          providerId: provider.id,
          usageCheckEnabled: provider.capabilities.usageCheckEnabled,
          errorMessage: error instanceof Error ? error.message : 'Usage check failed'
        } as ProviderUsageInfo;
      }
    });

    const usageInfos = await Promise.all(usagePromises);
    const usageMap = new Map(usageInfos.map(info => [info.providerId, info]));

    // Map to frontend Provider objects
    return providers.map(provider =>
      mapBackendToFrontendProvider(provider, usageMap.get(provider.id))
    );
  } catch (error) {
    console.error('Failed to fetch providers:', error);
    throw new Error('Failed to load provider data');
  }
}

export async function fetchProviderById(id: string): Promise<Provider | null> {
  try {
    const response = await apiGet(`/api/providers/${id}`);
    if (!response.provider) {
      return null;
    }

    // Fetch usage info
    let usageInfo: ProviderUsageInfo | undefined;
    try {
      const usageResponse = await apiGet(`/api/providers/${id}/usage`);
      usageInfo = { providerId: id, ...usageResponse };
    } catch (error) {
      usageInfo = {
        providerId: id,
        usageCheckEnabled: response.provider.capabilities.usageCheckEnabled,
        errorMessage: error instanceof Error ? error.message : 'Usage check failed'
      };
    }

    return mapBackendToFrontendProvider(response.provider, usageInfo);
  } catch {
    return null;
  }
}

export async function testProvider(id: string): Promise<{ success: boolean; message: string; latencyMs?: number }> {
  try {
    const response = await apiSend(`/api/providers/${id}/test`, 'POST', {});
    return {
      success: response.success || false,
      message: response.message || 'Test completed',
      latencyMs: response.latencyMs
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Test failed'
    };
  }
}

export async function refreshProviderHealth(): Promise<void> {
  try {
    await apiSend('/api/providers/refresh-health', 'POST', {});
  } catch (error) {
    console.error('Failed to refresh provider health:', error);
    throw new Error('Failed to refresh provider health');
  }
}