/**
 * Console Log screen — 9router-style live tail.
 *
 * Subscribes to /api/console-logs/stream over SSE and renders a black
 * terminal-style log feed with level-colored lines. Auto-scroll on new
 * entries. Clear button truncates the buffer server-side.
 *
 * Mirrors `src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.js`
 * from 9router.
 */

import { useEffect, useRef, useState } from "react";
import { ConsoleIcon } from "../components/icons";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { SurfaceCard } from "../components/SurfaceCard";
import { deleteConsoleLogs } from "../api/client";

const MAX_LINES = 1000;

const LEVEL_COLORS: Record<string, string> = {
  LOG: "#10b981",     // green-500
  INFO: "#60a5fa",    // blue-400
  WARN: "#facc15",    // yellow-400
  ERROR: "#f87171",   // red-400
  FATAL: "#f87171",
  DEBUG: "#c084fc",   // purple-400
  TRACE: "#9ca3af",   // gray-400
};

function colorForLine(line: string): string {
  const match = line.match(/^\[(\w+)\]/);
  if (!match) return LEVEL_COLORS.LOG;
  return LEVEL_COLORS[match[1].toUpperCase()] ?? LEVEL_COLORS.LOG;
}

type StreamEvent =
  | { type: "init"; logs: string[] }
  | { type: "line"; line: string }
  | { type: "clear" };

export function ConsoleLogScreen() {
  const [logs, setLogs] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource("/api/console-logs/stream");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as StreamEvent;
        if (msg.type === "init") {
          setLogs(msg.logs.slice(-MAX_LINES));
        } else if (msg.type === "line") {
          setLogs((prev) => {
            const next = [...prev, msg.line];
            return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
          });
        } else if (msg.type === "clear") {
          setLogs([]);
        }
      } catch {
        /* ignore malformed event */
      }
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    if (!autoScroll || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs, autoScroll]);

  const handleClear = async () => {
    try {
      await deleteConsoleLogs();
      // Server will push a {type:"clear"} event; UI will react there.
    } catch (err) {
      console.error("Failed to clear console logs", err);
    }
  };

  const filteredLogs = filter
    ? logs.filter((line) => line.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  return (
    <div className="screen-stack">
      <PageHeader
        icon={ConsoleIcon}
        title="Console Log"
        description="Live tail of the proxy's console output (Fastify pino logs and console.* calls)."
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            <StatusBadge variant={connected ? "success" : "warning"}>
              {connected ? "Connected" : "Disconnected"}
            </StatusBadge>
            <button
              type="button"
              className="button-link"
              onClick={() => setAutoScroll((v) => !v)}
              title={autoScroll ? "Disable auto-scroll" : "Enable auto-scroll"}
            >
              {autoScroll ? "Auto-scroll on" : "Auto-scroll off"}
            </button>
            <button
              type="button"
              className="button-secondary"
              onClick={handleClear}
              title="Clear console buffer"
            >
              Clear
            </button>
          </div>
        }
      />

      <SurfaceCard>
        <input
          type="text"
          className="search-input"
          placeholder="Filter lines (case-insensitive)..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ marginBottom: "var(--space-3)" }}
        />

        <div
          ref={logRef}
          className="console-log-terminal"
          style={{
            background: "#0a0a0a",
            color: "#10b981",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            lineHeight: "1.55",
            padding: "var(--space-3) var(--space-4)",
            borderRadius: "var(--radius-md)",
            height: "calc(100vh - 280px)",
            minHeight: 320,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
          onScroll={(e) => {
            const el = e.currentTarget;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            // Only re-engage auto-scroll when user scrolls back to the bottom.
            if (atBottom && !autoScroll) setAutoScroll(true);
            else if (!atBottom && autoScroll) setAutoScroll(false);
          }}
        >
          {filteredLogs.length === 0 ? (
            <span style={{ color: "#6b7280" }}>
              {filter ? "No lines match the filter." : "No console logs yet."}
            </span>
          ) : (
            filteredLogs.map((line, i) => (
              <div key={`${i}-${line.slice(0, 32)}`} style={{ color: colorForLine(line) }}>
                {line}
              </div>
            ))
          )}
        </div>
      </SurfaceCard>
    </div>
  );
}
