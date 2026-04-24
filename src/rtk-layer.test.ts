import test from "node:test";
import assert from "node:assert/strict";
import { applyRtkLayer } from "./rtk-layer.js";
import type { ProxyResponsesRequest } from "./schema.js";

test("rtk layer is inert when disabled", () => {
  const body: ProxyResponsesRequest = {
    model: "gpt-5.4",
    messages: [
      {
        role: "user",
        content: "hello",
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        content: "\u001b[32mok\u001b[0m\n\nsame\nsame\n",
      },
    ],
  };

  const result = applyRtkLayer(body, {
    enabled: false,
  });

  assert.equal(result.body, body);
  assert.equal(result.stats.applied, false);
  assert.equal(result.stats.toolOutputsSeen, 0);
});

test("rtk layer canonicalizes and truncates tool message output deterministically", () => {
  const body: ProxyResponsesRequest = {
    model: "gpt-5.4",
    messages: [
      {
        role: "user",
        content: "check logs",
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        content: "\u001b[32mline-1\u001b[0m\r\n\r\nsame\r\nsame\r\nline-4\r\nline-5\r\nline-6",
      },
    ],
  };

  const result = applyRtkLayer(body, {
    enabled: true,
    toolOutputEnabled: true,
    maxLines: 3,
    maxChars: 80,
  });

  assert.equal(result.stats.applied, true);
  assert.equal(result.stats.toolOutputsSeen, 1);
  assert.equal(result.stats.toolOutputsReduced, 1);

  const toolMessage = result.body.messages?.[1];
  assert.equal(typeof toolMessage?.content, "string");
  assert.match(
    toolMessage?.content as string,
    /\[rtk trunc fmt=plain/,
  );
  assert.equal((toolMessage?.content as string).includes("\u001b["), false);
  assert.equal((toolMessage?.content as string).includes("same\nsame"), false);
});

test("rtk layer transforms direct function_call_output items without touching user input", () => {
  const body: ProxyResponsesRequest = {
    model: "gpt-5.4",
    input: [
      {
        role: "user",
        content: "keep this intact",
      },
      {
        type: "function_call_output",
        call_id: "call_1",
        output: "a\nb\nc\nd\ne",
      },
    ],
  };

  const result = applyRtkLayer(body, {
    enabled: true,
    toolOutputEnabled: true,
    maxLines: 2,
    maxChars: 40,
  });

  assert.equal(result.body.input?.[0], body.input?.[0]);
  assert.notEqual(result.body.input?.[1], body.input?.[1]);
  assert.match(
    String((result.body.input?.[1] as { output?: string }).output),
    /lines=3/,
  );
});

test("rtk layer can preserve tail lines when truncating long tool output", () => {
  const body: ProxyResponsesRequest = {
    model: "gpt-5.4",
    messages: [
      {
        role: "tool",
        tool_call_id: "call_2",
        content: "head-1\nhead-2\nmid-1\nmid-2\nerror-1\nerror-2",
      },
    ],
  };

  const result = applyRtkLayer(body, {
    enabled: true,
    toolOutputEnabled: true,
    maxLines: 4,
    maxChars: 120,
    tailLines: 2,
  });

  assert.equal(result.stats.applied, true);
  const toolMessage = result.body.messages?.[0];
  assert.equal(typeof toolMessage?.content, "string");
  assert.match(String(toolMessage?.content), /head-1/);
  assert.match(String(toolMessage?.content), /\n\.\.\.\n/);
  assert.match(String(toolMessage?.content), /error-1/);
  assert.match(String(toolMessage?.content), /error-2/);
  assert.equal(String(toolMessage?.content).includes("mid-1"), false);
});

test("rtk layer auto-detects and pretty-prints json before truncation", () => {
  const body: ProxyResponsesRequest = {
    model: "gpt-5.4",
    messages: [
      {
        role: "tool",
        tool_call_id: "call_json",
        content: '{"root":{"items":[1,2,3],"meta":{"status":"ok","trace":"abc"}},"tail":{"done":true}}',
      },
    ],
  };

  const result = applyRtkLayer(body, {
    enabled: true,
    toolOutputEnabled: true,
    maxLines: 6,
    maxChars: 190,
    tailLines: 3,
    tailChars: 60,
  });

  const content = String(result.body.messages?.[0]?.content ?? "");
  assert.match(content, /fmt=json/);
  assert.match(content, /"root": \{/);
  assert.match(content, /"done": true/);
});

test("rtk layer auto-detects stack traces and preserves the tail error frames", () => {
  const body: ProxyResponsesRequest = {
    model: "gpt-5.4",
    messages: [
      {
        role: "tool",
        tool_call_id: "call_stack",
        content:
          "TypeError: failed\n    at first (/app/a.ts:1:1)\n    at second (/app/b.ts:2:2)\n    at third (/app/c.ts:3:3)\n    at final (/app/d.ts:4:4)",
      },
    ],
  };

  const result = applyRtkLayer(body, {
    enabled: true,
    toolOutputEnabled: true,
    maxLines: 4,
    maxChars: 140,
    tailLines: 2,
  });

  const content = String(result.body.messages?.[0]?.content ?? "");
  assert.match(content, /fmt=stack/);
  assert.match(content, /stack frames truncated/);
  assert.match(content, /final \(\/app\/d.ts:4:4/);
});

test("rtk layer preserves important command log lines from the middle segment", () => {
  const body: ProxyResponsesRequest = {
    model: "gpt-5.4",
    messages: [
      {
        role: "tool",
        tool_call_id: "call_cmd",
        content: [
          "$ npm run build",
          "INFO compiling module a",
          "INFO compiling module b",
          "INFO compiling module c",
          "WARN retrying cache fetch",
          "INFO compiling module d",
          "ERROR request failed with status code 502",
          "INFO compiling module e",
          "INFO compiling module f",
          "build finished",
        ].join("\n"),
      },
    ],
  };

  const result = applyRtkLayer(body, {
    enabled: true,
    toolOutputEnabled: true,
    maxLines: 4,
    maxChars: 180,
    tailLines: 1,
    detectFormat: "command",
  });

  const content = String(result.body.messages?.[0]?.content ?? "");
  assert.match(content, /fmt=command/);
  assert.match(content, /ERROR request failed with status code 502/);
  assert.match(content, /build finished/);
});
