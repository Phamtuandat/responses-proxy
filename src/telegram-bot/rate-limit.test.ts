import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { SqliteRateLimiter } from "./rate-limit.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop();
    if (directory) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("SqliteRateLimiter blocks requests above the per-user threshold", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "telegram-rate-limit-"));
  tempDirs.push(directory);
  const dbFile = path.join(directory, "bot.sqlite");
  const limiter = SqliteRateLimiter.create(dbFile, {
    windowMs: 1_000,
    maxRequests: 2,
  });

  assert.equal(limiter.consume("user-1", 1_000).allowed, true);
  assert.equal(limiter.consume("user-1", 1_100).allowed, true);

  const denied = limiter.consume("user-1", 1_200);
  assert.equal(denied.allowed, false);
  assert.equal(denied.remaining, 0);
  assert.ok(denied.retryAfterMs > 0);
});

test("SqliteRateLimiter resets after the configured window", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "telegram-rate-limit-"));
  tempDirs.push(directory);
  const dbFile = path.join(directory, "bot.sqlite");
  const limiter = SqliteRateLimiter.create(dbFile, {
    windowMs: 1_000,
    maxRequests: 1,
  });

  assert.equal(limiter.consume("user-2", 5_000).allowed, true);
  assert.equal(limiter.consume("user-2", 5_500).allowed, false);
  assert.equal(limiter.consume("user-2", 6_001).allowed, true);
});

test("SqliteRateLimiter persists counters across recreation", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "telegram-rate-limit-"));
  tempDirs.push(directory);
  const dbFile = path.join(directory, "bot.sqlite");
  const firstLimiter = SqliteRateLimiter.create(dbFile, {
    windowMs: 1_000,
    maxRequests: 2,
  });
  firstLimiter.consume("user-3", 100);

  const secondLimiter = SqliteRateLimiter.create(dbFile, {
    windowMs: 1_000,
    maxRequests: 2,
  });
  assert.equal(secondLimiter.consume("user-3", 200).allowed, true);
  assert.equal(secondLimiter.consume("user-3", 300).allowed, false);
});
