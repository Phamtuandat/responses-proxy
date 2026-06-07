import assert from "node:assert/strict";
import test from "node:test";
import {
  detectAnthropicBypass,
  buildBypassMessage,
  buildBypassSseFrames,
} from "./anthropic-bypass.js";

const CLI_UA = "claude-cli/2.1.92 (external, sdk-cli)";

test("does not bypass requests from non-claude-cli clients", () => {
  const body = {
    messages: [{ role: "user", content: "count" }],
  };
  assert.equal(detectAnthropicBypass(body, "some-other-agent"), null);
});

test("bypasses the single 'count' probe", () => {
  const body = { messages: [{ role: "user", content: "count" }] };
  const decision = detectAnthropicBypass(body, CLI_UA);
  assert.ok(decision);
  assert.equal(typeof decision?.text, "string");
});

test("bypasses a 'Warmup' first message", () => {
  const body = { messages: [{ role: "user", content: "Warmup" }] };
  assert.ok(detectAnthropicBypass(body, CLI_UA));
});

test("bypasses the title-extraction assistant seed '{'", () => {
  const body = {
    messages: [
      { role: "user", content: "hello there" },
      { role: "assistant", content: [{ type: "text", text: "{" }] },
    ],
  };
  assert.ok(detectAnthropicBypass(body, CLI_UA));
});

test("bypasses the configured skip pattern (conversation title)", () => {
  const body = {
    messages: [
      {
        role: "user",
        content:
          "Please write a 5-10 word title for the following conversation: hi there",
      },
    ],
  };
  assert.ok(detectAnthropicBypass(body, CLI_UA));
});

test("naming bypass generates a 3-word title from the first user message", () => {
  const body = {
    system: [{ type: "text", text: "Respond with isNewTopic JSON verdict." }],
    messages: [{ role: "user", content: "Refactor the billing module please" }],
  };
  const decision = detectAnthropicBypass(body, CLI_UA, { namingEnabled: true });
  assert.ok(decision);
  const parsed = JSON.parse(decision!.text) as { isNewTopic: boolean; title: string };
  assert.equal(parsed.isNewTopic, true);
  assert.equal(parsed.title, "Refactor the billing");
});

test("naming bypass is skipped when namingEnabled is false", () => {
  const body = {
    system: "isNewTopic verdict please",
    messages: [{ role: "user", content: "do the thing" }],
  };
  assert.equal(detectAnthropicBypass(body, CLI_UA, { namingEnabled: false }), null);
});

test("forwards a normal interactive prompt (no bypass)", () => {
  const body = {
    messages: [{ role: "user", content: "Explain how promises work in JS" }],
  };
  assert.equal(detectAnthropicBypass(body, CLI_UA), null);
});

test("buildBypassMessage returns a well-formed Anthropic message", () => {
  const payload = buildBypassMessage("claude-opus-4.8", "hello") as {
    type: string;
    role: string;
    content: Array<{ type: string; text: string }>;
    stop_reason: string;
  };
  assert.equal(payload.type, "message");
  assert.equal(payload.role, "assistant");
  assert.equal(payload.content[0]?.text, "hello");
  assert.equal(payload.stop_reason, "end_turn");
});

test("buildBypassSseFrames emits a complete Anthropic SSE sequence", () => {
  const frames = buildBypassSseFrames("claude-opus-4.8", "hello").join("");
  assert.match(frames, /event: message_start/);
  assert.match(frames, /event: content_block_delta/);
  assert.match(frames, /event: message_stop/);
});
