import assert from "node:assert/strict";
import test from "node:test";
import {
  EventStreamParser,
  EventStreamParseError,
  crc32,
  decodeJsonPayload,
  encodeEventStreamMessage,
  eventType,
  parseEventStream,
} from "./kiro-eventstream.js";

function assistantFrame(content: string): Buffer {
  return encodeEventStreamMessage(
    {
      ":event-type": "assistantResponseEvent",
      ":content-type": "application/json",
      ":message-type": "event",
    },
    Buffer.from(JSON.stringify({ content }), "utf8"),
  );
}

test("crc32 matches the known check value for 'The quick brown fox...'", () => {
  // IEEE CRC32 of this canonical string is 0x414fa339.
  const value = crc32(Buffer.from("The quick brown fox jumps over the lazy dog", "utf8"));
  assert.equal(value, 0x414fa339);
});

test("round-trips a single encoded message", () => {
  const frame = assistantFrame("hello");
  const messages = parseEventStream(frame);
  assert.equal(messages.length, 1);
  assert.equal(eventType(messages[0]), "assistantResponseEvent");
  assert.equal(messages[0].headers[":content-type"], "application/json");
  assert.deepEqual(decodeJsonPayload(messages[0]), { content: "hello" });
});

test("parses multiple concatenated messages", () => {
  const frames = Buffer.concat([
    assistantFrame("alpha"),
    assistantFrame("beta"),
    assistantFrame("gamma"),
  ]);
  const messages = parseEventStream(frames);
  assert.deepEqual(
    messages.map((m) => decodeJsonPayload(m)?.content),
    ["alpha", "beta", "gamma"],
  );
});

test("incremental parser buffers partial messages across chunks", () => {
  const frame = assistantFrame("streamed");
  const parser = new EventStreamParser();

  // Feed the message one byte at a time; nothing should complete until the last byte.
  let completed = 0;
  for (let i = 0; i < frame.length; i += 1) {
    const out = parser.push(frame.subarray(i, i + 1));
    completed += out.length;
    if (i < frame.length - 1) {
      assert.equal(out.length, 0, `unexpected completion at byte ${i}`);
    }
  }
  assert.equal(completed, 1);
  assert.equal(parser.pendingBytes(), 0);
});

test("incremental parser handles a chunk that spans a message boundary", () => {
  const a = assistantFrame("first");
  const b = assistantFrame("second");
  const combined = Buffer.concat([a, b]);

  const parser = new EventStreamParser();
  const firstHalf = combined.subarray(0, a.length + 5);
  const secondHalf = combined.subarray(a.length + 5);

  const out1 = parser.push(firstHalf);
  assert.equal(out1.length, 1);
  assert.equal(decodeJsonPayload(out1[0])?.content, "first");

  const out2 = parser.push(secondHalf);
  assert.equal(out2.length, 1);
  assert.equal(decodeJsonPayload(out2[0])?.content, "second");
});

test("tolerates a corrupted prelude CRC (frames by length, not checksum)", () => {
  const frame = assistantFrame("crc-tolerant");
  // Corrupt only the prelude CRC bytes (offset 8-11), leaving the lengths intact.
  // 9router frames purely by the length prefix, so this must still decode.
  frame.writeUInt32BE((frame.readUInt32BE(8) ^ 0xffffffff) >>> 0, 8);
  const messages = parseEventStream(frame);
  assert.equal(messages.length, 1);
  assert.deepEqual(decodeJsonPayload(messages[0]), { content: "crc-tolerant" });
});

test("parseEventStream rejects a trailing incomplete message", () => {
  const frame = assistantFrame("partial");
  assert.throws(
    () => parseEventStream(frame.subarray(0, frame.length - 3)),
    (error: unknown) => error instanceof EventStreamParseError,
  );
});

test("decodeJsonPayload returns undefined for non-JSON payloads", () => {
  const frame = encodeEventStreamMessage(
    { ":event-type": "raw" },
    Buffer.from("not json", "utf8"),
  );
  const [message] = parseEventStream(frame);
  assert.equal(decodeJsonPayload(message), undefined);
});
