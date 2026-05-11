import { InlineKeyboard, type Bot, type Context } from "grammy";
import type { BillingRepository, RenewalRequestKind, RenewalRequestRecord } from "../../billing.js";
import type { CustomerKeyRepository } from "../../customer-keys.js";
import type { AuditLogRepository } from "../../audit-log.js";
import { renderAdminScreen } from "../admin-actions.js";
import { isAdmin } from "../auth.js";
import type { BotDependencies } from "../actions.js";
import type { BotIdentityRepository } from "../bot-identity-repository.js";
import { buildCustomerActionKeyboard } from "../customer-actions.js";
import { formatDateTime, formatField, formatMessage, formatRawField, formatSection } from "../message-format.js";
import { URL } from "node:url";
import type { CustomerWorkspaceRepository } from "../customer-workspace-repository.js";
import { readCustomerBillingOverview } from "../customer-billing.js";
import { answerCallbackQuerySafely, replyOrEditMessage } from "../callbacks.js";
import { renewCustomerAccess } from "../grants.js";
import { getProxyErrorMessage } from "../actions.js";
import {
  buildTelegramSessionScope,
  type TelegramBotCallbackPayload,
  type TelegramBotStateStore,
} from "../sessions.js";

const DEFAULT_PURCHASE_AMOUNT_VND = 5_000;
const DEFAULT_PURCHASE_TOKEN_LIMIT = 10_000_000;
const DEFAULT_PURCHASE_PLAN_ID = "basic";
const DEFAULT_PURCHASE_DAYS = 1;
const DEFAULT_TOKEN_TOPUP_LOT_DAYS = 1;
const RENEWAL_CALLBACK_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function resolveRequestPriceVnd(
  request: RenewalRequestRecord,
  billing: BillingRepository,
): number {
  if (typeof request.priceVnd === "number" && request.priceVnd > 0) {
    return request.priceVnd;
  }
  if (request.kind === "renewal") {
    const planId = request.requestedPlanId ?? DEFAULT_PURCHASE_PLAN_ID;
    const plan = billing.getPlan(planId);
    if (plan && plan.currency === "VND" && plan.priceCents > 0) {
      return plan.priceCents;
    }
  }
  return DEFAULT_PURCHASE_AMOUNT_VND;
}

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
      await handleAdminRenewCommand(ctx, deps, stateStore, identities, workspaces, customerKeys, billing, auditLog, rawArgs);
      return;
    }
    await handleCustomerRenewCommand(ctx, deps, stateStore, identities, workspaces, customerKeys, billing, auditLog, rawArgs);
  });

  bot.callbackQuery("v1:renew:open", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await answerCallbackQuerySafely(ctx, { text: "Open a private chat with the bot.", show_alert: true });
      return;
    }
    await answerCallbackQuerySafely(ctx, { text: "24h renewal request" });
    await handleCustomerRenewCommand(ctx, deps, stateStore, identities, workspaces, customerKeys, billing, auditLog, "");
  });

  bot.callbackQuery("v1:topup:open", async (ctx) => {
    if (ctx.chat?.type !== "private") {
      await answerCallbackQuerySafely(ctx, { text: "Open a private chat with the bot.", show_alert: true });
      return;
    }
    await answerCallbackQuerySafely(ctx, { text: "Token top-up request" });
    await handleCustomerRenewRequest(ctx, deps, stateStore, identities, workspaces, customerKeys, billing, auditLog, {
      kind: "token_topup",
      tokenDelta: DEFAULT_PURCHASE_TOKEN_LIMIT,
      lotDays: DEFAULT_TOKEN_TOPUP_LOT_DAYS,
      priceVnd: DEFAULT_PURCHASE_AMOUNT_VND,
    });
  });

  bot.callbackQuery(
    /^v1:renew:(confirm-payment|approve|approve-rotate|approve-30|approve-90|approve-custom|close|view-customer|reject-reasons|reject|reject-custom|back):([A-Za-z0-9_-]+)$/,
    async (ctx) => {
    if (!isAdmin(ctx, deps.config)) {
      await answerCallbackQuerySafely(ctx, { text: "Admin only.", show_alert: true });
      return;
    }
    const action = normalizeRenewalAction(ctx.match[1]);
    const token = ctx.match[2];
    const callbackState = stateStore.readCallbackToken(token);
    if (callbackState?.kind !== "renewal_request_action" || callbackState.action !== action) {
      await answerCallbackQuerySafely(ctx, { text: "Action expired. Refresh /renew list.", show_alert: true });
      return;
    }
    if (action === "confirm_payment") {
      const confirmed = await confirmRenewalPayment(ctx, billing, auditLog, callbackState.requestId);
      if (confirmed) {
        const updatedRequest = billing.getRenewalRequest(callbackState.requestId);
        if (updatedRequest) {
          await renderRenewalPromptCard(ctx, stateStore, updatedRequest, confirmed.message, "main");
        } else {
          await updateRenewalReviewMessage(ctx, confirmed.message);
        }
        await answerCallbackQuerySafely(ctx, { text: "Payment marked as confirmed" });
      } else {
        await answerCallbackQuerySafely(ctx, { text: "Could not confirm payment.", show_alert: true });
      }
      return;
    }
    if (action === "approve") {
      const request = billing.getRenewalRequest(callbackState.requestId);
      if (request?.status !== "payment_confirmed") {
        await answerCallbackQuerySafely(ctx, { text: "Confirm payment first.", show_alert: true });
        return;
      }
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
        await answerCallbackQuerySafely(ctx, { text: "Renewal approved" });
      } else {
        await answerCallbackQuerySafely(ctx, { text: "Renewal approval failed. Check the bot message.", show_alert: true });
      }
      return;
    }
    if (action === "approve_rotate") {
      const request = billing.getRenewalRequest(callbackState.requestId);
      if (request?.status !== "payment_confirmed") {
        await answerCallbackQuerySafely(ctx, { text: "Confirm payment first.", show_alert: true });
        return;
      }
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
        await answerCallbackQuerySafely(ctx, { text: "Renewal approved and key rotated" });
      } else {
        await answerCallbackQuerySafely(ctx, { text: "Renewal approval failed. Check the bot message.", show_alert: true });
      }
      return;
    }
    if (action === "approve_override") {
      const request = billing.getRenewalRequest(callbackState.requestId);
      if (request?.status !== "payment_confirmed") {
        await answerCallbackQuerySafely(ctx, { text: "Confirm payment first.", show_alert: true });
        return;
      }
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
        await answerCallbackQuerySafely(ctx, { text: `Renewal approved for ${callbackState.overrideDays} days` });
      } else {
        await answerCallbackQuerySafely(ctx, { text: "Renewal approval failed. Check the bot message.", show_alert: true });
      }
      return;
    }
    if (action === "prompt_custom_days") {
      const request = billing.getRenewalRequest(callbackState.requestId);
      if (request?.status !== "payment_confirmed") {
        await answerCallbackQuerySafely(ctx, { text: "Confirm payment first.", show_alert: true });
        return;
      }
      const prepared = prepareRenewalAdminInput(ctx);
      if (!prepared) {
        await answerCallbackQuerySafely(ctx, { text: "This action only works from a message button.", show_alert: true });
        return;
      }
      stateStore.set(buildTelegramSessionScope(prepared.chatId, prepared.userId), {
        kind: "awaiting_renewal_custom_days",
        requestId: callbackState.requestId,
        sourceChatId: prepared.chatId,
        sourceMessageId: prepared.messageId,
      });
      if (request) {
        await renderRenewalPromptCard(ctx, stateStore, request, [
          "Renewal review",
          `request_id: ${callbackState.requestId}`,
          "Awaiting custom approval days.",
          "Send a positive integer in this chat. Example: 45",
        ].join("\n"), "prompt");
      }
      await answerCallbackQuerySafely(ctx, { text: "Send the number of days in this chat" });
      return;
    }
    if (action === "view_customer") {
      const shown = await showCustomerRenewalContext(
        ctx,
        stateStore,
        identities,
        workspaces,
        customerKeys,
        billing,
        auditLog,
        callbackState.requestId,
      );
      if (shown) {
        await answerCallbackQuerySafely(ctx, { text: "Customer details loaded" });
      }
      return;
    }
    if (action === "show_reject_reasons") {
      const request = billing.getRenewalRequest(callbackState.requestId);
      if (!request) {
        await answerCallbackQuerySafely(ctx, { text: "Renewal request was not found.", show_alert: true });
        return;
      }
      if (request.status === "closed") {
        await answerCallbackQuerySafely(ctx, { text: "Request is closed.", show_alert: true });
        return;
      }
      await showRenewalRejectKeyboard(ctx, stateStore, request);
      await answerCallbackQuerySafely(ctx, { text: "Choose a rejection reason" });
      return;
    }
    if (action === "prompt_custom_reason") {
      const prepared = prepareRenewalAdminInput(ctx);
      if (!prepared) {
        await answerCallbackQuerySafely(ctx, { text: "This action only works from a message button.", show_alert: true });
        return;
      }
      stateStore.set(buildTelegramSessionScope(prepared.chatId, prepared.userId), {
        kind: "awaiting_renewal_reject_reason",
        requestId: callbackState.requestId,
        sourceChatId: prepared.chatId,
        sourceMessageId: prepared.messageId,
      });
      const request = billing.getRenewalRequest(callbackState.requestId);
      if (request) {
        await renderRenewalPromptCard(ctx, stateStore, request, [
          "Renewal review",
          `request_id: ${callbackState.requestId}`,
          "Awaiting custom rejection reason.",
          "Send the rejection reason in this chat.",
        ].join("\n"), "prompt");
      }
      await answerCallbackQuerySafely(ctx, { text: "Send the rejection reason in this chat" });
      return;
    }
    if (action === "show_main_actions") {
      const request = billing.getRenewalRequest(callbackState.requestId);
      if (!request) {
        await answerCallbackQuerySafely(ctx, { text: "Renewal request was not found.", show_alert: true });
        return;
      }
      await showRenewalMainKeyboard(
        ctx,
        stateStore,
        request,
        formatAdminRenewalRequestText({
          request,
          identities,
          workspaces,
          customerKeys,
          billing,
        }),
      );
      await answerCallbackQuerySafely(ctx, { text: "Back to actions" });
      return;
    }
    const closed = await closeRenewalRequest(
      ctx,
      billing,
      auditLog,
      callbackState.requestId,
      callbackState.resolution ?? "closed_by_admin",
      true,
      true,
    );
    if (closed) {
      await updateRenewalReviewMessage(ctx, closed.message);
      await answerCallbackQuerySafely(ctx, { text: action === "reject_reason" ? "Renewal rejected" : "Renewal closed" });
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
        await renderRenewalPromptCardByRef(
          ctx,
          stateStore,
          billing.getRenewalRequest(session.requestId),
          session.sourceChatId,
          session.sourceMessageId,
          [
            "Renewal review",
            `request_id: ${session.requestId}`,
            "Awaiting custom approval days.",
            "Please send a positive integer number of days.",
          ].join("\n"),
          "prompt",
        );
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
      }
      return;
    }

    if (session.kind === "awaiting_renewal_reject_reason") {
      const resolution = ctx.message.text.trim();
      if (!resolution) {
        await renderRenewalPromptCardByRef(
          ctx,
          stateStore,
          billing.getRenewalRequest(session.requestId),
          session.sourceChatId,
          session.sourceMessageId,
          [
            "Renewal review",
            `request_id: ${session.requestId}`,
            "Awaiting custom rejection reason.",
            "Please send a non-empty rejection reason.",
          ].join("\n"),
          "prompt",
        );
        return;
      }
      const result = await closeRenewalRequest(ctx, billing, auditLog, session.requestId, resolution, true, true);
      stateStore.clear(scope);
      if (result) {
        await updateRenewalReviewMessageByRef(ctx, session.sourceChatId, session.sourceMessageId, result.message);
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
    await replyOrEditMessage(ctx, "For safety, open a private chat with this bot and run /renew there.");
    return;
  }

  const telegramUserId = ctx.from?.id?.toString();
  if (!telegramUserId) {
    await replyOrEditMessage(ctx, "Could not determine your Telegram user.");
    return;
  }

  const workspace = workspaces.getDefaultWorkspace(telegramUserId);
  if (!workspace) {
    await replyOrEditMessage(ctx, "No customer workspace has been assigned to your Telegram user yet.");
    return;
  }

  if (!rawArgs.trim()) {
    await handleCustomerRenewRequest(ctx, deps, stateStore, identities, workspaces, customerKeys, billing, auditLog, {
      planId: DEFAULT_PURCHASE_PLAN_ID,
      days: DEFAULT_PURCHASE_DAYS,
    });
    return;
  }

  await replyOrEditMessage(ctx, "Usage: /renew - request a 24h renewal");
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
  parsed?: {
    kind?: RenewalRequestKind;
    planId?: string;
    days?: number;
    tokenDelta?: number;
    lotDays?: number;
    priceVnd?: number;
  },
): Promise<void> {
  const telegramUserId = ctx.from?.id?.toString();
  if (!telegramUserId) {
    await replyOrEditMessage(ctx, "Could not determine your Telegram user.");
    return;
  }

  const workspace = workspaces.getDefaultWorkspace(telegramUserId);
  if (!workspace) {
    await replyOrEditMessage(ctx, "No customer workspace has been assigned to your Telegram user yet.");
    return;
  }

  const activeKey = customerKeys.getActiveKeyForUser(telegramUserId);
  const kind = parsed?.kind ?? "renewal";
  if (kind === "token_topup") {
    const activeLots = billing.getActiveEntitlementLotsForWorkspace(workspace.id);
    if (!activeKey || activeLots.length === 0) {
      await replyOrEditMessage(ctx, "Buy API key or renew access before buying more tokens.");
      return;
    }
  }
  const renewalPriceVnd = kind === "renewal"
    ? (() => {
        const planId = parsed?.planId ?? DEFAULT_PURCHASE_PLAN_ID;
        const plan = billing.getPlan(planId);
        return plan && plan.currency === "VND" && plan.priceCents > 0
          ? plan.priceCents
          : DEFAULT_PURCHASE_AMOUNT_VND;
      })()
    : undefined;
  const created = billing.createRenewalRequest({
    workspaceId: workspace.id,
    telegramUserId,
    kind,
    requestedPlanId: kind === "renewal" ? parsed?.planId : undefined,
    requestedDays: kind === "renewal" ? parsed?.days : undefined,
    requestedTokenDelta: kind === "token_topup" ? parsed?.tokenDelta : undefined,
    requestedTokenLotDays: kind === "token_topup" ? parsed?.lotDays : undefined,
    priceVnd: kind === "token_topup" ? parsed?.priceVnd : renewalPriceVnd,
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
        kind: created.request.kind,
        requestedPlanId: created.request.requestedPlanId,
        requestedDays: created.request.requestedDays,
        requestedTokenDelta: created.request.requestedTokenDelta,
        requestedTokenLotDays: created.request.requestedTokenLotDays,
        priceVnd: created.request.priceVnd,
      },
    });
  }

  const paymentAmount = resolveRequestPriceVnd(created.request, billing);
  const renewalPlan = created.request.kind === "renewal"
    ? billing.getPlan(created.request.requestedPlanId ?? DEFAULT_PURCHASE_PLAN_ID)
    : undefined;
  const renewalTokenLimit = renewalPlan?.monthlyTokenLimit ?? DEFAULT_PURCHASE_TOKEN_LIMIT;
  const paymentUrl = created.created && deps.config.sepayAccountNumber
    ? buildSePayPaymentUrl({
        accountNumber: deps.config.sepayAccountNumber,
        bankCode: deps.config.sepayBankCode ?? "MBBank",
        amount: paymentAmount,
        description: `Chuc ngon mieng ma ${created.request.id}`,
        template: deps.config.sepayTemplate ?? "compact",
        download: deps.config.sepayDownload ?? false,
      })
    : undefined;

  const message = created.created
    ? formatMessage(
        created.request.kind === "token_topup"
          ? "Token top-up request submitted."
          : activeKey
            ? "Renewal request submitted."
            : "API key purchase request submitted.",
        [
          formatField("Request id", created.request.id),
          formatField("Workspace", workspace.id),
          created.request.kind === "token_topup"
            ? `pack: ${paymentAmount} VND -> ${created.request.requestedTokenDelta ?? DEFAULT_PURCHASE_TOKEN_LIMIT} tokens`
            : `plan: ${paymentAmount} VND -> ${renewalTokenLimit} tokens`,
          created.request.requestedPlanId ? `requested_plan_id: ${created.request.requestedPlanId}` : undefined,
          created.request.requestedDays ? `requested_days: ${created.request.requestedDays}` : undefined,
          created.request.requestedTokenDelta ? `requested_token_delta: ${created.request.requestedTokenDelta}` : undefined,
          created.request.requestedTokenLotDays ? `token_lot_days: ${created.request.requestedTokenLotDays}` : undefined,
          paymentUrl ? formatPaymentSection(paymentAmount, created.request.id, paymentUrl) : undefined,
          "Admin will verify the transfer manually before approval.",
        ],
      )
    : formatMessage("You already have an open renewal request.", [
        formatField("Request id", created.request.id),
        formatRawField("kind", created.request.kind),
        created.request.requestedPlanId ? `requested_plan_id: ${created.request.requestedPlanId}` : undefined,
        created.request.requestedDays ? `requested_days: ${created.request.requestedDays}` : undefined,
        created.request.requestedTokenDelta ? `requested_token_delta: ${created.request.requestedTokenDelta}` : undefined,
        created.request.requestedTokenLotDays ? `token_lot_days: ${created.request.requestedTokenLotDays}` : undefined,
        "Please wait for admin review.",
      ]);
  const resultLines = [message];

  if (created.created) {
    const notification = await notifyAdminsAboutRenewalRequest(
      ctx,
      deps,
      stateStore,
      identities,
      workspaces,
      customerKeys,
      billing,
      created.request,
    );
    if (notification.sent === 0) {
      resultLines.push("admin_notification: pending_manual_follow_up");
    }
  }
  await replyOrEditMessage(ctx, resultLines.filter(Boolean).join("\n"), {
    reply_markup: buildCustomerActionKeyboard(activeKey?.status === "active"),
  });
}

