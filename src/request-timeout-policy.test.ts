import assert from "node:assert/strict";
import test from "node:test";
import { isHermesSummaryRequest, resolveRequestTimeoutMs } from "./request-timeout-policy.js";

test("detects Hermes context checkpoint summarization requests", () => {
  assert.equal(
    isHermesSummaryRequest({
      input: [
        {
          role: "user",
          content:
            "You are a summarization agent creating a context checkpoint. Summarize the session.",
        },
      ],
    }),
    true,
  );
});

test("does not classify normal chat requests as Hermes summaries", () => {
  assert.equal(
    isHermesSummaryRequest({
      input: [{ role: "user", content: "Implement this Jira ticket." }],
    }),
    false,
  );
});

test("extends timeout only for detected Hermes summary requests when enabled", () => {
  assert.equal(
    resolveRequestTimeoutMs(
      {
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "You are a summarization agent creating a context checkpoint." }],
          },
        ],
      },
      {
        defaultTimeoutMs: 300_000,
        summaryTimeoutMs: 900_000,
        extendHermesSummaryTimeout: true,
      },
    ),
    900_000,
  );

  assert.equal(
    resolveRequestTimeoutMs(
      {
        input: [{ role: "user", content: "Normal request" }],
      },
      {
        defaultTimeoutMs: 300_000,
        summaryTimeoutMs: 900_000,
        extendHermesSummaryTimeout: true,
      },
    ),
    300_000,
  );
});
