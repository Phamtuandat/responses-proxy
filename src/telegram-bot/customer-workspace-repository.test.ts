import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { CustomerWorkspaceRepository } from "./customer-workspace-repository.js";

function withRepository(fn: (repo: CustomerWorkspaceRepository) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), "customer-workspace-"));
  try {
    fn(CustomerWorkspaceRepository.create(path.join(dir, "bot.sqlite")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("CustomerWorkspaceRepository creates default workspace idempotently", () => {
  withRepository((repo) => {
    const first = repo.ensureDefaultWorkspace({
      ownerTelegramUserId: "1283361952",
      telegramChatId: "1283361952",
      defaultClientRoute: "customers",
      status: "active",
      now: new Date("2026-04-27T00:00:00.000Z"),
    });
    const second = repo.ensureDefaultWorkspace({
      ownerTelegramUserId: "1283361952",
      defaultClientRoute: "other",
      status: "pending_approval",
      now: new Date("2026-04-28T00:00:00.000Z"),
    });

    assert.equal(second.id, first.id);
    assert.equal(second.defaultClientRoute, "customers");
    assert.equal(second.status, "active");
    assert.equal(second.createdAt, "2026-04-27T00:00:00.000Z");
  });
});

test("CustomerWorkspaceRepository can create pending approval workspace", () => {
  withRepository((repo) => {
    const workspace = repo.ensureDefaultWorkspace({
      ownerTelegramUserId: "42",
      defaultClientRoute: "customers",
      status: "pending_approval",
    });

    assert.equal(workspace.ownerTelegramUserId, "42");
    assert.equal(workspace.status, "pending_approval");
  });
});
