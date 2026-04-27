import type { Bot } from "grammy";
import { sendModels, type BotDependencies } from "../actions.js";

export function registerModelsCommand(bot: Bot, deps: BotDependencies): void {
  bot.command("models", async (ctx) => {
    await sendModels(ctx, deps);
  });
}
