import { InlineKeyboard, type Bot } from "grammy";
import type { BillingRepository, RenewalRequestRecord } from "../../billing.js";
import type { CustomerKeyRepository } from "../../customer-keys.js";
import {
  ADMIN_CALLBACK_PATTERN,
  buildAdminStartKeyboard,
  buildApplyClientKeyboard,
  renderAdminScreen,
  type AdminActionLoop,
  type AdminCallbackAction,
} from "../admin-actions.js";
import {
  loadClientsText,
  loadModelsText,
  loadOauthStatusText,
  loadProvidersText,
  loadStatusText,
  replyWithProxyError,
  type BotDependencies,
} from "../actions.js";
import { isAdmin } from "../auth.js";
import type { BotIdentityRepository } from "../bot-identity-repository.js";
import { answerCallbackQuerySafely } from "../callbacks.js";
import { renderCustomerActionText } from "../customer-actions.js";
import type { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";
import { buildAdminKeyListKeyboard } from "./apikey.js";

type AdminActionDefinition = {
  run: (ctx: Parameters<Bot["command"]>[1] extends infer _T ? any : never) => Promise<void>;
  loop?: AdminActionLoop;
};

export function registerStartCommand(
  bot: Bot,
  deps: BotDependencies,
  identities: BotIdentityRepository,
  workspaces: CustomerWorkspaceRepository,
  customerKeys: CustomerKeyRepository,
  billing: BillingRepository,
): void {
  bot.command("start", async (ctx) => {
    if (isAdmin(ctx, deps.config)) {
      await ctx.reply(formatAdminStartPanel(), {
        reply_markup: buildAdminStartKeyboard(),
      });
      return;
    }

    const userId = ctx.from?.id?.toString();
    const chatId = ctx.chat?.id?.toString();
    const user = userId ? identities.getUser(userId) : undefined;
    const activeKey = userId ? customerKeys.getActiveKeyForUser(userId) : undefined;
    const workspace =
      userId && deps.config.publicSignupEnabled
        ? workspaces.ensureDefaultWorkspace({
            ownerTelegramUserId: userId,
            telegramChatId: chatId,
            defaultClientRoute: deps.config.defaultCustomerRoute,
            status: deps.config.requireAdminApproval ? "pending_approval" : "active",
          })
        : undefined;

    await renderCustomerActionText(
      ctx,
      [
        "Responses Proxy bot is ready.",
        user ? `account: ${user.status}` : undefined,
        workspace ? `workspace: ${workspace.status}` : undefined,
        "Use /help to see available commands.",
      ]
        .filter(Boolean)
        .join("\n"),
      !!activeKey,
    );
  });

  const adminActions: Record<AdminCallbackAction, AdminActionDefinition> = {
    status: {
      loop: "proxy",
      run: async (ctx) => {
        await renderAdminScreen(ctx, {
          text: await loadStatusText(deps),
          loop: "proxy",
        });
      },
    },
    clients: {
      loop: "config",
      run: async (ctx) => {
        await renderAdminScreen(ctx, {
          text: await loadClientsText(deps),
          loop: "config",
        });
      },
    },
    providers: {
      loop: "proxy",
      run: async (ctx) => {
        await renderAdminScreen(ctx, {
          text: await loadProvidersText(deps),
          loop: "proxy",
        });
      },
    },
    models: {
      loop: "proxy",
      run: async (ctx) => {
        await renderAdminScreen(ctx, {
          text: await loadModelsText(deps),
          loop: "proxy",
        });
      },
    },
    oauth: {
      loop: "proxy",
      run: async (ctx) => {
        await renderAdminScreen(ctx, {
          text: await loadOauthStatusText(deps),
          loop: "proxy",
        });
      },
    },
    plans: {
      loop: "billing",
      run: async (ctx) => {
        await renderAdminScreen(ctx, {
          text: formatBillingPlans(billing),
          loop: "billing",
        });
      },
    },
    renewals: {
      loop: "billing",
      run: async (ctx) => {
        await renderAdminScreen(ctx, {
          text: formatOpenRenewalRequests(billing),
          loop: "billing",
        });
      },
    },
    apikeys: {
      loop: "keys",
      run: async (ctx) => {
        const keys = customerKeys.listRecentKeys(10);
        await renderAdminScreen(ctx, {
          text: formatRecentCustomerKeys(keys),
          loop: "keys",
          primaryKeyboard: keys.length > 0 ? buildAdminKeyListKeyboard(keys) : undefined,
        });
      },
    },
    apply: {
      loop: "apply",
      run: async (ctx) => {
        await renderAdminScreen(ctx, {
          text: "Choose a client to configure.",
          loop: "apply",
          primaryKeyboard: buildApplyClientKeyboard(false),
        });
      },
    },
    menu: {
      run: async (ctx) => {
        await renderAdminScreen(ctx, {
          text: formatAdminStartPanel(),
          loop: "main",
        });
      },
    },
  };

  bot.callbackQuery(ADMIN_CALLBACK_PATTERN, async (ctx) => {
    if (!isAdmin(ctx, deps.config)) {
      await answerCallbackQuerySafely(ctx, { text: "Admin only.", show_alert: true });
      return;
    }
    const action = ctx.match[1] as AdminCallbackAction;
    const definition = adminActions[action];
    await answerCallbackQuerySafely(ctx, { text: "Loaded" });
    try {
      await definition.run(ctx);
    } catch (error) {
      await replyWithProxyError(ctx, error);
    }
  });
}

function formatAdminStartPanel(): string {
  return [
    "Admin panel",
    "role: admin",
    "Use the buttons below to run admin actions.",
  ].join("\n");
}

function formatBillingPlans(billing: BillingRepository): string {
  const plans = billing.listPlans();
  if (plans.length === 0) {
    return "No billing plans are configured.";
  }
  return [
    "Billing plans:",
    ...plans.map(
      (plan) =>
        `- ${plan.id}: ${plan.name} | status=${plan.status} | monthly_token_limit=${plan.monthlyTokenLimit} | max_api_keys=${plan.maxApiKeys}`,
    ),
  ].join("\n");
}

function formatOpenRenewalRequests(billing: BillingRepository): string {
  const openRequests = billing.listRenewalRequests("open");
  if (openRequests.length === 0) {
    return "No open renewal requests.";
  }
  return [
    "Open renewal requests:",
    ...openRequests.slice(0, 10).map(formatRenewalRequestLine),
  ].join("\n");
}

function formatRecentCustomerKeys(keys: ReturnType<CustomerKeyRepository["listRecentKeys"]>): string {
  if (keys.length === 0) {
    return [
      "Customer API keys",
      "No customer API keys found.",
      "Use /grant or /apikey issue to create one.",
    ].join("\n");
  }
  return [
    "Customer API keys",
    "Recent keys. Tap a key button to copy its id, paste it back into this chat, then send to manage.",
    ...keys.map((key) =>
      [
        `- ${key.id}`,
        key.telegramUserId ? `user=${key.telegramUserId}` : undefined,
        `status=${key.status}`,
        `route=${key.clientRoute}`,
        `preview=${key.apiKeyPreview}`,
      ]
        .filter(Boolean)
        .join(" | "),
    ),
  ].join("\n");
}

function formatRenewalRequestLine(request: RenewalRequestRecord): string {
  return [
    `- ${request.id}`,
    `telegram_user_id=${request.telegramUserId}`,
    request.requestedPlanId ? `plan_id=${request.requestedPlanId}` : undefined,
    request.requestedDays ? `days=${request.requestedDays}` : undefined,
    `requested_at=${request.requestedAt}`,
  ]
    .filter(Boolean)
    .join(" ");
}
