import { InlineKeyboard, type Bot } from "grammy";
import { renderAdminScreen } from "../admin-actions.js";
import { isAdmin } from "../auth.js";
import { answerCallbackQuerySafely } from "../callbacks.js";
import { formatOauthStatus } from "../format.js";
import { replyWithProxyError, type BotDependencies } from "../actions.js";
import type { TelegramBotStateStore } from "../sessions.js";

type OauthStatusPayload = Awaited<ReturnType<BotDependencies["proxyClient"]["getOauthStatus"]>>;

function buildAccountsKeyboard(
  payload: OauthStatusPayload,
  stateStore: TelegramBotStateStore,
  admin: boolean,
): InlineKeyboard | undefined {
  const keyboard = new InlineKeyboard();
  for (const account of payload?.accounts ?? []) {
    const accountActionToken = stateStore.issueCallbackToken({
      kind: "account_action",
      action: "refresh",
      accountId: account.id,
    });
    const label = (account.email || account.accountId || account.id).slice(0, 18);
    keyboard.text(`↻ ${label}`, `v1:acct:refresh:${accountActionToken}`);
    if (account.disabled) {
      keyboard.text("🟢 Enable", `v1:acct:enable:${accountActionToken}`);
    } else {
      keyboard.text("🟡 Disable", `v1:acct:disable:${accountActionToken}`);
    }
    if (admin) {
      keyboard.text("🔴 Delete", `v1:acct:delete-confirm:${accountActionToken}`);
    }
    keyboard.row();
  }
  return (payload?.accounts?.length ?? 0) > 0 ? keyboard : undefined;
}

export function registerAccountsCommand(
  bot: Bot,
  deps: BotDependencies,
  stateStore: TelegramBotStateStore,
): void {
  bot.command("accounts", async (ctx) => {
    await renderAccountsScreen(ctx, deps, stateStore);
  });

  bot.callbackQuery("v1:acct:list", async (ctx) => {
    await answerCallbackQuerySafely(ctx, { text: "Loaded" });
    await renderAccountsScreen(ctx, deps, stateStore);
  });

  bot.callbackQuery(/^v1:acct:(refresh|disable|enable):([A-Za-z0-9_-]+)$/, async (ctx) => {
    const action = ctx.match[1];
    const token = ctx.match[2];
    try {
      const callbackState = stateStore.readCallbackToken(token);
      const accountId = callbackState?.kind === "account_action" ? callbackState.accountId : undefined;
      if (!accountId) {
        await answerCallbackQuerySafely(ctx, { text: "Action expired. Refresh /accounts.", show_alert: true });
        return;
      }
      if (action === "refresh") {
        await deps.proxyClient.refreshAccount(accountId);
      } else if (action === "disable") {
        await deps.proxyClient.disableAccount(accountId);
      } else if (action === "enable") {
        await deps.proxyClient.enableAccount(accountId);
      }
      await answerCallbackQuerySafely(ctx, { text: `${action} ok` });
      await renderAccountsScreen(ctx, deps, stateStore);
    } catch (error) {
      await answerCallbackQuerySafely(ctx);
      await replyWithProxyError(ctx, error);
    }
  });

  bot.callbackQuery(/^v1:acct:delete-confirm:([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (!isAdmin(ctx, deps.config)) {
      await answerCallbackQuerySafely(ctx, { text: "Admin only", show_alert: true });
      return;
    }
    const token = ctx.match[1];
    const callbackState = stateStore.readCallbackToken(token);
    const accountId = callbackState?.kind === "account_action" ? callbackState.accountId : undefined;
    if (!accountId) {
      await answerCallbackQuerySafely(ctx, { text: "Action expired. Refresh /accounts.", show_alert: true });
      return;
    }
    const deleteToken = stateStore.issueCallbackToken({
      kind: "account_action",
      action: "delete",
      accountId,
    });
    await answerCallbackQuerySafely(ctx);
    await renderAdminScreen(ctx, {
      text: "Confirm account deletion?",
      loop: "accounts",
      primaryKeyboard: new InlineKeyboard()
        .text("Delete account", `v1:acct:delete:${deleteToken}`)
        .text("Cancel", "v1:acct:delete-cancel"),
    });
  });

  bot.callbackQuery("v1:acct:delete-cancel", async (ctx) => {
    await answerCallbackQuerySafely(ctx, { text: "Cancelled" });
    await renderAccountsScreen(ctx, deps, stateStore);
  });

  bot.callbackQuery(/^v1:acct:delete:([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (!isAdmin(ctx, deps.config)) {
      await answerCallbackQuerySafely(ctx, { text: "Admin only", show_alert: true });
      return;
    }
    try {
      const token = ctx.match[1];
      const callbackState = stateStore.readCallbackToken(token);
      const accountId = callbackState?.kind === "account_action" ? callbackState.accountId : undefined;
      if (!accountId) {
        await answerCallbackQuerySafely(ctx, { text: "Action expired. Refresh /accounts.", show_alert: true });
        return;
      }
      stateStore.clearCallbackToken(token);
      await deps.proxyClient.deleteAccount(accountId);
      await answerCallbackQuerySafely(ctx, { text: "delete ok" });
      await renderAccountsScreen(ctx, deps, stateStore);
    } catch (error) {
      await answerCallbackQuerySafely(ctx);
      await replyWithProxyError(ctx, error);
    }
  });
}

async function renderAccountsScreen(
  ctx: Parameters<Bot["command"]>[1] extends infer _T ? any : never,
  deps: BotDependencies,
  stateStore: TelegramBotStateStore,
): Promise<void> {
  try {
    const payload = await deps.proxyClient.getOauthStatus();
    await renderAdminScreen(ctx, {
      text: formatOauthStatus(payload),
      loop: "accounts",
      primaryKeyboard: buildAccountsKeyboard(payload, stateStore, isAdmin(ctx, deps.config)),
    });
  } catch (error) {
    await replyWithProxyError(ctx, error);
  }
}
