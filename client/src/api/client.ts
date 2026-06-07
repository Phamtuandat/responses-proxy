import type {
  ChatGptOAuthStatusResponse,
  ChatGptOAuthStartResponse,
  DashboardAuthApprovalStatusResponse,
  DashboardAuthRequestApprovalResponse,
  ChatGptOAuthCallbackResponse,
  DashboardAuthRequestOtpResponse,
  DashboardAuthSessionResponse,
  DashboardAuthVerifyResponse,
  ClientConfigApplyInput,
  ClientConfigApplyResponse,
  ClientMutationInput,
  ClientMutationResponse,
  ClientConfigsStatusResponse,
  ClientTokenLimitResponse,
  ClientTokenLimitsResponse,
  EndpointInfoResponse,
  HealthResponse,
  KiroAccountsResponse,
  KiroAccountResponse,
  KiroAccountUpdateInput,
  KiroAccountDeleteResponse,
  KiroDevicePollResponse,
  KiroDeviceStartInput,
  KiroDeviceStartResponse,
  KiroImportInput,
  KiroImportResponse,
  KiroStatus,
  LiveUsageResponse,
  ModelComboDeleteResponse,
  ModelComboInput,
  ModelComboResponse,
  ModelCombosResponse,
  ProviderDeleteResponse,
  ProviderModelsResponse,
  ProviderMutationInput,
  ProviderMutationResponse,
  PromptCacheLatestResponse,
  ProvidersResponse,
  RtkPolicyInput,
  RtkPolicyMutationResponse,
  UsageStatsResponse,
  AuditLogsResponse,
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

export function getDashboardAuthSession() {
  return apiGet<DashboardAuthSessionResponse>("/api/dashboard-auth/session");
}

export function requestDashboardOtp() {
  return apiSend<DashboardAuthRequestOtpResponse>("/api/dashboard-auth/request-otp", "POST");
}

export function verifyDashboardOtp(otp: string) {
  return apiSend<DashboardAuthVerifyResponse>("/api/dashboard-auth/verify", "POST", { otp });
}

export function requestDashboardApproval() {
  return apiSend<DashboardAuthRequestApprovalResponse>("/api/dashboard-auth/request-approval", "POST");
}

export function getDashboardApprovalStatus(challengeId: string, pollToken: string) {
  const query = new URLSearchParams({ challengeId, pollToken });
  return apiGet<DashboardAuthApprovalStatusResponse>(`/api/dashboard-auth/approval-status?${query.toString()}`);
}

export function logoutDashboard() {
  return apiSend<{ ok: true }>("/api/dashboard-auth/logout", "POST");
}

export function getHealth() {
  return apiGet<HealthResponse>("/health");
}

export function deleteConsoleLogs() {
  return apiSend<{ ok: boolean }>("/api/console-logs", "DELETE");
}

export function getEndpointInfo() {
  return apiGet<EndpointInfoResponse>("/api/endpoint-info");
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

export function toggleProviderEnabled(providerId: string, enabled: boolean) {
  return apiSend<ProviderMutationResponse>(`/api/providers/${encodeURIComponent(providerId)}/toggle-enabled`, "POST", { enabled });
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

export function getLiveUsage() {
  return apiGet<LiveUsageResponse>("/api/providers/live-usage");
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

// Kiro API functions
export function getKiroStatus() {
  return apiGet<KiroStatus>("/api/kiro/status");
}

export function getKiroAccounts() {
  return apiGet<KiroAccountsResponse>("/api/kiro/accounts");
}

export function getKiroAccount(accountId: string) {
  return apiGet<KiroAccountResponse>(`/api/kiro/accounts/${encodeURIComponent(accountId)}`);
}

export function refreshKiroAccount(accountId: string) {
  return apiSend<KiroAccountResponse>(
    `/api/kiro/accounts/${encodeURIComponent(accountId)}/refresh`,
    "POST",
  );
}

export function updateKiroAccount(accountId: string, updates: KiroAccountUpdateInput) {
  return apiSend<KiroAccountResponse>(
    `/api/kiro/accounts/${encodeURIComponent(accountId)}`,
    "PATCH",
    updates,
  );
}

export function deleteKiroAccount(accountId: string) {
  return apiSend<KiroAccountDeleteResponse>(
    `/api/kiro/accounts/${encodeURIComponent(accountId)}`,
    "DELETE",
  );
}

export function importKiroAccounts(input?: KiroImportInput) {
  return apiSend<KiroImportResponse>("/api/kiro/import", "POST", input);
}

export function getKiroModelAliases() {
  return apiGet<{ ok: boolean; aliases: Record<string, string> }>("/api/kiro/model-aliases");
}

export function addKiroModelAlias(alias: string, target: string) {
  return apiSend<{ ok: boolean; aliases: Record<string, string> }>("/api/kiro/model-aliases", "PUT", { alias, target });
}

export function deleteKiroModelAlias(alias: string) {
  return apiSend<{ ok: boolean; aliases: Record<string, string> }>(`/api/kiro/model-aliases/${encodeURIComponent(alias)}`, "DELETE");
}

export function testKiroModel(model: string) {
  return apiSend<{ ok: boolean; model: string; resolvedModel?: string; accountId?: string; region?: string; latencyMs?: number; error?: string }>("/api/kiro/models/test", "POST", { model });
}

export function getAuditLogs(params?: { limit?: number; event?: string; subjectId?: string }) {
  const query = new URLSearchParams();
  if (params?.limit) query.append("limit", String(params.limit));
  if (params?.event) query.append("event", params.event);
  if (params?.subjectId) query.append("subjectId", params.subjectId);
  const search = query.toString() ? `?${query.toString()}` : "";
  return apiGet<AuditLogsResponse>(`/api/debug/audit-logs${search}`);
}

// Kiro Device Login API functions
export function startKiroDeviceLogin(input: KiroDeviceStartInput) {
  return apiSend<KiroDeviceStartResponse>("/api/kiro/device/start", "POST", input);
}

export function pollKiroDeviceLogin(sessionId: string) {
  return apiSend<KiroDevicePollResponse>("/api/kiro/device/poll", "POST", { sessionId });
}

// ─── Model Combos (9Router-style) ────────────────────────────────────────────

export function getModelCombos(kind?: string) {
  const search = kind !== undefined ? `?kind=${encodeURIComponent(kind)}` : "";
  return apiGet<ModelCombosResponse>(`/api/model-combos${search}`);
}

export function getModelCombo(id: string) {
  return apiGet<ModelComboResponse>(`/api/model-combos/${encodeURIComponent(id)}`);
}

export function createModelCombo(input: ModelComboInput) {
  return apiSend<ModelComboResponse>("/api/model-combos", "POST", input);
}

export function updateModelCombo(id: string, input: Partial<ModelComboInput>) {
  return apiSend<ModelComboResponse>(`/api/model-combos/${encodeURIComponent(id)}`, "PUT", input);
}

export function deleteModelCombo(id: string) {
  return apiSend<ModelComboDeleteResponse>(`/api/model-combos/${encodeURIComponent(id)}`, "DELETE");
}

// ─── MITM Model Mappings ─────────────────────────────────────────────────────

export function getMitmMappings(tool: string) {
  return apiGet<{ ok: boolean; tool: string; mappings: Record<string, string> }>(
    `/api/cli-tools/mitm-mappings?tool=${encodeURIComponent(tool)}`,
  );
}

export function setMitmMappings(tool: string, mappings: Record<string, string>) {
  return apiSend<{ ok: boolean; tool: string; mappings: Record<string, string> }>(
    "/api/cli-tools/mitm-mappings",
    "PUT",
    { tool, mappings },
  );
}
