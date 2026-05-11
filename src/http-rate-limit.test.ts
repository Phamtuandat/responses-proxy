import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryHttpRateLimiter } from "./http-rate-limit.js";

test("rate limiter allows requests until bucket limit is reached", () => {
  const limiter = new InMemoryHttpRateLimiter();

  const first = limiter.consume("responses:token-a", {
    windowMs: 1_000,
    maxRequests: 2,
    nowMs: 10_000,
  });
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);
  assert.equal(first.retryAfterMs, 0);

  const second = limiter.consume("responses:token-a", {
    windowMs: 1_000,
    maxRequests: 2,
    nowMs: 10_100,
  });
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);

  const third = limiter.consume("responses:token-a", {
    windowMs: 1_000,
    maxRequests: 2,
    nowMs: 10_200,
  });
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
  assert.equal(third.retryAfterMs, 800);
});

test("rate limiter resets bucket after window expires", () => {
  const limiter = new InMemoryHttpRateLimiter();

  assert.equal(
    limiter.consume("health:ip-a", {
      windowMs: 1_000,
      maxRequests: 1,
      nowMs: 5_000,
    }).allowed,
    true,
  );
  assert.equal(
    limiter.consume("health:ip-a", {
      windowMs: 1_000,
      maxRequests: 1,
      nowMs: 5_500,
    }).allowed,
    false,
  );

  const reset = limiter.consume("health:ip-a", {
    windowMs: 1_000,
    maxRequests: 1,
    nowMs: 6_000,
  });
  assert.equal(reset.allowed, true);
  assert.equal(reset.remaining, 0);
});

test("rate limiter isolates keys", () => {
  const limiter = new InMemoryHttpRateLimiter();

  assert.equal(
    limiter.consume("responses:token-a", {
      windowMs: 1_000,
      maxRequests: 1,
      nowMs: 1,
    }).allowed,
    true,
  );
  assert.equal(
    limiter.consume("responses:token-b", {
      windowMs: 1_000,
      maxRequests: 1,
      nowMs: 2,
    }).allowed,
    true,
  );
});
