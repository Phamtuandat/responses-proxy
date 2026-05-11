import assert from "node:assert/strict";
import test from "node:test";
import { buildCodexConfigFiles, sendCustomerCodexSetup } from "./codex-config-delivery.js";

test("buildCodexConfigFiles creates plug-and-play Codex config files", () => {
  const files = buildCodexConfigFiles({
    baseUrl: "https://proxy.example.com/v1",
    apiKey: "sk-customer-secret",
    model: "gpt-5.5",
  });

  assert.match(files.configToml, /model = "gpt-5\.5"/);
  assert.match(files.configToml, /model_provider = "resproxy"/);
  assert.match(files.configToml, /base_url = "https:\/\/proxy\.example\.com\/v1"/);
  assert.match(files.configToml, /api_key = "sk-customer-secret"/);
  assert.match(files.configToml, /wire_api = "responses"/);
  assert.deepEqual(JSON.parse(files.authJson), {
    auth_mode: "apikey",
    OPENAI_API_KEY: "sk-customer-secret",
  });
});

test("sendCustomerCodexSetup includes Mac and Windows paste locations", async () => {
  const sentMessages: string[] = [];
  const sentDocuments: Array<{ filename?: string; content: string }> = [];
  const ctx = {
    api: {
      async sendMessage(_chatId: number, text: string) {
        sentMessages.push(text);
        return {} as any;
      },
      async sendDocument(_chatId: number, document: { filename?: string; fileData?: Uint8Array }) {
        sentDocuments.push({
          filename: document.filename,
          content: document.fileData ? Buffer.from(document.fileData).toString("utf8") : "",
        });
        return {} as any;
      },
    },
  } as any;

  const ok = await sendCustomerCodexSetup(ctx, {
    telegramUserId: "42",
    baseUrl: "https://proxy.example.com/v1",
    apiKey: "sk-customer-secret",
    title: "Your access is active",
    details: ["• Plan ID: basic"],
  });

  assert.equal(ok, true);
  assert.equal(sentMessages[0]?.includes("Mac: ~/.codex/"), true);
  assert.equal(sentMessages[0]?.includes("Windows: %USERPROFILE%\\.codex\\"), true);
  assert.deepEqual(sentDocuments.map((document) => document.filename), ["config.toml", "auth.json"]);
  assert.match(sentDocuments[0]?.content ?? "", /base_url = "https:\/\/proxy\.example\.com\/v1"/);
});
