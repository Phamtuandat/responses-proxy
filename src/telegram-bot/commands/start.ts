import type { Bot } from "grammy";
import type { BotDependencies } from "../actions.js";
import type { BotIdentityRepository } from "../bot-identity-repository.js";
import type { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";

export function registerStartCommand(
  bot: Bot,
  deps: BotDependencies,
  identities: BotIdentityRepository,
  workspaces: CustomerWorkspaceRepository,
): void {
  bot.command("start", async (ctx) => {
    const userId = ctx.from?.id?.toString();
    const chatId = ctx.chat?.id?.toString();
    const user = userId ? identities.getUser(userId) : undefined;
    const workspace =
      userId && deps.config.publicSignupEnabled
        ? workspaces.ensureDefaultWorkspace({
            ownerTelegramUserId: userId,
            telegramChatId: chatId,
            defaultClientRoute: deps.config.defaultCustomerRoute,
            status: deps.config.requireAdminApproval ? "pending_approval" : "active",
          })
        : undefined;

    await ctx.reply(
      [
        "Responses Proxy bot is ready.",
        user ? `account: ${user.status}` : undefined,
        workspace ? `workspace: ${workspace.status}` : undefined,
        "Use /help to see available commands.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  });
}
