import { InlineKeyboard, type Bot } from "grammy";
import { replyWithProxyError, sendOauthStatus, type BotDependencies } from "../actions.js";
import { buildTelegramSessionScope, type TelegramBotStateStore } from "../sessions.js";

export function registerOauthCommand(
  bot: Bot,
  deps: BotDependencies,
  sessions: TelegramBotStateStore,
): void {
  bot.command("oauth", async (ctx) => {
    await sendOauthStatus(ctx, deps);
    await ctx.reply(
      "Choose an OAuth action.",
      {
        reply_markup: new InlineKeyboard().text("Add Account", "oauth:start"),
      },
    );
  });

  bot.callbackQuery("oauth:start", async (ctx) => {
    try {
      const result = await deps.proxyClient.startOauth();
      const chatId = ctx.chat?.id?.toString();
      const userId = ctx.from?.id?.toString();
      if (chatId && userId) {
        sessions.set(buildTelegramSessionScope(chatId, userId), { kind: "awaiting_oauth_callback" });
      }
      await ctx.answerCallbackQuery();
      await ctx.reply(
        [
          "Open this URL and complete sign-in:",
          result?.authUrl ?? "Missing auth URL",
          "",
          "Warning: the callback URL may contain short-lived authorization material.",
          "Only paste it into this authorized bot chat.",
          "",
          "Then paste the full callback URL into this chat.",
        ].join("\n"),
      );
    } catch (error) {
      await ctx.answerCallbackQuery();
      await replyWithProxyError(ctx, error);
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const chatId = ctx.chat?.id?.toString();
    const userId = ctx.from?.id?.toString();
    if (!chatId || !userId) {
      await next();
      return;
    }
    const session = sessions.get(buildTelegramSessionScope(chatId, userId));
    if (session?.kind !== "awaiting_oauth_callback") {
      await next();
      return;
    }
    if (ctx.message.text.startsWith("/")) {
      await next();
      return;
    }

    try {
      const result = await deps.proxyClient.completeOauth(ctx.message.text.trim());
      sessions.clear(buildTelegramSessionScope(chatId, userId));
      await ctx.reply("OAuth account connected.");
      if (result?.accounts) {
        await sendOauthStatus(ctx, deps);
      }
    } catch (error) {
      await replyWithProxyError(ctx, error);
    }
  });
}
