import { Bot } from "grammy";
import type { BotDependencies } from "./actions.js";
import { createAllowlistMiddleware, createCustomerCommandMiddleware } from "./auth.js";
import { BotIdentityRepository } from "./bot-identity-repository.js";
import { CustomerWorkspaceRepository } from "./customer-workspace-repository.js";
import { CustomerKeyRepository } from "../customer-keys.js";
import { BillingRepository } from "../billing.js";
import { AuditLogRepository } from "../audit-log.js";
import { registerCustomerActionCallbacks } from "./customer-actions.js";
import { registerAccountsCommand } from "./commands/accounts.js";
import { registerApiKeyCommand } from "./commands/apikey.js";
import { registerApplyCommand } from "./commands/apply.js";
import { registerClientsCommand } from "./commands/clients.js";
import { registerGrantCommand } from "./commands/grant.js";
import { registerHelpCommand } from "./commands/help.js";
import { registerMeCommand } from "./commands/me.js";
import { registerModelsCommand } from "./commands/models.js";
import { registerOauthCommand } from "./commands/oauth.js";
import { registerPlansCommand } from "./commands/plans.js";
import { registerProvidersCommand } from "./commands/providers.js";
import { registerQuotaCommand } from "./commands/quota.js";
import { registerRenewCommand } from "./commands/renew.js";
import { registerRenewUserCommand } from "./commands/renew-user.js";
import { registerStartCommand } from "./commands/start.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerTailscaleCommand } from "./commands/tailscale.js";
import { registerTestCommand } from "./commands/test.js";
import { registerUsageCommand } from "./commands/usage.js";
import { createRateLimitMiddleware, SqliteRateLimiter } from "./rate-limit.js";
import { SqliteSessionStore } from "./sessions.js";
import { createCustomerMessageCleanupMiddleware } from "./message-cleanup.js";

export function createTelegramBot(deps: BotDependencies): Bot {
  const bot = new Bot(deps.config.telegramBotToken);
  const identities = BotIdentityRepository.create(deps.config.sessionDbPath);
  const workspaces = CustomerWorkspaceRepository.create(deps.config.sessionDbPath);
  const sessions = SqliteSessionStore.create(deps.config.sessionDbPath, deps.config.sessionTtlMs);
  const customerKeys = CustomerKeyRepository.create(deps.config.sessionDbPath);
  const billing = BillingRepository.create(deps.config.sessionDbPath);
  const auditLog = AuditLogRepository.create(deps.config.sessionDbPath);
  const rateLimiter = SqliteRateLimiter.create(deps.config.sessionDbPath, {
    windowMs: deps.config.rateLimitWindowMs,
    maxRequests: deps.config.rateLimitMaxRequests,
  });

  bot.use(createAllowlistMiddleware(deps.config));
  bot.use(async (ctx, next) => {
    const fromId = ctx.from?.id?.toString();
    const chatId = ctx.chat?.id?.toString();
    if (fromId) {
      identities.upsertUser({
        telegramUserId: fromId,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        lastName: ctx.from?.last_name,
        languageCode: ctx.from?.language_code,
        defaultRole: deps.config.ownerUserIds.has(fromId) ? "owner" : "customer",
        defaultStatus: deps.config.requireAdminApproval ? "pending_approval" : "active",
      });
    }
    if (chatId && ctx.chat) {
      identities.upsertChat({
        telegramChatId: chatId,
        chatType: ctx.chat.type,
        title: "title" in ctx.chat ? ctx.chat.title : undefined,
      });
    }
    if (fromId && chatId) {
      identities.upsertMembership({
        telegramUserId: fromId,
        telegramChatId: chatId,
      });
    }
    await next();
  });
  bot.use(createCustomerCommandMiddleware(deps.config));
  bot.use(createRateLimitMiddleware(rateLimiter));
  bot.use(createCustomerMessageCleanupMiddleware(deps.config));

  registerStartCommand(bot, deps, identities, workspaces, customerKeys, billing);
  registerCustomerActionCallbacks(bot, workspaces, customerKeys, billing, auditLog);
  registerHelpCommand(bot, deps);
  registerMeCommand(bot, identities, workspaces, customerKeys, auditLog);
  registerPlansCommand(bot, deps, billing);
  registerApiKeyCommand(bot, deps, customerKeys, workspaces, billing, auditLog);
  registerTailscaleCommand(bot, deps);
  registerUsageCommand(bot, workspaces, customerKeys, billing);
  registerQuotaCommand(bot, workspaces, customerKeys, billing);
  registerRenewCommand(bot, deps, sessions, identities, workspaces, customerKeys, billing, auditLog);
  registerGrantCommand(bot, deps, identities, workspaces, customerKeys, billing, auditLog);
  registerRenewUserCommand(bot, deps, identities, workspaces, customerKeys, billing, auditLog);
  registerStatusCommand(bot, deps);
  registerProvidersCommand(bot, deps);
  registerClientsCommand(bot, deps);
  registerModelsCommand(bot, deps);
  registerApplyCommand(bot, deps, sessions);
  registerOauthCommand(bot, deps, sessions);
  registerAccountsCommand(bot, deps, sessions);
  registerTestCommand(bot, deps, sessions);

  bot.catch((error) => {
    const ctx = error.ctx;
    console.error("telegram bot error", {
      error:
        error.error instanceof Error
          ? {
              name: error.error.name,
              message: error.error.message,
              stack: error.error.stack,
            }
          : error.error,
      updateType: resolveUpdateType(ctx.update),
      chatId: ctx.chat?.id,
      fromId: ctx.from?.id,
      callbackData: ctx.callbackQuery?.data,
      messageText: ctx.message && "text" in ctx.message ? ctx.message.text : undefined,
    });
  });

  return bot;
}

function resolveUpdateType(update: object): string {
  for (const key of Object.keys(update)) {
    if (key !== "update_id") {
      return key;
    }
  }
  return "unknown";
}
