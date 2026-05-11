import type { Bot } from "grammy";
import { DashboardAuthRepository } from "../dashboard-auth.js";
import { answerCallbackQuerySafely, replyOrEditMessage } from "./callbacks.js";
import { isAdmin } from "./auth.js";
import type { TelegramBotConfig } from "./config.js";

export function registerDashboardLoginCallbacks(
  bot: Bot,
  config: TelegramBotConfig,
  dashboardAuth: DashboardAuthRepository,
): void {
  bot.callbackQuery(/^v1:dashauth:([a-f0-9]+):(\d{2})$/, async (ctx) => {
    if (!isAdmin(ctx, config)) {
      await answerCallbackQuerySafely(ctx, { text: "Admin only.", show_alert: true });
      return;
    }

    const challengeId = ctx.match[1];
    const selectedCode = ctx.match[2];
    const telegramUserId = ctx.from?.id?.toString();
    if (!telegramUserId) {
      await answerCallbackQuerySafely(ctx, { text: "Missing Telegram user.", show_alert: true });
      return;
    }

    const result = dashboardAuth.resolveApprovalChoice({
      challengeId,
      telegramUserId,
      selectedCode,
    });

    if (!result.ok) {
      await answerCallbackQuerySafely(ctx, {
        text:
          result.reason === "expired"
            ? "Approval request expired."
            : result.reason === "consumed"
              ? "Approval request already handled."
              : "Approval request not found.",
        show_alert: true,
      });
      return;
    }

    const approved = result.status === "approved";
    await answerCallbackQuerySafely(ctx, {
      text: approved ? "Dashboard login approved." : "Wrong code.",
      show_alert: !approved,
    });
    await replyOrEditMessage(
      ctx,
      approved ? "Responses Proxy dashboard login approved." : "Responses Proxy dashboard login rejected.",
    );
  });
}
