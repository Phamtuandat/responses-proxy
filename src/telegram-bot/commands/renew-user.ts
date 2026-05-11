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
import { formatField, formatSection } from "../message-format.js";
import { sendCustomerCodexSetup } from "../codex-config-delivery.js";

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
          "Customer access renewed",
          formatSection("Customer", [
            formatField("Telegram user ID", parsed.telegramUserId),
            formatField("Plan", parsed.planId),
            formatField("Client route", result.clientRoute),
            formatField("Mode", result.mode),
          ]),
          formatSection("Workspace", [
            formatField("Workspace ID", result.workspaceId),
            formatField("Subscription ends at", result.subscriptionEndsAt),
          ]),
          formatSection("Key", [
            formatField("Preview", result.apiKey ? maskApiKey(result.apiKey) : result.keyPreview),
            canShowApiKeyToAdmin ? `api_key: ${result.apiKey}` : undefined,
            result.apiKey && !canShowApiKeyToAdmin
              ? "Full key: replacement key is shown only in private chat"
              : undefined,
          ]),
        ]
          .filter(Boolean)
          .join("\n\n"),
      );

      const customerNotified = await notifyCustomer(
        ctx,
        parsed.telegramUserId,
        parsed.planId,
        deps.config.publicResponsesBaseUrl,
        deps.config.defaultModel,
        result,
      );
      if (result.apiKey && customerNotified) {
        auditLog.record({
          event: "api_key.revealed",
          actor: { type: "bot", id: "renewuser" },
          subjectType: "customer_api_key",
          subjectId: result.keyId,
          metadata: {
            telegramUserId: parsed.telegramUserId,
            workspaceId: result.workspaceId,
            keyPreview: result.keyPreview,
            audience: "customer_private_chat",
            apiKey: result.apiKey,
          },
        });
      }
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
  baseUrl: string,
  model: string,
  result: {
    clientRoute: string;
    subscriptionEndsAt: string;
    apiKey?: string;
  },
): Promise<boolean> {
  if (result.apiKey) {
    const sent = await sendCustomerCodexSetup(ctx, {
      telegramUserId,
      baseUrl,
      apiKey: result.apiKey,
      model,
      title: "Your access has been renewed",
      details: [
        formatField("Plan ID", planId),
        formatField("Client route", result.clientRoute),
        formatField("Subscription ends at", result.subscriptionEndsAt),
      ],
    });
    if (sent) {
      return true;
    }
  }

  try {
    await ctx.api.sendMessage(
      Number(telegramUserId),
      [
        "Your access has been renewed",
        "Run /apikey in this private chat to receive your Codex config files.",
      ].join("\n\n"),
    );
    return true;
  } catch {
    await ctx.reply("Customer notification could not be delivered yet. They may need to /start the bot first.");
    return false;
  }
}
