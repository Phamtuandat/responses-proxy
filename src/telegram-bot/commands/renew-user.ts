import type { Bot, Context } from "grammy";
import { isAdmin } from "../auth.js";
import type { BillingRepository } from "../../billing.js";
import type { CustomerKeyRepository } from "../../customer-keys.js";
import type { AuditLogRepository } from "../../audit-log.js";
import type { BotIdentityRepository } from "../bot-identity-repository.js";
import type { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";
import { maskApiKey } from "../format.js";
import { renewCustomerAccess } from "../grants.js";
import { replyWithProxyError, type BotDependencies } from "../actions.js";

export function registerRenewUserCommand(
  bot: Bot,
  deps: BotDependencies,
  identities: BotIdentityRepository,
  workspaces: CustomerWorkspaceRepository,
  customerKeys: CustomerKeyRepository,
  billing: BillingRepository,
  auditLog: AuditLogRepository,
): void {
  bot.command("renewuser", async (ctx) => {
    if (!isAdmin(ctx, deps.config)) {
      await ctx.reply("Only admins can renew customer access.");
      return;
    }

    const parsed = parseRenewUserArgs(ctx.match?.toString() || "");
    if (!parsed) {
      await ctx.reply("Usage: /renewuser <telegramUserId> <planId> <days> [replace-key]");
      return;
    }

    try {
      const result = await renewCustomerAccess({
        telegramUserId: parsed.telegramUserId,
        planId: parsed.planId,
        days: parsed.days,
        replaceKey: parsed.replaceKey,
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
            telegramUserId: parsed.telegramUserId,
            workspaceId: result.workspaceId,
            keyPreview: result.keyPreview,
            audience: "admin_private_chat",
            apiKey: result.apiKey,
          },
        });
      }
      await ctx.reply(
        [
          "Customer access renewed.",
          `telegram_user_id: ${parsed.telegramUserId}`,
          `plan_id: ${parsed.planId}`,
          `client_route: ${result.clientRoute}`,
          `mode: ${result.mode}`,
          `workspace_id: ${result.workspaceId}`,
          `subscription_ends_at: ${result.subscriptionEndsAt}`,
          `key_preview: ${result.apiKey ? maskApiKey(result.apiKey) : result.keyPreview}`,
          canShowApiKeyToAdmin ? `api_key: ${result.apiKey}` : undefined,
          result.apiKey && !canShowApiKeyToAdmin
            ? "api_key_delivery: replacement key is only shown in a private chat."
            : undefined,
        ]
          .filter(Boolean)
          .join("\n"),
      );

      await notifyCustomer(ctx, parsed.telegramUserId, parsed.planId, result);
    } catch (error) {
      await replyWithProxyError(ctx, error);
    }
  });
}

type ParsedRenewUserArgs = {
  telegramUserId: string;
  planId: string;
  days: number;
  replaceKey: boolean;
};

function parseRenewUserArgs(raw: string): ParsedRenewUserArgs | undefined {
  const args = raw.trim().split(/\s+/g).filter(Boolean);
  const [telegramUserId, planId, daysRaw, replaceKeyRaw] = args;
  const days = Number(daysRaw);
  if (!/^\d+$/.test(telegramUserId ?? "") || !planId || !Number.isInteger(days) || days <= 0) {
    return undefined;
  }
  if (replaceKeyRaw && replaceKeyRaw !== "replace-key") {
    return undefined;
  }
  return {
    telegramUserId,
    planId,
    days,
    replaceKey: replaceKeyRaw === "replace-key",
  };
}

async function notifyCustomer(
  ctx: Context,
  telegramUserId: string,
  planId: string,
  result: {
    clientRoute: string;
    subscriptionEndsAt: string;
    apiKey?: string;
  },
): Promise<void> {
  try {
    await ctx.api.sendMessage(
      Number(telegramUserId),
      [
        "Your Responses access has been renewed.",
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
}
