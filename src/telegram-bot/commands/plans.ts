import type { Bot } from "grammy";
import type { BillingRepository } from "../../billing.js";
import { isAdmin } from "../auth.js";
import type { BotDependencies } from "../actions.js";

export function registerPlansCommand(bot: Bot, deps: BotDependencies, billing: BillingRepository): void {
  bot.command("plans", async (ctx) => {
    if (!isAdmin(ctx, deps.config)) {
      await ctx.reply("Only admins can view billing plans.");
      return;
    }

    const plans = billing.listPlans();
    if (plans.length === 0) {
      await ctx.reply("No billing plans are configured.");
      return;
    }

    await ctx.reply(
      [
        "Billing plans:",
        ...plans.map(
          (plan) =>
            `- ${plan.id}: ${plan.name} | status=${plan.status} | monthly_token_limit=${plan.monthlyTokenLimit} | max_api_keys=${plan.maxApiKeys}`,
        ),
      ].join("\n"),
    );
  });
}
