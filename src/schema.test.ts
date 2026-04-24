import assert from "node:assert/strict";
import test from "node:test";
import { proxyResponsesRequestSchema } from "./schema.js";

test("accepts nullable reasoning and text fields from responses clients", () => {
  const parsed = proxyResponsesRequestSchema.safeParse({
    model: "gpt-5.4",
    input: "ping",
    reasoning: null,
    text: null,
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.reasoning, null);
    assert.equal(parsed.data.text, null);
  }
});
