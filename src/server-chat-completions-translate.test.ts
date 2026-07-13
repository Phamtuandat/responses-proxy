import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "responses-proxy-chat-translate-"));
const dbFile = path.join(tempDir, "app.sqlite");

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    request.on("data", (chunk) => (data += chunk));
    request.on("end", () => resolve(data));
  });
}

let lastUpstreamPath: string | undefined;
let lastUpstreamBody: Record<string, unknown> | undefined;

// A mock OpenAI-compatible upstream that only speaks Chat Completions.
const upstream = createServer(async (request, response) => {
  lastUpstreamPath = request.url;
  lastUpstreamBody = JSON.parse((await readBody(request)) || "{}");
  if (request.url !== "/v1/chat/completions") {
    response.statusCode = 404;
    response.end();
    return;
  }
  const isStream = lastUpstreamBody?.stream === true;
  if (isStream) {
    response.setHeader("Content-Type", "text/event-stream");
    response.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({ choices: [{ delta: { content: " world" } }] })}\n\n`,
    );
    response.write("data: [DONE]\n\n");
    response.end();
    return;
  }
  response.setHeader("Content-Type", "application/json");
  response.end(
    JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content: "Hello world" } }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    }),
  );
});

process.env.RESPONSES_PROXY_DISABLE_LISTEN = "true";
process.env.APP_DB_PATH = dbFile;
process.env.CUSTOMER_KEY_DB_PATH = dbFile;
// A reserved .invalid host means no builtin upstream provider is seeded, so the
// custom chat_completions provider below is the only one → single_match routing.
process.env.UPSTREAM_BASE_URL = "http://upstream.invalid";
process.env.PROVIDER_USAGE_CHECK_ENABLED = "false";
process.env.CHATGPT_OAUTH_ENABLED = "false";
process.env.KIRO_ENABLED = "false";
process.env.LOG_LEVEL = "silent";
process.env.RESPONSE_CACHE_ENABLED = "false";

await new Promise<void>((resolve) => {
  upstream.listen(0, "127.0.0.1", () => resolve());
});
const address = upstream.address();
if (!address || typeof address === "string") {
  throw new Error("Upstream did not bind");
}

const { app } = await import("./server.js");

// Create a chat_completions provider; its provider API key doubles as the routing
// key (single_match), and its baseUrl points at the mock Chat upstream.
const created = await app.inject({
  method: "POST",
  url: "/api/providers",
  payload: {
    name: "chat-upstream",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    authMode: "api_key",
    apiKey: "up-key",
    enabled: true,
    capabilities: { transportMode: "chat_completions" },
  },
});
assert.equal(created.statusCode, 201);
const providerId = (created.json() as { provider: { id: string } }).provider.id;
await app.inject({
  method: "POST",
  url: "/api/providers/select",
  payload: { providerId },
});

test.after(async () => {
  await app.close();
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  rmSync(tempDir, { recursive: true, force: true });
});

test("/v1/responses non-stream is translated from a chat_completions upstream", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/responses",
    headers: { authorization: "Bearer up-key" },
    payload: { model: "gpt-4o", input: "hi" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(lastUpstreamPath, "/v1/chat/completions");
  // Upstream received Chat-format (messages, not input).
  assert.ok(Array.isArray(lastUpstreamBody?.messages));
  // Client receives Responses-format output.
  const body = res.json() as Record<string, unknown>;
  assert.equal(body.object, "response");
  const output = body.output as Array<Record<string, unknown>>;
  assert.equal(output[0].type, "message");
  const content = output[0].content as Array<Record<string, unknown>>;
  assert.equal(content[0].type, "output_text");
  assert.equal(content[0].text, "Hello world");
});

test("/v1/responses stream is translated to Responses SSE events", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/responses",
    headers: { authorization: "Bearer up-key" },
    payload: { model: "gpt-4o", input: "hi", stream: true },
  });
  assert.equal(res.statusCode, 200);
  const text = res.body;
  assert.ok(text.includes("event: response.created"), "has response.created");
  assert.ok(text.includes("response.output_text.delta"), "has text deltas");
  assert.ok(text.includes("event: response.completed"), "has response.completed");
  assert.ok(text.includes("data: [DONE]"), "ends with DONE");
  // Should NOT leak the upstream chat.completion.chunk shape.
  assert.ok(!text.includes("chat.completion"), "no chat shape leaked");
});

test("/v1/messages (Claude Code) is served by a chat_completions provider", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/messages",
    headers: { authorization: "Bearer up-key" },
    payload: {
      model: "claude-sonnet-4",
      max_tokens: 100,
      system: "Be brief.",
      messages: [{ role: "user", content: "hi" }],
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(lastUpstreamPath, "/v1/chat/completions");
  // System prompt preserved as a system message (not folded into user turn).
  const messages = lastUpstreamBody?.messages as Array<Record<string, unknown>>;
  assert.equal(messages[0].role, "system");
  assert.equal(messages[0].content, "Be brief.");
  // Client receives an Anthropic message.
  const body = res.json() as Record<string, unknown>;
  assert.equal(body.type, "message");
  assert.equal(body.role, "assistant");
  const content = body.content as Array<Record<string, unknown>>;
  assert.equal(content[0].type, "text");
  assert.equal(content[0].text, "Hello world");
});
