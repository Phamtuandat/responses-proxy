import type { Context } from "grammy";
import type { TelegramBotConfig } from "./config.js";
import {
  formatClientConfigs,
  formatHealthStatus,
  formatModels,
  formatOauthStatus,
  formatProviderDetails,
  formatProviders,
  formatProxyError,
  formatTestResult,
} from "./format.js";
import { ProxyClientError, ResponsesProxyClient } from "./proxy-client.js";

export type BotDependencies = {
  config: TelegramBotConfig;
  proxyClient: ResponsesProxyClient;
};

export async function replyWithProxyError(ctx: Context, error: unknown): Promise<void> {
  if (error instanceof ProxyClientError) {
    await ctx.reply(formatProxyError(error.body?.error ?? error));
    return;
  }
  await ctx.reply(error instanceof Error ? error.message : "Unknown bot error");
}

export async function loadStatusText(deps: BotDependencies): Promise<string> {
  const [health, providers, promptCache, usageStats] = await Promise.all([
    deps.proxyClient.getHealth(),
    deps.proxyClient.getProviders(),
    deps.proxyClient.getLatestPromptCache(),
    deps.proxyClient.getUsageStats(),
  ]);
  const usageSummary = summarizeUsageStats(usageStats?.stats);
  return formatHealthStatus({
    ...health,
    activeProviderId: providers?.activeProviderId,
    latestPromptCache: promptCache?.latest ?? null,
    usageSummary,
  });
}

export async function loadProvidersText(deps: BotDependencies): Promise<string> {
  return formatProviders(await deps.proxyClient.getProviders());
}

export async function loadClientsText(deps: BotDependencies): Promise<string> {
  return formatClientConfigs(await deps.proxyClient.getClientConfigs());
}

export async function loadModelsText(deps: BotDependencies): Promise<string> {
  return formatModels(await deps.proxyClient.getModels());
}

export async function loadOauthStatusText(deps: BotDependencies): Promise<string> {
  return formatOauthStatus(await deps.proxyClient.getOauthStatus());
}

export async function sendStatus(ctx: Context, deps: BotDependencies): Promise<void> {
  try {
    await ctx.reply(await loadStatusText(deps));
  } catch (error) {
    await replyWithProxyError(ctx, error);
  }
}

export async function sendProviders(ctx: Context, deps: BotDependencies): Promise<void> {
  try {
    await ctx.reply(await loadProvidersText(deps));
  } catch (error) {
    await replyWithProxyError(ctx, error);
  }
}

export async function sendClients(ctx: Context, deps: BotDependencies): Promise<void> {
  try {
    await ctx.reply(await loadClientsText(deps));
  } catch (error) {
    await replyWithProxyError(ctx, error);
  }
}

export async function sendOauthStatus(ctx: Context, deps: BotDependencies): Promise<void> {
  try {
    await ctx.reply(await loadOauthStatusText(deps));
  } catch (error) {
    await replyWithProxyError(ctx, error);
  }
}

export async function sendTestResult(
  ctx: Context,
  deps: BotDependencies,
  input: { prompt: string; model?: string; providerId?: string },
): Promise<void> {
  try {
    const result = await deps.proxyClient.sendTestPrompt({
      prompt: input.prompt,
      model: input.model?.trim() || deps.config.defaultModel,
      providerId: input.providerId?.trim() || undefined,
    });
    await ctx.reply(formatTestResult(result));
  } catch (error) {
    await replyWithProxyError(ctx, error);
  }
}

export async function sendModels(ctx: Context, deps: BotDependencies): Promise<void> {
  try {
    await ctx.reply(formatModels(await deps.proxyClient.getModels()));
  } catch (error) {
    await replyWithProxyError(ctx, error);
  }
}

export async function sendProviderDetails(
  ctx: Context,
  deps: BotDependencies,
  providerId: string,
): Promise<void> {
  try {
    const payload = await deps.proxyClient.getProviderDetails(providerId);
    await ctx.reply(formatProviderDetails(payload.provider));
  } catch (error) {
    await replyWithProxyError(ctx, error);
  }
}

function summarizeUsageStats(stats: unknown): string[] {
  if (!stats || typeof stats !== "object") {
    return [];
  }
  const summary = stats as Record<string, unknown>;
  const lines: string[] = [];
  if (typeof summary.totalRequests === "number") {
    lines.push(`total requests: ${summary.totalRequests}`);
  }
  if (typeof summary.totalPromptTokens === "number") {
    lines.push(`prompt tokens: ${summary.totalPromptTokens}`);
  }
  if (typeof summary.totalCompletionTokens === "number") {
    lines.push(`completion tokens: ${summary.totalCompletionTokens}`);
  }
  return lines;
}
