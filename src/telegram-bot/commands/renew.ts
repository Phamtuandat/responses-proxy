import type { Bot, Context } from "grammy";
import type { BillingRepository, RenewalRequestRecord } from "../../billing.js";
import type { CustomerKeyRepository } from "../../customer-keys.js";
import type { AuditLogRepository } from "../../audit-log.js";
import { isAdmin } from "../auth.js";
import type { BotDependencies } from "../actions.js";
import type { BotIdentityRepository } from "../bot-identity-repository.js";
import type { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";
import { renewCustomerAccess } from "../grants.js";
import { replyWithProxyError } from "../actions.js";

export function registerRenewCommand(
  bot: Bot,
  deps: BotDependencies,
  identities: BotIdentityRepository,
  workspaces: CustomerWorkspaceRepository,
  customerKeys: CustomerKeyRepository,
  billing: BillingRepository,
  auditLog: AuditLogRepository,
): void {
  bot.command("renew", async (ctx) => {
    const rawArgs = ctx.match?.toString() || "";
    if (isAdmin(ctx, deps.config)) {
      await handleAdminRenewCommand(ctx, deps, identities, workspaces, customerKeys, billing, auditLog, rawArgs);
      return;
    }
    await handleCustomerRenewCommand(ctx, deps, workspaces, billing, auditLog, rawArgs);
  });
}

async function handleCustomerRenewCommand(
  ctx: Context,
  deps: BotDependencies,
  workspaces: CustomerWorkspaceRepository,
  billing: BillingRepository,
  auditLog: AuditLogRepository,
  rawArgs: string,
): Promise<void> {
  if (ctx.chat?.type !== "private") {
    await ctx.reply("For safety, open a private chat with this bot and run /renew there.");
    return;
  }

  const telegramUserId = ctx.from?.id?.toString();
  if (!telegramUserId) {
    await ctx.reply("Could not determine your Telegram user.");
    return;
  }

  const workspace = workspaces.getDefaultWorkspace(telegramUserId);
  if (!workspace) {
    await ctx.reply("No customer workspace has been assigned to your Telegram user yet.");
    return;
  }

  const parsed = parseCustomerRenewArgs(rawArgs);
  if (rawArgs.trim() && !parsed) {
    await ctx.reply("Usage: /renew or /renew <planId> <days>");
    return;
  }

  const created = billing.createRenewalRequest({
    workspaceId: workspace.id,
    telegramUserId,
    requestedPlanId: parsed?.planId,
    requestedDays: parsed?.days,
  });
  if (created.created) {
    auditLog.record({
      event: "renewal.requested",
      actor: { type: "customer", id: telegramUserId },
      subjectType: "renewal_request",
      subjectId: created.request.id,
      metadata: {
        workspaceId: workspace.id,
        telegramUserId,
        requestedPlanId: created.request.requestedPlanId,
        requestedDays: created.request.requestedDays,
      },
    });
  }

  const message = created.created
    ? [
        "Renewal request submitted.",
        `request_id: ${created.request.id}`,
        `workspace_id: ${workspace.id}`,
        created.request.requestedPlanId ? `requested_plan_id: ${created.request.requestedPlanId}` : undefined,
        created.request.requestedDays ? `requested_days: ${created.request.requestedDays}` : undefined,
        "Admin will review and process payment manually.",
      ]
    : [
        "You already have an open renewal request.",
        `request_id: ${created.request.id}`,
        created.request.requestedPlanId ? `requested_plan_id: ${created.request.requestedPlanId}` : undefined,
        created.request.requestedDays ? `requested_days: ${created.request.requestedDays}` : undefined,
        "Please wait for admin review.",
      ];
  await ctx.reply(message.filter(Boolean).join("\n"));

  if (created.created) {
    await notifyAdminsAboutRenewalRequest(ctx, deps, created.request);
  }
}

async function handleAdminRenewCommand(
  ctx: Context,
  deps: BotDependencies,
  identities: BotIdentityRepository,
  workspaces: CustomerWorkspaceRepository,
  customerKeys: CustomerKeyRepository,
  billing: BillingRepository,
  auditLog: AuditLogRepository,
  rawArgs: string,
): Promise<void> {
  const args = rawArgs.trim().split(/\s+/g).filter(Boolean);
  const subcommand = args[0]?.toLowerCase();

  if (!subcommand) {
    await ctx.reply("Usage: /renew list | /renew approve <requestId> <planId> <days> [replace-key] | /renew close <requestId> [reason]");
    return;
  }

  if (subcommand === "list") {
    const openRequests = billing.listRenewalRequests("open");
    if (openRequests.length === 0) {
      await ctx.reply("No open renewal requests.");
      return;
    }
    await ctx.reply(
      [
        "Open renewal requests:",
        ...openRequests.slice(0, 10).map(formatRenewalRequestLine),
      ].join("\n"),
    );
    return;
  }

  if (subcommand === "close") {
    const requestId = args[1];
    const reason = args.slice(2).join(" ").trim();
    if (!requestId) {
      await ctx.reply("Usage: /renew close <requestId> [reason]");
      return;
    }
    const request = billing.getRenewalRequest(requestId);
    if (!request) {
      await ctx.reply("Renewal request was not found.");
      return;
    }
    if (request.status !== "open") {
      await ctx.reply("Renewal request is not open anymore.");
      return;
    }

    const closed = billing.closeRenewalRequest({
      id: requestId,
      resolution: reason || "closed_by_admin",
    });
    await ctx.reply(
      [
        "Renewal request closed.",
        `request_id: ${closed?.id ?? requestId}`,
        `status: ${closed?.status ?? "closed"}`,
        `resolution: ${closed?.resolution ?? (reason || "closed_by_admin")}`,
      ].join("\n"),
    );
    return;
  }

  if (subcommand === "approve") {
    const [requestId, planId, daysRaw, replaceKeyRaw] = args.slice(1);
    const days = Number(daysRaw);
    if (!requestId || !planId || !Number.isInteger(days) || days <= 0 || (replaceKeyRaw && replaceKeyRaw !== "replace-key")) {
      await ctx.reply("Usage: /renew approve <requestId> <planId> <days> [replace-key]");
      return;
    }

    const request = billing.getRenewalRequest(requestId);
    if (!request) {
      await ctx.reply("Renewal request was not found.");
      return;
    }
    if (request.status !== "open") {
      await ctx.reply("Renewal request is not open anymore.");
      return;
    }

    try {
      const result = await renewCustomerAccess({
        telegramUserId: request.telegramUserId,
        planId,
        days,
        replaceKey: replaceKeyRaw === "replace-key",
        defaultClientRoute: deps.config.defaultCustomerRoute,
        identities,
        workspaces,
        customerKeys,
        billing,
        proxyClient: deps.proxyClient,
        auditLog,
        actor: { type: "admin", id: ctx.from?.id?.toString() },
      });
      billing.approveRenewalRequest({
        id: requestId,
        approvedPlanId: planId,
        approvedDays: days,
        resolution: "approved_by_admin",
      });
      if (result.apiKey && ctx.chat?.type === "private") {
        auditLog.record({
          event: "api_key.revealed",
          actor: { type: "admin", id: ctx.from?.id?.toString() },
          subjectType: "customer_api_key",
          subjectId: result.keyId,
          metadata: {
            telegramUserId: request.telegramUserId,
            workspaceId: result.workspaceId,
            keyPreview: result.keyPreview,
            audience: "admin_private_chat",
            apiKey: result.apiKey,
          },
        });
      }

      await ctx.reply(
        [
          "Renewal request approved.",
          `request_id: ${requestId}`,
          `telegram_user_id: ${request.telegramUserId}`,
          `plan_id: ${planId}`,
          `days: ${days}`,
          `mode: ${result.mode}`,
          `subscription_ends_at: ${result.subscriptionEndsAt}`,
        ].join("\n"),
      );
    } catch (error) {
      await replyWithProxyError(ctx, error);
    }
    return;
  }

  await ctx.reply("Usage: /renew list | /renew approve <requestId> <planId> <days> [replace-key] | /renew close <requestId> [reason]");
}

function parseCustomerRenewArgs(raw: string): { planId: string; days: number } | undefined {
  const args = raw.trim().split(/\s+/g).filter(Boolean);
  if (args.length === 0) {
    return undefined;
  }
  const [planId, daysRaw] = args;
  const days = Number(daysRaw);
  if (!planId || !Number.isInteger(days) || days <= 0) {
    return undefined;
  }
  return { planId, days };
}

async function notifyAdminsAboutRenewalRequest(
  ctx: Context,
  deps: BotDependencies,
  request: RenewalRequestRecord,
): Promise<void> {
  const recipients = new Set([
    ...deps.config.ownerUserIds,
    ...deps.config.adminUserIds,
  ]);
  const requesterId = ctx.from?.id?.toString();
  if (requesterId) {
    recipients.delete(requesterId);
  }

  const text = [
    "New renewal request.",
    `request_id: ${request.id}`,
    `telegram_user_id: ${request.telegramUserId}`,
    `workspace_id: ${request.workspaceId}`,
    request.requestedPlanId ? `requested_plan_id: ${request.requestedPlanId}` : undefined,
    request.requestedDays ? `requested_days: ${request.requestedDays}` : undefined,
    `requested_at: ${request.requestedAt}`,
  ]
    .filter(Boolean)
    .join("\n");

  for (const recipient of recipients) {
    try {
      await ctx.api.sendMessage(Number(recipient), text);
    } catch {
      // best effort admin notification
    }
  }
}

function formatRenewalRequestLine(request: RenewalRequestRecord): string {
  return [
    `- ${request.id}`,
    `telegram_user_id=${request.telegramUserId}`,
    request.requestedPlanId ? `plan_id=${request.requestedPlanId}` : undefined,
    request.requestedDays ? `days=${request.requestedDays}` : undefined,
    `requested_at=${request.requestedAt}`,
  ]
    .filter(Boolean)
    .join(" ");
}
