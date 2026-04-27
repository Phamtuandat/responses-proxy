import test from "node:test";
import assert from "node:assert/strict";
import { parseTestArgs } from "./test.js";

test("parseTestArgs returns raw prompt when no provider flag is present", () => {
  assert.deepEqual(parseTestArgs("Say hello"), {
    prompt: "Say hello",
  });
});

test("parseTestArgs extracts provider id and prompt", () => {
  assert.deepEqual(parseTestArgs("--provider-id account-openai-codex Say hello"), {
    providerId: "account-openai-codex",
    prompt: "Say hello",
  });
});
