import type { Context, MiddlewareFn } from "grammy";
import type { TelegramBotConfig } from "./config.js";
import { isAdmin } from "./auth.js";

const customerCleanupCommands = new Set([
  "start",
  "help",
  "me",
  "apikey",
  "usage",
  "quota",
  "renew",
  "tailscale",
]);

export function createCustomerMessageCleanupMiddleware(config: TelegramBotConfig): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const cleanupTarget = readCustomerCleanupTarget(ctx, config);
    try {
      await next();
    } finally {
      if (cleanupTarget) {
        await deleteMessageBestEffort(ctx, cleanupTarget);
      }
    }
  };
}

export async function deleteMessageBestEffort(
  ctx: Context,
  target: { chatId: number; messageId: number },
): Promise<boolean> {
  try {
    await ctx.api.deleteMessage(target.chatId, target.messageId);
    return true;
  } catch {
    return false;
  }
}

function readCustomerCleanupTarget(
  ctx: Context,
  config: TelegramBotConfig,
): { chatId: number; messageId: number } | undefined {
  if (isAdmin(ctx, config)) {
    return undefined;
  }

  const message = ctx.message;
  if (!message || !("text" in message) || typeof message.text !== "string") {
    return undefined;
  }

  const command = parseCommand(message.text);
  if (!command || !customerCleanupCommands.has(command)) {
    return undefined;
  }

  const chatId = ctx.chat?.id;
  const messageId = message.message_id;
  return typeof chatId === "number" && typeof messageId === "number"
    ? { chatId, messageId }
    : undefined;
}

function parseCommand(text: string): string | undefined {
  const match = text.trim().match(/^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s|$)/);
  return match?.[1]?.toLowerCase();
}
