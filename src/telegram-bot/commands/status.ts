import type { Bot } from "grammy";
import { sendStatus, type BotDependencies } from "../actions.js";

export function registerStatusCommand(bot: Bot, deps: BotDependencies): void {
  bot.command("status", async (ctx) => {
    await sendStatus(ctx, deps);
  });
}
