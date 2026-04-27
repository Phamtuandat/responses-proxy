import { InlineKeyboard, type Bot } from "grammy";
import { sendProviderDetails, sendProviders, type BotDependencies } from "../actions.js";

export function registerProvidersCommand(bot: Bot, deps: BotDependencies): void {
  bot.command("providers", async (ctx) => {
    await sendProviders(ctx, deps);
    try {
      const payload = await deps.proxyClient.getProviders();
      for (const provider of payload?.providers ?? []) {
        await ctx.reply(
          `${provider.name} (${provider.id})`,
          {
            reply_markup: new InlineKeyboard()
              .text("Details", `v1:provider:details:${provider.id}`)
              .row()
              .text("Apply Hermes", `v1:apply:start:hermes:${provider.id}`)
              .text("Apply Codex", `v1:apply:start:codex:${provider.id}`),
          },
        );
      }
    } catch {
      return;
    }
  });

  bot.callbackQuery(/^v1:provider:details:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendProviderDetails(ctx, deps, ctx.match[1]);
  });
}
