import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BillingRepository } from "./billing.js";
import { recordCustomerUsageFromPayload } from "./customer-usage.js";

function withRepository(fn: (repo: BillingRepository) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "customer-usage-"));
  try {
    fn(BillingRepository.create(path.join(dir, "billing.sqlite")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("recordCustomerUsageFromPayload returns zero change for operator access", () => {
  withRepository((repo) => {
    const usage = recordCustomerUsageFromPayload({
      billingRepository: repo,
      usagePayload: { usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } },
      access: { kind: "operator" },
    });

    assert.equal(usage, undefined);
  });
});

test("recordCustomerUsageFromPayload increments customer entitlement usage after a request", () => {
  withRepository((repo) => {
    const granted = repo.grantSubscription({
      workspaceId: "workspace-1",
      planId: "basic",
      days: 30,
      now: new Date("2026-04-27T00:00:00.000Z"),
    });

    const usage = recordCustomerUsageFromPayload({
      billingRepository: repo,
      usagePayload: {
        usage: {
          input_tokens: 12,
          output_tokens: 8,
          total_tokens: 20,
        },
      },
      access: {
        kind: "customer",
        workspace: { id: "workspace-1" },
        entitlement: { id: granted.entitlement.id },
        customerKey: { id: "key-1" },
      },
    });

    assert.ok(usage);
    assert.equal(usage.totalTokens, 20);
    assert.equal(repo.getEntitlementUsage(granted.entitlement.id)?.totalTokens, 20);
  });
});
