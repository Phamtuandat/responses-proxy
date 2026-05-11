import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ResponseCacheStore } from "./response-cache.js";

test("ResponseCacheStore stores, expires, reports stats, and flushes entries", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-response-cache-"));
  const dbFile = path.join(tempDir, "cache.sqlite");
  try {
    const store = ResponseCacheStore.create(dbFile);
    store.set("request-a", "provider-a", { ok: true, value: 1 }, 60_000);

    assert.deepEqual(store.get("request-a", "provider-a"), { ok: true, value: 1 });
    assert.equal(store.get("request-a", "provider-b"), undefined);

    const stats = store.stats();
    assert.equal(stats.totalEntries, 1);
    assert.equal(stats.expiredEntries, 0);
    assert.equal(stats.estimatedBytes > 0, true);

    store.set("request-expired", "provider-a", { ok: false }, -1);
    assert.equal(store.get("request-expired", "provider-a"), undefined);
    assert.equal(store.prune(), 1);
    assert.equal(store.flush(), 1);
    assert.equal(store.stats().totalEntries, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
