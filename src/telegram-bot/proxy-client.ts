import { extractResponseText } from "./format.js";

type ProxyErrorShape = {
  error?: {
    type?: string;
    code?: string;
    message?: string;
    request_id?: string;
    upstream_status?: number;
    retryable?: boolean;
  };
};

export class ProxyClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: ProxyErrorShape | undefined,
  ) {
    super(message);
  }
}

export class ResponsesProxyClient {
  constructor(
    private readonly baseUrl: string,
    private readonly clientApiKey?: string,
    private readonly requestTimeoutMs = 30_000,
  ) {}

  async getHealth(): Promise<any> {
    return this.requestJson("/health");
  }

  async getProviders(): Promise<any> {
    return this.requestJson("/api/providers");
  }

  async getUsageStats(): Promise<any> {
    return this.requestJson("/api/stats/usage");
  }

  async getLatestPromptCache(): Promise<any> {
    return this.requestJson("/api/debug/prompt-cache/latest");
  }

  async getClientConfigs(): Promise<any> {
    return this.requestJson("/api/client-configs/status");
  }

  async setClientRouteApiKeys(input: { client: string; apiKeys: string[] }): Promise<any> {
    return this.requestJson("/api/client-route-keys", {
      method: "POST",
      body: input,
    });
  }

  async getProviderDetails(providerId: string): Promise<any> {
    return this.requestJson(`/api/providers/${encodeURIComponent(providerId)}`);
  }

  async getProviderModels(providerId: string): Promise<any> {
    return this.requestJson(`/api/provider-models?providerId=${encodeURIComponent(providerId)}`);
  }

  async setProviderRoute(input: { client: string; providerId: string }): Promise<any> {
    return this.requestJson("/api/provider-routes", {
      method: "POST",
      body: input,
    });
  }

  async applyClientConfig(input: {
    client: "hermes" | "codex";
    model: string;
    routeApiKey?: string;
  }): Promise<any> {
    return this.requestJson("/api/client-configs/apply", {
      method: "POST",
      body: {
        client: input.client,
        model: input.model,
        routeApiKey: input.routeApiKey,
      },
    });
  }

  async getOauthStatus(): Promise<any> {
    return this.requestJson("/api/chatgpt-oauth/status");
  }

  async startOauth(): Promise<any> {
    return this.requestJson("/api/chatgpt-oauth/start", { method: "POST" });
  }

  async completeOauth(callbackUrl: string): Promise<any> {
    return this.requestJson("/api/chatgpt-oauth/callback", {
      method: "POST",
      body: {
        callbackUrl,
      },
    });
  }

  async refreshAccount(accountId: string): Promise<any> {
    return this.requestJson(`/api/account-auth/accounts/${encodeURIComponent(accountId)}/refresh`, {
      method: "POST",
    });
  }

  async disableAccount(accountId: string): Promise<any> {
    return this.requestJson(`/api/account-auth/accounts/${encodeURIComponent(accountId)}/disable`, {
      method: "POST",
    });
  }

  async enableAccount(accountId: string): Promise<any> {
    return this.requestJson(`/api/account-auth/accounts/${encodeURIComponent(accountId)}/enable`, {
      method: "POST",
    });
  }

  async deleteAccount(accountId: string): Promise<any> {
    return this.requestJson(`/api/account-auth/accounts/${encodeURIComponent(accountId)}`, {
      method: "DELETE",
    });
  }

  async sendTestPrompt(input: {
    prompt: string;
    model: string;
    providerId?: string;
  }): Promise<{
    outputText: string;
    requestId: string | null;
    raw: unknown;
  }> {
    const body = await this.requestJson("/v1/responses", {
      method: "POST",
      headers: this.clientApiKey
        ? {
            Authorization: `Bearer ${this.clientApiKey}`,
          }
        : undefined,
      body: {
        model: input.model,
        input: input.prompt,
        metadata: input.providerId ? { provider_id: input.providerId } : undefined,
      },
    });
    return {
      outputText: extractResponseText(body),
      requestId: typeof body?._request_id === "string" ? body._request_id : null,
      raw: body,
    };
  }

  async getModels(): Promise<any> {
    return this.requestJson("/v1/models", {
      headers: this.clientApiKey
        ? {
            Authorization: `Bearer ${this.clientApiKey}`,
          }
        : undefined,
    });
  }

  private async requestJson(
    pathname: string,
    options?: {
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    },
  ): Promise<any> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${pathname}`, {
        method: options?.method ?? "GET",
        headers: {
          "content-type": "application/json",
          ...(options?.headers ?? {}),
        },
        body: options?.body ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new ProxyClientError("Proxy request timed out", 504, {
          error: {
            type: "proxy_error",
            code: "BOT_PROXY_REQUEST_TIMEOUT",
            message: `Proxy request timed out after ${this.requestTimeoutMs}ms`,
            retryable: true,
          },
        });
      }
      throw new ProxyClientError(
        error instanceof Error ? error.message : "Could not reach responses-proxy",
        502,
        {
          error: {
            type: "proxy_error",
            code: "BOT_PROXY_REQUEST_FAILED",
            message: error instanceof Error ? error.message : "Could not reach responses-proxy",
            retryable: true,
          },
        },
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    const body = isJson ? ((await response.json()) as ProxyErrorShape) : undefined;

    if (!response.ok) {
      const message = body?.error?.message || `Proxy request failed with status ${response.status}`;
      throw new ProxyClientError(message, response.status, body);
    }

    return body;
  }
}
