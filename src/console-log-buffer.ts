/**
 * In-process console log capture for the dashboard's live log viewer.
 *
 * Holds a ring buffer of the most recent log lines and emits SSE events to any
 * subscriber (the dashboard `/api/console-logs/stream` endpoint). Receives
 * input from two places:
 *
 * 1. Fastify's pino logger via a tee Writable stream (parsed from JSON to a
 *    "[LEVEL] timestamp message" line).
 * 2. console.log/info/warn/error calls scattered across the codebase.
 *
 * Mirrors 9router's `/api/translator/console-logs/stream` shape:
 *   { type: "init", logs: string[] }
 *   { type: "line", line: string }
 *   { type: "clear" }
 */

import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

const MAX_LINES = 1000;

type Subscriber = (event: { type: "line"; line: string } | { type: "clear" }) => void;

class ConsoleLogBuffer {
  private readonly lines: string[] = [];
  private readonly emitter = new EventEmitter();
  /** Sequence number to dedupe lines that round-trip through patched console. */
  private installedConsole = false;

  constructor() {
    // Allow many SSE subscribers without warnings.
    this.emitter.setMaxListeners(0);
  }

  /** Get a snapshot of the most recent lines (oldest first). */
  snapshot(): string[] {
    return [...this.lines];
  }

  /** Append a single line; trims to the ring buffer cap and notifies subscribers. */
  append(line: string): void {
    if (!line) return;
    // Split multi-line input so each row stays one entry.
    const split = line.split("\n");
    for (const piece of split) {
      const trimmed = piece.replace(/\s+$/, "");
      if (!trimmed) continue;
      this.lines.push(trimmed);
      if (this.lines.length > MAX_LINES) {
        this.lines.splice(0, this.lines.length - MAX_LINES);
      }
      this.emitter.emit("line", { type: "line", line: trimmed });
    }
  }

  /** Clear the buffer and notify subscribers. */
  clear(): void {
    this.lines.length = 0;
    this.emitter.emit("line", { type: "clear" });
  }

  subscribe(handler: Subscriber): () => void {
    this.emitter.on("line", handler);
    return () => this.emitter.off("line", handler);
  }

  /**
   * Tee Writable stream suitable for the Fastify `logger.stream` option.
   * Each pino JSON record is parsed into a single human-readable line.
   */
  createTeeStream(downstream: NodeJS.WritableStream): Writable {
    return new Writable({
      write: (chunk, _enc, cb) => {
        const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
        // Forward to original stream first so existing log file capture is unchanged.
        try {
          downstream.write(text);
        } catch {
          /* ignore downstream errors — they should not break logging */
        }
        for (const raw of text.split("\n")) {
          if (!raw.trim()) continue;
          this.append(formatPinoLine(raw));
        }
        cb();
      },
    });
  }

  /** Patch global console.* methods so they tee into this buffer. */
  installConsoleHook(): void {
    if (this.installedConsole) return;
    this.installedConsole = true;
    const wrap = (method: "log" | "info" | "warn" | "error" | "debug", level: string) => {
      const original = console[method].bind(console);
      console[method] = (...args: unknown[]) => {
        try {
          this.append(formatConsoleArgs(level, args));
        } catch {
          /* ignore — logging must never throw */
        }
        original(...args);
      };
    };
    wrap("log", "LOG");
    wrap("info", "INFO");
    wrap("warn", "WARN");
    wrap("error", "ERROR");
    wrap("debug", "DEBUG");
  }
}

function formatPinoLine(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (!trimmed.startsWith("{")) {
    return trimmed; // Already plain text — keep as-is.
  }
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const level = pinoLevelLabel(typeof obj.level === "number" ? obj.level : undefined);
    const time = typeof obj.time === "number" ? new Date(obj.time).toISOString() : "";
    const msg = typeof obj.msg === "string" ? obj.msg : "";
    const reqId = typeof obj.reqId === "string" ? ` reqId=${obj.reqId}` : "";
    const provider = typeof obj.provider === "string" ? ` provider=${obj.provider}` : "";
    const status = typeof obj.upstreamStatus === "number" ? ` status=${obj.upstreamStatus}` : "";
    const totalMs = typeof obj.totalMs === "number" ? ` totalMs=${obj.totalMs}` : "";
    const errMessage = typeof obj.err === "object" && obj.err
      ? ` err=${(obj.err as Record<string, unknown>).message}`
      : "";
    return `[${level}] ${time} ${msg}${reqId}${provider}${status}${totalMs}${errMessage}`.trim();
  } catch {
    return trimmed;
  }
}

function pinoLevelLabel(level: number | undefined): string {
  if (typeof level !== "number") return "INFO";
  if (level >= 60) return "FATAL";
  if (level >= 50) return "ERROR";
  if (level >= 40) return "WARN";
  if (level >= 30) return "INFO";
  if (level >= 20) return "DEBUG";
  if (level >= 10) return "TRACE";
  return "LOG";
}

function formatConsoleArgs(level: string, args: unknown[]): string {
  const parts = args.map((arg) => {
    if (typeof arg === "string") return arg;
    if (arg instanceof Error) return arg.stack ?? arg.message;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  });
  return `[${level}] ${new Date().toISOString()} ${parts.join(" ")}`;
}

export const consoleLogBuffer = new ConsoleLogBuffer();
