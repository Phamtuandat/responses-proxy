import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProxyErrorEnvelope,
  resolveProxyError,
  isRetryableStatusCode,
  parseUpstreamErrorBody,
  truncateUpstreamErrorBody,
} from "./error-response.js";

test("parses structured upstream JSON error payloads", () => {
  assert.deepEqual(
    parseUpstreamErrorBody(
      JSON.stringify({
        error: {
          message: "Model quota exceeded",
          type: "rate_limit_error",
          code: "quota_exceeded",
          param: "model",
        },
      }),
    ),
    {
      message: "Model quota exceeded",
      type: "rate_limit_error",
      code: "quota_exceeded",
      param: "model",
    },
  );
});

test("builds backward-compatible proxy error envelopes with upstream details", () => {
  const envelope = buildProxyErrorEnvelope({
    statusCode: 429,
    requestId: "req_123",
    message: "[req_123] upstream rejected request (429 Too Many Requests)",
    upstreamBody: JSON.stringify({
      error: {
        message: "Rate limit reached",
        type: "rate_limit_error",
        code: "rate_limit",
      },
    }),
    defaultCode: "UPSTREAM_BAD_REQUEST",
    errorType: "proxy_error",
  });

  assert.equal(envelope.error.type, "proxy_error");
  assert.equal(envelope.error.code, "UPSTREAM_BAD_REQUEST");
  assert.equal(envelope.error.request_id, "req_123");
  assert.equal(envelope.error.upstream_status, 429);
  assert.equal(envelope.error.retryable, true);
  assert.match(String(envelope.error.message), /Rate limit reached/);
  assert.deepEqual(envelope.error.upstream_error, {
    message: "Rate limit reached",
    type: "rate_limit_error",
    code: "rate_limit",
    param: undefined,
  });
  assert.match(String(envelope.error.upstream_body), /rate_limit_error/);
});

test("truncates oversized upstream error bodies without dropping the tail", () => {
  const raw = `${"A".repeat(5000)}TAIL`;
  const truncated = truncateUpstreamErrorBody(raw);
  assert.ok(truncated);
  assert.match(String(truncated), /upstream error body truncated/);
  assert.match(String(truncated), /TAIL$/);
});

test("marks only retryable upstream statuses as retryable", () => {
  assert.equal(isRetryableStatusCode(400), false);
  assert.equal(isRetryableStatusCode(413), false);
  assert.equal(isRetryableStatusCode(429), true);
  assert.equal(isRetryableStatusCode(500), true);
});

test("provider error policy can remap verbose upstream failures to cleaner codes and messages", () => {
  const resolved = resolveProxyError({
    statusCode: 500,
    message: "[req_123] upstream rejected request (500 Internal Server Error)",
    upstreamBody: JSON.stringify({
      error: {
        message: "Request body is too large",
        type: "server_error",
        code: "internal_error",
      },
    }),
    defaultCode: "UPSTREAM_REQUEST_FAILED",
    errorType: "proxy_error",
    providerErrorPolicy: {
      rules: [
        {
          bodyIncludes: ["request body is too large"],
          code: "UPSTREAM_REQUEST_TOO_LARGE",
          message: "Upstream rejected the request because the serialized prompt body is too large",
          retryable: false,
        },
      ],
    },
  });

  assert.equal(resolved.errorCode, "UPSTREAM_REQUEST_TOO_LARGE");
  assert.equal(resolved.retryable, false);
  assert.equal(
    resolved.envelope.error.message,
    "Upstream rejected the request because the serialized prompt body is too large",
  );
});
