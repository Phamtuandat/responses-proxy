import type {
  ChatGptOAuthStatusResponse,
  ClientConfigsStatusResponse,
  HealthResponse,
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

export function getHealth() {
  return apiGet<HealthResponse>("/health");
}

export function getProviders() {
  return apiGet<ProvidersResponse>("/api/providers");
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
