import assert from "node:assert/strict";
import test from "node:test";
import {
  AnthropicSseEmitter,
  buildAnthropicMessage,
  buildAnthropicModelsList,
  buildCountTokensResponse,
  parseAnthropicRequest,
} from "./anthropic-messages.js";
import type { ToolUseDelta } from "./kiro-codewhisperer.js";

test("parseAnthropicRequest folds system into the first user turn", () => {
  const parsed = parseAnthropicRequest({
    model: "claude-sonnet-4",
    system: "You are helpful.",
    messages: [{ role: "user", content: "Hi" }],
  });
  assert.equal(parsed.turns.length, 1);
  assert.equal(parsed.turns[0].role, "user");
  assert.equal(parsed.turns[0].content, "You are helpful.\n\nHi");
  assert.equal(parsed.model, "claude-sonnet-4");
});

test("parseAnthropicRequest handles system as text-block array", () => {
  const parsed = parseAnthropicRequest({
    model: "claude-sonnet-4",
    system: [
      { type: "text", text: "Part one." },
      { type: "text", text: "Part two." },
    ],
    messages: [{ role: "user", content: "Q" }],
  });
  assert.equal(parsed.turns[0].content, "Part one.\n\nPart two.\n\nQ");
});

test("parseAnthropicRequest parses tools (input_schema → inputSchema)", () => {
  const parsed = parseAnthropicRequest({
    model: "claude-sonnet-4",
    messages: [{ role: "user", content: "weather?" }],
    tools: [
      {
        name: "get_weather",
        description: "Get weather",
        input_schema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      },
    ],
  });
  assert.equal(parsed.tools.length, 1);
  assert.equal(parsed.tools[0].name, "get_weather");
  assert.equal(parsed.tools[0].description, "Get weather");
  assert.deepEqual(parsed.tools[0].inputSchema.required, ["city"]);
});

test("parseAnthropicRequest extracts tool_use from assistant and tool_result from user", () => {
  const parsed = parseAnthropicRequest({
    model: "claude-sonnet-4",
    messages: [
      { role: "user", content: "weather in NYC?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check." },
          { type: "tool_use", id: "tu_1", name: "get_weather", input: { city: "NYC" } },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tu_1", content: "Sunny, 25C" }],
      },
    ],
  });
  assert.equal(parsed.turns.length, 3);

  const assistantTurn = parsed.turns[1];
  assert.equal(assistantTurn.role, "assistant");
  if (assistantTurn.role === "assistant") {
    assert.equal(assistantTurn.toolUses?.length, 1);
    assert.equal(assistantTurn.toolUses?.[0].toolUseId, "tu_1");
    assert.deepEqual(assistantTurn.toolUses?.[0].input, { city: "NYC" });
  }

  const toolResultTurn = parsed.turns[2];
  assert.equal(toolResultTurn.role, "user");
  if (toolResultTurn.role === "user") {
    assert.equal(toolResultTurn.toolResults?.length, 1);
    assert.equal(toolResultTurn.toolResults?.[0].toolUseId, "tu_1");
    assert.equal(toolResultTurn.toolResults?.[0].content, "Sunny, 25C");
    assert.equal(toolResultTurn.toolResults?.[0].status, "success");
  }
});

test("parseAnthropicRequest marks is_error tool_result as error status", () => {
  const parsed = parseAnthropicRequest({
    model: "claude-sonnet-4",
    messages: [
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tu_x", content: "boom", is_error: true }],
      },
    ],
  });
  const turn = parsed.turns[0];
  if (turn.role === "user") {
    assert.equal(turn.toolResults?.[0].status, "error");
  }
});

test("buildAnthropicMessage returns text + tool_use content with tool_use stop_reason", () => {
  const message = buildAnthropicMessage({
    text: "Calling tool",
    toolUses: [{ toolUseId: "tu_1", name: "get_weather", input: { city: "NYC" } }],
    model: "claude-sonnet-4",
    inputTokens: 10,
    outputTokens: 5,
  });
  assert.equal(message.type, "message");
  assert.equal(message.role, "assistant");
  assert.equal(message.stop_reason, "tool_use");
  const content = message.content as Array<Record<string, unknown>>;
  assert.equal(content[0].type, "text");
  assert.equal(content[1].type, "tool_use");
  assert.equal(content[1].id, "tu_1");
  assert.deepEqual(content[1].input, { city: "NYC" });
});

test("buildAnthropicMessage uses end_turn and a non-empty content block for text-only", () => {
  const message = buildAnthropicMessage({
    text: "hello",
    toolUses: [],
    model: "claude-sonnet-4",
    inputTokens: 1,
    outputTokens: 1,
  });
  assert.equal(message.stop_reason, "end_turn");
  const content = message.content as Array<Record<string, unknown>>;
  assert.equal(content.length, 1);
  assert.equal(content[0].text, "hello");
});

