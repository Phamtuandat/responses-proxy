import type { Context, MiddlewareFn } from "grammy";
import type { TelegramBotConfig } from "./config.js";

function isAllowed(ctx: Context, config: TelegramBotConfig): boolean {
  const fromId = ctx.from?.id?.toString();
  const chatId = ctx.chat?.id?.toString();
  const hasEmergencyUserLockdown = config.allowedUserIds.size > 0;
  const isOwnerOrAdmin =
    !!fromId && (config.ownerUserIds.has(fromId) || config.adminUserIds.has(fromId));

  const userAllowed =
    fromId
      ? isOwnerOrAdmin ||
        config.allowedUserIds.has(fromId) ||
        (!hasEmergencyUserLockdown && config.publicSignupEnabled)
      : false;
  const chatAllowed =
    config.allowedChatIds.size === 0 || (chatId ? config.allowedChatIds.has(chatId) : false);

  return userAllowed && chatAllowed;
}

export function isAdmin(ctx: Context, config: TelegramBotConfig): boolean {
  const fromId = ctx.from?.id?.toString();
  return !!fromId && (config.ownerUserIds.has(fromId) || config.adminUserIds.has(fromId));
}

export function createAllowlistMiddleware(config: TelegramBotConfig): MiddlewareFn<Context> {
  return async (ctx, next) => {
    if (!isAllowed(ctx, config)) {
      await ctx.reply("This bot is restricted. Your user or chat is not authorized.");
      return;
    }
    await next();
  };
}

export function createCustomerCommandMiddleware(config: TelegramBotConfig): MiddlewareFn<Context> {
  const customerCommands = new Set(["start", "help", "me", "apikey", "usage", "quota", "renew", "tailscale"]);
  return async (ctx, next) => {
    if (isAdmin(ctx, config)) {
      await next();
      return;
    }

    const text = ctx.message && "text" in ctx.message ? ctx.message.text : undefined;
    const command = parseCommand(text);
    if (!command || customerCommands.has(command)) {
      await next();
      return;
    }

    await ctx.reply("This command is admin-only. Use /apikey to view your Responses API key.");
  };
}

function parseCommand(text: string | undefined): string | undefined {
  const match = text?.trim().match(/^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s|$)/);
  return match?.[1]?.toLowerCase();
}
