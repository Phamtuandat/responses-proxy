import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCodexConfigFiles,
  buildCodexConfigSetupScript,
  buildCodexSetupCurlCommand,
  buildCodexSetupEndpointUrl,
} from "./codex-setup.js";

test("buildCodexSetupEndpointUrl strips the public /v1 suffix", () => {
  assert.equal(
    buildCodexSetupEndpointUrl("https://proxy.example.com/v1/"),
    "https://proxy.example.com/api/customer/codex/setup.sh",
  );
});

test("buildCodexSetupCurlCommand targets the customer setup endpoint", () => {
  const command = buildCodexSetupCurlCommand({
    publicResponsesBaseUrl: "https://proxy.example.com/v1",
    apiKey: "sk-customer-secret",
  });

  assert.match(command, /curl -fsSL/);
  assert.match(command, /Authorization: Bearer sk-customer-secret/);
  assert.match(command, /https:\/\/proxy\.example\.com\/api\/customer\/codex\/setup\.sh/);
  assert.match(command, /\| sh$/);
});

test("buildCodexConfigSetupScript writes both Codex config files with backups", () => {
  const files = buildCodexConfigFiles({
    baseUrl: "https://proxy.example.com/v1",
    apiKey: "sk-customer-secret",
    model: "gpt-5.5",
  });
  const script = buildCodexConfigSetupScript(files);

  assert.match(script, /mktemp -d/);
  assert.match(script, /backup="\$dest\.\$\(date \+%Y%m%d-%H%M%S\)\.bak"/);
  assert.match(script, /install_file "\$tmpdir\/config\.toml" "\$HOME\/\.codex\/config\.toml"/);
  assert.match(script, /install_file "\$tmpdir\/auth\.json" "\$HOME\/\.codex\/auth\.json"/);
  assert.match(script, /base_url = "https:\/\/proxy\.example\.com\/v1"/);
  assert.match(script, /OPENAI_API_KEY": "sk-customer-secret"/);
});
