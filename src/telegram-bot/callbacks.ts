import type { Context } from "grammy";

export async function answerCallbackQuerySafely(
  ctx: Context,
  payload?: Parameters<Context["answerCallbackQuery"]>[0],
): Promise<void> {
  try {
    await ctx.answerCallbackQuery(payload);
  } catch {
    // Telegram callback queries can expire before the bot answers; the action itself can still continue.
  }
}

export async function replyOrEditMessage(
  ctx: Context,
  text: string,
  options?: Parameters<Context["reply"]>[1],
): Promise<void> {
  const callbackMessage = ctx.callbackQuery && "message" in ctx.callbackQuery ? ctx.callbackQuery.message : undefined;
  if (callbackMessage) {
    try {
      await ctx.editMessageText(text, options as never);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const normalized = message.toLowerCase();
      if (normalized.includes("message is not modified")) {
        return;
      }
      if (
        normalized.includes("message to edit not found")
        || normalized.includes("message can't be edited")
        || normalized.includes("message is too old")
      ) {
        return;
      }
    }
  }
  await ctx.reply(text, options);
}
