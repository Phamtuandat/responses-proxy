import type { Bot, Context } from "grammy";
import type { CustomerKeyRepository } from "../../customer-keys.js";
import type { AuditLogRepository } from "../../audit-log.js";
import { isAdmin } from "../auth.js";
import type { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";
import { maskApiKey } from "../format.js";
import { replyWithProxyError, type BotDependencies } from "../actions.js";

export function registerApiKeyCommand(
  bot: Bot,
  deps: BotDependencies,
  customerKeys: CustomerKeyRepository,
  workspaces: CustomerWorkspaceRepository,
  auditLog: AuditLogRepository,
): void {
  bot.command("apikey", async (ctx) => {
    const args = ctx.match?.toString().trim() || "";
    if (args.startsWith("issue ")) {
      await issueCustomerApiKey(ctx, deps, customerKeys, workspaces, auditLog, args.slice("issue ".length).trim());
      return;
    }

    if (ctx.chat?.type !== "private") {
      await ctx.reply("For safety, open a private chat with this bot and run /apikey there.");
      return;
    }

    const userId = ctx.from?.id?.toString();
    const record = userId ? customerKeys.getActiveKeyForUser(userId) : undefined;
    if (!record) {
      await ctx.reply("No Responses API key has been assigned to your Telegram user yet.");
      return;
    }

    await ctx.reply(
      [
        "Your Responses API key",
        `base_url: ${deps.config.publicResponsesBaseUrl}`,
        `client_route: ${record.clientRoute}`,
        `key_status: ${record.status}`,
        `key_preview: ${record.apiKeyPreview}`,
      ].join("\n"),
    );
  });
}

async function issueCustomerApiKey(
  ctx: Context,
  deps: BotDependencies,
  customerKeys: CustomerKeyRepository,
  workspaces: CustomerWorkspaceRepository,
  auditLog: AuditLogRepository,
  args: string,
): Promise<void> {
  if (!isAdmin(ctx, deps.config)) {
    await ctx.reply("Only admins can issue customer API keys.");
    return;
  }

  const [userId, clientRouteRaw, apiKeyRaw] = args.split(/\s+/g);
  if (!/^\d+$/.test(userId ?? "")) {
    await ctx.reply("Usage: /apikey issue <telegramUserId> [clientRoute] [apiKey]");
    return;
  }

  const clientRoute = normalizeClientRoute(clientRouteRaw || deps.config.defaultCustomerRoute);

  try {
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: userId,
      defaultClientRoute: clientRoute,
      status: "active",
    });
    const created = customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: userId,
      clientRoute,
      apiKey: apiKeyRaw,
    });
    auditLog.record({
      event: "api_key.created",
      actor: { type: "admin", id: ctx.from?.id?.toString() },
      subjectType: "customer_api_key",
      subjectId: created.record.id,
      metadata: {
        telegramUserId: userId,
        workspaceId: workspace.id,
        clientRoute,
        keyPreview: created.record.apiKeyPreview,
      },
    });

    const clientConfigs = await deps.proxyClient.getClientConfigs();
    const currentKeys = readClientRouteKeys(clientConfigs, clientRoute);
    const nextKeys = [...new Set([...currentKeys, created.apiKey])];
    await deps.proxyClient.setClientRouteApiKeys({
      client: clientRoute,
      apiKeys: nextKeys,
    });

    await ctx.reply(
      [
        "Customer API key issued.",
        `telegram_user_id: ${userId}`,
        `workspace_id: ${workspace.id}`,
        `client_route: ${created.record.clientRoute}`,
        `api_key: ${created.apiKey}`,
        `key_preview: ${maskApiKey(created.apiKey)}`,
        "This full key is shown once. Ask the customer to open this bot and run /apikey for status later.",
      ].join("\n"),
    );
    auditLog.record({
      event: "api_key.revealed",
      actor: { type: "admin", id: ctx.from?.id?.toString() },
      subjectType: "customer_api_key",
      subjectId: created.record.id,
      metadata: {
        telegramUserId: userId,
        workspaceId: workspace.id,
        keyPreview: created.record.apiKeyPreview,
        audience: ctx.chat?.type === "private" ? "admin_private_chat" : "admin_chat",
        apiKey: created.apiKey,
      },
    });
  } catch (error) {
    await replyWithProxyError(ctx, error);
  }
}

function readClientRouteKeys(payload: any, clientRoute: string): string[] {
  const routes = [
    ...(Array.isArray(payload?.clientRoutes) ? payload.clientRoutes : []),
    ...Object.values(payload?.clients ?? {})
      .map((entry: any) => entry?.route)
      .filter(Boolean),
  ];
  const route = routes.find((entry: any) => entry?.key === clientRoute);
  return Array.isArray(route?.apiKeys)
    ? route.apiKeys.filter((entry: unknown): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function normalizeClientRoute(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "customers";
}
