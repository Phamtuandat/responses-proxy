import { InlineKeyboard, type Bot, type Context } from "grammy";
import type { AuditLogRepository } from "../audit-log.js";
import type { BillingRepository } from "../billing.js";
import type { CustomerKeyRepository } from "../customer-keys.js";
import { answerCallbackQuerySafely, replyOrEditMessage } from "./callbacks.js";
import { readCustomerBillingOverview, type CustomerBillingOverview } from "./customer-billing.js";
import type { CustomerWorkspaceRepository } from "./customer-workspace-repository.js";

export type CustomerActionView = "dashboard" | "key" | "usage" | "quota";

export function buildCustomerActionKeyboard(hasActiveKey: boolean): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔐 View key", "v1:customer:key")
    .text("📊 Usage", "v1:customer:usage")
    .row()
    .text("🧾 Quota", "v1:customer:quota")
    .text(hasActiveKey ? "🔵 Renew" : "🟢 New", "v1:renew:open")
    .row()
    .text("🔄 Refresh", "v1:customer:dashboard");
}

export function registerCustomerActionCallbacks(
  bot: Bot,
  workspaces: CustomerWorkspaceRepository,
  customerKeys: CustomerKeyRepository,
  billing: BillingRepository,
  auditLog: AuditLogRepository,
): void {
  bot.callbackQuery(/^v1:customer:(dashboard|key|usage|quota)$/, async (ctx) => {
    const view = ctx.match[1] as CustomerActionView;
    await answerCallbackQuerySafely(ctx, { text: view === "dashboard" ? "Refreshed" : "Loaded" });
    await replyWithCustomerView(ctx, view, workspaces, customerKeys, billing, auditLog);
  });
}

export async function renderCustomerActionText(
  ctx: Context,
  text: string,
  hasActiveKey: boolean,
): Promise<void> {
  await replyOrEditMessage(ctx, text, {
    reply_markup: buildCustomerActionKeyboard(hasActiveKey),
  });
}

export async function replyWithCustomerView(
  ctx: Context,
  view: CustomerActionView,
  workspaces: CustomerWorkspaceRepository,
  customerKeys: CustomerKeyRepository,
  billing: BillingRepository,
  auditLog?: AuditLogRepository,
): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await replyOrEditMessage(ctx, "For safety, open a private chat with this bot.");
    return;
  }

  const userId = ctx.from?.id?.toString();
  if (!userId) {
    await replyOrEditMessage(ctx, "Could not determine your Telegram user.");
    return;
  }

  const overview = readCustomerBillingOverview({
    telegramUserId: userId,
    workspaces,
    customerKeys,
    billing,
  });

  if (!overview.workspace) {
    await renderCustomerActionText(ctx, "No customer workspace has been assigned to your Telegram user yet.", false);
    return;
  }

  await renderCustomerActionText(
    ctx,
    formatCustomerView(view, userId, overview, customerKeys, auditLog),
    overview.apiKey?.status === "active",
  );
}

function formatCustomerView(
  view: CustomerActionView,
  userId: string,
  overview: CustomerBillingOverview,
  customerKeys: CustomerKeyRepository,
  auditLog?: AuditLogRepository,
): string {
  if (view === "key") {
    const apiKey = overview.apiKey ? customerKeys.getApiKeySecret(overview.apiKey.id) : undefined;
    if (apiKey && overview.apiKey) {
      auditLog?.record({
        event: "api_key.revealed",
        actor: { type: "customer", id: userId },
        subjectType: "customer_api_key",
        subjectId: overview.apiKey.id,
        metadata: {
          telegramUserId: userId,
          workspaceId: overview.apiKey.workspaceId,
          keyPreview: overview.apiKey.apiKeyPreview,
          audience: "customer_action_key",
          apiKey,
        },
      });
    }
    return [
      "Your Responses API key",
      `client_route: ${overview.workspace?.defaultClientRoute ?? overview.apiKey?.clientRoute ?? "none"}`,
      overview.apiKey ? `key_status: ${overview.apiKey.status}` : "key_status: none",
      overview.apiKey ? `key_preview: ${overview.apiKey.apiKeyPreview}` : undefined,
      apiKey ? `api_key: ${apiKey}` : undefined,
      overview.apiKey && !apiKey ? "full_key: unavailable_for_legacy_key" : undefined,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (view === "usage") {
    return [
      "Your usage",
      `workspace_id: ${overview.workspace?.id ?? "none"}`,
      `workspace_status: ${overview.workspace?.status ?? "none"}`,
      `client_route: ${overview.workspace?.defaultClientRoute ?? "none"}`,
      `entitlement_status: ${overview.entitlementStatus}`,
      overview.entitlement ? `period_start: ${overview.entitlement.validFrom}` : undefined,
      overview.entitlement ? `period_end: ${overview.entitlement.validUntil}` : undefined,
      `input_tokens: ${overview.usage.inputTokens}`,
      `output_tokens: ${overview.usage.outputTokens}`,
      `used_tokens: ${overview.usage.totalTokens}`,
      overview.entitlement ? `token_limit: ${overview.entitlement.monthlyTokenLimit}` : undefined,
      overview.remainingTokens !== null ? `remaining_tokens: ${overview.remainingTokens}` : undefined,
      overview.apiKey ? `key_status: ${overview.apiKey.status}` : "key_status: none",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (view === "quota") {
    return [
      "Your quota",
      `workspace_id: ${overview.workspace?.id ?? "none"}`,
      `entitlement_status: ${overview.entitlementStatus}`,
      overview.entitlement ? `token_limit: ${overview.entitlement.monthlyTokenLimit}` : undefined,
      `used_tokens: ${overview.usage.totalTokens}`,
      overview.remainingTokens !== null ? `remaining_tokens: ${overview.remainingTokens}` : undefined,
      overview.entitlement ? `expires_at: ${overview.entitlement.validUntil}` : undefined,
      overview.apiKey ? `key_status: ${overview.apiKey.status}` : "key_status: none",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "Your dashboard",
    `workspace_id: ${overview.workspace?.id ?? "none"}`,
    `workspace_status: ${overview.workspace?.status ?? "none"}`,
    `client_route: ${overview.workspace?.defaultClientRoute ?? "none"}`,
    `entitlement_status: ${overview.entitlementStatus}`,
    overview.entitlement ? `expires_at: ${overview.entitlement.validUntil}` : undefined,
    overview.remainingTokens !== null ? `remaining_tokens: ${overview.remainingTokens}` : undefined,
    overview.apiKey ? `key_status: ${overview.apiKey.status}` : "key_status: none",
    overview.apiKey ? `key_preview: ${overview.apiKey.apiKeyPreview}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}