function formatPaymentSection(paymentAmount: number, requestId: string, paymentUrl: string): string {
  return formatSection("Payment", [
    formatField("Amount", `${formatNumber(paymentAmount)} VND`),
    formatField("Transfer note", `Chuc ngon mieng ma ${requestId}`),
    formatField("Scan QR", paymentUrl),
  ]);
}

function formatPaymentConfirmationSection(requestId: string, status: string, amountVnd: number): string {
  return formatSection("Payment", [
    formatField("Request ID", requestId),
    formatField("Status", status),
    formatField("Amount", `${formatNumber(amountVnd)} VND`),
  ]);
}

async function handleAdminRenewCommand(
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
  const args = rawArgs.trim().split(/\s+/g).filter(Boolean);
  const subcommand = args[0]?.toLowerCase();

  if (!subcommand) {
    await renderAdminRenewalInfo(
      ctx,
      "🧾 Renewal commands\nUsage: /renew list | /renew paid <requestId> | /renew approve <requestId> <planId> <days> [replace-key] | /renew approve <requestId> topup [tokenDelta] [days] | /renew close <requestId> [reason]",
    );
    return;
  }

  if (subcommand === "list") {
    const openRequests = [
      ...billing.listRenewalRequests("payment_confirmed"),
      ...billing.listRenewalRequests("open"),
    ];
    await renderAdminRenewalList(ctx, stateStore, openRequests);
    return;
  }

  if (subcommand === "paid" || subcommand === "confirm-payment") {
    const requestId = args[1];
    if (!requestId) {
      await renderAdminRenewalInfo(ctx, "🧾 Mark renewal payment\nUsage: /renew paid <requestId>");
      return;
    }
    const confirmed = await confirmRenewalPayment(ctx, billing, auditLog, requestId);
    if (confirmed) {
      const updatedRequest = billing.getRenewalRequest(requestId);
      if (updatedRequest) {
        await ctx.reply(confirmed.message, {
          reply_markup: buildAdminRenewalKeyboard(stateStore, updatedRequest),
        });
      } else {
        await updateRenewalReviewMessage(ctx, confirmed.message);
      }
    }
    return;
  }

  if (subcommand === "close") {
    const requestId = args[1];
    const reason = args.slice(2).join(" ").trim();
    if (!requestId) {
      await renderAdminRenewalInfo(ctx, "🧾 Close renewal request\nUsage: /renew close <requestId> [reason]");
      return;
    }
    await closeRenewalRequest(ctx, billing, auditLog, requestId, reason || "closed_by_admin", false, true);
    return;
  }

  if (subcommand === "approve") {
    const rest = args.slice(1);
    const [requestId, second, third, fourth] = rest;
    if (!requestId) {
      await renderAdminRenewalInfo(
        ctx,
        "Usage: /renew approve <requestId> <planId> <days> [replace-key] | /renew approve <requestId> topup [tokenDelta] [days]",
      );
      return;
    }
    const existingRequest = billing.getRenewalRequest(requestId);
    const topupMode = second?.toLowerCase() === "topup" || existingRequest?.kind === "token_topup";
    if (topupMode) {
      const tokenDeltaRaw = second?.toLowerCase() === "topup" ? third : second;
      const daysRaw = second?.toLowerCase() === "topup" ? fourth : third;
      const tokenDelta = tokenDeltaRaw ? Number(tokenDeltaRaw) : undefined;
      const days = daysRaw ? Number(daysRaw) : undefined;
      if ((tokenDelta !== undefined && (!Number.isInteger(tokenDelta) || tokenDelta <= 0))
        || (days !== undefined && (!Number.isInteger(days) || days <= 0))) {
        await renderAdminRenewalInfo(
          ctx,
          "Usage: /renew approve <requestId> topup [tokenDelta] [days]",
        );
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
        undefined,
        days,
        false,
        false,
        tokenDelta,
      );
      return;
    }
    const planId = second;
    const daysRaw = third;
    const replaceKeyRaw = fourth;
    const days = Number(daysRaw);
    if (!planId || !Number.isInteger(days) || days <= 0 || (replaceKeyRaw && replaceKeyRaw !== "replace-key")) {
      await renderAdminRenewalInfo(ctx, "Usage: /renew approve <requestId> <planId> <days> [replace-key]");
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

  await renderAdminRenewalInfo(
    ctx,
    "Usage: /renew list | /renew paid <requestId> | /renew approve <requestId> <planId> <days> [replace-key] | /renew close <requestId> [reason]",
  );
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
): Promise<{ sent: number; failed: number }> {
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

  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    try {
      await ctx.api.sendMessage(Number(recipient), text, {
        reply_markup: buildAdminRenewalKeyboard(stateStore, request),
      });
      sent += 1;
    } catch {
      failed += 1;
      // best effort admin notification
    }
  }
  return { sent, failed };
}

function buildAdminRenewalListKeyboard(
  stateStore: TelegramBotStateStore,
  requests: RenewalRequestRecord[],
): InlineKeyboard | undefined {
  const keyboard = new InlineKeyboard();
  requests.slice(0, 10).forEach((request) => {
    const reviewToken = issueRenewalCallbackToken(stateStore, {
      kind: "renewal_request_action",
      action: "show_main_actions",
      requestId: request.id,
    });
    keyboard.text(`${request.telegramUserId} · ${request.id.slice(0, 8)}`, `v1:renew:back:${reviewToken}`).row();
  });
  return requests.length > 0 ? keyboard : undefined;
}

function buildSePayPaymentUrl(args: { accountNumber: string; bankCode: string; amount: number; description: string; template: string; download: boolean }): string {
  const url = new URL("https://qr.sepay.vn/img");
  url.searchParams.set("acc", args.accountNumber);
  url.searchParams.set("bank", args.bankCode);
  url.searchParams.set("amount", String(args.amount));
  url.searchParams.set("des", args.description);
  url.searchParams.set("template", args.template);
  url.searchParams.set("download", String(args.download));
  return url.toString();
}

function buildAdminRenewalKeyboard(stateStore: TelegramBotStateStore, request: RenewalRequestRecord): InlineKeyboard {
  const approveToken = issueRenewalCallbackToken(stateStore, {
    kind: "renewal_request_action",
    action: "approve",
    requestId: request.id,
  });
  const approveRotateToken = issueRenewalCallbackToken(stateStore, {
    kind: "renewal_request_action",
    action: "approve_rotate",
    requestId: request.id,
  });
  const approve30Token = issueRenewalCallbackToken(stateStore, {
    kind: "renewal_request_action",
    action: "approve_override",
    requestId: request.id,
    overrideDays: 30,
  });
  const approve90Token = issueRenewalCallbackToken(stateStore, {
    kind: "renewal_request_action",
    action: "approve_override",
    requestId: request.id,
    overrideDays: 90,
  });
  const approveCustomToken = issueRenewalCallbackToken(stateStore, {
    kind: "renewal_request_action",
    action: "prompt_custom_days",
    requestId: request.id,
  });
  const viewCustomerToken = issueRenewalCallbackToken(stateStore, {
    kind: "renewal_request_action",
    action: "view_customer",
    requestId: request.id,
  });
  const rejectToken = issueRenewalCallbackToken(stateStore, {
    kind: "renewal_request_action",
    action: "show_reject_reasons",
    requestId: request.id,
  });
  const closeToken = issueRenewalCallbackToken(stateStore, {
    kind: "renewal_request_action",
    action: "close",
    requestId: request.id,
  });
  const confirmPaymentToken = issueRenewalCallbackToken(stateStore, {
    kind: "renewal_request_action",
    action: "confirm_payment",
    requestId: request.id,
  });
  const keyboard = new InlineKeyboard();
  if (request.status !== "payment_confirmed") {
    keyboard.text("✅ Confirm transfer", `v1:renew:confirm-payment:${confirmPaymentToken}`).row();
  }
  if (request.kind === "token_topup") {
    if (request.status === "payment_confirmed") {
      keyboard.text("🟢 Approve top-up", `v1:renew:approve:${approveToken}`).row();
    }
    keyboard
      .text("⚪ View customer", `v1:renew:view-customer:${viewCustomerToken}`)
      .url("⚪ Open customer chat", `tg://user?id=${request.telegramUserId}`)
      .row()
      .text("🔴 Reject with reason", `v1:renew:reject-reasons:${rejectToken}`)
      .row()
      .text("⚫ Close", `v1:renew:close:${closeToken}`);
    return keyboard;
  }
  if (request.status === "payment_confirmed") {
    keyboard
      .text("🟢 Approve", `v1:renew:approve:${approveToken}`)
      .text("🔵 Approve + rotate key", `v1:renew:approve-rotate:${approveRotateToken}`)
      .row()
      .text("🟢 Approve 30d", `v1:renew:approve-30:${approve30Token}`)
      .text("🟢 Approve 90d", `v1:renew:approve-90:${approve90Token}`)
      .row()
      .text("🟡 Approve custom days", `v1:renew:approve-custom:${approveCustomToken}`)
      .row();
  }
  keyboard
    .text("⚪ View customer", `v1:renew:view-customer:${viewCustomerToken}`)
    .url("⚪ Open customer chat", `tg://user?id=${request.telegramUserId}`)
    .row()
    .text("🔴 Reject with reason", `v1:renew:reject-reasons:${rejectToken}`)
    .row()
    .text("⚫ Close", `v1:renew:close:${closeToken}`);
  return keyboard;
}

function buildRejectReasonKeyboard(stateStore: TelegramBotStateStore, request: RenewalRequestRecord): InlineKeyboard {
  const unpaidToken = issueRenewalCallbackToken(stateStore, {
    kind: "renewal_request_action",
    action: "reject_reason",
    requestId: request.id,
    resolution: "rejected_unpaid",
  });
  const duplicateToken = issueRenewalCallbackToken(stateStore, {
    kind: "renewal_request_action",
    action: "reject_reason",
    requestId: request.id,
    resolution: "rejected_duplicate_request",
  });
  const invalidPlanToken = issueRenewalCallbackToken(stateStore, {
    kind: "renewal_request_action",
    action: "reject_reason",
    requestId: request.id,
    resolution: "rejected_invalid_plan",
  });
  const backToken = issueRenewalCallbackToken(stateStore, {
    kind: "renewal_request_action",
    action: "show_main_actions",
    requestId: request.id,
  });
  const customReasonToken = issueRenewalCallbackToken(stateStore, {
    kind: "renewal_request_action",
    action: "prompt_custom_reason",
    requestId: request.id,
  });
  return new InlineKeyboard()
    .text("🔴 Unpaid", `v1:renew:reject:${unpaidToken}`)
    .text("🟠 Duplicate", `v1:renew:reject:${duplicateToken}`)
    .row()
    .text("🟠 Invalid plan", `v1:renew:reject:${invalidPlanToken}`)
    .text("🟡 Custom reason", `v1:renew:reject-custom:${customReasonToken}`)
    .row()
    .text("⚪ Back", `v1:renew:back:${backToken}`);
}

function buildRenewalPromptKeyboard(stateStore: TelegramBotStateStore, request: RenewalRequestRecord): InlineKeyboard {
  const backToken = issueRenewalCallbackToken(stateStore, {
    kind: "renewal_request_action",
    action: "show_main_actions",
    requestId: request.id,
  });
  return new InlineKeyboard().text("⚪ Back", `v1:renew:back:${backToken}`);
}

function buildRenewalCustomerKeyboard(stateStore: TelegramBotStateStore, request: RenewalRequestRecord): InlineKeyboard {
  const backToken = issueRenewalCallbackToken(stateStore, {
    kind: "renewal_request_action",
    action: "show_main_actions",
    requestId: request.id,
  });
  return new InlineKeyboard()
    .text("⚪ Back", `v1:renew:back:${backToken}`)
    .url("⚪ Open customer chat", `tg://user?id=${request.telegramUserId}`);
}

function normalizeRenewalAction(
  value: string,
): "approve" | "approve_rotate" | "approve_override" | "confirm_payment" | "close" | "view_customer" | "show_reject_reasons" | "reject_reason" | "show_main_actions" | "prompt_custom_days" | "prompt_custom_reason" {
  if (value === "approve-rotate") {
    return "approve_rotate";
  }
  if (value === "approve-30" || value === "approve-90") {
    return "approve_override";
  }
  if (value === "approve-custom") {
    return "prompt_custom_days";
  }
  if (value === "confirm-payment") {
    return "confirm_payment";
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
    | "confirm_payment"
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
  const fallbackPlan = !args.request.requestedPlanId ? args.billing.getPlan(DEFAULT_PURCHASE_PLAN_ID) : undefined;
  const userStatus = user?.status ?? "unknown";
  const workspaceStatus = overview.workspace?.status ?? "none";
  const accountPending = userStatus === "pending_approval" || workspaceStatus === "pending_approval";
  return [
    accountPending
      ? "⚠ Approving this request will also activate a pending approval account/workspace."
      : undefined,
    args.request.kind === "token_topup"
      ? "Token top-up request"
      : overview.apiKey ? "Renewal request" : "New access request",
    formatSection("Customer", [
      formatField("Telegram user", formatTelegramUserLabel(user, args.request.telegramUserId)),
      formatField("Account status", formatStatus(userStatus)),
      formatField("Workspace status", formatStatus(workspaceStatus)),
    ]),
    formatSection("Request", [
      formatField("Request ID", args.request.id),
      formatField("Workspace ID", args.request.workspaceId),
      formatField("Kind", formatStatus(args.request.kind)),
      formatField("Status", formatStatus(args.request.status)),
      plan
        ? formatField("Requested plan", `${plan.id} (${plan.name})`)
        : fallbackPlan
          ? formatField("Requested plan", `${fallbackPlan.id} (${fallbackPlan.name})`)
        : args.request.requestedPlanId
          ? formatField("Requested plan", args.request.requestedPlanId)
          : formatField("Requested plan", "manual review needed"),
      args.request.requestedDays ? formatField("Requested days", args.request.requestedDays) : undefined,
      args.request.requestedTokenDelta ? formatField("Token top-up", formatNumber(args.request.requestedTokenDelta)) : undefined,
      args.request.requestedTokenLotDays ? formatField("Token lot days", args.request.requestedTokenLotDays) : undefined,
      args.request.priceVnd ? formatField("Price", `${formatNumber(args.request.priceVnd)} VND`) : undefined,
      formatField("Requested at", formatDateTime(args.request.requestedAt)),
    ]),
    formatSection("Current access", [
      overview.apiKey ? formatField("Key preview", overview.apiKey.apiKeyPreview) : undefined,
      overview.entitlement ? formatField("Current expiry", formatDateTime(overview.entitlement.validUntil)) : formatField("Current expiry", "none"),
      formatField("Entitlement", formatStatus(overview.entitlementStatus)),
      overview.remainingTokens !== null ? formatField("Remaining tokens", formatNumber(overview.remainingTokens)) : undefined,
    ]),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function formatTelegramUserLabel(
  user: ReturnType<BotIdentityRepository["getUser"]>,
  telegramUserId: string,
): string {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  const username = user?.username ? `@${user.username}` : undefined;
  return [name || undefined, username, `id=${telegramUserId}`].filter(Boolean).join(" | ");
}

function formatStatus(value: string): string {
  return value.replace(/_/g, " ");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

async function renderAdminRenewalList(
  ctx: Context,
  stateStore: TelegramBotStateStore,
  openRequests: RenewalRequestRecord[],
): Promise<void> {
  await renderAdminScreen(ctx, {
    text:
      openRequests.length === 0
        ? "No open renewal requests."
        : [
            "Open renewal requests:",
            ...openRequests.slice(0, 10).map(formatRenewalRequestLine),
          ].join("\n"),
    loop: "billing",
    primaryKeyboard: buildAdminRenewalListKeyboard(stateStore, openRequests),
  });
}

async function renderAdminRenewalInfo(ctx: Context, text: string): Promise<void> {
  await renderAdminScreen(ctx, {
    text,
    loop: "billing",
  });
}

async function showCustomerRenewalContext(
  ctx: Context,
  stateStore: TelegramBotStateStore,
  identities: BotIdentityRepository,
  workspaces: CustomerWorkspaceRepository,
  customerKeys: CustomerKeyRepository,
  billing: BillingRepository,
  auditLog: AuditLogRepository,
  requestId: string,
): Promise<boolean> {
  const request = billing.getRenewalRequest(requestId);
  if (!request) {
    await renderAdminRenewalInfo(ctx, "Renewal request was not found.");
    return false;
  }
  const user = identities.getUser(request.telegramUserId);
  const overview = readCustomerBillingOverview({
    telegramUserId: request.telegramUserId,
    workspaces,
    customerKeys,
    billing,
  });
  const currentApiKey = overview.apiKey;
  const canShowApiKeyToAdmin = ctx.chat?.type === "private" && !!currentApiKey;
  const apiKey = currentApiKey && canShowApiKeyToAdmin ? customerKeys.getApiKeySecret(currentApiKey.id) : undefined;
  if (apiKey && currentApiKey) {
    auditLog.record({
      event: "api_key.revealed",
      actor: { type: "admin", id: ctx.from?.id?.toString() },
      subjectType: "customer_api_key",
      subjectId: currentApiKey.id,
      metadata: {
        telegramUserId: request.telegramUserId,
        workspaceId: request.workspaceId,
        keyPreview: currentApiKey.apiKeyPreview,
        audience: "admin_customer_review",
        apiKey,
      },
    });
  }
  await renderRenewalCustomerContext(ctx, stateStore, request, [
    "Customer renewal review",
    `customer: ${formatTelegramUserLabel(user, request.telegramUserId)}`,
    `request_id: ${request.id}`,
    `workspace_id: ${request.workspaceId}`,
    overview.workspace ? `workspace_status: ${overview.workspace.status}` : "workspace_status: none",
    overview.workspace ? `client_route: ${overview.workspace.defaultClientRoute}` : undefined,
    overview.apiKey ? `key_status: ${overview.apiKey.status}` : undefined,
    overview.apiKey ? `key_preview: ${overview.apiKey.apiKeyPreview}` : undefined,
    apiKey ? `api_key: ${apiKey}` : undefined,
    overview.apiKey && canShowApiKeyToAdmin && !apiKey ? "full_key: unavailable_for_legacy_key" : undefined,
    overview.entitlement ? `current_expiry: ${formatDateTime(overview.entitlement.validUntil)}` : "current_expiry: none",
    `entitlement_status: ${overview.entitlementStatus}`,
    overview.entitlement ? `token_limit: ${overview.entitlement.monthlyTokenLimit}` : undefined,
    overview.remainingTokens !== null ? `remaining_tokens: ${overview.remainingTokens}` : undefined,
    `request_status: ${request.status}`,
  ]
    .filter(Boolean)
    .join("\n"));
  return true;
}

async function confirmRenewalPayment(
  ctx: Context,
  billing: BillingRepository,
  auditLog: AuditLogRepository,
  requestId: string,
): Promise<{ message: string } | false> {
  const request = billing.getRenewalRequest(requestId);
  if (!request) {
    await updateRenewalReviewMessage(ctx, "Renewal request was not found.");
    return false;
  }
  if (request.status === "approved" || request.status === "closed") {
    await updateRenewalReviewMessage(ctx, "Renewal request is not open anymore.");
    return false;
  }
  const confirmed = billing.confirmRenewalPayment({
    id: requestId,
    resolution: "payment_confirmed_manual",
    expectedStatus: "open",
  });
  if (!confirmed) {
    await updateRenewalReviewMessage(ctx, "Payment was already confirmed by another admin.");
    return false;
  }
  const amountVnd = resolveRequestPriceVnd(confirmed, billing);
  auditLog.record({
    event: "payment.confirmed_manual",
    actor: { type: "admin", id: ctx.from?.id?.toString() },
    subjectType: "renewal_request",
    subjectId: requestId,
    metadata: {
      telegramUserId: request.telegramUserId,
      workspaceId: request.workspaceId,
      amountVnd,
      transferDescription: `Chuc ngon mieng ma ${requestId}`,
    },
  });
  const message = [
    "Payment confirmed manually.",
    formatPaymentConfirmationSection(confirmed.id, confirmed.status, amountVnd),
    "Admin can approve this request now.",
  ].join("\n");
  return { message };
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
  overrideTokenDelta?: number,
): Promise<{ message: string } | false> {
  const request = billing.getRenewalRequest(requestId);
  if (!request) {
    await updateRenewalReviewMessage(ctx, "Renewal request was not found.");
    return false;
  }
  if (request.status === "approved" || request.status === "closed") {
    await updateRenewalReviewMessage(ctx, "Renewal request is not open anymore.");
    return false;
  }
  if (request.status !== "payment_confirmed") {
    await updateRenewalReviewMessage(ctx, "Please confirm payment first.");
    return false;
  }
  const planId = overridePlanId ?? request.requestedPlanId ?? DEFAULT_PURCHASE_PLAN_ID;
  const days = overrideDays ?? request.requestedDays;
  if (request.kind === "token_topup") {
    const tokenDelta = overrideTokenDelta ?? request.requestedTokenDelta ?? DEFAULT_PURCHASE_TOKEN_LIMIT;
    const lotDays = overrideDays ?? request.requestedTokenLotDays ?? DEFAULT_TOKEN_TOPUP_LOT_DAYS;
    try {
      const activeKey = customerKeys.getActiveKeyForUser(request.telegramUserId);
      const activeLots = billing.getActiveEntitlementLotsForWorkspace(request.workspaceId);
      if (!activeKey || activeLots.length === 0) {
        throw new Error("Token top-up requires an active customer key and active token lot.");
      }
      const approved = billing.approveTokenTopUpAtomically({
        requestId,
        workspaceId: request.workspaceId,
        tokenDelta,
        lotDays,
        resolution: "approved_by_admin",
      });
      if (!approved) {
        await updateRenewalReviewMessage(ctx, "Request is no longer pending approval.");
        return false;
      }
      const lot = approved.lot;
      auditLog.record({
        event: "renewal.approved",
        actor: { type: "admin", id: ctx.from?.id?.toString() },
        subjectType: "renewal_request",
        subjectId: requestId,
        metadata: {
          telegramUserId: request.telegramUserId,
          workspaceId: request.workspaceId,
          kind: request.kind,
          tokenDelta,
          lotDays,
          lotId: lot.id,
          lotExpiresAt: lot.validUntil,
        },
      });
      const customerNotified = await notifyCustomerAboutApprovedTokenTopUp(ctx, {
        telegramUserId: request.telegramUserId,
        tokenDelta,
        expiresAt: lot.validUntil,
      });
      const message = [
        "Token top-up request approved",
        formatSection("Request", [
          formatField("Request ID", requestId),
          formatField("Telegram user ID", request.telegramUserId),
          formatField("Token delta", formatNumber(tokenDelta)),
          formatField("Lot expires at", formatDateTime(lot.validUntil)),
        ]),
        formatSection("Delivery", [
          customerNotified ? "Customer notified: yes" : "Customer notified: pending manual follow-up",
        ]),
        formatSection("Status", [formatField("Value", "approved")]),
      ]
        .filter(Boolean)
        .join("\n\n");
      if (!silentReply) {
        await updateRenewalReviewMessage(ctx, message);
      }
      return { message };
    } catch (error) {
      return closeFailedApprovalRequest(ctx, billing, auditLog, request, requestId, error);
    }
  }
  if (!planId || !days) {
    await updateRenewalReviewMessage(
      ctx,
      "This renewal request needs manual review. Use /renew approve <requestId> <planId> <days>.",
    );
    return false;
  }

  try {
    const transitioned = billing.approveRenewalRequest({
      id: requestId,
      approvedPlanId: planId,
      approvedDays: days,
      resolution: "approved_by_admin",
      expectedStatus: "payment_confirmed",
    });
    if (!transitioned) {
      await updateRenewalReviewMessage(ctx, "Request is no longer pending approval.");
      return false;
    }
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
    const canShowApiKeyToAdmin = !!result.apiKey && ctx.chat?.type === "private";
    if (canShowApiKeyToAdmin) {
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
    const customerNotified = await notifyCustomerAboutApprovedRenewal(ctx, {
      telegramUserId: request.telegramUserId,
      planId,
      clientRoute: result.clientRoute,
      subscriptionEndsAt: result.subscriptionEndsAt,
      apiKey: result.apiKey,
    });
    if (result.apiKey && customerNotified) {
      auditLog.record({
        event: "api_key.revealed",
        actor: { type: "bot", id: "renewal-approval" },
        subjectType: "customer_api_key",
        subjectId: result.keyId,
        metadata: {
          telegramUserId: request.telegramUserId,
          workspaceId: result.workspaceId,
          keyPreview: result.keyPreview,
          audience: "customer_private_chat",
          apiKey: result.apiKey,
        },
      });
    }

    const message = [
      "Renewal request approved",
      formatSection("Request", [
        formatField("Request ID", requestId),
        formatField("Telegram user ID", request.telegramUserId),
        formatField("Plan ID", planId),
        formatField("Days", days),
        formatField("Mode", result.mode),
          formatField("Subscription ends at", formatDateTime(result.subscriptionEndsAt)),
      ]),
      formatSection("Delivery", [
        canShowApiKeyToAdmin ? `api_key: ${result.apiKey}` : undefined,
        customerNotified ? "Customer notified: yes" : "Customer notified: pending manual follow-up",
      ]),
      formatSection("Status", [formatField("Value", "approved")]),
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!silentReply) {
      await updateRenewalReviewMessage(ctx, message);
    }
    return { message };
  } catch (error) {
    return closeFailedApprovalRequest(ctx, billing, auditLog, request, requestId, error);
  }
}

async function notifyCustomerAboutApprovedRenewal(
  ctx: Context,
  input: {
    telegramUserId: string;
    planId: string;
    clientRoute: string;
    subscriptionEndsAt: string;
    apiKey?: string;
  },
): Promise<boolean> {
  try {
    await ctx.api.sendMessage(
      Number(input.telegramUserId),
      [
        "Your access has been approved",
        formatSection("Plan", [
          formatField("Plan ID", input.planId),
          formatField("Client route", input.clientRoute),
          formatField("Subscription ends at", formatDateTime(input.subscriptionEndsAt)),
        ]),
        formatSection("API key", [
          input.apiKey
            ? `api_key: ${input.apiKey}`
            : "Run /apikey in this private chat to view your current key status.",
        ]),
      ].join("\n\n"),
    );
    return true;
  } catch {
    return false;
  }
}

async function notifyCustomerAboutApprovedTokenTopUp(
  ctx: Context,
  input: {
    telegramUserId: string;
    tokenDelta: number;
    expiresAt: string;
  },
): Promise<boolean> {
  try {
    await ctx.api.sendMessage(
      Number(input.telegramUserId),
      [
        "Your token top-up has been approved",
        formatSection("Tokens", [
          formatField("Token delta", formatNumber(input.tokenDelta)),
          formatField("Expires at", formatDateTime(input.expiresAt)),
        ]),
        "Your existing API key can use this token lot.",
      ].join("\n\n"),
    );
    return true;
  } catch {
    return false;
  }
}

async function closeFailedApprovalRequest(
  ctx: Context,
  billing: BillingRepository,
  auditLog: AuditLogRepository,
  request: RenewalRequestRecord,
  requestId: string,
  error: unknown,
): Promise<false> {
  const currentRequest = billing.getRenewalRequest(requestId);
  if (currentRequest && currentRequest.status !== "closed") {
    billing.closeRenewalRequest({
      id: requestId,
      resolution: "approval_failed",
    });
    auditLog.record({
      event: "renewal.closed",
      actor: { type: "system", id: "renewal-approval-failed" },
      subjectType: "renewal_request",
      subjectId: requestId,
      metadata: {
        telegramUserId: currentRequest.telegramUserId,
        workspaceId: currentRequest.workspaceId,
        kind: currentRequest.kind,
        resolution: "approval_failed",
        priorStatus: currentRequest.status,
      },
    });
    try {
      await ctx.api.sendMessage(
        Number(currentRequest.telegramUserId),
        [
          currentRequest.kind === "token_topup"
            ? "Your token top-up approval failed before tokens could be added."
            : "Your API key purchase approval failed before access could be provisioned.",
          `request_id: ${requestId}`,
          currentRequest.kind === "token_topup"
            ? "The failed request was closed automatically. You can tap Buy tokens again."
            : "The failed request was closed automatically. You can tap Buy API key again.",
        ].join("\n"),
      );
    } catch {
      // best effort notification
    }
  }
  await updateRenewalReviewMessage(
    ctx,
    [
      request.kind === "token_topup" ? "Token top-up approval failed." : "Renewal approval failed.",
      `request_id: ${requestId}`,
      "status: closed",
      "resolution: approval_failed",
      `error: ${getProxyErrorMessage(error)}`,
      request.kind === "token_topup"
        ? "Customer can submit a new Buy tokens request."
        : "Customer can submit a new Buy API key request.",
    ].join("\n"),
  );
  return false;
}

async function closeRenewalRequest(
  ctx: Context,
  billing: BillingRepository,
  auditLog: AuditLogRepository,
  requestId: string,
  resolution = "closed_by_admin",
  silentReply = false,
  notifyCustomer = false,
): Promise<{ message: string } | false> {
  const request = billing.getRenewalRequest(requestId);
  if (!request) {
    await updateRenewalReviewMessage(ctx, "Renewal request was not found.");
    return false;
  }
  if (request.status === "approved" || request.status === "closed") {
    await updateRenewalReviewMessage(ctx, "Renewal request is not open anymore.");
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
  ];
  if (notifyCustomer) {
    try {
      await ctx.api.sendMessage(
        Number(request.telegramUserId),
        [
          "Your renewal request was not approved.",
          `request_id: ${closed?.id ?? requestId}`,
          `reason: ${closed?.resolution ?? resolution}`,
          "Contact support if you believe this needs another review.",
        ].join("\n"),
      );
    } catch {
      message.push("customer_notification: pending_manual_follow_up");
    }
  }
  if (!silentReply) {
    await updateRenewalReviewMessage(ctx, message.join("\n"));
  }
  return { message: message.join("\n") };
}

async function updateRenewalReviewMessage(ctx: Context, text: string): Promise<void> {
  const callbackMessage = ctx.callbackQuery && "message" in ctx.callbackQuery ? ctx.callbackQuery.message : undefined;
  try {
    if (callbackMessage && "editMessageText" in ctx && typeof ctx.editMessageText === "function") {
      await ctx.editMessageText(text, {
        reply_markup: undefined,
      } as any);
      return;
    }
    if (callbackMessage && "editMessageReplyMarkup" in ctx && typeof ctx.editMessageReplyMarkup === "function") {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined } as any);
    }
  } catch {
    // best effort cleanup
  }
  await ctx.reply(text);
}

async function renderRenewalPromptCard(
  ctx: Context,
  stateStore: TelegramBotStateStore,
  request: RenewalRequestRecord,
  text: string,
  mode: "main" | "reject" | "prompt",
): Promise<void> {
  try {
    if ("editMessageText" in ctx && typeof ctx.editMessageText === "function") {
      await ctx.editMessageText(text, {
        reply_markup:
          mode === "reject"
            ? buildRejectReasonKeyboard(stateStore, request)
            : mode === "prompt"
              ? buildRenewalPromptKeyboard(stateStore, request)
              : buildAdminRenewalKeyboard(stateStore, request),
      } as any);
      return;
    }
    if ("editMessageReplyMarkup" in ctx && typeof ctx.editMessageReplyMarkup === "function") {
      await ctx.editMessageReplyMarkup({
        reply_markup:
          mode === "reject"
            ? buildRejectReasonKeyboard(stateStore, request)
            : mode === "prompt"
              ? buildRenewalPromptKeyboard(stateStore, request)
              : buildAdminRenewalKeyboard(stateStore, request),
      } as any);
    }
  } catch {
    // best effort cleanup
  }
}

async function renderRenewalCustomerContext(
  ctx: Context,
  stateStore: TelegramBotStateStore,
  request: RenewalRequestRecord,
  text: string,
): Promise<void> {
  try {
    if ("editMessageText" in ctx && typeof ctx.editMessageText === "function") {
      await ctx.editMessageText(text, {
        reply_markup: buildRenewalCustomerKeyboard(stateStore, request),
      } as any);
      return;
    }
  } catch {
    // best effort cleanup
  }
  await ctx.reply(text, {
    reply_markup: buildRenewalCustomerKeyboard(stateStore, request),
  });
}

async function updateRenewalReviewMessageByRef(
  ctx: Context,
  chatId: string,
  messageId: number,
  text: string,
): Promise<void> {
  try {
    await ctx.api.editMessageText(Number(chatId), messageId, text, {
      reply_markup: undefined,
    } as any);
  } catch {
    // best effort cleanup
  }
}

async function renderRenewalPromptCardByRef(
  ctx: Context,
  stateStore: TelegramBotStateStore,
  request: RenewalRequestRecord | undefined,
  chatId: string,
  messageId: number,
  text: string,
  mode: "main" | "reject" | "prompt",
): Promise<void> {
  if (!request) {
    await updateRenewalReviewMessageByRef(ctx, chatId, messageId, text);
    return;
  }
  try {
    await ctx.api.editMessageText(Number(chatId), messageId, text, {
      reply_markup:
        mode === "reject"
          ? buildRejectReasonKeyboard(stateStore, request)
          : mode === "prompt"
            ? buildRenewalPromptKeyboard(stateStore, request)
            : buildAdminRenewalKeyboard(stateStore, request),
    } as any);
  } catch {
    // best effort cleanup
  }
}

async function showRenewalRejectKeyboard(
  ctx: Context,
  stateStore: TelegramBotStateStore,
  request: RenewalRequestRecord,
): Promise<void> {
  await renderRenewalPromptCard(
    ctx,
    stateStore,
    request,
    [
      "Renewal review",
      `request_id: ${request.id}`,
      "Choose a rejection reason.",
    ].join("\n"),
    "reject",
  );
}

async function showRenewalMainKeyboard(
  ctx: Context,
  stateStore: TelegramBotStateStore,
  request: RenewalRequestRecord,
  text: string,
): Promise<void> {
  await renderRenewalPromptCard(
    ctx,
    stateStore,
    request,
    text,
    "main",
  );
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
    `kind=${request.kind}`,
    `telegram_user_id=${request.telegramUserId}`,
    request.requestedPlanId ? `plan_id=${request.requestedPlanId}` : undefined,
    request.requestedDays ? `days=${request.requestedDays}` : undefined,
    request.requestedTokenDelta ? `token_delta=${request.requestedTokenDelta}` : undefined,
    request.requestedTokenLotDays ? `token_lot_days=${request.requestedTokenLotDays}` : undefined,
    `requested_at=${formatDateTime(request.requestedAt)}`,
  ]
    .filter(Boolean)
    .join(" ");
}

function issueRenewalCallbackToken(
  stateStore: TelegramBotStateStore,
  payload: Extract<TelegramBotCallbackPayload, { kind: "renewal_request_action" }>,
): string {
  return stateStore.issueCallbackToken(payload, Date.now(), RENEWAL_CALLBACK_TOKEN_TTL_MS);
}
