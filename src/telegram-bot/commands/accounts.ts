import { InlineKeyboard, type Bot } from "grammy";
import { isAdmin } from "../auth.js";
import { formatOauthStatus } from "../format.js";
import { replyWithProxyError, type BotDependencies } from "../actions.js";
import type { TelegramBotStateStore } from "../sessions.js";

function buildAccountKeyboard(token: string, admin: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("Refresh", `v1:acct:refresh:${token}`)
    .text("Disable", `v1:acct:disable:${token}`)
    .row()
    .text("Enable", `v1:acct:enable:${token}`);
  if (admin) {
    keyboard.text("Delete", `v1:acct:delete-confirm:${token}`);
  }
  return keyboard;
}

export function registerAccountsCommand(
  bot: Bot,
  deps: BotDependencies,
  stateStore: TelegramBotStateStore,
): void {
  bot.command("accounts", async (ctx) => {
    try {
      const payload = await deps.proxyClient.getOauthStatus();
      await ctx.reply(formatOauthStatus(payload));
      for (const account of payload?.accounts ?? []) {
        const accountActionToken = stateStore.issueCallbackToken({
          kind: "account_action",
          action: "refresh",
          accountId: account.id,
        });
        await ctx.reply(
          `Manage account ${account.email || account.accountId || account.id}`,
          {
            reply_markup: buildAccountKeyboard(accountActionToken, isAdmin(ctx, deps.config)),
          },
        );
      }
    } catch (error) {
      await replyWithProxyError(ctx, error);
    }
  });

  bot.callbackQuery(/^v1:acct:(refresh|disable|enable):([A-Za-z0-9_-]+)$/, async (ctx) => {
    const action = ctx.match[1];
    const token = ctx.match[2];
    try {
      const callbackState = stateStore.readCallbackToken(token);
      const accountId = callbackState?.kind === "account_action" ? callbackState.accountId : undefined;
      if (!accountId) {
        await ctx.answerCallbackQuery({ text: "Action expired. Refresh /accounts.", show_alert: true });
        return;
      }
      if (action === "refresh") {
        await deps.proxyClient.refreshAccount(accountId);
      } else if (action === "disable") {
        await deps.proxyClient.disableAccount(accountId);
      } else if (action === "enable") {
        await deps.proxyClient.enableAccount(accountId);
      }
      await ctx.answerCallbackQuery({ text: `${action} ok` });
      const oauthStatus = await deps.proxyClient.getOauthStatus();
      await ctx.reply(formatOauthStatus(oauthStatus));
    } catch (error) {
      await ctx.answerCallbackQuery();
      await replyWithProxyError(ctx, error);
    }
  });

  bot.callbackQuery(/^v1:acct:delete-confirm:([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (!isAdmin(ctx, deps.config)) {
      await ctx.answerCallbackQuery({ text: "Admin only", show_alert: true });
      return;
    }
    const token = ctx.match[1];
    const callbackState = stateStore.readCallbackToken(token);
    const accountId = callbackState?.kind === "account_action" ? callbackState.accountId : undefined;
    if (!accountId) {
      await ctx.answerCallbackQuery({ text: "Action expired. Refresh /accounts.", show_alert: true });
      return;
    }
    const deleteToken = stateStore.issueCallbackToken({
      kind: "account_action",
      action: "delete",
      accountId,
    });
    await ctx.answerCallbackQuery();
    await ctx.reply("Confirm account deletion?", {
      reply_markup: new InlineKeyboard()
        .text("Delete account", `v1:acct:delete:${deleteToken}`)
        .text("Cancel", "v1:acct:delete-cancel"),
    });
  });

  bot.callbackQuery("v1:acct:delete-cancel", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Cancelled" });
  });

  bot.callbackQuery(/^v1:acct:delete:([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (!isAdmin(ctx, deps.config)) {
      await ctx.answerCallbackQuery({ text: "Admin only", show_alert: true });
      return;
    }
    try {
      const token = ctx.match[1];
      const callbackState = stateStore.readCallbackToken(token);
      const accountId = callbackState?.kind === "account_action" ? callbackState.accountId : undefined;
      if (!accountId) {
        await ctx.answerCallbackQuery({ text: "Action expired. Refresh /accounts.", show_alert: true });
        return;
      }
      stateStore.clearCallbackToken(token);
      await deps.proxyClient.deleteAccount(accountId);
      await ctx.answerCallbackQuery({ text: "delete ok" });
      const oauthStatus = await deps.proxyClient.getOauthStatus();
      await ctx.reply(formatOauthStatus(oauthStatus));
    } catch (error) {
      await ctx.answerCallbackQuery();
      await replyWithProxyError(ctx, error);
    }
  });
}
