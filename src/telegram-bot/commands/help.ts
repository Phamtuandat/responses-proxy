import type { Bot } from "grammy";
import { isAdmin } from "../auth.js";
import type { BotDependencies } from "../actions.js";

export function registerHelpCommand(bot: Bot, deps: BotDependencies): void {
  bot.command("help", async (ctx) => {
    const topic = (ctx.match?.toString() ?? "").trim().toLowerCase();
    const lines = isAdmin(ctx, deps.config)
      ? topic === "proxy"
        ? [
            "Proxy Maintenance:",
            "/status - health and active provider",
            "/providers - provider list and client routes",
            "/clients - Hermes and Codex config status",
            "/models - list models through proxy routing",
            "/apply <hermes|codex> <model> [routeApiKey] - quick apply config",
            "/oauth - show OAuth status and start account connect flow",
            "/accounts - list OAuth accounts",
            "/test [prompt] - send a small Responses API request",
          ]
        : topic === "customer"
          ? [
              "Customer Commands:",
              "/me - show your Telegram account and workspace status",
              "/apikey - show your Responses API key",
              "/usage - show token usage for your current period",
              "/quota - show token limit, remaining balance, and expiration",
              "/renew - choose a plan and send a renewal request to admin",
              "/tailscale - install Tailscale and ask admin for a fresh invite",
            ]
        : [
            "Admin Ops:",
            "/plans - list billing plan ids and limits",
            "/grant <telegramUserId> <planId> <days> - activate customer access",
            "/renewuser <telegramUserId> <planId> <days> [replace-key] - renew customer access",
            "/renew list | approve | close - manage renewal requests",
            "/apikey issue <telegramUserId> [clientRoute] [apiKey] - issue a customer key",
            "",
            "More:",
            "/help customer - show customer-facing commands",
            "/help proxy - show proxy maintenance commands",
          ]
      : [
          "Available commands:",
          "/me - show your Telegram account and workspace status",
          "/apikey - show your Responses API key",
          "/usage - show token usage for your current period",
          "/quota - show token limit, remaining balance, and expiration",
          "/renew - choose a plan and send a renewal request to admin",
          "/tailscale - install Tailscale and ask admin for a fresh invite",
        ];
    await ctx.reply(lines.join("\n"));
  });
}
