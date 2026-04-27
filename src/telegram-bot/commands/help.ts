import type { Bot } from "grammy";
import { isAdmin } from "../auth.js";
import type { BotDependencies } from "../actions.js";

export function registerHelpCommand(bot: Bot, deps: BotDependencies): void {
  bot.command("help", async (ctx) => {
    const lines = isAdmin(ctx, deps.config)
      ? [
          "Available commands:",
          "/status - health and active provider",
          "/providers - provider list and client routes",
          "/clients - Hermes and Codex config status",
          "/models - list models through proxy routing",
          "/apply <hermes|codex> <model> [routeApiKey] - quick apply config",
          "/oauth - show OAuth status and start account connect flow",
          "/accounts - list OAuth accounts",
          "/grant <telegramUserId> <planId> <days> - activate customer access",
          "/renewuser <telegramUserId> <planId> <days> [replace-key] - renew customer access",
          "/renew list | approve | close - manage renewal requests",
          "/apikey issue <telegramUserId> [clientRoute] [apiKey] - issue a customer key",
          "/test [prompt] - send a small Responses API request",
        ]
      : [
          "Available commands:",
          "/me - show your Telegram account and workspace status",
          "/apikey - show your Responses API key",
          "/usage - show token usage for your current period",
          "/quota - show token limit, remaining balance, and expiration",
          "/renew - request a manual renewal review from admin",
        ];
    await ctx.reply(lines.join("\n"));
  });
}
