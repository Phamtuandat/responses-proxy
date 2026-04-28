import { InlineKeyboard, type Bot, type Context } from "grammy";
import type { BillingRepository } from "../../billing.js";
import type { CustomerApiKeyRecord, CustomerKeyRepository } from "../../customer-keys.js";
import type { AuditLogRepository } from "../../audit-log.js";
import { replyAdminActionLoop } from "../admin-actions.js";
import { isAdmin } from "../auth.js";
import { answerCallbackQuerySafely } from "../callbacks.js";
import { buildCustomerActionKeyboard } from "../customer-actions.js";
import type { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";
import { maskApiKey } from "../format.js";
import { replyWithProxyError, type BotDependencies } from "../actions.js";
import { assertWorkspaceApiKeyCapacity } from "../grants.js";

type AdminKeyAction = "show" | "suspend" | "activate" | "revoke" | "rotate";

export function registerApiKeyCommand(
  bot: Bot,
  deps: BotDependencies,
  customerKeys: CustomerKeyRepository,
  workspaces: CustomerWorkspaceRepository,
  billing: BillingRepository,
  auditLog: AuditLogRepository,
): void {
  bot.command("apikey", async (ctx) => {
    const args = ctx.match?.toString().trim() || "";
    if (args.startsWith("issue ")) {
      await issueCustomerApiKey(ctx, deps, customerKeys, workspaces, billing, auditLog, args.slice("issue ".length).trim());
      return;
    }
    if (args && isAdmin(ctx, deps.config)) {
      await handleAdminApiKeyCommand(ctx, deps, customerKeys, workspaces, billing, auditLog, args);
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
    const apiKey = customerKeys.getApiKeySecret(record.id);
    if (apiKey) {
      auditLog.record({
        event: "api_key.revealed",
        actor: { type: "customer", id: userId },
        subjectType: "customer_api_key",
        subjectId: record.id,
        metadata: {
          telegramUserId: userId,
          workspaceId: record.workspaceId,
          keyPreview: record.apiKeyPreview,
          audience: "customer_private_chat",
          apiKey,
        },
      });
    }

    await ctx.reply(
      [
        "Your Responses API key",
        `base_url: ${deps.config.publicResponsesBaseUrl}`,
        `client_route: ${record.clientRoute}`,
        `key_status: ${record.status}`,
        apiKey ? `api_key: ${apiKey}` : undefined,
        `key_preview: ${record.apiKeyPreview}`,
        apiKey ? undefined : "full_key: unavailable_for_legacy_key",
      ]
        .filter(Boolean)
        .join("\n"),
      { reply_markup: buildCustomerActionKeyboard(record.status === "active") },
    );
  });

  const adminKeyActions: Record<AdminKeyAction, (ctx: Context, record: CustomerApiKeyRecord) => Promise<void>> = {
    show: async (ctx, record) => {
      await answerCallbackQuerySafely(ctx, { text: "Key details loaded" });
      await showAdminApiKey(ctx, customerKeys, auditLog, record);
      await replyAdminActionLoop(ctx, "keys");
    },
    suspend: async (ctx, record) => {
      const ok = await changeCustomerApiKeyStatus(ctx, deps, customerKeys, auditLog, record, "suspend");
      await answerCallbackQuerySafely(ctx,
        ok ? { text: "Key suspended" } : { text: "Key update failed. Check the bot message.", show_alert: true },
      );
    },
    revoke: async (ctx, record) => {
      const ok = await changeCustomerApiKeyStatus(ctx, deps, customerKeys, auditLog, record, "revoke");
      await answerCallbackQuerySafely(ctx,
        ok ? { text: "Key revoked" } : { text: "Key update failed. Check the bot message.", show_alert: true },
      );
    },
    activate: async (ctx, record) => {
      const ok = await activateCustomerApiKey(ctx, deps, customerKeys, auditLog, record);
      await answerCallbackQuerySafely(ctx,
        ok ? { text: "Key activated" } : { text: "Key activation failed. Check the bot message.", show_alert: true },
      );
    },
    rotate: async (ctx, record) => {
      if (!record.telegramUserId) {
        await answerCallbackQuerySafely(ctx, { text: "This key is not linked to a Telegram user.", show_alert: true });
        return;
      }
      const ok = await rotateCustomerApiKey(ctx, deps, customerKeys, workspaces, billing, auditLog, {
        telegramUserId: record.telegramUserId,
        clientRoute: record.clientRoute,
      });
      await answerCallbackQuerySafely(ctx,
        ok ? { text: "Key rotated" } : { text: "Key rotation failed. Check the bot message.", show_alert: true },
      );
    },
  };

  bot.callbackQuery(/^v1:apikey:(show|suspend|activate|revoke|rotate):([A-Za-z0-9_-]+)$/, async (ctx) => {
    if (!isAdmin(ctx, deps.config)) {
      await answerCallbackQuerySafely(ctx, { text: "Admin only.", show_alert: true });
      return;
    }

    const action = ctx.match[1];
    const keyId = ctx.match[2];
    const record = customerKeys.getById(keyId);
    if (!record) {
      await answerCallbackQuerySafely(ctx, { text: "Key not found.", show_alert: true });
      return;
    }
    await adminKeyActions[action as AdminKeyAction](ctx, record);
  });

  bot.on("message:text", async (ctx, next) => {
    if (!isAdmin(ctx, deps.config)) {
      await next();
      return;
    }
    if (ctx.message.text.trim().startsWith("/")) {
      await next();
      return;
    }
    const record = resolveAdminKeyPaste(customerKeys, ctx.message.text);
    if (!record) {
      await next();
      return;
    }
    await showAdminApiKey(ctx, customerKeys, auditLog, record);
    await replyAdminActionLoop(ctx, "keys");
  });
}

async function handleAdminApiKeyCommand(
  ctx: Context,
  deps: BotDependencies,
  customerKeys: CustomerKeyRepository,
  workspaces: CustomerWorkspaceRepository,
  billing: BillingRepository,
  auditLog: AuditLogRepository,
  rawArgs: string,
): Promise<void> {
  const args = rawArgs.split(/\s+/g).filter(Boolean);
  const [subcommand, target, clientRouteRaw] = args;
  if (!subcommand || subcommand === "help") {
    await ctx.reply(formatAdminApiKeyUsage());
    return;
  }

  if (subcommand === "list") {
    if (!/^\d+$/.test(target ?? "")) {
      await ctx.reply("Usage: /apikey list <telegramUserId>");
      return;
    }
    const keys = customerKeys.listKeysByUser(target);
    await ctx.reply(
      [
        `Customer API keys for ${target}`,
        "Tap a key button to copy its id, paste it back into this chat, then send to manage.",
        keys.length === 0 ? "none" : undefined,
        ...keys.map(formatCustomerKeyLine),
      ]
        .filter(Boolean)
        .join("\n"),
      keys.length > 0 ? { reply_markup: buildAdminKeyListKeyboard(keys) } : undefined,
    );
    await replyAdminActionLoop(ctx, "keys");
    return;
  }

  if (subcommand === "show") {
    const record = resolveAdminKeyTarget(customerKeys, target);
    if (!record) {
      await ctx.reply("Usage: /apikey show <keyId|telegramUserId>");
      return;
    }
    await showAdminApiKey(ctx, customerKeys, auditLog, record);
    await replyAdminActionLoop(ctx, "keys");
    return;
  }

  if (subcommand === "suspend" || subcommand === "revoke") {
    const record = target ? customerKeys.getById(target) : undefined;
    if (!record) {
      await ctx.reply(`Usage: /apikey ${subcommand} <keyId>`);
      return;
    }
    await changeCustomerApiKeyStatus(ctx, deps, customerKeys, auditLog, record, subcommand);
    return;
  }

  if (subcommand === "activate") {
    const record = target ? customerKeys.getById(target) : undefined;
    if (!record) {
      await ctx.reply("Usage: /apikey activate <keyId>");
      return;
    }
    await activateCustomerApiKey(ctx, deps, customerKeys, auditLog, record);
    return;
  }

  if (subcommand === "rotate") {
    if (!/^\d+$/.test(target ?? "")) {
      await ctx.reply("Usage: /apikey rotate <telegramUserId> [clientRoute]");
      return;
    }
    await rotateCustomerApiKey(ctx, deps, customerKeys, workspaces, billing, auditLog, {
      telegramUserId: target,
      clientRoute: clientRouteRaw,
    });
    return;
  }

  await ctx.reply(formatAdminApiKeyUsage());
}

async function showAdminApiKey(
  ctx: Context,
  customerKeys: CustomerKeyRepository,
  auditLog: AuditLogRepository,
  record: CustomerApiKeyRecord,
): Promise<void> {
  const apiKey = ctx.chat?.type === "private" ? customerKeys.getApiKeySecret(record.id) : undefined;
  if (apiKey) {
    auditLog.record({
      event: "api_key.revealed",
      actor: { type: "admin", id: ctx.from?.id?.toString() },
      subjectType: "customer_api_key",
      subjectId: record.id,
      metadata: {
        telegramUserId: record.telegramUserId,
        workspaceId: record.workspaceId,
        keyPreview: record.apiKeyPreview,
        audience: "admin_key_management",
        apiKey,
      },
    });
  }
  await ctx.reply(
    [
      "Customer API key",
      ...formatCustomerKeyDetails(record),
      apiKey ? `api_key: ${apiKey}` : undefined,
      record.apiKeySecret && ctx.chat?.type !== "private"
        ? "api_key_delivery: full key is only shown in a private admin chat."
        : undefined,
      !record.apiKeySecret ? "full_key: unavailable_for_legacy_key" : undefined,
    ]
      .filter(Boolean)
      .join("\n"),
    { reply_markup: buildAdminKeyActionsKeyboard(record) },
  );
}

async function changeCustomerApiKeyStatus(
  ctx: Context,
  deps: BotDependencies,
  customerKeys: CustomerKeyRepository,
  auditLog: AuditLogRepository,
  record: CustomerApiKeyRecord,
  action: "suspend" | "revoke",
): Promise<boolean> {
  const status = action === "suspend" ? "suspended" : "revoked";
  try {
    const apiKey = customerKeys.getApiKeySecret(record.id);
    if (apiKey) {
      await syncRemoveRouteApiKey(deps, record.clientRoute, apiKey);
    }
    const updated = customerKeys.setStatus(record.id, status);
    auditLog.record({
      event: status === "suspended" ? "api_key.suspended" : "api_key.revoked",
      actor: { type: "admin", id: ctx.from?.id?.toString() },
      subjectType: "customer_api_key",
      subjectId: record.id,
      metadata: {
        telegramUserId: record.telegramUserId,
        workspaceId: record.workspaceId,
        keyPreview: record.apiKeyPreview,
        reason: "admin_key_management",
        proxySynced: !!apiKey,
      },
    });
    await ctx.reply(
      [
        `Customer API key ${status}.`,
        `key_id: ${record.id}`,
        `key_status: ${updated?.status ?? status}`,
        apiKey ? "proxy_sync: removed_from_route" : "proxy_sync: skipped_legacy_secret_unavailable",
      ].join("\n"),
      { reply_markup: updated ? buildAdminKeyActionsKeyboard(updated) : undefined },
    );
    await replyAdminActionLoop(ctx, "keys");
    return true;
  } catch (error) {
    await replyWithProxyError(ctx, error);
    return false;
  }
}

async function activateCustomerApiKey(
  ctx: Context,
  deps: BotDependencies,
  customerKeys: CustomerKeyRepository,
  auditLog: AuditLogRepository,
  record: CustomerApiKeyRecord,
): Promise<boolean> {
  const apiKey = customerKeys.getApiKeySecret(record.id);
  if (!apiKey) {
    await ctx.reply("Cannot activate this legacy key because the full key is unavailable. Use /apikey rotate <telegramUserId>.");
    return false;
  }
  try {
    await syncAddRouteApiKey(deps, record.clientRoute, apiKey);
    const updated = customerKeys.setStatus(record.id, "active");
    auditLog.record({
      event: "api_key.activated",
      actor: { type: "admin", id: ctx.from?.id?.toString() },
      subjectType: "customer_api_key",
      subjectId: record.id,
      metadata: {
        telegramUserId: record.telegramUserId,
        workspaceId: record.workspaceId,
        keyPreview: record.apiKeyPreview,
        reason: "admin_key_management",
      },
    });
    await ctx.reply(
      [
        "Customer API key activated.",
        `key_id: ${record.id}`,
        `key_status: ${updated?.status ?? "active"}`,
        "proxy_sync: added_to_route",
      ].join("\n"),
      { reply_markup: updated ? buildAdminKeyActionsKeyboard(updated) : undefined },
    );
    await replyAdminActionLoop(ctx, "keys");
    return true;
  } catch (error) {
    await replyWithProxyError(ctx, error);
    return false;
  }
}

async function issueCustomerApiKey(
  ctx: Context,
  deps: BotDependencies,
  customerKeys: CustomerKeyRepository,
  workspaces: CustomerWorkspaceRepository,
  billing: BillingRepository,
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
  if (!apiKeyRaw && ctx.chat?.type !== "private") {
    await ctx.reply("Run /apikey issue in a private admin chat when generating a new key, or provide an explicit apiKey.");
    return;
  }

  const clientRoute = normalizeClientRoute(clientRouteRaw || deps.config.defaultCustomerRoute);

  try {
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: userId,
      defaultClientRoute: clientRoute,
      status: "active",
    });
    assertWorkspaceApiKeyCapacity({
      workspaceId: workspace.id,
      billing,
      customerKeys,
    });
    const created = customerKeys.createKey({
      workspaceId: workspace.id,
      telegramUserId: userId,
      clientRoute,
      apiKey: apiKeyRaw,
      status: "suspended",
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

    try {
      const clientConfigs = await deps.proxyClient.getClientConfigs();
      const currentKeys = readClientRouteKeys(clientConfigs, clientRoute);
      const nextKeys = [...new Set([...currentKeys, created.apiKey])];
      await deps.proxyClient.setClientRouteApiKeys({
        client: clientRoute,
        apiKeys: nextKeys,
      });
      customerKeys.setStatus(created.record.id, "active");
      auditLog.record({
        event: "api_key.activated",
        actor: { type: "admin", id: ctx.from?.id?.toString() },
        subjectType: "customer_api_key",
        subjectId: created.record.id,
        metadata: {
          telegramUserId: userId,
          workspaceId: workspace.id,
          keyPreview: created.record.apiKeyPreview,
          reason: "proxy_sync_succeeded",
        },
      });
    } catch (error) {
      customerKeys.setStatus(created.record.id, "revoked");
      auditLog.record({
        event: "api_key.revoked",
        actor: { type: "system", id: "proxy-sync-rollback" },
        subjectType: "customer_api_key",
        subjectId: created.record.id,
        metadata: {
          telegramUserId: userId,
          workspaceId: workspace.id,
          keyPreview: created.record.apiKeyPreview,
          reason: "proxy_sync_failed",
        },
      });
      throw error;
    }

    const canShowApiKeyToAdmin = ctx.chat?.type === "private";
    await ctx.reply(
      [
        "Customer API key issued.",
        `telegram_user_id: ${userId}`,
        `workspace_id: ${workspace.id}`,
        `client_route: ${created.record.clientRoute}`,
        `key_preview: ${maskApiKey(created.apiKey)}`,
        canShowApiKeyToAdmin ? `api_key: ${created.apiKey}` : undefined,
        canShowApiKeyToAdmin
          ? "This full key is shown once. Ask the customer to open this bot and run /apikey for status later."
          : "api_key_delivery: full key is only shown in a private admin chat.",
      ]
        .filter(Boolean)
        .join("\n"),
      { reply_markup: buildAdminKeyActionsKeyboard(customerKeys.getById(created.record.id) ?? created.record) },
    );
    await replyAdminActionLoop(ctx, "keys");
    if (canShowApiKeyToAdmin) {
      auditLog.record({
        event: "api_key.revealed",
        actor: { type: "admin", id: ctx.from?.id?.toString() },
        subjectType: "customer_api_key",
        subjectId: created.record.id,
        metadata: {
          telegramUserId: userId,
          workspaceId: workspace.id,
          keyPreview: created.record.apiKeyPreview,
          audience: "admin_private_chat",
          apiKey: created.apiKey,
        },
      });
    }
  } catch (error) {
    await replyWithProxyError(ctx, error);
  }
}

async function rotateCustomerApiKey(
  ctx: Context,
  deps: BotDependencies,
  customerKeys: CustomerKeyRepository,
  workspaces: CustomerWorkspaceRepository,
  billing: BillingRepository,
  auditLog: AuditLogRepository,
  input: { telegramUserId: string; clientRoute?: string },
): Promise<boolean> {
  const workspace = workspaces.getDefaultWorkspace(input.telegramUserId);
  if (!workspace) {
    await ctx.reply("No customer workspace has been assigned to this Telegram user yet.");
    return false;
  }

  const currentKey = customerKeys.getActiveKeyForUser(input.telegramUserId) ?? customerKeys.getLatestKeyForUser(input.telegramUserId);
  const clientRoute = normalizeClientRoute(input.clientRoute || currentKey?.clientRoute || workspace.defaultClientRoute);
  const ignoredKeyIds = currentKey && currentKey.status !== "revoked" ? [currentKey.id] : [];
  assertWorkspaceApiKeyCapacity({
    workspaceId: workspace.id,
    billing,
    customerKeys,
    ignoredKeyIds,
  });

  const created = customerKeys.createKey({
    workspaceId: workspace.id,
    telegramUserId: input.telegramUserId,
    clientRoute,
    status: "suspended",
  });
  auditLog.record({
    event: "api_key.created",
    actor: { type: "admin", id: ctx.from?.id?.toString() },
    subjectType: "customer_api_key",
    subjectId: created.record.id,
    metadata: {
      telegramUserId: input.telegramUserId,
      workspaceId: workspace.id,
      clientRoute,
      keyPreview: created.record.apiKeyPreview,
      reason: "admin_rotation",
    },
  });
  if (currentKey) {
    auditLog.record({
      event: "api_key.rotated",
      actor: { type: "admin", id: ctx.from?.id?.toString() },
      subjectType: "customer_api_key",
      subjectId: created.record.id,
      metadata: {
        telegramUserId: input.telegramUserId,
        workspaceId: workspace.id,
        oldKeyId: currentKey.id,
        newKeyId: created.record.id,
        newKeyPreview: created.record.apiKeyPreview,
        reason: "admin_rotation",
      },
    });
  }

  try {
    const currentSecret = currentKey ? customerKeys.getApiKeySecret(currentKey.id) : undefined;
    await syncRotateRouteApiKey(deps, clientRoute, created.apiKey, currentSecret);
    customerKeys.setStatus(created.record.id, "active");
    auditLog.record({
      event: "api_key.activated",
      actor: { type: "admin", id: ctx.from?.id?.toString() },
      subjectType: "customer_api_key",
      subjectId: created.record.id,
      metadata: {
        telegramUserId: input.telegramUserId,
        workspaceId: workspace.id,
        keyPreview: created.record.apiKeyPreview,
        reason: "proxy_sync_succeeded",
      },
    });
    if (currentKey && currentKey.status !== "revoked") {
      customerKeys.setStatus(currentKey.id, "revoked");
      auditLog.record({
        event: "api_key.revoked",
        actor: { type: "admin", id: ctx.from?.id?.toString() },
        subjectType: "customer_api_key",
        subjectId: currentKey.id,
        metadata: {
          telegramUserId: input.telegramUserId,
          workspaceId: workspace.id,
          keyPreview: currentKey.apiKeyPreview,
          reason: "rotation",
          proxySynced: !!currentSecret,
        },
      });
    }
  } catch (error) {
    customerKeys.setStatus(created.record.id, "revoked");
    auditLog.record({
      event: "api_key.revoked",
      actor: { type: "system", id: "proxy-sync-rollback" },
      subjectType: "customer_api_key",
      subjectId: created.record.id,
      metadata: {
        telegramUserId: input.telegramUserId,
        workspaceId: workspace.id,
        keyPreview: created.record.apiKeyPreview,
        reason: "proxy_sync_failed",
      },
    });
    await replyWithProxyError(ctx, error);
    return false;
  }

  const canShowApiKeyToAdmin = ctx.chat?.type === "private";
  if (canShowApiKeyToAdmin) {
    auditLog.record({
      event: "api_key.revealed",
      actor: { type: "admin", id: ctx.from?.id?.toString() },
      subjectType: "customer_api_key",
      subjectId: created.record.id,
      metadata: {
        telegramUserId: input.telegramUserId,
        workspaceId: workspace.id,
        keyPreview: created.record.apiKeyPreview,
        audience: "admin_key_rotation",
        apiKey: created.apiKey,
      },
    });
  }
  await ctx.reply(
    [
      "Customer API key rotated.",
      `telegram_user_id: ${input.telegramUserId}`,
      `workspace_id: ${workspace.id}`,
      currentKey ? `old_key_id: ${currentKey.id}` : undefined,
      `new_key_id: ${created.record.id}`,
      `client_route: ${created.record.clientRoute}`,
      `key_preview: ${maskApiKey(created.apiKey)}`,
      canShowApiKeyToAdmin ? `api_key: ${created.apiKey}` : "api_key_delivery: full key is only shown in a private admin chat.",
    ]
      .filter(Boolean)
      .join("\n"),
    { reply_markup: buildAdminKeyActionsKeyboard(customerKeys.getById(created.record.id) ?? created.record) },
  );
  await replyAdminActionLoop(ctx, "keys");
  return true;
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

async function syncAddRouteApiKey(deps: BotDependencies, clientRoute: string, apiKey: string): Promise<void> {
  const clientConfigs = await deps.proxyClient.getClientConfigs();
  const currentKeys = readClientRouteKeys(clientConfigs, clientRoute);
  const nextKeys = [...new Set([...currentKeys, apiKey])];
  await deps.proxyClient.setClientRouteApiKeys({
    client: clientRoute,
    apiKeys: nextKeys,
  });
}

async function syncRemoveRouteApiKey(deps: BotDependencies, clientRoute: string, apiKey: string): Promise<void> {
  const clientConfigs = await deps.proxyClient.getClientConfigs();
  const currentKeys = readClientRouteKeys(clientConfigs, clientRoute);
  const nextKeys = currentKeys.filter((key) => key !== apiKey);
  await deps.proxyClient.setClientRouteApiKeys({
    client: clientRoute,
    apiKeys: nextKeys,
  });
}

async function syncRotateRouteApiKey(
  deps: BotDependencies,
  clientRoute: string,
  newApiKey: string,
  oldApiKey?: string,
): Promise<void> {
  const clientConfigs = await deps.proxyClient.getClientConfigs();
  const currentKeys = readClientRouteKeys(clientConfigs, clientRoute);
  const withoutOld = oldApiKey ? currentKeys.filter((key) => key !== oldApiKey) : currentKeys;
  const nextKeys = [...new Set([...withoutOld, newApiKey])];
  await deps.proxyClient.setClientRouteApiKeys({
    client: clientRoute,
    apiKeys: nextKeys,
  });
}

function resolveAdminKeyTarget(
  customerKeys: CustomerKeyRepository,
  target: string | undefined,
): CustomerApiKeyRecord | undefined {
  if (!target) {
    return undefined;
  }
  return /^\d+$/.test(target) ? customerKeys.getLatestKeyForUser(target) : customerKeys.getById(target);
}

function formatAdminApiKeyUsage(): string {
  return [
    "Usage:",
    "/apikey list <telegramUserId>",
    "/apikey show <keyId|telegramUserId> - opens action buttons",
    "/apikey suspend <keyId>",
    "/apikey activate <keyId>",
    "/apikey revoke <keyId>",
    "/apikey rotate <telegramUserId> [clientRoute]",
    "/apikey issue <telegramUserId> [clientRoute] [apiKey]",
  ].join("\n");
}

export function buildAdminKeyListKeyboard(keys: CustomerApiKeyRecord[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  keys.slice(0, 10).forEach((record) => {
    keyboard.copyText(`📋 ${formatKeyButtonLabel(record)}`, record.id).row();
  });
  return keyboard;
}

function buildAdminKeyActionsKeyboard(record: CustomerApiKeyRecord): InlineKeyboard {
  const keyboard = new InlineKeyboard().text("🔐 Reveal", `v1:apikey:show:${record.id}`);
  if (record.status === "active") {
    keyboard.text("🟡 Suspend", `v1:apikey:suspend:${record.id}`);
  } else if (record.status === "suspended" || record.status === "expired") {
    keyboard.text("🟢 Activate", `v1:apikey:activate:${record.id}`);
  }
  keyboard.row();
  if (record.status !== "revoked") {
    keyboard.text("🔴 Revoke", `v1:apikey:revoke:${record.id}`);
  }
  if (record.telegramUserId) {
    keyboard.text("🔵 Rotate", `v1:apikey:rotate:${record.id}`);
  }
  return keyboard;
}

function formatKeyButtonLabel(record: CustomerApiKeyRecord): string {
  const icon =
    record.status === "active"
      ? "🟢"
      : record.status === "suspended"
        ? "🟡"
        : record.status === "revoked"
          ? "🔴"
          : "⚪";
  return `${icon} ${record.apiKeyPreview}`;
}

function resolveAdminKeyPaste(
  customerKeys: CustomerKeyRepository,
  text: string,
): CustomerApiKeyRecord | undefined {
  const value = text.trim();
  if (!value || value.includes("\n") || value.length > 256) {
    return undefined;
  }
  const byId = customerKeys.getById(value);
  if (byId) {
    return byId;
  }
  if (value.startsWith("sk-")) {
    return customerKeys.getByApiKey(value);
  }
  return undefined;
}

function formatCustomerKeyLine(record: CustomerApiKeyRecord): string {
  return [
    `- ${record.id}`,
    `status=${record.status}`,
    `route=${record.clientRoute}`,
    `preview=${record.apiKeyPreview}`,
    `created=${record.createdAt}`,
    record.lastUsedAt ? `last_used=${record.lastUsedAt}` : undefined,
  ]
    .filter(Boolean)
    .join(" | ");
}

function formatCustomerKeyDetails(record: CustomerApiKeyRecord): string[] {
  return [
    `key_id: ${record.id}`,
    `workspace_id: ${record.workspaceId}`,
    record.telegramUserId ? `telegram_user_id: ${record.telegramUserId}` : undefined,
    record.telegramChatId ? `telegram_chat_id: ${record.telegramChatId}` : undefined,
    `client_route: ${record.clientRoute}`,
    `key_status: ${record.status}`,
    `key_preview: ${record.apiKeyPreview}`,
    record.name ? `name: ${record.name}` : undefined,
    record.expiresAt ? `expires_at: ${record.expiresAt}` : undefined,
    record.lastUsedAt ? `last_used_at: ${record.lastUsedAt}` : undefined,
    `created_at: ${record.createdAt}`,
    `updated_at: ${record.updatedAt}`,
    record.revokedAt ? `revoked_at: ${record.revokedAt}` : undefined,
  ].filter((line): line is string => !!line);
}

function normalizeClientRoute(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "customers";
}
