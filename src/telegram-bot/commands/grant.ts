import type { Bot } from "grammy";
import { isAdmin } from "../auth.js";
import type { BillingRepository } from "../../billing.js";
import type { CustomerKeyRepository } from "../../customer-keys.js";
import type { AuditLogRepository } from "../../audit-log.js";
import type { BotIdentityRepository } from "../bot-identity-repository.js";
import type { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";
import { maskApiKey } from "../format.js";
import { grantCustomerAccess } from "../grants.js";
import { replyWithProxyError, type BotDependencies } from "../actions.js";

function formatGrantUsage(billing: BillingRepository): string {
  const planIds = billing.listPlans().map((plan) => plan.id);
  return [
    "Usage: /grant <telegramUserId> <planId> <days>",
    planIds.length > 0 ? `Available planIds: ${planIds.join(", ")}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export function registerGrantCommand(
  bot: Bot,
  deps: BotDependencies,
  identities: BotIdentityRepository,
  workspaces: CustomerWorkspaceRepository,
  customerKeys: CustomerKeyRepository,
  billing: BillingRepository,
  auditLog: AuditLogRepository,
): void {
  bot.command("grant", async (ctx) => {
    if (!isAdmin(ctx, deps.config)) {
      await ctx.reply("Only admins can grant customer access.");
      return;
    }

    const args = (ctx.match?.toString() || "").trim().split(/\s+/g).filter(Boolean);
    const [telegramUserId, planId, daysRaw] = args;
    const days = Number(daysRaw);
    if (!/^\d+$/.test(telegramUserId ?? "") || !planId || !Number.isInteger(days) || days <= 0) {
      await ctx.reply(formatGrantUsage(billing));
      return;
    }

    if (!billing.getPlan(planId)) {
      await ctx.reply(
        [
          `Unknown planId: ${planId}`,
          formatGrantUsage(billing),
        ].join("\n"),
      );
      return;
    }

    try {
      const result = await grantCustomerAccess({
        telegramUserId,
        planId,
        days,
        defaultClientRoute: deps.config.defaultCustomerRoute,
        identities,
        workspaces,
        customerKeys,
        billing,
        proxyClient: deps.proxyClient,
        auditLog,
        actor: { type: "admin", id: ctx.from?.id?.toString() },
      });

      const canShowApiKeyToAdmin = !!result.apiKey && ctx.chat?.type === "private";
      if (result.apiKey && canShowApiKeyToAdmin) {
        auditLog.record({
          event: "api_key.revealed",
          actor: { type: "admin", id: ctx.from?.id?.toString() },
          subjectType: "customer_api_key",
          subjectId: result.keyId,
          metadata: {
            telegramUserId,
            workspaceId: result.workspaceId,
            keyPreview: result.keyPreview,
            audience: "admin_private_chat",
            apiKey: result.apiKey,
          },
        });
      }

      await ctx.reply(
        [
          "Customer access granted.",
          `telegram_user_id: ${telegramUserId}`,
          `plan_id: ${planId}`,
          `client_route: ${result.clientRoute}`,
          `mode: ${result.mode}`,
          `workspace_id: ${result.workspaceId}`,
          `subscription_ends_at: ${result.subscriptionEndsAt}`,
          `key_preview: ${result.apiKey ? maskApiKey(result.apiKey) : result.keyPreview}`,
          canShowApiKeyToAdmin ? `api_key: ${result.apiKey}` : undefined,
          result.apiKey && !canShowApiKeyToAdmin
            ? "api_key_delivery: full key is only shown in a private admin chat."
            : undefined,
        ]
          .filter(Boolean)
          .join("\n"),
      );

      try {
        await ctx.api.sendMessage(
          Number(telegramUserId),
          [
            "Your Responses access is active.",
            `plan_id: ${planId}`,
            `client_route: ${result.clientRoute}`,
            `subscription_ends_at: ${result.subscriptionEndsAt}`,
            result.apiKey
              ? `api_key: ${result.apiKey}`
              : "Run /apikey in this private chat to view your current key status.",
          ].join("\n"),
        );
      } catch {
        await ctx.reply("Customer notification could not be delivered yet. They may need to /start the bot first.");
      }
    } catch (error) {
      await replyWithProxyError(ctx, error);
    }
  });
}
