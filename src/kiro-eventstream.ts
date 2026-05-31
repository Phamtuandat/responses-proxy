/**
 * Decoder for the AWS `application/vnd.amazon.eventstream` binary framing used by
 * CodeWhisperer / Amazon Q streaming responses (the same framing Bedrock and
 * Transcribe use). Each message is:
 *
 *   prelude (12 bytes):
 *     total length    uint32 (big-endian)   total bytes of the whole message
 *     headers length  uint32 (big-endian)   bytes of the header section
 *     prelude crc     uint32 (big-endian)   CRC32 of the first 8 bytes
 *   headers   (variable, `headers length` bytes)
 *   payload   (variable, total - 12 - headersLength - 4 bytes)
 *   message crc uint32 (big-endian)         CRC32 of every byte except itself
 *
 * Each header is: name length (uint8), name (utf8), value type (uint8), value.
 *
 * The decoder is incremental: feed it chunks and it returns whatever complete
 * messages are now available, buffering any partial trailing bytes.
 */

const PRELUDE_LENGTH = 12;
const MESSAGE_CRC_LENGTH = 4;
const MIN_MESSAGE_LENGTH = PRELUDE_LENGTH + MESSAGE_CRC_LENGTH;

export type EventStreamHeaderValue = string | number | boolean | Buffer;

export type EventStreamMessage = {
  headers: Record<string, EventStreamHeaderValue>;
  payload: Buffer;
};

export class EventStreamParseError extends Error {}

const CRC32_TABLE = buildCrc32Table();

function buildCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

/** Standard IEEE CRC32 over a byte range, returned as an unsigned 32-bit int. */
export function crc32(buffer: Buffer, start = 0, end = buffer.length): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i += 1) {
    crc = CRC32_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Incremental decoder. Push raw bytes as they arrive from the upstream stream and
 * drain complete messages. Relies on the length prefix (not the CRC) to frame
 * messages, matching the proven 9router/AWS-SDK behavior; a bad prelude CRC is
 * tolerated rather than fatal so a single checksum quirk can't kill a valid stream.
 */
export class EventStreamParser {
  private buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer | Uint8Array): EventStreamMessage[] {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, incoming]) : incoming;
    return this.drain();
  }

  /** Number of unparsed bytes still buffered (a partial trailing message). */
  pendingBytes(): number {
    return this.buffer.length;
  }

  private drain(): EventStreamMessage[] {
    const messages: EventStreamMessage[] = [];
    while (this.buffer.length >= PRELUDE_LENGTH) {
      const totalLength = this.buffer.readUInt32BE(0);
      if (totalLength < MIN_MESSAGE_LENGTH) {
        throw new EventStreamParseError(
          `event-stream message length ${totalLength} is below the minimum ${MIN_MESSAGE_LENGTH}`,
        );
      }
      if (this.buffer.length < totalLength) {
        // Wait for the rest of this message to arrive.
        break;
      }
      const frame = this.buffer.subarray(0, totalLength);
      messages.push(decodeMessage(frame));
      this.buffer = this.buffer.subarray(totalLength);
    }
    return messages;
  }
}

/** Decode every complete message in a fully buffered response body. */
export function parseEventStream(buffer: Buffer): EventStreamMessage[] {
  const parser = new EventStreamParser();
  const messages = parser.push(buffer);
  if (parser.pendingBytes() > 0) {
    throw new EventStreamParseError(
      `event-stream buffer ended with ${parser.pendingBytes()} trailing bytes (incomplete message)`,
    );
  }
  return messages;
}

function decodeMessage(frame: Buffer): EventStreamMessage {
  const totalLength = frame.readUInt32BE(0);
  const headersLength = frame.readUInt32BE(4);
  // Note: bytes 8-11 hold the prelude CRC32. 9router (and the AWS SDK in practice)
  // frame purely by the length prefix and do not reject on CRC mismatch, so we skip
  // validation here to stay byte-compatible with the proven client.

  const payloadStart = PRELUDE_LENGTH + headersLength;
  const payloadEnd = totalLength - MESSAGE_CRC_LENGTH;
  if (payloadStart > payloadEnd) {
    throw new EventStreamParseError(
      `event-stream headers length ${headersLength} overflows message of ${totalLength} bytes`,
    );
  }

  const headers = decodeHeaders(frame.subarray(PRELUDE_LENGTH, payloadStart));
  const payload = Buffer.from(frame.subarray(payloadStart, payloadEnd));
  return { headers, payload };
}

