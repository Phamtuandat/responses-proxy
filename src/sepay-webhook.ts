import type { AuditLogRepository } from "./audit-log.js";
import type { BillingRepository, RenewalRequestRecord } from "./billing.js";

const REQUEST_ID_PATTERN = /Chuc\s+ngon\s+mieng\s+ma\s+([A-Fa-f0-9-]{8,})/i;
const DEFAULT_FALLBACK_AMOUNT_VND = 5_000;

export type SepayWebhookPayload = {
  transferAmount?: number | string;
  transferType?: string;
  content?: string;
  referenceCode?: string;
  id?: number | string;
  gateway?: string;
  [key: string]: unknown;
};

export type SepayWebhookOutcome =
  | { status: "ignored"; reason: string }
  | { status: "already_processed"; request: RenewalRequestRecord }
  | { status: "amount_mismatch"; request: RenewalRequestRecord; receivedAmount: number; expectedAmount: number }
  | { status: "confirmed"; request: RenewalRequestRecord; amountVnd: number };

export function resolveExpectedAmountVnd(
  request: RenewalRequestRecord,
  billing: BillingRepository,
): number {
  if (typeof request.priceVnd === "number" && request.priceVnd > 0) {
    return request.priceVnd;
  }
  if (request.kind === "renewal") {
    const planId = request.requestedPlanId ?? "basic";
    const plan = billing.getPlan(planId);
    if (plan && plan.currency === "VND" && plan.priceCents > 0) {
      return plan.priceCents;
    }
  }
  return DEFAULT_FALLBACK_AMOUNT_VND;
}

export function extractRequestIdFromContent(content: string | undefined): string | undefined {
  if (!content) {
    return undefined;
  }
  const match = content.match(REQUEST_ID_PATTERN);
  return match ? match[1] : undefined;
}

export function processSepayWebhook(args: {
  payload: SepayWebhookPayload;
  billing: BillingRepository;
  auditLog: AuditLogRepository;
  adminActorId?: string;
}): SepayWebhookOutcome {
  const payload = args.payload;
  const transferType = typeof payload.transferType === "string" ? payload.transferType.toLowerCase() : undefined;
  if (transferType && transferType !== "in") {
    return { status: "ignored", reason: `transfer_type_${transferType}` };
  }

  const requestId = extractRequestIdFromContent(typeof payload.content === "string" ? payload.content : undefined);
  if (!requestId) {
    return { status: "ignored", reason: "no_request_id_in_content" };
  }

  const request = args.billing.getRenewalRequest(requestId);
  if (!request) {
    return { status: "ignored", reason: "request_not_found" };
  }

  if (request.status !== "open") {
    return { status: "already_processed", request };
  }

  const receivedAmount = Number(payload.transferAmount);
  if (!Number.isFinite(receivedAmount) || receivedAmount <= 0) {
    return { status: "ignored", reason: "invalid_amount" };
  }

  const expectedAmount = resolveExpectedAmountVnd(request, args.billing);
  if (receivedAmount !== expectedAmount) {
    args.auditLog.record({
      event: "payment.amount_mismatch",
      actor: { type: "system", id: "sepay-webhook" },
      subjectType: "renewal_request",
      subjectId: request.id,
      metadata: {
        telegramUserId: request.telegramUserId,
        workspaceId: request.workspaceId,
        receivedAmountVnd: receivedAmount,
        expectedAmountVnd: expectedAmount,
        referenceCode: typeof payload.referenceCode === "string" ? payload.referenceCode : undefined,
      },
    });
    return { status: "amount_mismatch", request, receivedAmount, expectedAmount };
  }

  const confirmed = args.billing.confirmRenewalPayment({
    id: request.id,
    resolution: "payment_confirmed_sepay_webhook",
    expectedStatus: "open",
  });
  if (!confirmed) {
    const latest = args.billing.getRenewalRequest(request.id);
    return latest
      ? { status: "already_processed", request: latest }
      : { status: "ignored", reason: "request_gone" };
  }

  args.auditLog.record({
    event: "payment.confirmed_sepay",
    actor: { type: "system", id: "sepay-webhook" },
    subjectType: "renewal_request",
    subjectId: request.id,
    metadata: {
      telegramUserId: request.telegramUserId,
      workspaceId: request.workspaceId,
      amountVnd: receivedAmount,
      transferDescription: typeof payload.content === "string" ? payload.content : undefined,
      referenceCode: typeof payload.referenceCode === "string" ? payload.referenceCode : undefined,
      gateway: typeof payload.gateway === "string" ? payload.gateway : undefined,
    },
  });

  return { status: "confirmed", request: confirmed, amountVnd: receivedAmount };
}
