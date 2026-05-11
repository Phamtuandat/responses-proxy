import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BillingRepository } from "./billing.js";

function withRepository(fn: (repo: BillingRepository) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "billing-repo-"));
  try {
    fn(BillingRepository.create(path.join(dir, "billing.sqlite")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("BillingRepository seeds default plans", () => {
  withRepository((repo) => {
    const plans = repo.listPlans();
    assert.equal(plans.some((plan) => plan.id === "basic"), true);
    assert.equal(plans.length, 1);
    assert.equal(plans[0]?.priceCents, 5_000);
    assert.equal(plans[0]?.currency, "VND");
    assert.equal(plans[0]?.monthlyTokenLimit, 10_000_000);
  });
});

test("BillingRepository grants subscription and active entitlement", () => {
  withRepository((repo) => {
    const granted = repo.grantSubscription({
      workspaceId: "workspace-1",
      planId: "basic",
      days: 30,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });

    assert.equal(granted.subscription.workspaceId, "workspace-1");
    assert.equal(granted.subscription.planId, "basic");
    assert.equal(granted.entitlement.workspaceId, "workspace-1");
    assert.equal(granted.entitlement.status, "active");
    assert.equal(
      repo.getActiveEntitlementForWorkspace("workspace-1", new Date("2026-04-28T00:00:00.000Z"))?.id,
      granted.entitlement.id,
    );
  });
});

test("BillingRepository keeps renewed entitlement pending until the current period ends", () => {
  withRepository((repo) => {
    const first = repo.grantSubscription({
      workspaceId: "workspace-renew",
      planId: "basic",
      days: 30,
      now: new Date("2026-04-01T00:00:00.000Z"),
    });

    const renewed = repo.grantSubscription({
      workspaceId: "workspace-renew",
      planId: "basic",
      days: 30,
      now: new Date("2026-04-15T00:00:00.000Z"),
    });

    assert.equal(renewed.subscription.currentPeriodStart, "2026-05-01T00:00:00.000Z");
    assert.equal(renewed.entitlement.validFrom, "2026-05-01T00:00:00.000Z");
    assert.equal(
      repo.getActiveEntitlementForWorkspace("workspace-renew", new Date("2026-04-20T00:00:00.000Z"))?.id,
      first.entitlement.id,
    );
    assert.equal(
      repo.getActiveEntitlementForWorkspace("workspace-renew", new Date("2026-05-02T00:00:00.000Z"))?.id,
      renewed.entitlement.id,
    );
  });
});

test("BillingRepository expires outdated entitlements and subscriptions", () => {
  withRepository((repo) => {
    repo.grantSubscription({
      workspaceId: "workspace-1",
      planId: "basic",
      days: 1,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });

    const changes = repo.expireEntitlements(new Date("2026-04-29T00:00:00.000Z"));

    assert.equal(changes, 1);
    assert.equal(repo.getActiveEntitlementForWorkspace("workspace-1", new Date("2026-04-29T00:00:00.000Z")), undefined);
    assert.equal(repo.getLatestSubscriptionForWorkspace("workspace-1")?.status, "expired");
  });
});

test("BillingRepository tracks entitlement usage totals", () => {
  withRepository((repo) => {
    const granted = repo.grantSubscription({
      workspaceId: "workspace-usage",
      planId: "basic",
      days: 30,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });

    repo.incrementEntitlementUsage({
      entitlementId: granted.entitlement.id,
      workspaceId: "workspace-usage",
      customerApiKeyId: "key-1",
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      now: new Date("2026-04-27T01:00:00.000Z"),
    });
    const usage = repo.incrementEntitlementUsage({
      entitlementId: granted.entitlement.id,
      workspaceId: "workspace-usage",
      inputTokens: 4,
      outputTokens: 6,
      totalTokens: 10,
      now: new Date("2026-04-27T02:00:00.000Z"),
    });

    assert.equal(usage.inputTokens, 14);
    assert.equal(usage.outputTokens, 11);
    assert.equal(usage.totalTokens, 25);
    assert.equal(repo.getEntitlementUsage(granted.entitlement.id)?.totalTokens, 25);
  });
});

test("BillingRepository returns the latest entitlement for expired workspaces", () => {
  withRepository((repo) => {
    repo.grantSubscription({
      workspaceId: "workspace-expired",
      planId: "basic",
      days: 1,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    repo.expireEntitlements(new Date("2026-04-29T00:00:00.000Z"));

    const latest = repo.getLatestEntitlementForWorkspace("workspace-expired");
    assert.ok(latest);
    assert.equal(latest.status, "expired");
  });
});

test("BillingRepository dedupes duplicate open renewal requests", () => {
  withRepository((repo) => {
    const first = repo.createRenewalRequest({
      workspaceId: "workspace-1",
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 30,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    const second = repo.createRenewalRequest({
      workspaceId: "workspace-1",
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 30,
      now: new Date("2026-04-27T01:00:00.000Z"),
    });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.request.id, second.request.id);
    assert.equal(repo.listRenewalRequests("open").length, 1);
  });
});

test("BillingRepository keeps token top-up requests separate from renewals", () => {
  withRepository((repo) => {
    const renewal = repo.createRenewalRequest({
      workspaceId: "workspace-kind",
      telegramUserId: "42",
      requestedPlanId: "basic",
      requestedDays: 1,
    });
    const topup = repo.createRenewalRequest({
      workspaceId: "workspace-kind",
      telegramUserId: "42",
      kind: "token_topup",
      requestedTokenDelta: 1_000,
      requestedTokenLotDays: 7,
      priceVnd: 5_000,
    });
    const duplicateTopup = repo.createRenewalRequest({
      workspaceId: "workspace-kind",
      telegramUserId: "42",
      kind: "token_topup",
      requestedTokenDelta: 1_000,
      requestedTokenLotDays: 7,
      priceVnd: 5_000,
    });

    assert.equal(renewal.created, true);
    assert.equal(topup.created, true);
    assert.equal(duplicateTopup.created, false);
    assert.equal(topup.request.kind, "token_topup");
    assert.equal(topup.request.requestedTokenDelta, 1_000);
    assert.equal(topup.request.requestedTokenLotDays, 7);
  });
});

test("BillingRepository consumes active token lots by earliest expiry first", () => {
  withRepository((repo) => {
    const workspaceId = "workspace-lots";
    const first = repo.createTokenTopUpLot({
      workspaceId,
      tokenDelta: 100,
      days: 1,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    const second = repo.createTokenTopUpLot({
      workspaceId,
      tokenDelta: 200,
      days: 2,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });

    repo.consumeWorkspaceUsage({
      workspaceId,
      customerApiKeyId: "key-1",
      inputTokens: 60,
      outputTokens: 90,
      totalTokens: 150,
      now: new Date("2026-04-27T01:00:00.000Z"),
    });

    assert.equal(repo.getEntitlementUsage(first.id)?.totalTokens, 100);
    assert.equal(repo.getEntitlementUsage(second.id)?.totalTokens, 50);
    assert.equal((repo.getEntitlementUsage(first.id)?.inputTokens ?? 0) + (repo.getEntitlementUsage(second.id)?.inputTokens ?? 0), 60);
    assert.equal((repo.getEntitlementUsage(first.id)?.outputTokens ?? 0) + (repo.getEntitlementUsage(second.id)?.outputTokens ?? 0), 90);
    assert.equal(repo.getUsableActiveEntitlementForWorkspace(workspaceId, new Date("2026-04-27T01:00:00.000Z"))?.id, second.id);
  });
});

test("closing a renewal request does not alter entitlement", () => {
  withRepository((repo) => {
    const granted = repo.grantSubscription({
      workspaceId: "workspace-close",
      planId: "basic",
      days: 30,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    const request = repo.createRenewalRequest({
      workspaceId: "workspace-close",
      telegramUserId: "99",
      requestedPlanId: "basic",
      requestedDays: 15,
      now: new Date("2026-04-27T01:00:00.000Z"),
    });

    const closed = repo.closeRenewalRequest({
      id: request.request.id,
      resolution: "manual-close",
      now: new Date("2026-04-27T02:00:00.000Z"),
    });

    assert.equal(closed?.status, "closed");
    assert.equal(closed?.resolution, "manual-close");
    assert.equal(repo.getActiveEntitlementForWorkspace("workspace-close")?.id, granted.entitlement.id);
  });
});
