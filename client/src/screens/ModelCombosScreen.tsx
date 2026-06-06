/**
 * Model Combos Screen — 9Router-style simple combo management.
 *
 * A combo is a named ordered list of model strings with sequential fallback.
 * When a request uses a combo name as its model, the proxy tries each model
 * in order until one succeeds.
 */

import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "../components/PageHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { StatusBadge } from "../components/StatusBadge";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PlusIcon, ConfigIcon } from "../components/icons";
import {
  getModelCombos,
  createModelCombo,
  updateModelCombo,
  deleteModelCombo,
} from "../api/client";
import type { ModelCombo, ModelComboInput } from "../api/types";

// ─── Validation ──────────────────────────────────────────────────────────────

const VALID_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

// ─── Main Screen ─────────────────────────────────────────────────────────────

export function ModelCombosScreen() {
  const [combos, setCombos] = useState<ModelCombo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingCombo, setEditingCombo] = useState<ModelCombo | null>(null);
  const [deletingCombo, setDeletingCombo] = useState<ModelCombo | null>(null);

  const fetchCombos = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getModelCombos();
      setCombos(data.combos || []);
    } catch (error) {
      console.error("Failed to fetch model combos:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCombos();
  }, [fetchCombos]);

  const handleCreate = async (input: ModelComboInput) => {
    await createModelCombo(input);
    setShowCreate(false);
    await fetchCombos();
  };

  const handleUpdate = async (id: string, input: Partial<ModelComboInput>) => {
    await updateModelCombo(id, input);
    setEditingCombo(null);
    await fetchCombos();
  };

  const handleDelete = async () => {
    if (!deletingCombo) return;
    await deleteModelCombo(deletingCombo.id);
    setDeletingCombo(null);
    await fetchCombos();
  };

  const handleToggleRoundRobin = async (combo: ModelCombo) => {
    await updateModelCombo(combo.id, { roundRobin: !combo.roundRobin });
    await fetchCombos();
  };

  if (loading) {
    return <LoadingState title="Loading combos" description="Fetching model combinations..." cards={2} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <PageHeader
        title="Model Combos"
        subtitle="Named model lists with sequential fallback — use combo name as model to auto-try each in order"
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 transition-colors"
          >
            <PlusIcon className="h-4 w-4" />
            Create Combo
          </button>
        }
      />

      {combos.length === 0 ? (
        <EmptyState
          title="No model combos yet"
          description="Create a combo to define fallback chains. Use the combo name as your model to auto-route through providers in order."
          actionLabel="Create Combo"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="flex flex-col gap-4">
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

      {/* Create Modal */}
      {showCreate && (
        <ComboFormModal
          onSave={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* Edit Modal */}
      {editingCombo && (
        <ComboFormModal
          combo={editingCombo}
          onSave={(input) => handleUpdate(editingCombo.id, input)}
          onClose={() => setEditingCombo(null)}
        />
      )}

      {/* Delete Confirmation */}
      {deletingCombo && (
        <ConfirmDialog
          title="Delete Combo"
          message={`Delete "${deletingCombo.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={handleDelete}
          onCancel={() => setDeletingCombo(null)}
        />
      )}
    </div>
  );
}


// ─── Combo Card ──────────────────────────────────────────────────────────────

interface ComboCardProps {
  combo: ModelCombo;
  onEdit: () => void;
  onDelete: () => void;
  onToggleRoundRobin: () => void;
}

function ComboCard({ combo, onEdit, onDelete, onToggleRoundRobin }: ComboCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(combo.name).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <SurfaceCard className="group">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: name + models preview */}
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
            <ConfigIcon className="h-4 w-4 text-blue-600" />
          </div>
          <div className="min-w-0 flex-1">
            <code className="block truncate font-mono text-sm font-medium">{combo.name}</code>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
              {combo.models.length === 0 ? (
                <span className="text-xs italic text-gray-400">No models</span>
              ) : (
                <>
                  {combo.models.slice(0, 3).map((model, i) => (
                    <span
                      key={i}
                      className="inline-flex max-w-[220px] truncate rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                    >
                      {i + 1}. {model}
                    </span>
                  ))}
                  {combo.models.length > 3 && (
                    <span className="text-[10px] text-gray-400">
                      +{combo.models.length - 3} more
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3 sm:shrink-0">
          {/* Round Robin toggle */}
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
            <span>Round Robin</span>
            <button
              type="button"
              role="switch"
              aria-checked={combo.roundRobin}
              onClick={onToggleRoundRobin}
              className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                combo.roundRobin ? "bg-blue-600" : "bg-gray-200 dark:bg-gray-700"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  combo.roundRobin ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </label>

          {/* Action buttons */}
          <div className="flex gap-1">
            <button
              onClick={handleCopy}
              className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-800 transition-colors"
              title="Copy combo name"
            >
              {copied ? "✓" : "Copy"}
            </button>
            <button
              onClick={onEdit}
              className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-800 transition-colors"
              title="Edit"
            >
              Edit
            </button>
            <button
              onClick={onDelete}
              className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
              title="Delete"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </SurfaceCard>
  );
}

// ─── Combo Form Modal ────────────────────────────────────────────────────────

interface ComboFormModalProps {
  combo?: ModelCombo;
  onSave: (input: ModelComboInput) => Promise<void>;
  onClose: () => void;
}

function ComboFormModal({ combo, onSave, onClose }: ComboFormModalProps) {
  const [name, setName] = useState(combo?.name || "");
  const [models, setModels] = useState<string[]>(combo?.models || []);
  const [newModel, setNewModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");

  const isEdit = !!combo;

  const validateName = (value: string): boolean => {
    if (!value.trim()) {
      setNameError("Name is required");
      return false;
    }
    if (!VALID_NAME_REGEX.test(value)) {
      setNameError("Only letters, numbers, -, _ and . allowed");
      return false;
    }
    setNameError("");
    return true;
  };

  const handleAddModel = () => {
    const trimmed = newModel.trim();
    if (!trimmed) return;
    if (!models.includes(trimmed)) {
      setModels([...models, trimmed]);
    }
    setNewModel("");
  };

  const handleRemoveModel = (index: number) => {
    setModels(models.filter((_, i) => i !== index));
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const next = [...models];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setModels(next);
  };

  const handleMoveDown = (index: number) => {
    if (index === models.length - 1) return;
    const next = [...models];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setModels(next);
  };

  const handleSave = async () => {
    if (!validateName(name)) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), models });
    } catch (error: any) {
      setNameError(error?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-4">
          {isEdit ? "Edit Combo" : "Create Combo"}
        </h2>

        {/* Name */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">Combo Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); if (e.target.value) validateName(e.target.value); }}
            placeholder="my-combo"
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800"
          />
          {nameError && <p className="mt-1 text-xs text-red-500">{nameError}</p>}
          <p className="mt-0.5 text-[10px] text-gray-400">
            Only letters, numbers, -, _ and . allowed
          </p>
        </div>

        {/* Models list */}
        <div className="mb-4">
          <label className="block text-sm font-medium mb-1">
            Models (fallback order)
          </label>
          {models.length > 0 && (
            <div className="mb-2 flex flex-col gap-1 max-h-[250px] overflow-y-auto">
              {models.map((model, index) => (
                <div
                  key={index}
                  className="flex items-center gap-1.5 rounded-md bg-gray-50 px-2 py-1 dark:bg-gray-800"
                >
                  <span className="w-4 text-center text-[10px] font-medium text-gray-400">
                    {index + 1}
                  </span>
                  <code className="min-w-0 flex-1 truncate text-xs">
                    {model}
                  </code>
                  <button
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0}
                    className="px-1 text-gray-400 hover:text-blue-600 disabled:opacity-20"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => handleMoveDown(index)}
                    disabled={index === models.length - 1}
                    className="px-1 text-gray-400 hover:text-blue-600 disabled:opacity-20"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => handleRemoveModel(index)}
                    className="px-1 text-red-400 hover:text-red-600"
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add model input */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddModel(); } }}
              placeholder="provider/model-name"
              className="flex-1 rounded-lg border border-dashed border-gray-300 bg-white px-3 py-1.5 text-sm font-mono placeholder-gray-400 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800"
            />
            <button
              onClick={handleAddModel}
              disabled={!newModel.trim()}
              className="rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Add
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || !!nameError || saving}
            className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {saving ? "Saving..." : isEdit ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
