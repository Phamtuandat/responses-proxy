import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AuditLogRepository } from "./audit-log.js";
import { BillingRepository } from "./billing.js";
import { CustomerWorkspaceRepository } from "./telegram-bot/customer-workspace-repository.js";
import { processSepayWebhook } from "./sepay-webhook.js";

function setup(): {
  billing: BillingRepository;
  audit: AuditLogRepository;
  workspaces: CustomerWorkspaceRepository;
  cleanup: () => void;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), "sepay-webhook-"));
  const dbFile = path.join(dir, "bot.sqlite");
  const billing = BillingRepository.create(dbFile);
  const audit = AuditLogRepository.create(dbFile);
  const workspaces = CustomerWorkspaceRepository.create(dbFile);
  return {
    billing,
    audit,
    workspaces,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("sepay webhook confirms a matching renewal request", () => {
  const { billing, audit, workspaces, cleanup } = setup();
  try {
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    const created = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 1,
      priceVnd: 5_000,
    });

    const outcome = processSepayWebhook({
      payload: {
        transferAmount: 5_000,
        transferType: "in",
        content: `Chuc ngon mieng ma ${created.request.id}`,
        referenceCode: "FT123",
      },
      billing,
      auditLog: audit,
    });

    assert.equal(outcome.status, "confirmed");
    assert.equal(billing.getRenewalRequest(created.request.id)?.status, "payment_confirmed");
    const events = audit.listEvents({ event: "payment.confirmed_sepay", limit: 5 });
    assert.equal(events.length, 1);
  } finally {
    cleanup();
  }
});

test("sepay webhook records mismatch without confirming on wrong amount", () => {
  const { billing, audit, workspaces, cleanup } = setup();
  try {
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    const created = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 1,
      priceVnd: 5_000,
    });

    const outcome = processSepayWebhook({
      payload: {
        transferAmount: 1_000,
        transferType: "in",
        content: `Chuc ngon mieng ma ${created.request.id}`,
      },
      billing,
      auditLog: audit,
    });

    assert.equal(outcome.status, "amount_mismatch");
    assert.equal(billing.getRenewalRequest(created.request.id)?.status, "open");
    assert.equal(audit.listEvents({ event: "payment.amount_mismatch", limit: 5 }).length, 1);
    assert.equal(audit.listEvents({ event: "payment.confirmed_sepay", limit: 5 }).length, 0);
  } finally {
    cleanup();
  }
});

test("sepay webhook ignores payloads without a recognizable request id", () => {
  const { billing, audit, cleanup } = setup();
  try {
    const outcome = processSepayWebhook({
      payload: {
        transferAmount: 5_000,
        transferType: "in",
        content: "unrelated transfer",
      },
      billing,
      auditLog: audit,
    });
    assert.equal(outcome.status, "ignored");
    assert.equal(audit.listEvents({ limit: 5 }).length, 0);
  } finally {
    cleanup();
  }
});

test("sepay webhook reports already_processed for non-open requests", () => {
  const { billing, audit, workspaces, cleanup } = setup();
  try {
    const workspace = workspaces.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "active",
    });
    const created = billing.createRenewalRequest({
      workspaceId: workspace.id,
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 1,
      priceVnd: 5_000,
    });
    billing.confirmRenewalPayment({ id: created.request.id, expectedStatus: "open" });

    const outcome = processSepayWebhook({
      payload: {
        transferAmount: 5_000,
        transferType: "in",
        content: `Chuc ngon mieng ma ${created.request.id}`,
      },
      billing,
      auditLog: audit,
    });

    assert.equal(outcome.status, "already_processed");
    assert.equal(audit.listEvents({ event: "payment.confirmed_sepay", limit: 5 }).length, 0);
  } finally {
    cleanup();
  }
});
