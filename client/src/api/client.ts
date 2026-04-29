import type {
  ChatGptOAuthStatusResponse,
  ChatGptOAuthStartResponse,
  ChatGptOAuthCallbackResponse,
  ClientConfigApplyInput,
  ClientConfigApplyResponse,
  ClientMutationInput,
  ClientMutationResponse,
  ClientConfigsStatusResponse,
  ClientTokenLimitResponse,
  ClientTokenLimitsResponse,
  HealthResponse,
  ProviderDeleteResponse,
  ProviderModelsResponse,
  ProviderMutationInput,
  ProviderMutationResponse,
  PromptCacheLatestResponse,
  ProvidersResponse,
  RtkPolicyInput,
  RtkPolicyMutationResponse,
  UsageStatsResponse,
} from "./types";

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function apiSend<T>(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = (await response.json().catch(() => undefined)) as
    | { error?: { message?: string } }
    | undefined;

  if (!response.ok) {
    throw new Error(payload?.error?.message || `${method} ${path} failed: ${response.status}`);
  }

  return payload as T;
}

export function getHealth() {
  return apiGet<HealthResponse>("/health");
}

export function getProviders() {
  return apiGet<ProvidersResponse>("/api/providers");
}

export function createProvider(input: ProviderMutationInput) {
  return apiSend<ProviderMutationResponse>("/api/providers", "POST", input);
}

export function updateProvider(providerId: string, input: ProviderMutationInput) {
  return apiSend<ProviderMutationResponse>(`/api/providers/${encodeURIComponent(providerId)}`, "PUT", input);
}

export function deleteProvider(providerId: string) {
  return apiSend<ProviderDeleteResponse>(`/api/providers/${encodeURIComponent(providerId)}`, "DELETE");
}

export function createClient(input: ClientMutationInput) {
  return apiSend<ClientMutationResponse>("/api/clients", "POST", input);
}

export function updateClient(clientKey: string, input: ClientMutationInput) {
  return apiSend<ClientMutationResponse>(`/api/clients/${encodeURIComponent(clientKey)}`, "PUT", input);
}

export function deleteClient(clientKey: string) {
  return apiSend<ClientMutationResponse>(`/api/clients/${encodeURIComponent(clientKey)}`, "DELETE");
}

export function getClientTokenLimits() {
  return apiGet<ClientTokenLimitsResponse>("/api/client-token-limits");
}

export function updateClientTokenLimit(clientKey: string, input: {
  enabled: boolean;
  tokenLimit: number;
  windowType: "daily" | "weekly" | "monthly" | "fixed";
  windowSizeSeconds?: number;
  hardBlock: boolean;
}) {
  return apiSend<ClientTokenLimitResponse>(
    `/api/client-token-limits/${encodeURIComponent(clientKey)}`,
    "PUT",
    input,
  );
}

export function getUsageStats() {
  return apiGet<UsageStatsResponse>("/api/stats/usage");
}

export function updateRtkPolicy(client: string, policy: RtkPolicyInput) {
  return apiSend<RtkPolicyMutationResponse>("/api/rtk-policies", "POST", {
    client,
    policy,
  });
}

export function getPromptCacheLatest(providerId?: string) {
  const search = providerId ? `?providerId=${encodeURIComponent(providerId)}` : "";
  return apiGet<PromptCacheLatestResponse>(`/api/debug/prompt-cache/latest${search}`);
}

export function getChatGptOAuthStatus() {
  return apiGet<ChatGptOAuthStatusResponse>("/api/chatgpt-oauth/status");
}

export function startChatGptOAuth() {
  return apiSend<ChatGptOAuthStartResponse>("/api/chatgpt-oauth/start", "POST");
}

export function submitChatGptOAuthCallback(input: { redirectUrl: string }) {
  return apiSend<ChatGptOAuthCallbackResponse>("/api/chatgpt-oauth/callback", "POST", input);
}

export function updateChatGptOAuthSettings(input: { rotationMode: string }) {
  return apiSend<ChatGptOAuthStatusResponse>("/api/chatgpt-oauth/settings", "PATCH", input);
}

export function refreshAccount(accountId: string) {
  return apiSend<ChatGptOAuthStatusResponse>(
    `/api/account-auth/accounts/${encodeURIComponent(accountId)}/refresh`,
    "POST",
  );
}

export function enableAccount(accountId: string) {
  return apiSend<ChatGptOAuthStatusResponse>(
    `/api/account-auth/accounts/${encodeURIComponent(accountId)}/enable`,
    "POST",
  );
}

export function disableAccount(accountId: string) {
  return apiSend<ChatGptOAuthStatusResponse>(
    `/api/account-auth/accounts/${encodeURIComponent(accountId)}/disable`,
    "POST",
  );
}

export function deleteAccount(accountId: string) {
  return apiSend<ChatGptOAuthStatusResponse>(
    `/api/account-auth/accounts/${encodeURIComponent(accountId)}`,
    "DELETE",
  );
}

export function getClientConfigsStatus() {
  return apiGet<ClientConfigsStatusResponse>("/api/client-configs/status");
}

export function applyClientConfig(input: ClientConfigApplyInput) {
  return apiSend<ClientConfigApplyResponse>("/api/client-configs/apply", "POST", input);
}

export function getProviderModels(providerId: string) {
  return apiGet<ProviderModelsResponse>(`/api/provider-models?providerId=${encodeURIComponent(providerId)}`);
}
