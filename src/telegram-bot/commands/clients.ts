import { InlineKeyboard, type Bot } from "grammy";
import { sendClients, type BotDependencies } from "../actions.js";

export function registerClientsCommand(bot: Bot, deps: BotDependencies): void {
  bot.command("clients", async (ctx) => {
    await sendClients(ctx, deps);
    await ctx.reply("Quick Apply:", {
      reply_markup: new InlineKeyboard()
        .text("Apply to Hermes", "v1:apply:client:hermes")
        .row()
        .text("Apply to Codex", "v1:apply:client:codex"),
    });
  });
}
