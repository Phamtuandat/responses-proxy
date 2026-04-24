import assert from "node:assert/strict";
import test from "node:test";
import {
  applyProviderRequestParameterPolicy,
  resolveMaxOutputTokensRule,
} from "./provider-request-parameters.js";

test("request parameter policy can rename max_output_tokens for provider wire compatibility", () => {
  const rewritten = applyProviderRequestParameterPolicy(
    {
      model: "gpt-5.4",
      max_output_tokens: 512,
    },
    {
      requestParameterPolicy: {
        maxOutputTokens: {
          mode: "rename",
          target: "max_completion_tokens",
        },
      },
    },
  );

  assert.equal("max_output_tokens" in rewritten, false);
  assert.equal(rewritten.max_completion_tokens, 512);
});

test("legacy stripMaxOutputTokens flag resolves to strip mode for backward compatibility", () => {
  const rule = resolveMaxOutputTokensRule({
    stripMaxOutputTokens: true,
  });

  assert.deepEqual(rule, {
    mode: "strip",
  });
});
