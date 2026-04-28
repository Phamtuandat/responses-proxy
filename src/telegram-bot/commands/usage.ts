import type { Bot } from "grammy";
import type { BillingRepository } from "../../billing.js";
import type { CustomerKeyRepository } from "../../customer-keys.js";
import { replyWithCustomerView } from "../customer-actions.js";
import type { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";

export function registerUsageCommand(
  bot: Bot,
  workspaces: CustomerWorkspaceRepository,
  customerKeys: CustomerKeyRepository,
  billing: BillingRepository,
): void {
  bot.command("usage", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await ctx.reply("For safety, open a private chat with this bot and run /usage there.");
      return;
    }
    await replyWithCustomerView(ctx, "usage", workspaces, customerKeys, billing);
  });
}
