import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClientTokenLimitError,
  extractUsageTotals,
  getClientTokenLimitStatus,
  resolveClientTokenWindowStart,
} from "./client-token-limits.js";
import type { ClientTokenLimitConfig, ClientTokenUsageSnapshot } from "./runtime-provider-repository.js";

const baseConfig: ClientTokenLimitConfig = {
  clientRoute: "codex",
  enabled: true,
  tokenLimit: 1000,
  windowType: "daily",
  hardBlock: true,
  createdAt: "2026-04-27T00:00:00.000Z",
  updatedAt: "2026-04-27T00:00:00.000Z",
};

const baseUsage: ClientTokenUsageSnapshot = {
  clientRoute: "codex",
  windowStart: "2026-04-27T00:00:00.000Z",
  inputTokens: 100,
  outputTokens: 50,
  totalTokens: 150,
  updatedAt: "2026-04-27T12:00:00.000Z",
};

test("resolveClientTokenWindowStart supports daily weekly monthly and fixed windows", () => {
  const now = new Date("2026-04-29T13:45:30.000Z");

  assert.equal(
    resolveClientTokenWindowStart(now, { windowType: "daily" }),
    "2026-04-29T00:00:00.000Z",
  );
  assert.equal(
    resolveClientTokenWindowStart(now, { windowType: "weekly" }),
    "2026-04-27T00:00:00.000Z",
  );
  assert.equal(
    resolveClientTokenWindowStart(now, { windowType: "monthly" }),
    "2026-04-01T00:00:00.000Z",
  );
  assert.equal(
    resolveClientTokenWindowStart(now, { windowType: "fixed", windowSizeSeconds: 3600 }),
    "2026-04-29T13:00:00.000Z",
  );
});

test("getClientTokenLimitStatus does not block disabled config", () => {
  assert.deepEqual(getClientTokenLimitStatus({ ...baseConfig, enabled: false }, baseUsage), {
    used: 150,
    limit: null,
    remaining: null,
    blocked: false,
    windowStart: "2026-04-27T00:00:00.000Z",
  });
});

test("getClientTokenLimitStatus reports usage under limit", () => {
  assert.deepEqual(getClientTokenLimitStatus(baseConfig, baseUsage), {
    used: 150,
    limit: 1000,
    remaining: 850,
    blocked: false,
    windowStart: "2026-04-27T00:00:00.000Z",
  });
});

test("getClientTokenLimitStatus blocks exactly at limit", () => {
  assert.deepEqual(
    getClientTokenLimitStatus(baseConfig, {
      ...baseUsage,
      totalTokens: 1000,
    }),
    {
      used: 1000,
      limit: 1000,
      remaining: 0,
      blocked: true,
      windowStart: "2026-04-27T00:00:00.000Z",
    },
  );
});

test("getClientTokenLimitStatus blocks above limit", () => {
  assert.deepEqual(
    getClientTokenLimitStatus(baseConfig, {
      ...baseUsage,
      totalTokens: 1075,
    }),
    {
      used: 1075,
      limit: 1000,
      remaining: 0,
      blocked: true,
      windowStart: "2026-04-27T00:00:00.000Z",
    },
  );
});

test("buildClientTokenLimitError creates a 429 request error body", () => {
  const status = getClientTokenLimitStatus(baseConfig, {
    ...baseUsage,
    totalTokens: 1000,
  });

  assert.deepEqual(buildClientTokenLimitError("codex", status), {
    statusCode: 429,
    body: {
      error: {
        type: "request_error",
        code: "CLIENT_TOKEN_LIMIT_EXCEEDED",
        message: "Client route 'codex' has reached its token limit for the current window.",
        client: "codex",
        client_route: "codex",
        usage: status,
      },
    },
  });
});

test("extractUsageTotals reads direct and nested usage totals", () => {
  assert.deepEqual(
    extractUsageTotals({
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
    }),
    {
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    },
  );
  assert.deepEqual(
    extractUsageTotals({
      usage: {
        input_tokens: 5,
        output_tokens: 6,
        total_tokens: 11,
      },
    }),
    {
      inputTokens: 5,
      outputTokens: 6,
      totalTokens: 11,
    },
  );
  assert.deepEqual(
    extractUsageTotals({
      response: {
        usage: {
          input_tokens: 3,
          output_tokens: 4,
          total_tokens: 7,
        },
      },
    }),
    {
      inputTokens: 3,
      outputTokens: 4,
      totalTokens: 7,
    },
  );
});

test("extractUsageTotals ignores usage payloads without total_tokens", () => {
  assert.equal(
    extractUsageTotals({
      input_tokens: 10,
      output_tokens: 20,
    }),
    undefined,
  );
});
