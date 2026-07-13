import assert from "node:assert/strict";
import test from "node:test";
import {
  ChatCompletionsDecoder,
  ResponsesDecoder,
  buildChatCompletionsRequestFromTurns,
  buildResponsesRequestFromTurns,
  parseSseData,
} from "./openai-translate.js";
import { parseAnthropicRequest } from "./anthropic-messages.js";

function chunkFrame(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

test("buildChatCompletionsRequestFromTurns maps system, text, tool calls and results", () => {
  const parsed = parseAnthropicRequest({
    model: "gpt-4o",
    system: "You are helpful.",
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
        content: [{ type: "tool_result", tool_use_id: "tu_1", content: "Sunny" }],
      },
    ],
    tools: [{ name: "get_weather", description: "w", input_schema: { type: "object" } }],
  });

  const body = buildChatCompletionsRequestFromTurns(parsed, { model: "gpt-4o", stream: true });
  const messages = body.messages as Array<Record<string, unknown>>;

  assert.equal(messages[0].role, "system");
  assert.equal(messages[0].content, "You are helpful.");
  assert.equal(messages[1].role, "user");
  assert.equal(messages[1].content, "weather in NYC?");

  const assistant = messages[2];
  assert.equal(assistant.role, "assistant");
  assert.equal(assistant.content, "Let me check.");
  const toolCalls = assistant.tool_calls as Array<Record<string, unknown>>;
  assert.equal(toolCalls[0].id, "tu_1");
  assert.equal((toolCalls[0].function as Record<string, unknown>).name, "get_weather");
  assert.equal((toolCalls[0].function as Record<string, unknown>).arguments, '{"city":"NYC"}');

  const toolMsg = messages[3];
  assert.equal(toolMsg.role, "tool");
  assert.equal(toolMsg.tool_call_id, "tu_1");
  assert.equal(toolMsg.content, "Sunny");

  const tools = body.tools as Array<Record<string, unknown>>;
  assert.equal(tools[0].type, "function");
  assert.equal((tools[0].function as Record<string, unknown>).name, "get_weather");
  assert.equal(body.stream, true);
});

test("buildChatCompletionsRequestFromTurns emits image_url content parts", () => {
  const parsed = parseAnthropicRequest({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image", source: { type: "url", url: "https://x/y.png" } },
        ],
      },
    ],
  });
  const body = buildChatCompletionsRequestFromTurns(parsed, { model: "gpt-4o", stream: false });
  const messages = body.messages as Array<Record<string, unknown>>;
  const parts = messages[0].content as Array<Record<string, unknown>>;
  assert.equal(parts[0].type, "text");
  assert.equal(parts[1].type, "image_url");
  assert.deepEqual(parts[1].image_url, { url: "https://x/y.png" });
});

test("buildResponsesRequestFromTurns maps system to instructions and tool items", () => {
  const parsed = parseAnthropicRequest({
    model: "gpt-4o",
    system: "Be terse.",
    messages: [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "tu_9", name: "f", input: { a: 1 } }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tu_9", content: "ok" }],
      },
    ],
    tools: [{ name: "f", input_schema: { type: "object" } }],
  });

  const body = buildResponsesRequestFromTurns(parsed, { model: "gpt-4o", stream: true });
  assert.equal(body.instructions, "Be terse.");
  const input = body.input as Array<Record<string, unknown>>;
  assert.equal(input[0].type, "message");
  assert.equal(input[0].role, "user");
  assert.equal(input[1].type, "function_call");
  assert.equal(input[1].call_id, "tu_9");
  assert.equal(input[1].arguments, '{"a":1}');
  assert.equal(input[2].type, "function_call_output");
  assert.equal(input[2].call_id, "tu_9");
  assert.equal(input[2].output, "ok");

  const tools = body.tools as Array<Record<string, unknown>>;
  assert.equal(tools[0].type, "function");
  assert.equal(tools[0].name, "f");
});

test("parseSseData reads data lines and the DONE sentinel", () => {
  assert.equal(parseSseData("data: [DONE]\n\n"), "[DONE]");
  assert.deepEqual(parseSseData('event: x\ndata: {"a":1}\n\n'), { a: 1 });
  assert.equal(parseSseData("event: ping\n\n"), undefined);
});

test("ChatCompletionsDecoder streams text then a tool call across fragments", () => {
  const decoder = new ChatCompletionsDecoder();
  const deltas = [
    ...decoder.pushFrame(chunkFrame({ choices: [{ delta: { content: "Hel" } }] })),
    ...decoder.pushFrame(chunkFrame({ choices: [{ delta: { content: "lo" } }] })),
    ...decoder.pushFrame(
      chunkFrame({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_a", function: { name: "get_weather", arguments: '{"ci' } },
              ],
            },
          },
        ],
      }),
    ),
    ...decoder.pushFrame(
      chunkFrame({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ty":"NYC"}' } }] } }],
      }),
    ),
    ...decoder.pushFrame("data: [DONE]\n\n"),
  ];

  assert.deepEqual(deltas[0], { textDelta: "Hel" });
  assert.deepEqual(deltas[1], { textDelta: "lo" });
  assert.equal(deltas[2].toolUse?.toolUseId, "call_a");
  assert.equal(deltas[2].toolUse?.name, "get_weather");
  assert.equal(deltas[2].toolUse?.inputDelta, '{"ci');
  // Fragment with no id reuses the index→id mapping.
  assert.equal(deltas[3].toolUse?.toolUseId, "call_a");
  assert.equal(deltas[3].toolUse?.inputDelta, 'ty":"NYC"}');
});

test("ChatCompletionsDecoder.parseMessage collects text and tool calls", () => {
  const out = ChatCompletionsDecoder.parseMessage({
    choices: [
      {
        message: {
          content: "done",
          tool_calls: [
            { id: "c1", function: { name: "f", arguments: '{"x":1}' } },
          ],
        },
      },
    ],
  });
  assert.equal(out.text, "done");
  assert.equal(out.toolUses.length, 1);
  assert.equal(out.toolUses[0].toolUseId, "c1");
  assert.deepEqual(out.toolUses[0].input, { x: 1 });
});

test("ResponsesDecoder streams text and function-call argument deltas", () => {
  const decoder = new ResponsesDecoder();
  const deltas = [
    ...decoder.pushFrame(
      chunkFrame({ type: "response.output_text.delta", delta: "Hi" }),
    ),
    ...decoder.pushFrame(
      chunkFrame({
        type: "response.output_item.added",
        item: { type: "function_call", id: "fc_1", call_id: "call_z", name: "f" },
      }),
    ),
    ...decoder.pushFrame(
      chunkFrame({
        type: "response.function_call_arguments.delta",
        item_id: "fc_1",
        delta: '{"a":1}',
      }),
    ),
  ];
  assert.deepEqual(deltas[0], { textDelta: "Hi" });
  assert.equal(deltas[1].toolUse?.toolUseId, "call_z");
  assert.equal(deltas[1].toolUse?.name, "f");
  assert.equal(deltas[2].toolUse?.toolUseId, "call_z");
  assert.equal(deltas[2].toolUse?.inputDelta, '{"a":1}');
});

test("ResponsesDecoder.parseMessage collects output_text and function_call items", () => {
  const out = ResponsesDecoder.parseMessage({
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: "hello" }],
      },
      { type: "function_call", call_id: "cc", name: "f", arguments: '{"y":2}' },
    ],
  });
  assert.equal(out.text, "hello");
  assert.equal(out.toolUses[0].toolUseId, "cc");
  assert.deepEqual(out.toolUses[0].input, { y: 2 });
});
