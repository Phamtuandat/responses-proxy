import test from "node:test";
import assert from "node:assert/strict";
import { normalizeResponsesRequestWithCache } from "./normalize-request.js";

test("equivalent requests reuse the same static key despite tool order and volatile metadata", () => {
  const first = normalizeResponsesRequestWithCache(
    {
      model: "cx/gpt-5.4-xhigh",
      input: [
        { role: "assistant", content: "Existing context" },
        { role: "user", content: "Latest user turn" },
      ],
      instructions: "You are a helpful agent.\n\nUse tools when needed.\n",
      tools: [
        {
          type: "function",
          name: "b_tool",
          parameters: { type: "object", properties: { q: { type: "string" } } },
        },
        {
          type: "function",
          name: "a_tool",
          parameters: { properties: { id: { type: "string" } }, type: "object" },
        },
      ],
      metadata: {
        request_id: "req-1",
        trace_id: "trace-1",
        tenant: "alpha",
      },
    },
    {
      promptCacheRedesignEnabled: true,
    },
  );

  const second = normalizeResponsesRequestWithCache(
    {
      model: "cx/gpt-5.4-xhigh",
      input: [
        { role: "assistant", content: "Existing context" },
        { role: "user", content: "Latest user turn" },
      ],
      instructions: "You are a helpful agent.\nUse tools when needed.",
      tools: [
        {
          type: "function",
          name: "a_tool",
          parameters: { type: "object", properties: { id: { type: "string" } } },
        },
        {
          type: "function",
          name: "b_tool",
          parameters: { properties: { q: { type: "string" } }, type: "object" },
        },
      ],
      metadata: {
        tenant: "alpha",
        request_id: "req-2",
        trace_id: "trace-2",
      },
    },
    {
      promptCacheRedesignEnabled: true,
    },
  );

  assert.equal(first.cacheLayout.familyId, second.cacheLayout.familyId);
  assert.equal(first.cacheLayout.staticKey, second.cacheLayout.staticKey);
});

test("changing only the latest user turn changes request key but preserves static key", () => {
  const baseRequest = {
    model: "cx/gpt-5.4-xhigh",
    input: [
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: "What is the plan?" },
    ],
    instructions: "You are a helpful agent.",
  };

  const first = normalizeResponsesRequestWithCache(baseRequest, {
    promptCacheRedesignEnabled: true,
  });
  const second = normalizeResponsesRequestWithCache(
    {
      ...baseRequest,
      input: [
        { role: "assistant", content: "Earlier answer" },
        { role: "user", content: "What is the revised plan?" },
      ],
    },
    {
      promptCacheRedesignEnabled: true,
    },
  );

  assert.equal(first.cacheLayout.staticKey, second.cacheLayout.staticKey);
  assert.notEqual(first.cacheLayout.requestKey, second.cacheLayout.requestKey);
});

test("changing previous response id does not fragment the static key", () => {
  const baseRequest = {
    model: "cx/gpt-5.4-xhigh",
    input: [
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: "Continue" },
    ],
    instructions: "You are a helpful agent.",
  };

  const first = normalizeResponsesRequestWithCache(
    {
      ...baseRequest,
      previous_response_id: "resp-1",
    },
    {
      promptCacheRedesignEnabled: true,
    },
  );
  const second = normalizeResponsesRequestWithCache(
    {
      ...baseRequest,
      previous_response_id: "resp-2",
    },
    {
      promptCacheRedesignEnabled: true,
    },
  );

  assert.equal(first.cacheLayout.staticKey, second.cacheLayout.staticKey);
});

test("long chat history does not fragment static key when only transcript grows", () => {
  const first = normalizeResponsesRequestWithCache(
    {
      model: "cx/gpt-5.4-xhigh",
      instructions: "You are a helpful agent.",
      input: [
        { role: "user", content: "Turn 1" },
        { role: "assistant", content: "Reply 1" },
        { role: "user", content: "Turn 2" },
        { role: "assistant", content: "Reply 2" },
        { role: "user", content: "Latest turn A" },
      ],
    },
    {
      promptCacheRedesignEnabled: true,
      promptCacheSummaryKeepRecentItems: 2,
    },
  );

  const second = normalizeResponsesRequestWithCache(
    {
      model: "cx/gpt-5.4-xhigh",
      instructions: "You are a helpful agent.",
      input: [
        { role: "user", content: "Turn 1" },
        { role: "assistant", content: "Reply 1" },
        { role: "user", content: "Turn 2" },
        { role: "assistant", content: "Reply 2" },
        { role: "user", content: "Latest turn B" },
      ],
    },
    {
      promptCacheRedesignEnabled: true,
      promptCacheSummaryKeepRecentItems: 2,
    },
  );

  assert.equal(first.cacheLayout.staticKey, second.cacheLayout.staticKey);
  assert.notEqual(first.cacheLayout.requestKey, second.cacheLayout.requestKey);
});

test("family retention rules apply by family prefix", () => {
  const normalized = normalizeResponsesRequestWithCache(
    {
      model: "cx/gpt-5.4-xhigh",
      input: [{ role: "user", content: "Hello" }],
    },
    {
      promptCacheRedesignEnabled: true,
      defaultPromptCacheRetention: "24h",
      promptCacheRetentionByFamilyEnabled: true,
      promptCacheRetentionByFamilyRules: [
        {
          prefix: "family:cx-gpt-5-4-xhigh",
          retention: "72h",
        },
      ],
    },
  );

  assert.equal(normalized.request.prompt_cache_retention, "72h");
});

test("direct input with legacy tool role is normalized before forwarding", () => {
  const normalized = normalizeResponsesRequestWithCache({
    model: "cx/gpt-5.4-xhigh",
    input: [
      {
        role: "assistant",
        content: "Calling tool",
      },
      {
        role: "tool",
        tool_call_id: "call_123",
        content: "tool result payload",
      },
    ],
  });

  assert.deepEqual(normalized.request.input, [
    {
      role: "assistant",
      content: "Calling tool",
    },
    {
      type: "function_call_output",
      call_id: "call_123",
      output: "tool result payload",
    },
  ]);
});

test("legacy tool role without tool_call_id falls back to assistant content", () => {
  const normalized = normalizeResponsesRequestWithCache({
    model: "cx/gpt-5.4-xhigh",
    input: [
      {
        role: "tool",
        content: "orphaned tool output",
      },
    ],
  });

  assert.deepEqual(normalized.request.input, [
    {
      role: "assistant",
      content: "orphaned tool output",
    },
  ]);
});
