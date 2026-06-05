import { useCallback, useState } from "react";
import { getAuditLogs } from "../api/client";
import type { AuditLogRecord, AuditLogsResponse } from "../api/types";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { RefreshButton } from "../components/RefreshButton";
import { SurfaceCard } from "../components/SurfaceCard";
import { StatusBadge } from "../components/StatusBadge";
import { ConsoleIcon } from "../components/icons";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatDateTime } from "../lib/format";

type AuditLogsData = {
  response: AuditLogsResponse;
};

export function ConsoleLogScreen() {
  const [selectedEvent, setSelectedEvent] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadLogs = useCallback(async () => {
    const response = await getAuditLogs({
      event: selectedEvent || undefined,
      limit: 100,
    });
    return { response };
  }, [selectedEvent]);

  const { state, retry } = useAsyncResource<AuditLogsData>(loadLogs);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  if (state.status === "loading" || state.status === "idle") {
    return <LoadingState title="Loading system console logs" description="Reading audit log records from the database." />;
  }

  if (state.status === "error") {
    return <ErrorState title="Console logs unavailable" description={state.error.message} onRetry={retry} />;
  }

  const rawLogs = state.data.response.logs || [];
  
  // Client-side query filter
  const filteredLogs = rawLogs.filter((log) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      log.event.toLowerCase().includes(query) ||
      log.actorType.toLowerCase().includes(query) ||
      (log.actorId && log.actorId.toLowerCase().includes(query)) ||
      (log.subjectId && log.subjectId.toLowerCase().includes(query)) ||
      JSON.stringify(log.metadata).toLowerCase().includes(query)
    );
  });

  // Extract unique events for the filter dropdown
  const allEvents = Array.from(new Set(rawLogs.map((log) => log.event)));

  return (
    <div className="screen-stack">
      <PageHeader
        icon={ConsoleIcon}
        title="Console Log"
        description="View, inspect, and analyze system events, authentication audits, and proxy transactions."
        actions={<RefreshButton onClick={retry} />}
      />

      {/* Toolbar controls */}
      <div className="providers-controls-row">
        <SurfaceCard title="Filter by Event" description="Filter the log feed by specific event categories">
          <select
            className="search-input"
            value={selectedEvent}
            onChange={(e) => {
              setSelectedEvent(e.target.value);
              setExpandedLogId(null);
            }}
          >
            <option value="">All system events</option>
            {allEvents.map((evt) => (
              <option key={evt} value={evt}>
                {evt}
              </option>
            ))}
          </select>
        </SurfaceCard>

        <SurfaceCard title="Search Logs" description="Search events, metadata, actors, or subject IDs">
          <input
            type="text"
            className="search-input"
            placeholder="Search console logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </SurfaceCard>
      </div>

      {/* Log Feed */}
      <SurfaceCard
        title="System Event Stream"
        description={`Displaying ${filteredLogs.length} recent system event records.`}
      >
        {filteredLogs.length === 0 ? (
          <EmptyState
            title="No logs found"
            description={searchQuery || selectedEvent ? "Adjust your search filters to view more logs." : "System events will appear here as proxy transactions are executed."}
            actionLabel="Reset Filters"
            onClick={() => {
              setSelectedEvent("");
              setSearchQuery("");
            }}
          />
        ) : (
          <div className="table-container" style={{ overflowX: "auto" }}>
            <table className="data-table" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                  <th style={{ padding: "var(--space-3) var(--space-4)" }}>Timestamp</th>
                  <th style={{ padding: "var(--space-3) var(--space-4)" }}>Event Type</th>
                  <th style={{ padding: "var(--space-3) var(--space-4)" }}>Actor</th>
                  <th style={{ padding: "var(--space-3) var(--space-4)" }}>Subject</th>
                  <th style={{ padding: "var(--space-3) var(--space-4)", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  return (
                    <>
                      <tr
                        key={log.id}
                        className={`table-row ${isExpanded ? "row-selected" : ""}`}
                        style={{
                          borderBottom: "1px solid var(--border)",
                          cursor: "pointer",
                          backgroundColor: isExpanded ? "var(--surface-hover)" : "transparent",
                        }}
                        onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                      >
                        <td style={{ padding: "var(--space-3) var(--space-4)", fontSize: "var(--font-xs)", fontFamily: "var(--font-mono)" }}>
                          {formatDateTime(log.createdAt)}
                        </td>
                        <td style={{ padding: "var(--space-3) var(--space-4)", fontWeight: "bold" }}>
                          <span style={{ color: "var(--accent)" }}>{log.event}</span>
                        </td>
                        <td style={{ padding: "var(--space-3) var(--space-4)", fontSize: "var(--font-sm)" }}>
                          <StatusBadge variant="neutral">
                            {log.actorType}:{log.actorId || "system"}
                          </StatusBadge>
                        </td>
                        <td style={{ padding: "var(--space-3) var(--space-4)", fontSize: "var(--font-sm)", fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
                          {log.subjectType ? `${log.subjectType}:` : ""}{log.subjectId || "global"}
                        </td>
                        <td style={{ padding: "var(--space-3) var(--space-4)", textAlign: "right" }}>
                          <button
                            className="button-link"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedLogId(isExpanded ? null : log.id);
                            }}
                            type="button"
                          >
                            {isExpanded ? "Collapse" : "Inspect"}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${log.id}-expanded`} style={{ borderBottom: "1px solid var(--border)", backgroundColor: "var(--surface-code)" }}>
                          <td colSpan={5} style={{ padding: "var(--space-4)" }}>
                            <div className="expanded-details-container" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontWeight: "bold", fontSize: "var(--font-sm)", color: "var(--text-primary)" }}>
                                  Detailed Event Payload Metadata
                                </span>
                                <button
                                  className="button-secondary"
                                  onClick={() => handleCopy(log.id, JSON.stringify(log, null, 2))}
                                  type="button"
                                  style={{ padding: "var(--space-1) var(--space-2)", fontSize: "var(--font-xs)" }}
                                >
                                  {copiedId === log.id ? "✓ Copied" : "Copy Payload"}
                                </button>
                              </div>
                              <pre
                                className="code-container"
                                style={{
                                  padding: "var(--space-3)",
                                  borderRadius: "var(--radius)",
                                  fontSize: "var(--font-xs)",
                                  lineHeight: "1.5",
                                  backgroundColor: "var(--bg)",
                                  border: "1px solid var(--border)",
                                  overflowX: "auto",
                                  whiteSpace: "pre-wrap",
                                }}
                              >
                                {JSON.stringify(log, null, 2)}
                              </pre>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}
