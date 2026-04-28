import { InlineKeyboard, type Bot, type Context } from "grammy";
import type { BillingRepository, RenewalRequestRecord } from "../../billing.js";
import type { CustomerKeyRepository } from "../../customer-keys.js";
import type { AuditLogRepository } from "../../audit-log.js";
import { isAdmin } from "../auth.js";
import type { BotDependencies } from "../actions.js";
import type { BotIdentityRepository } from "../bot-identity-repository.js";
import type { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";
import { readCustomerBillingOverview } from "../customer-billing.js";
import { renewCustomerAccess } from "../grants.js";
import { replyWithProxyError } from "../actions.js";
import { buildTelegramSessionScope, type TelegramBotStateStore } from "../sessions.js";

export function registerRenewCommand(
  bot: Bot,
  deps: BotDependencies,
  stateStore: TelegramBotStateStore,
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
    await handleCustomerRenewCommand(ctx, deps, stateStore, identities, workspaces, customerKeys, billing, auditLog, rawArgs);
  });

  bot.callbackQuery(/^v1:renew:plan:([A-Za-z0-9_-]+)$/, async (ctx) => {
    const token = ctx.match[1];
    const callbackState = stateStore.readCallbackToken(token);
    if (callbackState?.kind !== "renewal_plan") {
      await ctx.answerCallbackQuery({ text: "Selection expired. Run /renew again.", show_alert: true });
      return;
    }
    await ctx.answerCallbackQuery({ text: "Plan selected" });
    await handleCustomerRenewRequest(ctx, deps, stateStore, identities, workspaces, customerKeys, billing, auditLog, {
      planId: callbackState.planId,
      days: callbackState.days,
    });
  });

  bot.callbackQuery(
    /^v1:renew:(approve|approve-rotate|approve-30|approve-90|approve-custom|close|view-customer|reject-reasons|reject|reject-custom|back):([A-Za-z0-9_-]+)$/,
    async (ctx) => {
    if (!isAdmin(ctx, deps.config)) {
      await ctx.answerCallbackQuery({ text: "Admin only.", show_alert: true });
      return;
    }
    const action = normalizeRenewalAction(ctx.match[1]);
    const token = ctx.match[2];
    const callbackState = stateStore.readCallbackToken(token);
    if (callbackState?.kind !== "renewal_request_action" || callbackState.action !== action) {
      await ctx.answerCallbackQuery({ text: "Action expired. Refresh /renew list.", show_alert: true });
      return;
    }
    if (action === "approve") {
      const approved = await approveRenewalRequest(
        ctx,
        deps,
        identities,
        workspaces,
        customerKeys,
        billing,
        auditLog,
        callbackState.requestId,
        undefined,
        undefined,
        false,
        true,
      );
      if (approved) {
        await updateRenewalReviewMessage(ctx, approved.message);
        await ctx.answerCallbackQuery({ text: "Renewal approved" });
      }
      return;
    }
    if (action === "approve_rotate") {
      const approved = await approveRenewalRequest(
        ctx,
        deps,
        identities,
        workspaces,
        customerKeys,
        billing,
        auditLog,
        callbackState.requestId,
        undefined,
        undefined,
        true,
        true,
      );
      if (approved) {
        await updateRenewalReviewMessage(ctx, approved.message);
        await ctx.answerCallbackQuery({ text: "Renewal approved and key rotated" });
      }
      return;
    }
    if (action === "approve_override") {
      const approved = await approveRenewalRequest(
        ctx,
        deps,
        identities,
        workspaces,
        customerKeys,
        billing,
        auditLog,
        callbackState.requestId,
        undefined,
        callbackState.overrideDays,
        false,
        true,
      );
      if (approved) {
        await updateRenewalReviewMessage(ctx, approved.message);
        await ctx.answerCallbackQuery({ text: `Renewal approved for ${callbackState.overrideDays} days` });
      }
      return;
    }
    if (action === "prompt_custom_days") {
      const prepared = prepareRenewalAdminInput(ctx);
      if (!prepared) {
        await ctx.answerCallbackQuery({ text: "This action only works from a message button.", show_alert: true });
        return;
      }
      stateStore.set(buildTelegramSessionScope(prepared.chatId, prepared.userId), {
        kind: "awaiting_renewal_custom_days",
        requestId: callbackState.requestId,
        sourceChatId: prepared.chatId,
        sourceMessageId: prepared.messageId,
      });
      await ctx.answerCallbackQuery({ text: "Send the number of days in this chat" });
      await ctx.reply(`Send the override days for request ${callbackState.requestId}. Example: 45`);
      return;
    }
    if (action === "view_customer") {
      const shown = await showCustomerRenewalContext(ctx, identities, workspaces, customerKeys, billing, callbackState.requestId);
      if (shown) {
        await ctx.answerCallbackQuery({ text: "Customer details loaded" });
      }
      return;
    }
    if (action === "show_reject_reasons") {
      const request = billing.getRenewalRequest(callbackState.requestId);
      if (!request) {
        await ctx.answerCallbackQuery({ text: "Renewal request was not found.", show_alert: true });
        return;
      }
      await showRenewalRejectKeyboard(ctx, stateStore, request);
      await ctx.answerCallbackQuery({ text: "Choose a rejection reason" });
      return;
    }
    if (action === "prompt_custom_reason") {
      const prepared = prepareRenewalAdminInput(ctx);
      if (!prepared) {
        await ctx.answerCallbackQuery({ text: "This action only works from a message button.", show_alert: true });
        return;
      }
      stateStore.set(buildTelegramSessionScope(prepared.chatId, prepared.userId), {
        kind: "awaiting_renewal_reject_reason",
        requestId: callbackState.requestId,
        sourceChatId: prepared.chatId,
        sourceMessageId: prepared.messageId,
      });
      await ctx.answerCallbackQuery({ text: "Send the rejection reason in this chat" });
      await ctx.reply(`Send the rejection reason for request ${callbackState.requestId}.`);
      return;
    }
    if (action === "show_main_actions") {
      const request = billing.getRenewalRequest(callbackState.requestId);
      if (!request) {
        await ctx.answerCallbackQuery({ text: "Renewal request was not found.", show_alert: true });
        return;
      }
      await showRenewalMainKeyboard(ctx, stateStore, request);
      await ctx.answerCallbackQuery({ text: "Back to actions" });
      return;
    }
    const closed = await closeRenewalRequest(
      ctx,
      billing,
      auditLog,
      callbackState.requestId,
      callbackState.resolution ?? "closed_by_admin",
      true,
    );
    if (closed) {
      await updateRenewalReviewMessage(ctx, closed.message);
      await ctx.answerCallbackQuery({ text: action === "reject_reason" ? "Renewal rejected" : "Renewal closed" });
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const chatId = ctx.chat?.id?.toString();
    const userId = ctx.from?.id?.toString();
    if (!chatId || !userId || !isAdmin(ctx, deps.config)) {
      await next();
      return;
    }
    const scope = buildTelegramSessionScope(chatId, userId);
    const session = stateStore.get(scope);
    if (!session) {
      await next();
      return;
    }
    if (ctx.message.text.startsWith("/")) {
      await next();
      return;
    }

    if (session.kind === "awaiting_renewal_custom_days") {
      const days = Number(ctx.message.text.trim());
      if (!Number.isInteger(days) || days <= 0) {
        await ctx.reply("Please send a positive integer number of days.");
        return;
      }
      const result = await approveRenewalRequest(
        ctx,
        deps,
        identities,
        workspaces,
        customerKeys,
        billing,
        auditLog,
        session.requestId,
        undefined,
        days,
        false,
        true,
      );
      stateStore.clear(scope);
      if (result) {
        await updateRenewalReviewMessageByRef(ctx, session.sourceChatId, session.sourceMessageId, result.message);
        await ctx.reply(`Renewal request ${session.requestId} approved for ${days} days.`);
      }
      return;
    }

    if (session.kind === "awaiting_renewal_reject_reason") {
      const resolution = ctx.message.text.trim();
      if (!resolution) {
        await ctx.reply("Please send a non-empty rejection reason.");
        return;
      }
      const result = await closeRenewalRequest(ctx, billing, auditLog, session.requestId, resolution, true);
      stateStore.clear(scope);
      if (result) {
        await updateRenewalReviewMessageByRef(ctx, session.sourceChatId, session.sourceMessageId, result.message);
        await ctx.reply(`Renewal request ${session.requestId} closed with custom reason.`);
      }
      return;
    }

    await next();
  });
}

