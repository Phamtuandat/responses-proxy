import assert from "node:assert/strict";
import test from "node:test";
import { buildCostSummary } from "./cost-analytics.js";

test("buildCostSummary aggregates prompt cache observations", () => {
  const summary = buildCostSummary([
    {
      cacheHit: true,
      cacheSavedPercent: 50,
      cachedTokens: 100,
      timestamp: "2026-05-11T00:02:00.000Z",
    },
    {
      cacheHit: false,
      cacheSavedPercent: 10,
      cachedTokens: 0,
      timestamp: "2026-05-11T00:01:00.000Z",
    },
  ]);

  assert.deepEqual(summary.window, {
    from: "2026-05-11T00:01:00.000Z",
    to: "2026-05-11T00:02:00.000Z",
  });
  assert.equal(summary.totalRequests, 2);
  assert.equal(summary.promptCacheHits, 1);
  assert.equal(summary.promptCacheHitRate, 0.5);
  assert.equal(summary.avgCacheSavedPercent, 30);
  assert.equal(summary.estimatedTokensSaved, 100);
});

test("buildCostSummary returns zero summary for empty observations", () => {
  const summary = buildCostSummary([]);

  assert.equal(summary.totalRequests, 0);
  assert.equal(summary.promptCacheHits, 0);
  assert.equal(summary.promptCacheHitRate, 0);
  assert.equal(summary.avgCacheSavedPercent, 0);
  assert.equal(summary.estimatedTokensSaved, 0);
  assert.match(summary.window.from, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(summary.window.to, summary.window.from);
});
