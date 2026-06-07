/**
 * Shared Model Picker Modal — used by CLI Tools and MITM screens.
 *
 * Lists model combos (optional) + provider models grouped by provider, with
 * search. Emits a structured selection so callers can decide how to store it.
 */

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { getProviderModels, getModelCombos } from "../api/client";
import type { ProviderSummary, ModelCombo } from "../api/types";

export const COMBO_PROVIDER = "__combo__";

// ─── Provider short-prefix mapping (mirrors ModelCombosScreen) ───────────────

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

export function providerShortPrefix(provider: ProviderSummary): string {
  const direct = PROVIDER_SHORT_PREFIXES[provider.id];
  if (direct) return direct;
  const nameKey = provider.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const byName = PROVIDER_SHORT_PREFIXES[nameKey];
  if (byName) return byName;
  for (const [key, prefix] of Object.entries(PROVIDER_SHORT_PREFIXES)) {
    if (provider.id.startsWith(key)) return prefix;
  }
  return provider.id.replace(/^account-/, "");
}

export type ModelPickerSelection =
  | { kind: "model"; providerId: string; model: string }
  | { kind: "combo"; combo: ModelCombo };

export function ModelPickerModal({
  providers,
  combos,
  includeCombos = true,
  selectedModel = null,
  selectedComboId = null,
  title = "Select Model",
  onSelect,
  onClose,
}: {
  providers: ProviderSummary[];
  combos?: ModelCombo[];
  includeCombos?: boolean;
  /** Highlight a provider model (the "prefix/model" string). */
  selectedModel?: string | null;
  /** Highlight a combo by id. */
  selectedComboId?: string | null;
  title?: string;
  onSelect: (selection: ModelPickerSelection) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({});
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadedCombos, setLoadedCombos] = useState<ModelCombo[]>(combos || []);

  useEffect(() => {
    if (combos) return; // provided by caller
    if (!includeCombos) return;
    let cancelled = false;
    getModelCombos()
      .then((data) => { if (!cancelled) setLoadedCombos(data.combos || []); })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [combos, includeCombos]);

  useEffect(() => {
    if (combos) setLoadedCombos(combos);
  }, [combos]);

  useEffect(() => {
    let cancelled = false;
    setLoadingModels(true);
    const fetchAll = async () => {
      const results: Record<string, string[]> = {};
      for (const provider of providers) {
        try {
          const data = await getProviderModels(provider.id);
          if (!cancelled && data.models) {
            const prefix = providerShortPrefix(provider);
            const seen = new Set<string>();
            const normalized: string[] = [];
            for (const m of data.models) {
              const canonical = m.includes("/") ? m : `${prefix}/${m}`;
              if (!seen.has(canonical)) { seen.add(canonical); normalized.push(canonical); }
            }
            results[provider.id] = normalized;
          }
        } catch { /* skip */ }
      }
      if (!cancelled) { setProviderModels(results); setLoadingModels(false); }
    };
    fetchAll();
    return () => { cancelled = true; };
  }, [providers]);

  const allModels: { providerId: string; providerName: string; model: string }[] = [];
  for (const provider of providers) {
    for (const model of (providerModels[provider.id] || [])) {
      allModels.push({ providerId: provider.id, providerName: provider.name, model });
    }
  }

  const term = search.trim().toLowerCase();
  const filtered = term
    ? allModels.filter((m) => m.model.toLowerCase().includes(term) || m.providerName.toLowerCase().includes(term))
    : allModels;

  const filteredCombos = (includeCombos ? loadedCombos : []).filter((c) =>
    !term ? true : c.name.toLowerCase().includes(term),
  );

  const grouped: Record<string, { providerName: string; models: string[] }> = {};
  for (const item of filtered) {
    if (!grouped[item.providerId]) grouped[item.providerId] = { providerName: item.providerName, models: [] };
    grouped[item.providerId].models.push(item.model);
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 520, maxHeight: "80vh", display: "flex", flexDirection: "column" }}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Model Picker</p>
            <h2>{title}</h2>
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
          {/* Combos */}
          {filteredCombos.length > 0 && (
            <div style={{ marginBottom: "var(--space-4)" }}>
              <p style={{ margin: "0 0 var(--space-2)", fontSize: "var(--text-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--accent-strong)" }}>
                ⚡ Model Combos
              </p>
              <div style={{ display: "grid", gap: 2 }}>
                {filteredCombos.map((combo) => {
                  const isSelected = selectedComboId === combo.id;
                  return (
                    <PickerRow
                      key={combo.id}
                      selected={isSelected}
                      onClick={() => onSelect({ kind: "combo", combo })}
                      label={<span style={{ fontWeight: 600 }}>{combo.name}</span>}
                      meta={`${combo.models.length} model${combo.models.length === 1 ? "" : "s"}${combo.roundRobin ? " · RR" : ""}`}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {loadingModels ? (
            <p style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>Loading models from providers...</p>
          ) : Object.keys(grouped).length === 0 && filteredCombos.length === 0 ? (
            <p style={{ textAlign: "center", padding: "var(--space-6)", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
              {search ? "No models match your search" : "No models available. Connect providers first."}
            </p>
          ) : (
            <div style={{ display: "grid", gap: "var(--space-4)" }}>
              {Object.entries(grouped).map(([providerId, { providerName, models }]) => (
                <div key={providerId}>
                  <p style={{ margin: "0 0 var(--space-2)", fontSize: "var(--text-xs)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-muted)" }}>{providerName}</p>
                  <div style={{ display: "grid", gap: 2 }}>
                    {models.map((model) => (
                      <PickerRow
                        key={model}
                        selected={selectedModel === model}
                        onClick={() => onSelect({ kind: "model", providerId, model })}
                        label={<span style={{ fontFamily: "monospace" }}>{model}</span>}
                      />
                    ))}
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
    </div>,
    document.body,
  );
}

function PickerRow({
  selected,
  onClick,
  label,
  meta,
}: {
  selected: boolean;
  onClick: () => void;
  label: React.ReactNode;
  meta?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "6px var(--space-3)",
        borderRadius: "var(--radius-sm)",
        border: "1px solid transparent",
        background: selected ? "var(--accent-soft)" : "transparent",
        color: selected ? "var(--accent-strong)" : "var(--text-primary)",
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
        border: selected ? "none" : "1.5px solid var(--line-strong)",
        background: selected ? "var(--accent)" : "transparent",
        color: "#fff",
      }}>
        {selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>}
      </span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{label}</span>
      {meta && <span style={{ fontFamily: "monospace", fontSize: "0.6rem", color: "var(--text-muted)" }}>{meta}</span>}
    </button>
  );
}
