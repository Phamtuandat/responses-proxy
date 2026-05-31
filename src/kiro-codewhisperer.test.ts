import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_KIRO_MODEL_ID,
  buildCodeWhispererRequest,
  buildResponsesJson,
  buildResponsesSseFrames,
  collectAssistantText,
  collectInputText,
  extractAssistantDelta,
  flattenResponsesConversation,
  mapModelToCodeWhisperer,
} from "./kiro-codewhisperer.js";
import { encodeEventStreamMessage, parseEventStream } from "./kiro-eventstream.js";

function assistantFrame(content: string): Buffer {
  return encodeEventStreamMessage(
    { ":event-type": "assistantResponseEvent", ":content-type": "application/json" },
    Buffer.from(JSON.stringify({ content }), "utf8"),
  );
}

test("mapModelToCodeWhisperer resolves known aliases case-insensitively", () => {
  assert.equal(mapModelToCodeWhisperer("kiro-claude-sonnet-4"), "claude-sonnet-4");
  assert.equal(mapModelToCodeWhisperer("Claude-Sonnet-4-6"), "claude-sonnet-4-6");
});

test("mapModelToCodeWhisperer falls back to the default for unknown aliases", () => {
  assert.equal(mapModelToCodeWhisperer("gpt-5.5"), DEFAULT_KIRO_MODEL_ID);
  assert.equal(mapModelToCodeWhisperer(undefined), DEFAULT_KIRO_MODEL_ID);
});

test("mapModelToCodeWhisperer passes through recognized lowercase Kiro ids", () => {
  assert.equal(mapModelToCodeWhisperer("auto"), "auto");
  assert.equal(mapModelToCodeWhisperer("claude-sonnet-4.5"), "claude-sonnet-4.5");
});

test("flattenResponsesConversation folds instructions into the first user turn", () => {
  const turns = flattenResponsesConversation({
    instructions: "You are helpful.",
    input: [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
      { role: "user", content: "How are you?" },
    ],
  });
  assert.equal(turns.length, 3);
  assert.equal(turns[0].role, "user");
  assert.match(turns[0].content, /You are helpful\./);
  assert.match(turns[0].content, /Hello/);
  assert.equal(turns[2].content, "How are you?");
});

test("flattenResponsesConversation accepts a plain string input", () => {
  const turns = flattenResponsesConversation({ input: "just a string" });
  assert.deepEqual(turns, [{ role: "user", content: "just a string" }]);
});

test("flattenResponsesConversation extracts text from content-part arrays", () => {
  const turns = flattenResponsesConversation({
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: "part one " },
          { type: "input_text", text: "part two" },
        ],
      },
    ],
  });
  assert.equal(turns[0].content, "part one part two");
});

test("buildCodeWhispererRequest puts the last user turn as the current message", () => {
  const request = buildCodeWhispererRequest({
    body: {
      input: [
        { role: "user", content: "first question" },
        { role: "assistant", content: "first answer" },
        { role: "user", content: "second question" },
      ],
    },
    modelId: "claude-sonnet-4",
    profileArn: "arn:aws:codewhisperer:profile/x",
    conversationId: "conv-1",
  });

  assert.match(
    request.conversationState.currentMessage.userInputMessage.content,
    /second question$/,
  );
  assert.equal(request.conversationState.currentMessage.userInputMessage.modelId, "claude-sonnet-4");
  assert.equal(request.conversationState.conversationId, "conv-1");
  assert.equal(request.profileArn, "arn:aws:codewhisperer:profile/x");
  assert.equal(request.inferenceConfig.maxTokens, 32000);
  assert.equal(request.conversationState.history.length, 2);
  assert.ok("userInputMessage" in request.conversationState.history[0]);
  assert.ok("assistantResponseMessage" in request.conversationState.history[1]);
});

test("buildCodeWhispererRequest omits profileArn when absent", () => {
  const request = buildCodeWhispererRequest({
    body: { input: "hi" },
    modelId: DEFAULT_KIRO_MODEL_ID,
  });
  assert.equal("profileArn" in request, false);
  assert.match(request.conversationState.currentMessage.userInputMessage.content, /hi$/);
});

test("extractAssistantDelta reads content from a parsed frame", () => {
  const [message] = parseEventStream(assistantFrame("chunk-text"));
  assert.equal(extractAssistantDelta(message), "chunk-text");
});

test("collectAssistantText concatenates all assistant deltas", () => {
  const buffer = Buffer.concat([
    assistantFrame("Hello, "),
    assistantFrame("world"),
    assistantFrame("!"),
  ]);
  const { text, error } = collectAssistantText(buffer);
  assert.equal(text, "Hello, world!");
  assert.equal(error, undefined);
});

test("collectAssistantText surfaces error frames", () => {
  const errorFrame = encodeEventStreamMessage(
    { ":event-type": "errorEvent", ":content-type": "application/json" },
    Buffer.from(JSON.stringify({ message: "quota exceeded" }), "utf8"),
  );
  const buffer = Buffer.concat([assistantFrame("partial"), errorFrame]);
  const { text, error } = collectAssistantText(buffer);
  assert.equal(text, "partial");
  assert.equal(error, "quota exceeded");
});

test("buildResponsesJson produces a completed response with usage", () => {
  const json = buildResponsesJson({
    text: "answer text",
    model: "kiro-claude-sonnet-4",
    inputText: "some input prompt",
  });
  assert.equal(json.status, "completed");
  assert.equal(json.model, "kiro-claude-sonnet-4");
  const output = json.output as Array<Record<string, unknown>>;
  const content = output[0].content as Array<Record<string, unknown>>;
  assert.equal(content[0].text, "answer text");
  const usage = json.usage as Record<string, number>;
  assert.ok(usage.total_tokens > 0);
  assert.equal(usage.total_tokens, usage.input_tokens + usage.output_tokens);
});

test("buildResponsesSseFrames ends with a completed event and [DONE]", () => {
  const frames = buildResponsesSseFrames({
    text: "streamed answer",
    model: "kiro-claude-sonnet-4",
    inputText: "prompt",
  });
  const joined = frames.join("");
  assert.match(joined, /event: response\.created/);
  assert.match(joined, /event: response\.output_text\.delta/);
  assert.match(joined, /"delta":"streamed answer"/);
  assert.match(joined, /event: response\.completed/);
  assert.ok(frames[frames.length - 1].includes("[DONE]"));
});

test("collectInputText joins all turns for token estimation", () => {
  const text = collectInputText({
    instructions: "sys",
    input: [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ],
  });
  assert.match(text, /sys/);
  assert.match(text, /a/);
  assert.match(text, /b/);
});