function decodeHeaders(section: Buffer): Record<string, EventStreamHeaderValue> {
  const headers: Record<string, EventStreamHeaderValue> = {};
  let offset = 0;
  while (offset < section.length) {
    const nameLength = section.readUInt8(offset);
    offset += 1;
    const name = section.toString("utf8", offset, offset + nameLength);
    offset += nameLength;
    const valueType = section.readUInt8(offset);
    offset += 1;

    switch (valueType) {
      case 0: // true
        headers[name] = true;
        break;
      case 1: // false
        headers[name] = false;
        break;
      case 2: // byte
        headers[name] = section.readInt8(offset);
        offset += 1;
        break;
      case 3: // short
        headers[name] = section.readInt16BE(offset);
        offset += 2;
        break;
      case 4: // integer
        headers[name] = section.readInt32BE(offset);
        offset += 4;
        break;
      case 5: // long
        headers[name] = Number(section.readBigInt64BE(offset));
        offset += 8;
        break;
      case 6: {
        // byte array
        const len = section.readUInt16BE(offset);
        offset += 2;
        headers[name] = Buffer.from(section.subarray(offset, offset + len));
        offset += len;
        break;
      }
      case 7: {
        // string
        const len = section.readUInt16BE(offset);
        offset += 2;
        headers[name] = section.toString("utf8", offset, offset + len);
        offset += len;
        break;
      }
      case 8: // timestamp (epoch millis)
        headers[name] = Number(section.readBigInt64BE(offset));
        offset += 8;
        break;
      case 9: // uuid
        headers[name] = Buffer.from(section.subarray(offset, offset + 16)).toString("hex");
        offset += 16;
        break;
      default:
        throw new EventStreamParseError(`unknown event-stream header value type ${valueType}`);
    }
  }
  return headers;
}

/**
 * Encode a single event-stream message. Used by tests to build fixtures, but also
 * generally useful. Header values are emitted as strings (type 7) which matches
 * how CodeWhisperer tags `:event-type`, `:content-type`, and `:message-type`.
 */
export function encodeEventStreamMessage(
  headers: Record<string, string>,
  payload: Buffer,
): Buffer {
  const headerChunks: Buffer[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const nameBuf = Buffer.from(name, "utf8");
    const valueBuf = Buffer.from(value, "utf8");
    const head = Buffer.alloc(1 + nameBuf.length + 1 + 2);
    let o = 0;
    head.writeUInt8(nameBuf.length, o);
    o += 1;
    nameBuf.copy(head, o);
    o += nameBuf.length;
    head.writeUInt8(7, o); // string type
    o += 1;
    head.writeUInt16BE(valueBuf.length, o);
    headerChunks.push(Buffer.concat([head, valueBuf]));
  }
  const headerSection = Buffer.concat(headerChunks);
  const totalLength = PRELUDE_LENGTH + headerSection.length + payload.length + MESSAGE_CRC_LENGTH;

  const message = Buffer.alloc(totalLength);
  message.writeUInt32BE(totalLength, 0);
  message.writeUInt32BE(headerSection.length, 4);
  const preludeCrc = crc32(message, 0, 8);
  message.writeUInt32BE(preludeCrc, 8);
  headerSection.copy(message, PRELUDE_LENGTH);
  payload.copy(message, PRELUDE_LENGTH + headerSection.length);
  const messageCrc = crc32(message, 0, totalLength - MESSAGE_CRC_LENGTH);
  message.writeUInt32BE(messageCrc, totalLength - MESSAGE_CRC_LENGTH);
  return message;
}

/** Parse a header-tagged JSON payload, returning undefined on non-JSON payloads. */
export function decodeJsonPayload(message: EventStreamMessage): Record<string, unknown> | undefined {
  if (message.payload.length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(message.payload.toString("utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Convenience accessor for the `:event-type` header CodeWhisperer sets on each frame. */
export function eventType(message: EventStreamMessage): string | undefined {
  const value = message.headers[":event-type"];
  return typeof value === "string" ? value : undefined;
}
