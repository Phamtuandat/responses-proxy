import assert from "node:assert/strict";
import test from "node:test";
import {
  readRequestProviderHint,
  resolveProviderForRequest,
} from "./provider-routing.js";
import type { RuntimeProviderPreset } from "./runtime-provider-repository.js";

function createProvider(
  id: string,
  name: string,
  clientApiKeys: string[],
): RuntimeProviderPreset {
  return {
    id,
    name,
    baseUrl: `https://${id}.example/v1`,
    responsesUrl: `https://${id}.example/v1/responses`,
    providerApiKeys: [],
    clientApiKeys,
    capabilities: {
      usageCheckEnabled: false,
      stripMaxOutputTokens: false,
      requestParameterPolicy: {},
      sanitizeReasoningSummary: false,
      stripModelPrefixes: [],
    },
  };
}

test("reads explicit provider hint from headers and metadata", () => {
  assert.deepEqual(
    readRequestProviderHint(
      {
        "x-provider-id": "cliproxy",
        "x-provider-name": "ClipProxy",
      },
      {
        provider_id: "ignored",
        provider: "ignored",
      },
    ),
    {
      providerId: "cliproxy",
      providerName: "ClipProxy",
    },
  );
});

test("resolves a shared API key by explicit provider name", () => {
  const providers = [
    createProvider("cliproxy", "cliproxy", ["shared-key"]),
    createProvider("krouter", "krouter", ["shared-key"]),
  ];

  const result = resolveProviderForRequest({
    providers,
    explicitProviderName: "krouter",
  });

  assert.equal("provider" in result, true);
  if ("provider" in result) {
    assert.equal(result.provider.id, "krouter");
    assert.equal(result.matchReason, "explicit_provider");
  }
});

test("returns a clear error when a shared API key is ambiguous", () => {
  const providers = [
    createProvider("cliproxy", "cliproxy", ["shared-key"]),
    createProvider("krouter", "krouter", ["shared-key"]),
  ];

  const result = resolveProviderForRequest({
    providers,
  });

  assert.ok("error" in result);
  assert.equal(result.error.statusCode, 409);
  assert.equal(result.error.type, "validation_error");
  assert.equal(result.error.code, "AMBIGUOUS_PROVIDER_SELECTION");
  // Message guides the user to bind the key to a client route.
  assert.match(result.error.message, /client route/i);
});
