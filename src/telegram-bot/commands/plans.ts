import type { Bot } from "grammy";
import type { BillingRepository } from "../../billing.js";
import { isAdmin } from "../auth.js";
import type { BotDependencies } from "../actions.js";

function formatPlans(plans: ReturnType<BillingRepository["listPlans"]>): string {
  if (plans.length === 0) {
    return "💳 Billing plans:\nNo billing plans are configured yet.";
  }

  return [
    "💳 Billing plans:",
    ...plans.map(
      (plan) =>
        `• ${plan.id}: ${plan.name} | status=${plan.status} | monthly_token_limit=${plan.monthlyTokenLimit} | max_api_keys=${plan.maxApiKeys} | price_cents=${plan.priceCents} | billing_interval=${plan.billingInterval}`,
    ),
  ].join("\n");
}

function formatCreatePlanUsage(): string {
  return [
    "💳 Plan commands",
    "Usage: /plans create <planId> <name> <monthlyTokenLimit> <maxApiKeys> [priceCents] [currency] [billingInterval]",
    "Example: /plans create pro Pro 5000000 3 4900 USD month",
  ].join("\n");
}

function parseCreatePlanArgs(rawArgs: string): {
  id: string;
  name: string;
  monthlyTokenLimit: number;
  maxApiKeys: number;
  priceCents: number;
  currency: string;
  billingInterval: "month" | "year" | "one_time";
} | null {
  const parts = rawArgs.trim().split(/\s+/g).filter(Boolean);
  if (parts.length < 4) {
    return null;
  }

  const [id] = parts;
  let end = parts.length;

  const billingIntervalCandidate = parts[end - 1];
  const hasBillingInterval = billingIntervalCandidate === "month" || billingIntervalCandidate === "year" || billingIntervalCandidate === "one_time";
  const billingInterval: "month" | "year" | "one_time" = hasBillingInterval ? billingIntervalCandidate : "month";
  if (hasBillingInterval) {
    end -= 1;
  }

  const currencyCandidate = parts[end - 1];
  const hasCurrency = /^[A-Za-z]{3}$/.test(currencyCandidate);
  const currency = hasCurrency ? currencyCandidate.toUpperCase() : "USD";
  if (hasCurrency) {
    end -= 1;
  }

  let numericStart = end;
  while (numericStart > 1 && /^\d+$/.test(parts[numericStart - 1])) {
    numericStart -= 1;
  }
  const numericParts = parts.slice(numericStart, end);
  if (numericParts.length !== 2 && numericParts.length !== 3) {
    return null;
  }

  const [monthlyTokenLimitRaw, maxApiKeysRaw, priceCentsRaw] = numericParts;
  const name = parts.slice(1, numericStart).join(" ");

  if (!name) {
    return null;
  }
  const monthlyTokenLimit = Number(monthlyTokenLimitRaw);
  const maxApiKeys = Number(maxApiKeysRaw);
  const priceCents = priceCentsRaw ? Number(priceCentsRaw) : 0;
  if (
    !Number.isInteger(monthlyTokenLimit) ||
    monthlyTokenLimit <= 0 ||
    !Number.isInteger(maxApiKeys) ||
    maxApiKeys <= 0 ||
    !Number.isInteger(priceCents) ||
    priceCents < 0
  ) {
    return null;
  }

  return { id, name, monthlyTokenLimit, maxApiKeys, priceCents, currency, billingInterval };
}

export function registerPlansCommand(bot: Bot, deps: BotDependencies, billing: BillingRepository): void {
  bot.command("plans", async (ctx) => {
    if (!isAdmin(ctx, deps.config)) {
      await ctx.reply("Only admins can view billing plans.");
      return;
    }

    const rawArgs = (ctx.match?.toString() || "").trim();
    if (rawArgs.startsWith("create")) {
      const createArgs = rawArgs.slice("create".length).trim();
      const parsed = parseCreatePlanArgs(createArgs);
      if (!parsed) {
        await ctx.reply(formatCreatePlanUsage());
        return;
      }

      if (billing.getPlan(parsed.id)) {
        await ctx.reply(`Plan already exists: ${parsed.id}`);
        return;
      }

      const created = billing.createPlan(parsed);
      await ctx.reply(
        [
          `Created plan ${created.id}`,
          `name=${created.name}`,
          `status=${created.status}`,
          `monthly_token_limit=${created.monthlyTokenLimit}`,
          `max_api_keys=${created.maxApiKeys}`,
          `price_cents=${created.priceCents}`,
          `currency=${created.currency}`,
          `billing_interval=${created.billingInterval}`,
        ].join("\n"),
      );
      return;
    }

    await ctx.reply(formatPlans(billing.listPlans()));
  });
}
