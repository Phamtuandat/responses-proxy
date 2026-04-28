import type { Bot } from "grammy";
import type { AuditLogRepository } from "../../audit-log.js";
import type { CustomerKeyRepository } from "../../customer-keys.js";
import type { BotIdentityRepository } from "../bot-identity-repository.js";
import { renderCustomerActionText } from "../customer-actions.js";
import type { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";

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
        "Your account",
        `telegram_user_id: ${userId ?? "unknown"}`,
        `telegram_chat_id: ${chatId ?? "unknown"}`,
        `role: ${user?.role ?? "unknown"}`,
        `status: ${user?.status ?? "unknown"}`,
        workspace ? `workspace_id: ${workspace.id}` : "workspace_id: none",
        workspace ? `workspace_status: ${workspace.status}` : undefined,
        workspace ? `client_route: ${workspace.defaultClientRoute}` : undefined,
        keyRecord ? `key_status: ${keyRecord.status}` : "key_status: none",
        keyRecord ? `key_preview: ${keyRecord.apiKeyPreview}` : undefined,
        apiKey ? `api_key: ${apiKey}` : undefined,
        keyRecord && canShowApiKey && !apiKey ? "full_key: unavailable_for_legacy_key" : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
      keyRecord?.status === "active",
    );
  });
}
