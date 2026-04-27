import type { Bot } from "grammy";
import type { BotIdentityRepository } from "../bot-identity-repository.js";
import type { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";

export function registerMeCommand(
  bot: Bot,
  identities: BotIdentityRepository,
  workspaces: CustomerWorkspaceRepository,
): void {
  bot.command("me", async (ctx) => {
    const userId = ctx.from?.id?.toString();
    const chatId = ctx.chat?.id?.toString();
    const user = userId ? identities.getUser(userId) : undefined;
    const workspace = userId ? workspaces.getDefaultWorkspace(userId) : undefined;

    await ctx.reply(
      [
        "Your account",
        `telegram_user_id: ${userId ?? "unknown"}`,
        `telegram_chat_id: ${chatId ?? "unknown"}`,
        `role: ${user?.role ?? "unknown"}`,
        `status: ${user?.status ?? "unknown"}`,
        workspace ? `workspace_id: ${workspace.id}` : "workspace_id: none",
        workspace ? `workspace_status: ${workspace.status}` : undefined,
        workspace ? `client_route: ${workspace.defaultClientRoute}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  });
}
