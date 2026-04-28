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
