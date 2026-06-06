/**
 * Model Combos Screen — 9Router-style combo management.
 *
 * Full UX: drag-and-drop reordering, inline editing, model picker from
 * active providers, round-robin toggle, copy/edit/delete actions.
 *
 * Uses the project's CSS design system (--surface, --accent, etc.) instead
 * of Tailwind utility classes.
 */

import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "../components/PageHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { LoadingState } from "../components/LoadingState";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PlusIcon, ConfigIcon } from "../components/icons";
import {
  getModelCombos,
  createModelCombo,
  updateModelCombo,
  deleteModelCombo,
  getProviders,
  getProviderModels,
} from "../api/client";
import type { ModelCombo, ModelComboInput, ProviderSummary } from "../api/types";

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

/**
 * Map provider IDs to short 9Router-style prefixes for model combo display.
 * e.g. "account-kiro" → "kr", "openai" → "openai", "anthropic" → "anthropic"
 *
 * In 9Router: kr=Kiro, cc=Claude Code, cx=Codex, glm=GLM, oc=OpenCode, etc.
 * We mirror that mapping and fall back to a shortened provider id.
 */
const PROVIDER_SHORT_PREFIXES: Record<string, string> = {
  "account-kiro": "kr",
  "kiro-ide": "kr",
  "kiro-free": "kr",
  "account-openai-codex": "cx",
  "openai-codex": "cx",
  "codex": "cx",
  "openai": "openai",
  "anthropic": "anthropic",
  "claude-code": "cc",
  "deepseek": "deepseek",
  "groq": "groq",
  "google-gemini": "gemini",
  "gemini": "gemini",
  "mistral": "mistral",
  "openrouter": "or",
  "together-ai": "together",
  "together": "together",
};

