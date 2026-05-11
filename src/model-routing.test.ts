import assert from "node:assert/strict";
import test from "node:test";
import { resolveModelRouting, type ModelRoutingPolicy } from "./model-routing.js";

const policy: ModelRoutingPolicy = {
  enabled: true,
  inputTokenThreshold: 2000,
  cheapModel: "gpt-4o-mini",
  skipIfTools: true,
  skipIfImages: true,
  skipIfReasoning: true,
};

test("resolveModelRouting downgrades small expensive text requests", () => {
  const decision = resolveModelRouting(
    {
      model: "gpt-4.1",
      instructions: "Be concise.",
      input: [{ role: "user", content: "Hello" }],
    },
    policy,
  );

  assert.equal(decision.downgraded, true);
  if (decision.downgraded) {
    assert.equal(decision.originalModel, "gpt-4.1");
    assert.equal(decision.resolvedModel, "gpt-4o-mini");
    assert.match(decision.reason, /^estimated_tokens:/);
  }
});

test("resolveModelRouting skips tools images reasoning and large requests", () => {
  assert.deepEqual(
    resolveModelRouting({ model: "gpt-4.1", tools: [{ type: "function" }], input: [] }, policy),
    { downgraded: false },
  );
  assert.deepEqual(
    resolveModelRouting(
      {
        model: "gpt-4.1",
        input: [
          {
            role: "user",
            content: [{ type: "input_image", image_url: "https://example.test/image.png" }],
          },
        ],
      },
      policy,
    ),
    { downgraded: false },
  );
  assert.deepEqual(
    resolveModelRouting({ model: "gpt-4.1", reasoning: { effort: "high" }, input: [] }, policy),
    { downgraded: false },
  );
  assert.deepEqual(
    resolveModelRouting(
      {
        model: "gpt-4.1",
        input: [{ role: "user", content: "x".repeat(20_000) }],
      },
      policy,
    ),
    { downgraded: false },
  );
});
