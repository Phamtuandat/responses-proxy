import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PromptCacheStateStore } from "./prompt-cache-state.js";

test("persists latest prompt cache observation across store recreation", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-cache-state-"));
  const dbFile = path.join(tempDir, "app.sqlite");

  try {
    const firstStore = PromptCacheStateStore.create(dbFile);
    firstStore.saveLatestObservation({
      requestId: "req-1",
      providerId: "provider-a",
      model: "cx/gpt-5.4",
      familyId: "family:model:core:abc",
      staticKey: "static:family:model:core:abc:def",
      requestKey: "request:static:family:model:core:abc:def:ghi",
      promptCacheKey: "request:static:family:model:core:abc:def:ghi",
      promptCacheRetention: "24h",
      cacheHit: true,
      cachedTokens: 123,
      cacheSavedPercent: 61.5,
      stream: false,
      timestamp: "2026-04-18T08:00:00.000Z",
    });

    const secondStore = PromptCacheStateStore.create(dbFile);
    const loaded = secondStore.loadLatestObservations();

    assert.equal(loaded.latest?.requestId, "req-1");
    assert.equal(loaded.latest?.providerId, "provider-a");
    assert.equal(loaded.byProvider.get("provider-a")?.staticKey, "static:family:model:core:abc:def");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("persists cache hit streak across store recreation", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-cache-state-"));
  const dbFile = path.join(tempDir, "app.sqlite");

  try {
    const firstStore = PromptCacheStateStore.create(dbFile);
    const first = firstStore.recordCacheResult("session-a", 20, {
      nowMs: 1_000,
      ttlMs: 10_000,
    });

    assert.deepEqual(first, {
      cacheHit: true,
      consecutiveCacheHits: 1,
    });

    const secondStore = PromptCacheStateStore.create(dbFile);
    const second = secondStore.recordCacheResult("session-a", 30, {
      nowMs: 2_000,
      ttlMs: 10_000,
    });

    assert.deepEqual(second, {
      cacheHit: true,
      consecutiveCacheHits: 2,
    });

    const third = secondStore.recordCacheResult("session-a", 0, {
      nowMs: 3_000,
      ttlMs: 10_000,
    });

    assert.deepEqual(third, {
      cacheHit: false,
      consecutiveCacheHits: 0,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