function providerShortPrefix(provider: ProviderSummary): string {
  // Direct match
  const direct = PROVIDER_SHORT_PREFIXES[provider.id];
  if (direct) return direct;

  // Try matching by name (lowercase)
  const nameKey = provider.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const byName = PROVIDER_SHORT_PREFIXES[nameKey];
  if (byName) return byName;

  // Check if provider id starts with a known prefix
  for (const [key, prefix] of Object.entries(PROVIDER_SHORT_PREFIXES)) {
    if (provider.id.startsWith(key)) return prefix;
  }

  // Fallback: use provider id shortened (remove "account-" prefix if present)
  return provider.id.replace(/^account-/, "");
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export function ModelCombosScreen() {
  const [combos, setCombos] = useState<ModelCombo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingCombo, setEditingCombo] = useState<ModelCombo | null>(null);
  const [deletingCombo, setDeletingCombo] = useState<ModelCombo | null>(null);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [combosData, providersData] = await Promise.all([
        getModelCombos(),
        getProviders(),
      ]);
      setCombos(combosData.combos || []);
      setProviders(providersData.providerOptions || providersData.providers || []);
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async (input: ModelComboInput) => {
    await createModelCombo(input);
    setShowCreate(false);
    await fetchData();
  };

  const handleUpdate = async (id: string, input: Partial<ModelComboInput>) => {
    await updateModelCombo(id, input);
    setEditingCombo(null);
    await fetchData();
  };

  const handleDelete = async () => {
    if (!deletingCombo) return;
    await deleteModelCombo(deletingCombo.id);
    setDeletingCombo(null);
    await fetchData();
  };

  const handleToggleRoundRobin = async (combo: ModelCombo) => {
    await updateModelCombo(combo.id, { roundRobin: !combo.roundRobin });
    await fetchData();
  };

  if (loading) {
    return <LoadingState title="Loading combos" description="Fetching model combinations..." cards={2} />;
  }

  return (
    <div className="screen-stack">
      <PageHeader
        title="Combos"
        description="Create model combos with fallback support — use the combo name as your model to auto-route through providers in order."
        actions={
          <button className="button-primary" onClick={() => setShowCreate(true)}>
            <PlusIcon style={{ width: 16, height: 16 }} />
            Create Combo
          </button>
        }
      />

      {combos.length === 0 ? (
        <SurfaceCard>
          <div style={{ textAlign: "center", padding: "var(--space-8) var(--space-4)" }}>
            <div className="stat-card-icon" style={{ margin: "0 auto var(--space-4)", width: 56, height: 56, borderRadius: 18 }}>
              <ConfigIcon style={{ width: 28, height: 28 }} />
            </div>
            <p style={{ margin: "0 0 var(--space-1)", fontWeight: 600, fontSize: "var(--text-base)" }}>No combos yet</p>
            <p style={{ margin: "0 0 var(--space-4)", color: "var(--text-secondary)", fontSize: "var(--text-sm)" }}>Create model combos with fallback support</p>
            <button className="button-primary" onClick={() => setShowCreate(true)}>
              <PlusIcon style={{ width: 16, height: 16 }} />
              Create Combo
            </button>
          </div>
        </SurfaceCard>
      ) : (
        <div className="screen-stack" style={{ gap: "var(--space-4)" }}>
          {combos.map((combo) => (
            <ComboCard
              key={combo.id}
              combo={combo}
              onEdit={() => setEditingCombo(combo)}
              onDelete={() => setDeletingCombo(combo)}
              onToggleRoundRobin={() => handleToggleRoundRobin(combo)}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <ComboFormModal
          key="create"
          providers={providers}
          onSave={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}

      {editingCombo && (
        <ComboFormModal
          key={editingCombo.id}
          combo={editingCombo}
          providers={providers}
          onSave={(input) => handleUpdate(editingCombo.id, input)}
          onClose={() => setEditingCombo(null)}
        />
      )}

      {deletingCombo && (
        <ConfirmDialog
          title="Delete Combo"
          description={`Delete "${deletingCombo.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setDeletingCombo(null)}
        />
      )}
    </div>
  );
}


// ─── Combo Card ──────────────────────────────────────────────────────────────

function ComboCard({
  combo,
  onEdit,
  onDelete,
  onToggleRoundRobin,
}: {
  combo: ModelCombo;
  onEdit: () => void;
  onDelete: () => void;
  onToggleRoundRobin: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(combo.name).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="surface-card" style={{ padding: "var(--space-4) var(--space-5)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", flexWrap: "wrap" }}>
        {/* Left: icon + name + models */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flex: "1 1 auto", minWidth: 0 }}>
          <div className="stat-card-icon" style={{ width: 36, height: 36, borderRadius: 12, flexShrink: 0 }}>
            <ConfigIcon style={{ width: 18, height: 18 }} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <code style={{ display: "block", fontWeight: 600, fontSize: "var(--text-sm)", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {combo.name}
            </code>
            <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
              {combo.models.length === 0 ? (
                <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", fontStyle: "italic" }}>No models</span>
              ) : (
                <>
                  {combo.models.slice(0, 3).map((model, i) => (
                    <code key={i} className="metadata-pill" style={{ fontSize: "0.65rem", padding: "2px 8px", minHeight: "auto", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {model}
                    </code>
                  ))}
                  {combo.models.length > 3 && (
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>+{combo.models.length - 3} more</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: toggle + actions */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", flexShrink: 0 }}>
          {/* Round Robin toggle */}
          <label style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", cursor: "pointer", userSelect: "none" }}>
            <span style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "var(--text-muted)" }}>Round Robin</span>
            <button
              type="button"
              role="switch"
              aria-checked={combo.roundRobin}
              onClick={onToggleRoundRobin}
              style={{
                position: "relative",
                display: "inline-flex",
                width: 36,
                height: 20,
                borderRadius: "var(--radius-pill)",
                border: "none",
                background: combo.roundRobin ? "var(--accent)" : "var(--neutral-soft)",
                cursor: "pointer",
                transition: "background var(--animation-normal) var(--animation-easing)",
                padding: 0,
              }}
            >
              <span style={{
                position: "absolute",
                top: 2,
                left: combo.roundRobin ? 18 : 2,
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "#fff",
                boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                transition: "left var(--animation-normal) var(--animation-easing)",
              }} />
            </button>
          </label>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: "var(--space-1)" }}>
            <button className="button-link row-action-button" onClick={handleCopy} title="Copy combo name" style={{ minWidth: "auto" }}>
              {copied ? "✓" : "Copy"}
            </button>
            <button className="button-link row-action-button" onClick={onEdit} title="Edit">
              Edit
            </button>
            <button className="button-danger row-action-button" onClick={onDelete} title="Delete">
              Delete
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Draggable Model Item ────────────────────────────────────────────────────

function ModelItem({
  index,
  model,
  isFirst,
  isLast,
  onEdit,
  onMoveUp,
  onMoveDown,
  onRemove,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragging,
}: {
  index: number;
  model: string;
  isFirst: boolean;
  isLast: boolean;
  onEdit: (newVal: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragEnd: () => void;
  isDragging: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(model);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== model) onEdit(trimmed);
    else setDraft(model);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") { setDraft(model); setEditing(false); }
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }}
      onDragEnd={onDragEnd}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "6px var(--space-3)",
        borderRadius: "var(--radius-sm)",
        background: isDragging ? "var(--accent-soft)" : "var(--surface-muted)",
        border: `1px solid ${isDragging ? "var(--accent)" : "var(--line)"}`,
        opacity: isDragging ? 0.6 : 1,
        transition: "background var(--animation-fast), border-color var(--animation-fast)",
      }}
    >
      {/* Drag handle */}
      <span style={{ cursor: "grab", color: "var(--text-muted)", flexShrink: 0, display: "flex" }} title="Drag to reorder">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="4" r="2"/><circle cx="15" cy="4" r="2"/>
          <circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/>
          <circle cx="9" cy="20" r="2"/><circle cx="15" cy="20" r="2"/>
        </svg>
      </span>

      {/* Index */}
      <span style={{ width: 16, textAlign: "center", fontSize: "var(--text-xs)", fontWeight: 700, color: "var(--text-muted)", flexShrink: 0 }}>{index + 1}</span>

      {/* Model value (editable) */}
      {editing ? (
        <input
          type="text"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          style={{
            flex: 1,
            minWidth: 0,
            padding: "2px 8px",
            border: "1px solid var(--accent)",
            borderRadius: "var(--radius-sm)",
            background: "var(--control-bg)",
            fontFamily: "monospace",
            fontSize: "var(--text-xs)",
            minHeight: "auto",
            outline: "none",
          }}
        />
      ) : (
        <code
          onClick={() => setEditing(true)}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: "var(--text-xs)",
            cursor: "text",
            padding: "2px 8px",
            borderRadius: "var(--radius-sm)",
          }}
          title="Click to edit"
        >
          {model}
        </code>
      )}

      {/* Priority arrows */}
      <button
        onClick={onMoveUp}
        disabled={isFirst}
        style={{ background: "none", border: "none", padding: 2, cursor: isFirst ? "not-allowed" : "pointer", color: isFirst ? "var(--line-strong)" : "var(--text-muted)", display: "flex", minHeight: "auto" }}
        title="Move up"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 14l5-5 5 5z"/></svg>
      </button>
      <button
        onClick={onMoveDown}
        disabled={isLast}
        style={{ background: "none", border: "none", padding: 2, cursor: isLast ? "not-allowed" : "pointer", color: isLast ? "var(--line-strong)" : "var(--text-muted)", display: "flex", minHeight: "auto" }}
        title="Move down"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
      </button>

      {/* Remove */}
      <button
        onClick={onRemove}
        style={{ background: "none", border: "none", padding: 2, cursor: "pointer", color: "var(--danger)", display: "flex", minHeight: "auto" }}
        title="Remove"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    </div>
  );
}

// ─── Model Select Modal ──────────────────────────────────────────────────────

function ModelSelectModal({
  isOpen,
  providers,
  addedModels,
  onSelect,
  onDeselect,
  onClose,
}: {
  isOpen: boolean;
  providers: ProviderSummary[];
  addedModels: string[];
  onSelect: (model: string) => void;
  onDeselect: (model: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoadingModels(true);
    const fetchAllModels = async () => {
      const results: Record<string, string[]> = {};
      for (const provider of providers) {
        try {
          const data = await getProviderModels(provider.id);
          if (!cancelled && data.models) {
            const prefix = providerShortPrefix(provider);
            // Deduplicate: produce only "prefix/model" form.
            // API may return both "claude-sonnet-4.5" and "kr/claude-sonnet-4.5".
            // We normalize all to "prefix/model" and deduplicate.
            const seen = new Set<string>();
            const normalized: string[] = [];
            for (const m of data.models) {
              // If model already has a slash prefix, use it as-is
              // (it's already in "prefix/model" form like "kr/claude-sonnet-4.5")
              let canonical: string;
              if (m.includes("/")) {
                canonical = m;
              } else {
                canonical = `${prefix}/${m}`;
              }
              if (!seen.has(canonical)) {
                seen.add(canonical);
                normalized.push(canonical);
              }
            }
            results[provider.id] = normalized;
          }
        } catch { /* skip */ }
      }
      if (!cancelled) { setProviderModels(results); setLoadingModels(false); }
    };
    fetchAllModels();
    return () => { cancelled = true; };
  }, [isOpen, providers]);

  if (!isOpen) return null;

  const allModels: { providerId: string; providerName: string; model: string }[] = [];
  for (const provider of providers) {
    for (const model of (providerModels[provider.id] || [])) {
      allModels.push({ providerId: provider.id, providerName: provider.name, model });
    }
  }

  const filtered = search.trim()
    ? allModels.filter((m) => m.model.toLowerCase().includes(search.toLowerCase()) || m.providerName.toLowerCase().includes(search.toLowerCase()))
    : allModels;

  const grouped: Record<string, { providerName: string; models: string[] }> = {};
  for (const item of filtered) {
    if (!grouped[item.providerId]) grouped[item.providerId] = { providerName: item.providerName, models: [] };
    grouped[item.providerId].models.push(item.model);
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Model Picker</p>
            <h2>Add Model to Combo</h2>
          </div>
        </div>

        <div style={{ padding: "0 var(--space-5) var(--space-3)" }}>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search models..."
            autoFocus
            style={{ minHeight: 40 }}
          />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "0 var(--space-5)" }}>
          {loadingModels ? (
            <p style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>Loading models from providers...</p>
          ) : Object.keys(grouped).length === 0 ? (
            <p style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
              {search ? "No models match your search" : "No models available. Connect providers first."}
            </p>
          ) : (
            <div style={{ display: "grid", gap: "var(--space-4)" }}>
              {Object.entries(grouped).map(([providerId, { providerName, models }]) => (
                <div key={providerId}>
                  <p style={{ margin: "0 0 var(--space-2)", fontSize: "var(--text-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" }}>{providerName}</p>
                  <div style={{ display: "grid", gap: 2 }}>
                    {models.map((model) => {
                      const isAdded = addedModels.includes(model);
                      return (
                        <button
                          key={model}
                          onClick={() => isAdded ? onDeselect(model) : onSelect(model)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--space-2)",
                            padding: "6px var(--space-3)",
                            borderRadius: "var(--radius-sm)",
                            border: "1px solid transparent",
                            background: isAdded ? "var(--accent-soft)" : "transparent",
                            color: isAdded ? "var(--accent-strong)" : "var(--text-primary)",
                            fontFamily: "monospace",
                            fontSize: "var(--text-xs)",
                            cursor: "pointer",
                            textAlign: "left",
                            minHeight: "auto",
                            width: "100%",
                            transition: "background var(--animation-fast)",
                          }}
                        >
                          <span style={{
                            width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            border: isAdded ? "none" : "1.5px solid var(--line-strong)",
                            background: isAdded ? "var(--accent)" : "transparent",
                            color: "#fff",
                          }}>
                            {isAdded && <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
                          </span>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-actions" style={{ padding: "var(--space-4) var(--space-5)" }}>
          <button className="button-link" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ─── Combo Form Modal ────────────────────────────────────────────────────────

function ComboFormModal({
  combo,
  providers,
  onSave,
  onClose,
}: {
  combo?: ModelCombo;
  providers: ProviderSummary[];
  onSave: (input: ModelComboInput) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(combo?.name || "");
  const [models, setModels] = useState<string[]>(combo?.models || []);
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const isEdit = !!combo;

  const validateName = (value: string): boolean => {
    if (!value.trim()) { setNameError("Name is required"); return false; }
    if (!VALID_NAME_REGEX.test(value)) { setNameError("Only letters, numbers, -, _ and . allowed"); return false; }
    setNameError("");
    return true;
  };

  const handleAddModel = (model: string) => {
    if (!models.includes(model)) setModels([...models, model]);
  };
  const handleDeselectModel = (model: string) => {
    setModels(models.filter((m) => m !== model));
  };
  const handleRemoveModel = (index: number) => setModels(models.filter((_, i) => i !== index));
  const handleEditModel = (index: number, newVal: string) => { const u = [...models]; u[index] = newVal; setModels(u); };
  const handleMoveUp = (index: number) => { if (index === 0) return; const n = [...models]; [n[index-1], n[index]] = [n[index], n[index-1]]; setModels(n); };
  const handleMoveDown = (index: number) => { if (index === models.length-1) return; const n = [...models]; [n[index], n[index+1]] = [n[index+1], n[index]]; setModels(n); };

  const handleDragStart = (index: number) => setDragIndex(index);
  const handleDragOver = (index: number) => {
    if (dragIndex === null || dragIndex === index) return;
    const n = [...models]; const [d] = n.splice(dragIndex, 1); n.splice(index, 0, d); setModels(n); setDragIndex(index);
  };
  const handleDragEnd = () => setDragIndex(null);

  const handleSave = async () => {
    if (!validateName(name)) return;
    setSaving(true);
    try { await onSave({ name: name.trim(), models }); }
    catch (error: any) { setNameError(error?.message || "Failed to save"); }
    finally { setSaving(false); }
  };

  return (
    <>
      <div className="modal-backdrop" role="presentation" onClick={onClose}>
        <div className="modal-card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
          <div className="modal-header">
            <div>
              <p className="eyebrow">{isEdit ? "Edit" : "New"}</p>
              <h2>{isEdit ? "Edit Combo" : "Create Combo"}</h2>
            </div>
          </div>

          {/* Name field */}
          <div style={{ padding: "0 var(--space-5)", marginBottom: "var(--space-4)" }}>
            <div className="form-field">
              <label className="field-label">Combo Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); if (e.target.value) validateName(e.target.value); else setNameError(""); }}
                placeholder="my-combo"
                style={{ fontFamily: "monospace" }}
              />
              {nameError && <p style={{ margin: 0, color: "var(--danger)", fontSize: "var(--text-xs)" }}>{nameError}</p>}
              <p className="field-help">Only letters, numbers, -, _ and . allowed</p>
            </div>
          </div>

          {/* Models list */}
          <div style={{ flex: 1, overflow: "hidden", padding: "0 var(--space-5)", display: "flex", flexDirection: "column" }}>
            <label className="field-label" style={{ marginBottom: "var(--space-2)" }}>Models (fallback order)</label>

            {models.length === 0 ? (
              <div style={{ textAlign: "center", padding: "var(--space-5)", border: "1.5px dashed var(--line-strong)", borderRadius: "var(--radius-md)", background: "var(--surface-muted)" }}>
                <ConfigIcon style={{ width: 20, height: 20, color: "var(--text-muted)", margin: "0 auto var(--space-2)" }} />
                <p style={{ margin: 0, fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>No models added yet</p>
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: "auto", display: "grid", gap: 4, maxHeight: 320 }}>
                {models.map((model, index) => (
                  <ModelItem
                    key={`${index}-${model}`}
                    index={index}
                    model={model}
                    isFirst={index === 0}
                    isLast={index === models.length - 1}
                    onEdit={(v) => handleEditModel(index, v)}
                    onMoveUp={() => handleMoveUp(index)}
                    onMoveDown={() => handleMoveDown(index)}
                    onRemove={() => handleRemoveModel(index)}
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={() => handleDragOver(index)}
                    onDragEnd={handleDragEnd}
                    isDragging={dragIndex === index}
                  />
                ))}
              </div>
            )}

            {/* Add Model button */}
            <button
              onClick={() => setShowModelSelect(true)}
              style={{
                marginTop: "var(--space-3)",
                width: "100%",
                padding: "var(--space-3)",
                border: "1.5px dashed var(--line-strong)",
                borderRadius: "var(--radius-md)",
                background: "transparent",
                color: "var(--accent)",
                fontSize: "var(--text-xs)",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "var(--space-2)",
                minHeight: "auto",
                transition: "border-color var(--animation-fast), background var(--animation-fast)",
              }}
            >
              <PlusIcon style={{ width: 14, height: 14 }} />
              Add Model
            </button>
          </div>

          {/* Actions */}
          <div className="modal-actions" style={{ padding: "var(--space-4) var(--space-5)" }}>
            <button className="button-link" onClick={onClose}>Cancel</button>
            <button
              className="button-primary"
              onClick={handleSave}
              disabled={!name.trim() || !!nameError || saving}
            >
              {saving ? "Saving..." : isEdit ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </div>

      <ModelSelectModal
        isOpen={showModelSelect}
        providers={providers}
        addedModels={models}
        onSelect={handleAddModel}
        onDeselect={handleDeselectModel}
        onClose={() => setShowModelSelect(false)}
      />
    </>
  );
}