async function handleCustomerRenewCommand(
  ctx: Context,
  deps: BotDependencies,
  stateStore: TelegramBotStateStore,
  identities: BotIdentityRepository,
  workspaces: CustomerWorkspaceRepository,
  customerKeys: CustomerKeyRepository,
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

  if (!rawArgs.trim()) {
    const plans = billing.listPlans().filter((plan) => plan.status === "active");
    if (plans.length === 0) {
      await ctx.reply("No billing plans are available right now. Please contact admin.");
      return;
    }
    await ctx.reply("Choose a plan for your renewal request.", {
      reply_markup: buildRenewPlanKeyboard(stateStore, plans),
    });
    return;
  }

  const parsed = parseCustomerRenewArgs(rawArgs);
  if (!parsed) {
    await ctx.reply("Usage: /renew or /renew <planId> <days>");
    return;
  }

  await handleCustomerRenewRequest(ctx, deps, stateStore, identities, workspaces, customerKeys, billing, auditLog, parsed);
}

async function handleCustomerRenewRequest(
  ctx: Context,
  deps: BotDependencies,
  stateStore: TelegramBotStateStore,
  identities: BotIdentityRepository,
  workspaces: CustomerWorkspaceRepository,
  customerKeys: CustomerKeyRepository,
  billing: BillingRepository,
  auditLog: AuditLogRepository,
  parsed?: { planId: string; days: number },
): Promise<void> {
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
    await notifyAdminsAboutRenewalRequest(ctx, deps, stateStore, identities, workspaces, customerKeys, billing, created.request);
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
    await closeRenewalRequest(ctx, billing, auditLog, requestId, reason || "closed_by_admin");
    return;
  }

  if (subcommand === "approve") {
    const [requestId, planId, daysRaw, replaceKeyRaw] = args.slice(1);
    const days = Number(daysRaw);
    if (!requestId || !planId || !Number.isInteger(days) || days <= 0 || (replaceKeyRaw && replaceKeyRaw !== "replace-key")) {
      await ctx.reply("Usage: /renew approve <requestId> <planId> <days> [replace-key]");
      return;
    }

    await approveRenewalRequest(
      ctx,
      deps,
      identities,
      workspaces,
      customerKeys,
      billing,
      auditLog,
      requestId,
      planId,
      days,
      replaceKeyRaw === "replace-key",
    );
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
  stateStore: TelegramBotStateStore,
  identities: BotIdentityRepository,
  workspaces: CustomerWorkspaceRepository,
  customerKeys: CustomerKeyRepository,
  billing: BillingRepository,
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

  const text = formatAdminRenewalRequestText({
    request,
    identities,
    workspaces,
    customerKeys,
    billing,
  });

  for (const recipient of recipients) {
    try {
      await ctx.api.sendMessage(Number(recipient), text, {
        reply_markup: buildAdminRenewalKeyboard(stateStore, request),
      });
    } catch {
      // best effort admin notification
    }
  }
}

