import type { Bot } from "grammy";
import { sendTestResult, type BotDependencies } from "../actions.js";
import { buildTelegramSessionScope, type TelegramBotStateStore } from "../sessions.js";

export function registerTestCommand(
  bot: Bot,
  deps: BotDependencies,
  sessions: TelegramBotStateStore,
): void {
  bot.command("test", async (ctx) => {
    const args = ctx.match?.toString().trim() || "";
    if (args) {
      const parsed = parseTestArgs(args);
      await sendTestResult(ctx, deps, parsed);
      return;
    }

    const chatId = ctx.chat?.id?.toString();
    const userId = ctx.from?.id?.toString();
    if (chatId && userId) {
      sessions.set(buildTelegramSessionScope(chatId, userId), { kind: "awaiting_test_prompt" });
    }
    await ctx.reply("Send the test prompt text you want to run through /v1/responses.");
  });

  bot.on("message:text", async (ctx, next) => {
    const chatId = ctx.chat?.id?.toString();
    const userId = ctx.from?.id?.toString();
    if (!chatId || !userId) {
      await next();
      return;
    }

    const scope = buildTelegramSessionScope(chatId, userId);
    const session = sessions.get(scope);
    if (session?.kind !== "awaiting_test_prompt") {
      await next();
      return;
    }
    if (ctx.message.text.startsWith("/")) {
      await next();
      return;
    }

    sessions.clear(scope);
    await sendTestResult(ctx, deps, {
      prompt: ctx.message.text.trim(),
      model: session.model,
    });
  });
}

export function parseTestArgs(args: string): { prompt: string; providerId?: string } {
  const match = args.match(/^--provider-id\s+(\S+)\s+([\s\S]+)$/);
  if (!match) {
    return { prompt: args };
  }
  return {
    providerId: match[1],
    prompt: match[2].trim(),
  };
}
