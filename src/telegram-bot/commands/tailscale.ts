import type { Bot } from "grammy";
import type { BotDependencies } from "../actions.js";

export function registerTailscaleCommand(bot: Bot, deps: BotDependencies): void {
  bot.command("tailscale", async (ctx) => {
    const lines = [
      "Join Tailscale",
      "1. Install Tailscale on your device:",
      "https://tailscale.com/download",
      "2. Sign in to Tailscale on your device.",
      "3. Inbox admin in Telegram to get a fresh invite link for the private network.",
      "4. Open that invite link, join the tailnet, then connect Tailscale.",
      `5. Use this Responses base URL after you are connected:\n${deps.config.publicResponsesBaseUrl}`,
      "6. Run /apikey in this chat to check your key status.",
    ];

    await ctx.reply(lines.join("\n"));
  });
}
