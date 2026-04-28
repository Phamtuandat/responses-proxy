import type {
  ChatGptOAuthStatusResponse,
  ClientMutationInput,
  ClientMutationResponse,
  ClientConfigsStatusResponse,
  ClientTokenLimitResponse,
  ClientTokenLimitsResponse,
  HealthResponse,
  ProviderDeleteResponse,
  ProviderMutationInput,
  ProviderMutationResponse,
  PromptCacheLatestResponse,
  ProvidersResponse,
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

export async function apiSend<T>(path: string, method: "POST" | "PUT" | "DELETE", body?: unknown): Promise<T> {
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

export function getPromptCacheLatest() {
  return apiGet<PromptCacheLatestResponse>("/api/debug/prompt-cache/latest");
}

export function getChatGptOAuthStatus() {
  return apiGet<ChatGptOAuthStatusResponse>("/api/chatgpt-oauth/status");
}

export function getClientConfigsStatus() {
  return apiGet<ClientConfigsStatusResponse>("/api/client-configs/status");
}
