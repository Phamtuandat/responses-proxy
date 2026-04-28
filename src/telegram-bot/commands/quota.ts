import type { Bot } from "grammy";
import type { BillingRepository } from "../../billing.js";
import type { CustomerKeyRepository } from "../../customer-keys.js";
import { buildCustomerActionKeyboard } from "../customer-actions.js";
import { readCustomerBillingOverview } from "../customer-billing.js";
import type { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";

export function registerQuotaCommand(
  bot: Bot,
  workspaces: CustomerWorkspaceRepository,
  customerKeys: CustomerKeyRepository,
  billing: BillingRepository,
): void {
  bot.command("quota", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.reply("For safety, open a private chat with this bot and run /quota there.");
      return;
    }

    const userId = ctx.from?.id?.toString();
    if (!userId) {
      await ctx.reply("Could not determine your Telegram user.");
      return;
    }

    const overview = readCustomerBillingOverview({
      telegramUserId: userId,
      workspaces,
      customerKeys,
      billing,
    });

    if (!overview.workspace) {
      await ctx.reply("No customer workspace has been assigned to your Telegram user yet.");
      return;
    }

    await ctx.reply(
      [
        "Your quota",
        `workspace_id: ${overview.workspace.id}`,
        `entitlement_status: ${overview.entitlementStatus}`,
        overview.entitlement ? `token_limit: ${overview.entitlement.monthlyTokenLimit}` : undefined,
        `used_tokens: ${overview.usage.totalTokens}`,
        overview.remainingTokens !== null ? `remaining_tokens: ${overview.remainingTokens}` : undefined,
        overview.entitlement ? `expires_at: ${overview.entitlement.validUntil}` : undefined,
        overview.apiKey ? `key_status: ${overview.apiKey.status}` : "key_status: none",
      ]
        .filter(Boolean)
        .join("\n"),
      { reply_markup: buildCustomerActionKeyboard(overview.apiKey?.status === "active") },
    );
  });
}
