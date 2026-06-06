/**
 * API Key Manager — 9Router-style simple key management.
 *
 * Shows a list of API keys with:
 * - Name + masked key value
 * - Copy full key to clipboard
 * - Toggle active/inactive
 * - Delete
 * - Create new key with name
 *
 * Uses the existing /api/clients endpoints to manage route API keys.
 */

import { useState, useEffect, useCallback } from "react";
import { SurfaceCard } from "./SurfaceCard";
import { PlusIcon } from "./icons";
import type { ClientRouteSummary } from "../api/types";
import { getProviders, createClient, deleteClient } from "../api/client";

type ApiKeyEntry = {
  routeKey: string;
  apiKey: string;
  providerId?: string | null;
};

export function ApiKeyManager() {
  const [keys, setKeys] = useState<ApiKeyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getProviders();
      const routes = data.clientRoutes || [];
      const entries: ApiKeyEntry[] = [];
      for (const route of routes) {
        const routeKeys = Array.isArray(route.apiKeys) ? route.apiKeys.filter(Boolean) : [];
        for (const key of routeKeys) {
          entries.push({ routeKey: route.key, apiKey: key, providerId: route.providerId });
        }
      }
      setKeys(entries);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchKeys(); }, [fetchKeys]);

  const handleCreate = async () => {
    if (!newName.trim()) { setError("Name is required"); return; }
    setCreating(true);
    setError("");
    try {
      await createClient({ client: newName.trim() });
      setNewName("");
      setShowCreate(false);
      await fetchKeys();
    } catch (err: any) {
      setError(err.message || "Failed to create");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (entry: ApiKeyEntry) => {
    if (!confirm(`Delete route "${entry.routeKey}" and its API key?`)) return;
    try {
      await deleteClient(entry.routeKey);
      await fetchKeys();
    } catch { /* ignore */ }
  };

  return (
    <SurfaceCard
      title="API Keys"
      description="Manage access keys for CLI tools and clients."
      actions={
        <button className="button-primary" onClick={() => setShowCreate(true)} style={{ minHeight: 36 }}>
          <PlusIcon style={{ width: 14, height: 14 }} />
          New Key
        </button>
      }
    >
      {/* Create form */}
      {showCreate && (
        <div style={{ marginBottom: "var(--space-4)", padding: "var(--space-3) var(--space-4)", background: "var(--surface-muted)", borderRadius: "var(--radius-md)", border: "1px solid var(--line)" }}>
          <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              placeholder="Key name (e.g. my-laptop)"
              autoFocus
              style={{ flex: 1, minHeight: 36, fontSize: "var(--text-sm)", padding: "6px 12px" }}
            />
            <button className="button-primary" onClick={handleCreate} disabled={creating || !newName.trim()} style={{ minHeight: 36 }}>
              {creating ? "..." : "Create"}
            </button>
            <button className="button-link" onClick={() => { setShowCreate(false); setError(""); }} style={{ minHeight: 36 }}>
              Cancel
            </button>
          </div>
          {error && <p style={{ margin: "var(--space-2) 0 0", color: "var(--danger)", fontSize: "var(--text-xs)" }}>{error}</p>}
        </div>
      )}

      {/* Key list */}
      {loading ? (
        <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>Loading...</p>
      ) : keys.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)", textAlign: "center", padding: "var(--space-4)" }}>
          No API keys yet. Create one to connect your CLI tools.
        </p>
      ) : (
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          {keys.map((entry, i) => (
            <ApiKeyRow key={`${entry.routeKey}-${i}`} entry={entry} onDelete={() => handleDelete(entry)} />
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}

function ApiKeyRow({ entry, onDelete }: { entry: ApiKeyEntry; onDelete: () => void }) {
  const [copied, setCopied] = useState(false);
  const [showFull, setShowFull] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(entry.apiKey).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const masked = `${entry.apiKey.slice(0, 8)}${"•".repeat(12)}${entry.apiKey.slice(-4)}`;

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: "var(--space-3)",
      padding: "var(--space-2) var(--space-3)",
      background: "var(--surface-muted)",
      borderRadius: "var(--radius-sm)",
      border: "1px solid var(--line)",
    }}>
      {/* Active indicator */}
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: "var(--success)",
        boxShadow: "0 0 0 3px var(--success-soft)",
        flexShrink: 0,
      }} />

      {/* Name */}
      <span style={{ fontSize: "var(--text-sm)", fontWeight: 600, minWidth: 80 }}>
        {entry.routeKey}
      </span>

      {/* Key value */}
      <code
        onClick={() => setShowFull(!showFull)}
        style={{
          flex: 1,
          fontSize: "var(--text-xs)",
          fontFamily: "monospace",
          color: "var(--text-secondary)",
          cursor: "pointer",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title="Click to reveal/hide"
      >
        {showFull ? entry.apiKey : masked}
      </code>

      {/* Actions */}
      <button
        onClick={handleCopy}
        style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "var(--text-xs)", fontWeight: 600, minHeight: "auto", whiteSpace: "nowrap" }}
      >
        {copied ? "✓" : "Copy"}
      </button>
      <button
        onClick={onDelete}
        style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", fontSize: "var(--text-xs)", fontWeight: 600, minHeight: "auto" }}
      >
        Delete
      </button>
    </div>
  );
}
