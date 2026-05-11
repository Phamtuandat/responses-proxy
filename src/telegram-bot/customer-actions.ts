import { InlineKeyboard, type Bot, type Context } from "grammy";
import type { AuditLogRepository } from "../audit-log.js";
import type { BillingRepository } from "../billing.js";
import type { CustomerKeyRepository } from "../customer-keys.js";
import { answerCallbackQuerySafely, replyOrEditMessage } from "./callbacks.js";
import { readCustomerBillingOverview, type CustomerBillingOverview } from "./customer-billing.js";
import type { CustomerWorkspaceRepository } from "./customer-workspace-repository.js";
import { formatDateTime, formatField, formatMessage, formatSection } from "./message-format.js";

export type CustomerActionView = "dashboard" | "key" | "usage" | "quota";

export function buildCustomerActionKeyboard(hasActiveKey: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("🔐 View key", "v1:customer:key")
    .text("📊 Usage", "v1:customer:usage")
    .row()
    .text("🧾 Quota", "v1:customer:quota")
    .text(hasActiveKey ? "⏱ Renew 24h" : "💳 Buy API key", "v1:renew:open");
  if (hasActiveKey) {
    keyboard.row().text("➕ Buy tokens", "v1:topup:open");
  }
  return keyboard.row().text("🔄 Refresh", "v1:customer:dashboard");
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
    await renderCustomerActionText(ctx, formatMessage("⚠️ Workspace not ready", ["No customer workspace has been assigned to your Telegram user yet."]), false);
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
    return formatCustomerMessage("🔐 Your API key", [
      formatWorkspaceSection(overview),
      formatSection("API key", [
        overview.apiKey ? formatField("Status", formatStatus(overview.apiKey.status)) : formatField("Status", "none"),
        overview.apiKey ? formatField("Preview", overview.apiKey.apiKeyPreview) : undefined,
        formatField("Client route", overview.workspace?.defaultClientRoute ?? overview.apiKey?.clientRoute ?? "none"),
      ]),
      formatSection("Copy value", [
      apiKey ? `api_key: ${apiKey}` : undefined,
        overview.apiKey && !apiKey ? "Full key: unavailable for legacy key" : undefined,
      ]),
    ]);
  }

  if (view === "usage") {
    const lotLines = formatTokenLotLines(overview);
    return formatCustomerMessage("📊 Usage", [
      formatWorkspaceSection(overview),
      formatSection("Entitlement", [
        formatField("Status", formatStatus(overview.entitlementStatus)),
        overview.entitlement ? formatField("Period start", formatDateTime(overview.entitlement.validFrom)) : undefined,
        overview.entitlement ? formatField("Period end", formatDateTime(overview.entitlement.validUntil)) : undefined,
      ]),
      formatUsageSection(overview),
      lotLines.length > 0 ? formatSection("Token lots", lotLines) : undefined,
      formatApiKeySummarySection(overview),
    ]);
  }

  if (view === "quota") {
    const lotLines = formatTokenLotLines(overview);
    return formatCustomerMessage("🧾 Quota", [
      formatWorkspaceSection(overview),
      formatSection("Entitlement", [
        formatField("Status", formatStatus(overview.entitlementStatus)),
        overview.entitlement ? formatField("Expires at", formatDateTime(overview.entitlement.validUntil)) : undefined,
      ]),
      formatUsageSection(overview),
      lotLines.length > 0 ? formatSection("Token lots", lotLines) : undefined,
      formatApiKeySummarySection(overview),
    ]);
  }

  return formatCustomerMessage("🏠 Dashboard", [
    formatWorkspaceSection(overview),
    formatSection("Access", [
      formatField("Entitlement", formatStatus(overview.entitlementStatus)),
      overview.entitlement ? formatField("Expires at", formatDateTime(overview.entitlement.validUntil)) : undefined,
      overview.apiKey ? formatField("API key", formatStatus(overview.apiKey.status)) : formatField("API key", "none"),
      overview.apiKey ? formatField("Key preview", overview.apiKey.apiKeyPreview) : undefined,
    ]),
    formatUsageSection(overview),
    overview.tokenLots.length > 0 ? formatSection("Token lots", formatTokenLotLines(overview)) : undefined,
  ]);
}

function formatCustomerMessage(title: string, blocks: Array<string | undefined | false | null>): string {
  return [title, ...blocks.filter(Boolean)].join("\n\n");
}

function formatWorkspaceSection(overview: CustomerBillingOverview): string {
  return formatSection("Workspace", [
    formatField("ID", overview.workspace?.id ?? "none"),
    formatField("Status", formatStatus(overview.workspace?.status ?? "none")),
    formatField("Client route", overview.workspace?.defaultClientRoute ?? "none"),
  ]);
}

function formatApiKeySummarySection(overview: CustomerBillingOverview): string {
  return formatSection("API key", [
    overview.apiKey ? formatField("Status", formatStatus(overview.apiKey.status)) : formatField("Status", "none"),
    overview.apiKey ? formatField("Preview", overview.apiKey.apiKeyPreview) : undefined,
  ]);
}

function formatUsageSection(overview: CustomerBillingOverview): string {
  const limit = overview.tokenLots.length > 0
    ? overview.tokenLots.reduce((sum, lot) => sum + lot.entitlement.monthlyTokenLimit, 0)
    : overview.entitlement?.monthlyTokenLimit;

  return formatSection("Tokens", [
    formatField("Input", formatTokenCount(overview.usage.inputTokens)),
    formatField("Output", formatTokenCount(overview.usage.outputTokens)),
    formatField("Used", formatTokenCount(overview.usage.totalTokens)),
    typeof limit === "number" ? formatField("Limit", formatTokenCount(limit)) : undefined,
    overview.remainingTokens !== null ? formatField("Remaining", formatTokenCount(overview.remainingTokens)) : undefined,
  ]);
}

function formatTokenLotLines(overview: CustomerBillingOverview): string[] {
  if (overview.tokenLots.length === 0) {
    return [];
  }
  return overview.tokenLots.map((lot, index) =>
    `• Lot ${index + 1}: ${formatTokenCount(lot.remainingTokens)} remaining / ${formatTokenCount(lot.entitlement.monthlyTokenLimit)} limit, expires ${formatDateTime(lot.entitlement.validUntil)}`,
  );
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatStatus(value: string): string {
  return value.replace(/_/g, " ");
}