function buildRenewPlanKeyboard(stateStore: TelegramBotStateStore, plans: ReturnType<BillingRepository["listPlans"]>): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  plans.forEach((plan, index) => {
    const token = stateStore.issueCallbackToken({
      kind: "renewal_plan",
      planId: plan.id,
      days: defaultDaysForPlan(plan.billingInterval),
    });
    keyboard.text(plan.name, `v1:renew:plan:${token}`);
    if (index % 2 === 1) {
      keyboard.row();
    }
  });
  return keyboard;
}

function buildAdminRenewalKeyboard(stateStore: TelegramBotStateStore, request: RenewalRequestRecord): InlineKeyboard {
  const approveToken = stateStore.issueCallbackToken({
    kind: "renewal_request_action",
    action: "approve",
    requestId: request.id,
  });
  const approveRotateToken = stateStore.issueCallbackToken({
    kind: "renewal_request_action",
    action: "approve_rotate",
    requestId: request.id,
  });
  const approve30Token = stateStore.issueCallbackToken({
    kind: "renewal_request_action",
    action: "approve_override",
    requestId: request.id,
    overrideDays: 30,
  });
  const approve90Token = stateStore.issueCallbackToken({
    kind: "renewal_request_action",
    action: "approve_override",
    requestId: request.id,
    overrideDays: 90,
  });
  const approveCustomToken = stateStore.issueCallbackToken({
    kind: "renewal_request_action",
    action: "prompt_custom_days",
    requestId: request.id,
  });
  const viewCustomerToken = stateStore.issueCallbackToken({
    kind: "renewal_request_action",
    action: "view_customer",
    requestId: request.id,
  });
  const rejectToken = stateStore.issueCallbackToken({
    kind: "renewal_request_action",
    action: "show_reject_reasons",
    requestId: request.id,
  });
  const closeToken = stateStore.issueCallbackToken({
    kind: "renewal_request_action",
    action: "close",
    requestId: request.id,
  });
  return new InlineKeyboard()
    .text("Approve", `v1:renew:approve:${approveToken}`)
    .text("Approve + rotate key", `v1:renew:approve-rotate:${approveRotateToken}`)
    .row()
    .text("Approve 30d", `v1:renew:approve-30:${approve30Token}`)
    .text("Approve 90d", `v1:renew:approve-90:${approve90Token}`)
    .row()
    .text("Approve custom days", `v1:renew:approve-custom:${approveCustomToken}`)
    .row()
    .text("View customer", `v1:renew:view-customer:${viewCustomerToken}`)
    .url("Open customer chat", `tg://user?id=${request.telegramUserId}`)
    .row()
    .text("Reject with reason", `v1:renew:reject-reasons:${rejectToken}`)
    .row()
    .text("Close", `v1:renew:close:${closeToken}`);
}