test("buildCountTokensResponse returns an estimated input_tokens", () => {
  const result = buildCountTokensResponse("a".repeat(40));
  assert.equal(typeof result.input_tokens, "number");
  assert.equal(result.input_tokens, 10);
});

function parseEvents(frames: string[]): Array<{ event: string; data: Record<string, unknown> }> {
  const out: Array<{ event: string; data: Record<string, unknown> }> = [];
  for (const frame of frames) {
    const eventMatch = /event: (.+)/.exec(frame);
    const dataMatch = /data: (.+)/.exec(frame);
    if (eventMatch && dataMatch) {
      out.push({ event: eventMatch[1].trim(), data: JSON.parse(dataMatch[1]) });
    }
  }
  return out;
}

test("AnthropicSseEmitter emits a valid text-only sequence", () => {
  const emitter = new AnthropicSseEmitter({ model: "claude-sonnet-4", inputTokens: 5 });
  const frames = [
    ...emitter.start(),
    ...emitter.textDelta("Hello"),
    ...emitter.textDelta(" world"),
    ...emitter.finish(2),
  ];
  const events = parseEvents(frames);
  const types = events.map((e) => e.event);

  assert.equal(types[0], "message_start");
  assert.ok(types.includes("ping"));
  assert.ok(types.includes("content_block_start"));
  assert.equal(types.filter((t) => t === "content_block_delta").length, 2);
  assert.ok(types.includes("content_block_stop"));
  assert.ok(types.includes("message_delta"));
  assert.equal(types[types.length - 1], "message_stop");

  const messageDelta = events.find((e) => e.event === "message_delta");
  assert.equal((messageDelta?.data.delta as Record<string, unknown>).stop_reason, "end_turn");
});

test("AnthropicSseEmitter opens a tool_use block and emits input_json_delta", () => {
  const emitter = new AnthropicSseEmitter({ model: "claude-sonnet-4", inputTokens: 5 });
  const toolStart: ToolUseDelta = { toolUseId: "tu_1", name: "get_weather", inputDelta: '{"ci' };
  const toolMore: ToolUseDelta = { toolUseId: "tu_1", inputDelta: 'ty":"NYC"}' };
  const frames = [
    ...emitter.start(),
    ...emitter.toolUseDelta(toolStart),
    ...emitter.toolUseDelta(toolMore),
    ...emitter.finish(3),
  ];
  const events = parseEvents(frames);

  const blockStart = events.find((e) => e.event === "content_block_start");
  assert.equal((blockStart?.data.content_block as Record<string, unknown>).type, "tool_use");
  assert.equal((blockStart?.data.content_block as Record<string, unknown>).id, "tu_1");

  const deltas = events.filter((e) => e.event === "content_block_delta");
  assert.equal(deltas.length, 2);
  assert.equal((deltas[0].data.delta as Record<string, unknown>).type, "input_json_delta");
  assert.equal((deltas[0].data.delta as Record<string, unknown>).partial_json, '{"ci');

  const messageDelta = events.find((e) => e.event === "message_delta");
  assert.equal((messageDelta?.data.delta as Record<string, unknown>).stop_reason, "tool_use");
});

test("AnthropicSseEmitter transitions from text block to tool block (closes first)", () => {
  const emitter = new AnthropicSseEmitter({ model: "claude-sonnet-4", inputTokens: 1 });
  const frames = [
    ...emitter.start(),
    ...emitter.textDelta("thinking"),
    ...emitter.toolUseDelta({ toolUseId: "tu_1", name: "f", inputDelta: "{}" }),
    ...emitter.finish(1),
  ];
  const events = parseEvents(frames);
  const types = events.map((e) => e.event);
  // Two block_start (text, tool) and two block_stop (one before tool, one at finish).
  assert.equal(types.filter((t) => t === "content_block_start").length, 2);
  assert.equal(types.filter((t) => t === "content_block_stop").length, 2);
});

test("buildAnthropicModelsList returns a deduped Anthropic-format listing", () => {
  const list = buildAnthropicModelsList([
    "claude-sonnet-4",
    "claude-sonnet-4",
    " ",
    "claude-haiku-4-5",
  ]);
  const data = list.data as Array<Record<string, unknown>>;
  assert.equal(data.length, 2);
  assert.equal(data[0].type, "model");
  assert.equal(data[0].id, "claude-sonnet-4");
  assert.equal(typeof data[0].display_name, "string");
  assert.equal(list.has_more, false);
  assert.equal(list.first_id, "claude-sonnet-4");
  assert.equal(list.last_id, "claude-haiku-4-5");
});
