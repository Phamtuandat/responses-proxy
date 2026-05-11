import type { Bot } from "grammy";
import type { AuditLogRepository } from "../../audit-log.js";
import type { CustomerKeyRepository } from "../../customer-keys.js";
import type { BotIdentityRepository } from "../bot-identity-repository.js";
import { renderCustomerActionText } from "../customer-actions.js";
import type { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";
import { formatField, formatSection } from "../message-format.js";

export function registerMeCommand(
  bot: Bot,
  identities: BotIdentityRepository,
  workspaces: CustomerWorkspaceRepository,
  customerKeys: CustomerKeyRepository,
  auditLog: AuditLogRepository,
): void {
  bot.command("me", async (ctx) => {
    const userId = ctx.from?.id?.toString();
    const chatId = ctx.chat?.id?.toString();
    const user = userId ? identities.getUser(userId) : undefined;
    const workspace = userId ? workspaces.getDefaultWorkspace(userId) : undefined;
    const keyRecord = userId
      ? customerKeys.getActiveKeyForUser(userId) ?? customerKeys.getLatestKeyForUser(userId)
      : undefined;
    const canShowApiKey = ctx.chat?.type === "private" && !!keyRecord;
    const apiKey = keyRecord && canShowApiKey ? customerKeys.getApiKeySecret(keyRecord.id) : undefined;
    if (apiKey && keyRecord) {
      auditLog.record({
        event: "api_key.revealed",
        actor: { type: "customer", id: userId },
        subjectType: "customer_api_key",
        subjectId: keyRecord.id,
        metadata: {
          telegramUserId: userId,
          workspaceId: keyRecord.workspaceId,
          keyPreview: keyRecord.apiKeyPreview,
          audience: "customer_account_page",
          apiKey,
        },
      });
    }

    await renderCustomerActionText(
      ctx,
      [
        "👤 Your account",
        formatSection("Telegram", [
          formatField("User ID", userId ?? "unknown"),
          formatField("Chat ID", chatId ?? "unknown"),
          formatField("Role", user?.role ?? "unknown"),
          formatField("Account status", formatStatus(user?.status ?? "unknown")),
        ]),
        formatSection("Workspace", [
          formatField("ID", workspace?.id ?? "none"),
          workspace ? formatField("Status", formatStatus(workspace.status)) : undefined,
          workspace ? formatField("Client route", workspace.defaultClientRoute) : undefined,
        ]),
        formatSection("API key", [
          keyRecord ? formatField("Status", formatStatus(keyRecord.status)) : formatField("Status", "none"),
          keyRecord ? formatField("Preview", keyRecord.apiKeyPreview) : undefined,
          apiKey ? `api_key: ${apiKey}` : undefined,
          keyRecord && canShowApiKey && !apiKey ? "Full key: unavailable for legacy key" : undefined,
        ]),
      ].join("\n\n"),
      keyRecord?.status === "active",
    );
  });
}

function formatStatus(value: string): string {
  return value.replace(/_/g, " ");
}