function buildRejectReasonKeyboard(stateStore: TelegramBotStateStore, request: RenewalRequestRecord): InlineKeyboard {
  const unpaidToken = stateStore.issueCallbackToken({
    kind: "renewal_request_action",
    action: "reject_reason",
    requestId: request.id,
    resolution: "rejected_unpaid",
  });
  const duplicateToken = stateStore.issueCallbackToken({
    kind: "renewal_request_action",
    action: "reject_reason",
    requestId: request.id,
    resolution: "rejected_duplicate_request",
  });
  const invalidPlanToken = stateStore.issueCallbackToken({
    kind: "renewal_request_action",
    action: "reject_reason",
    requestId: request.id,
    resolution: "rejected_invalid_plan",
  });
  const backToken = stateStore.issueCallbackToken({
    kind: "renewal_request_action",
    action: "show_main_actions",
    requestId: request.id,
  });
  const customReasonToken = stateStore.issueCallbackToken({
    kind: "renewal_request_action",
    action: "prompt_custom_reason",
    requestId: request.id,
  });
  return new InlineKeyboard()
    .text("Unpaid", `v1:renew:reject:${unpaidToken}`)
    .text("Duplicate", `v1:renew:reject:${duplicateToken}`)
    .row()
    .text("Invalid plan", `v1:renew:reject:${invalidPlanToken}`)
    .text("Custom reason", `v1:renew:reject-custom:${customReasonToken}`)
    .row()
    .text("Back", `v1:renew:back:${backToken}`);
}

function defaultDaysForPlan(interval: "month" | "year" | "one_time"): number {
  if (interval === "year") {
    return 365;
  }
  return 30;
}

function normalizeRenewalAction(
  value: string,
): "approve" | "approve_rotate" | "approve_override" | "close" | "view_customer" | "show_reject_reasons" | "reject_reason" | "show_main_actions" | "prompt_custom_days" | "prompt_custom_reason" {
  if (value === "approve-rotate") {
    return "approve_rotate";
  }
  if (value === "approve-30" || value === "approve-90") {
    return "approve_override";
  }
  if (value === "approve-custom") {
    return "prompt_custom_days";
  }
  if (value === "view-customer") {
    return "view_customer";
  }
  if (value === "reject-reasons") {
    return "show_reject_reasons";
  }
  if (value === "reject") {
    return "reject_reason";
  }
  if (value === "reject-custom") {
    return "prompt_custom_reason";
  }
  if (value === "back") {
    return "show_main_actions";
  }
  return value as
    | "approve"
    | "approve_rotate"
    | "approve_override"
    | "close"
    | "view_customer"
    | "show_reject_reasons"
    | "reject_reason"
    | "show_main_actions"
    | "prompt_custom_days"
    | "prompt_custom_reason";
}

function formatAdminRenewalRequestText(args: {
  request: RenewalRequestRecord;
  identities: BotIdentityRepository;
  workspaces: CustomerWorkspaceRepository;
  customerKeys: CustomerKeyRepository;
  billing: BillingRepository;
}): string {
  const user = args.identities.getUser(args.request.telegramUserId);
  const overview = readCustomerBillingOverview({
    telegramUserId: args.request.telegramUserId,
    workspaces: args.workspaces,
    customerKeys: args.customerKeys,
    billing: args.billing,
  });
  const plan = args.request.requestedPlanId ? args.billing.getPlan(args.request.requestedPlanId) : undefined;
  return [
    "New renewal request.",
    `customer: ${formatTelegramUserLabel(user, args.request.telegramUserId)}`,
    `request_id: ${args.request.id}`,
    `workspace_id: ${args.request.workspaceId}`,
    plan
      ? `requested_plan: ${plan.id} (${plan.name})`
      : args.request.requestedPlanId
        ? `requested_plan: ${args.request.requestedPlanId}`
        : "requested_plan: manual review needed",
    args.request.requestedDays ? `requested_days: ${args.request.requestedDays}` : undefined,
    overview.workspace ? `workspace_status: ${overview.workspace.status}` : undefined,
    overview.apiKey ? `key_preview: ${overview.apiKey.apiKeyPreview}` : undefined,
    overview.entitlement ? `current_expiry: ${overview.entitlement.validUntil}` : "current_expiry: none",
    `entitlement_status: ${overview.entitlementStatus}`,
    overview.remainingTokens !== null ? `remaining_tokens: ${overview.remainingTokens}` : undefined,
    `requested_at: ${args.request.requestedAt}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatTelegramUserLabel(
  user: ReturnType<BotIdentityRepository["getUser"]>,
  telegramUserId: string,
): string {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  const username = user?.username ? `@${user.username}` : undefined;
  return [name || undefined, username, `id=${telegramUserId}`].filter(Boolean).join(" | ");
}

async function showCustomerRenewalContext(
  ctx: Context,
  identities: BotIdentityRepository,
  workspaces: CustomerWorkspaceRepository,
  customerKeys: CustomerKeyRepository,
  billing: BillingRepository,
  requestId: string,
): Promise<boolean> {
  const request = billing.getRenewalRequest(requestId);
  if (!request) {
    await ctx.reply("Renewal request was not found.");
    return false;
  }
  const user = identities.getUser(request.telegramUserId);
  const overview = readCustomerBillingOverview({
    telegramUserId: request.telegramUserId,
    workspaces,
    customerKeys,
    billing,
  });
  await ctx.reply(
    [
      "Customer renewal review",
      `customer: ${formatTelegramUserLabel(user, request.telegramUserId)}`,
      `request_id: ${request.id}`,
      `workspace_id: ${request.workspaceId}`,
      overview.workspace ? `workspace_status: ${overview.workspace.status}` : "workspace_status: none",
      overview.workspace ? `client_route: ${overview.workspace.defaultClientRoute}` : undefined,
      overview.apiKey ? `key_status: ${overview.apiKey.status}` : undefined,
      overview.apiKey ? `key_preview: ${overview.apiKey.apiKeyPreview}` : undefined,
      overview.entitlement ? `current_expiry: ${overview.entitlement.validUntil}` : "current_expiry: none",
      `entitlement_status: ${overview.entitlementStatus}`,
      overview.entitlement ? `token_limit: ${overview.entitlement.monthlyTokenLimit}` : undefined,
      overview.remainingTokens !== null ? `remaining_tokens: ${overview.remainingTokens}` : undefined,
      `request_status: ${request.status}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return true;
}

async function approveRenewalRequest(
  ctx: Context,
  deps: BotDependencies,
  identities: BotIdentityRepository,
  workspaces: CustomerWorkspaceRepository,
  customerKeys: CustomerKeyRepository,
  billing: BillingRepository,
  auditLog: AuditLogRepository,
  requestId: string,
  overridePlanId?: string,
  overrideDays?: number,
  replaceKey = false,
  silentReply = false,
): Promise<{ message: string } | false> {
  const request = billing.getRenewalRequest(requestId);
  if (!request) {
    await ctx.reply("Renewal request was not found.");
    return false;
  }
  if (request.status !== "open") {
    await ctx.reply("Renewal request is not open anymore.");
    return false;
  }
  const planId = overridePlanId ?? request.requestedPlanId;
  const days = overrideDays ?? request.requestedDays;
  if (!planId || !days) {
    await ctx.reply("This renewal request needs manual review. Use /renew approve <requestId> <planId> <days>.");
    return false;
  }

  try {
    const result = await renewCustomerAccess({
      telegramUserId: request.telegramUserId,
      planId,
      days,
      replaceKey,
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
    auditLog.record({
      event: "renewal.approved",
      actor: { type: "admin", id: ctx.from?.id?.toString() },
      subjectType: "renewal_request",
      subjectId: requestId,
      metadata: {
        telegramUserId: request.telegramUserId,
        workspaceId: request.workspaceId,
        approvedPlanId: planId,
        approvedDays: days,
      },
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

    const message = [
      "Renewal request approved.",
      `request_id: ${requestId}`,
      `telegram_user_id: ${request.telegramUserId}`,
      `plan_id: ${planId}`,
      `days: ${days}`,
      `mode: ${result.mode}`,
      `subscription_ends_at: ${result.subscriptionEndsAt}`,
      "status: approved",
    ].join("\n");
    if (!silentReply) {
      await ctx.reply(message);
    }
    return { message };
  } catch (error) {
    await replyWithProxyError(ctx, error);
    return false;
  }
}

async function closeRenewalRequest(
  ctx: Context,
  billing: BillingRepository,
  auditLog: AuditLogRepository,
  requestId: string,
  resolution = "closed_by_admin",
  silentReply = false,
): Promise<{ message: string } | false> {
  const request = billing.getRenewalRequest(requestId);
  if (!request) {
    await ctx.reply("Renewal request was not found.");
    return false;
  }
  if (request.status !== "open") {
    await ctx.reply("Renewal request is not open anymore.");
    return false;
  }

  const closed = billing.closeRenewalRequest({
    id: requestId,
    resolution,
  });
  auditLog.record({
    event: "renewal.closed",
    actor: { type: "admin", id: ctx.from?.id?.toString() },
    subjectType: "renewal_request",
    subjectId: requestId,
    metadata: {
      telegramUserId: request.telegramUserId,
      workspaceId: request.workspaceId,
      resolution: closed?.resolution ?? resolution,
    },
  });
  const message = [
    "Renewal request closed.",
    `request_id: ${closed?.id ?? requestId}`,
    `status: ${closed?.status ?? "closed"}`,
    `resolution: ${closed?.resolution ?? resolution}`,
  ].join("\n");
  if (!silentReply) {
    await ctx.reply(message);
  }
  return { message };
}

async function updateRenewalReviewMessage(ctx: Context, text: string): Promise<void> {
  try {
    if ("editMessageText" in ctx && typeof ctx.editMessageText === "function") {
      await ctx.editMessageText(text);
      return;
    }
    if ("editMessageReplyMarkup" in ctx && typeof ctx.editMessageReplyMarkup === "function") {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined } as any);
    }
  } catch {
    // best effort cleanup
  }
}

async function updateRenewalReviewMessageByRef(
  ctx: Context,
  chatId: string,
  messageId: number,
  text: string,
): Promise<void> {
  try {
    await ctx.api.editMessageText(Number(chatId), messageId, text);
  } catch {
    // best effort cleanup
  }
}

async function showRenewalRejectKeyboard(
  ctx: Context,
  stateStore: TelegramBotStateStore,
  request: RenewalRequestRecord,
): Promise<void> {
  if ("editMessageReplyMarkup" in ctx && typeof ctx.editMessageReplyMarkup === "function") {
    await ctx.editMessageReplyMarkup({
      reply_markup: buildRejectReasonKeyboard(stateStore, request),
    } as any);
  }
}

async function showRenewalMainKeyboard(
  ctx: Context,
  stateStore: TelegramBotStateStore,
  request: RenewalRequestRecord,
): Promise<void> {
  if ("editMessageReplyMarkup" in ctx && typeof ctx.editMessageReplyMarkup === "function") {
    await ctx.editMessageReplyMarkup({
      reply_markup: buildAdminRenewalKeyboard(stateStore, request),
    } as any);
  }
}

function prepareRenewalAdminInput(ctx: Context): { chatId: string; userId: string; messageId: number } | undefined {
  const chatId = ctx.chat?.id?.toString();
  const userId = ctx.from?.id?.toString();
  const message = (ctx.callbackQuery as any)?.message;
  const messageId = typeof message?.message_id === "number" ? message.message_id : undefined;
  if (!chatId || !userId || messageId === undefined) {
    return undefined;
  }
  return { chatId, userId, messageId };
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
