import type { FormEvent } from "react";
import { useState } from "react";
import type { ProviderSummary, ClientTokenWindowType } from "../api/types";
import { InlineAlert } from "./InlineAlert";

export type ClientFormData = {
  client: string;
  providerId: string;
  model: string;
  apiKeysText: string;
  tokenLimitEnabled: boolean;
  tokenLimitValue: string;
  tokenLimitWindowType: ClientTokenWindowType;
  tokenLimitWindowSizeSeconds: string;
  tokenLimitHardBlock: boolean;
};

export type ClientFormSubmitValue = {
  client: string;
  providerId?: string;
  model?: string;
  apiKeys: string[];
  tokenLimit: {
    enabled: boolean;
    tokenLimit: number;
    windowType: ClientTokenWindowType;
    windowSizeSeconds?: number;
    hardBlock: boolean;
  };
};

type ClientFormProps = {
  mode: "create" | "edit";
  initialData?: Partial<ClientFormData>;
  providerOptions: ProviderSummary[];
  onSubmit: (value: ClientFormSubmitValue) => void;
  onCancel: () => void;
  isSubmitting: boolean;
  error?: string | null;
};

function normalizeApiKeys(raw: string): string[] {
  return raw
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function ClientForm({
  mode,
  initialData,
  providerOptions,
  onSubmit,
  onCancel,
  isSubmitting,
  error,
}: ClientFormProps) {
  const [form, setForm] = useState<ClientFormData>({
    client: initialData?.client ?? "",
    providerId: initialData?.providerId ?? "",
    model: initialData?.model ?? "",
    apiKeysText: initialData?.apiKeysText ?? "",
    tokenLimitEnabled: initialData?.tokenLimitEnabled ?? false,
    tokenLimitValue: initialData?.tokenLimitValue ?? "",
    tokenLimitWindowType: initialData?.tokenLimitWindowType ?? "monthly",
    tokenLimitWindowSizeSeconds: initialData?.tokenLimitWindowSizeSeconds ?? "",
    tokenLimitHardBlock: initialData?.tokenLimitHardBlock ?? true,
  });
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    const client = form.client.trim();
    const providerId = form.providerId.trim();
    const model = form.model.trim();
    const apiKeys = normalizeApiKeys(form.apiKeysText);
    const tokenLimitValue = form.tokenLimitValue.trim();
    const windowSizeValue = form.tokenLimitWindowSizeSeconds.trim();

    if (!client) {
      setLocalError("Client key is required.");
      return;
    }

    if (client !== "default" && apiKeys.length === 0) {
      setLocalError("At least one client API key is required for non-default routes.");
      return;
    }

    if (form.tokenLimitEnabled) {
      if (!/^\d+$/.test(tokenLimitValue) || Number(tokenLimitValue) <= 0) {
        setLocalError("Token limit must be a positive integer.");
        return;
      }
      if (
        form.tokenLimitWindowType === "fixed" &&
        (!/^\d+$/.test(windowSizeValue) || Number(windowSizeValue) <= 0)
      ) {
        setLocalError("Fixed window seconds must be a positive integer.");
        return;
      }
    }

    onSubmit({
      client,
      providerId: providerId || undefined,
      model: model || undefined,
      apiKeys,
      tokenLimit: {
        enabled: form.tokenLimitEnabled,
        tokenLimit: form.tokenLimitEnabled ? Number(tokenLimitValue) : 1,
        windowType: form.tokenLimitWindowType,
        windowSizeSeconds:
          form.tokenLimitEnabled && form.tokenLimitWindowType === "fixed"
            ? Number(windowSizeValue)
            : undefined,
        hardBlock: form.tokenLimitHardBlock,
      },
    });
  }

  return (
    <form className="provider-form" onSubmit={handleSubmit}>
      <div className="modal-header">
        <div>
          <p className="eyebrow">{mode === "create" ? "Create client" : "Edit client"}</p>
          <h2>{mode === "create" ? "New client route" : "Update client route"}</h2>
        </div>
      </div>

      <p className="modal-copy">
        Manage client API keys, provider binding, model overrides, and token guardrails from one form.
      </p>

      {localError || error ? (
        <InlineAlert
          message={localError ?? error ?? ""}
          title="Could not save client"
          variant="error"
        />
      ) : null}

      <div className="client-form-grid">
        <label className="form-field">
          <span className="field-label">Client key</span>
          <input
            className="search-input"
            disabled={mode === "edit" || isSubmitting}
            onChange={(event) => setForm((current) => ({ ...current, client: event.target.value }))}
            required
            type="text"
            value={form.client}
          />
        </label>

        <label className="form-field">
          <span className="field-label">Provider binding</span>
          <select
            className="search-input"
            disabled={isSubmitting}
            onChange={(event) => setForm((current) => ({ ...current, providerId: event.target.value }))}
            value={form.providerId}
          >
            <option value="">Use current active/default provider</option>
            {providerOptions.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="form-field">
        <span className="field-label">Model override</span>
        <input
          className="search-input"
          disabled={isSubmitting}
          onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
          placeholder="Optional model override"
          type="text"
          value={form.model}
        />
      </label>

      <label className="form-field">
        <span className="field-label">Client API keys</span>
        <textarea
          className="search-input form-textarea"
          disabled={isSubmitting}
          onChange={(event) => setForm((current) => ({ ...current, apiKeysText: event.target.value }))}
          placeholder="One client API key per line"
          rows={5}
          value={form.apiKeysText}
        />
        <span className="field-help">
          API keys are only visible while editing this form and are never shown elsewhere in the UI.
        </span>
      </label>

      <div className="provider-detail-section">
        <div className="client-form-grid">
          <label className="form-field form-checkbox">
            <input
              checked={form.tokenLimitEnabled}
              disabled={isSubmitting}
              onChange={(event) =>
                setForm((current) => ({ ...current, tokenLimitEnabled: event.target.checked }))
              }
              type="checkbox"
            />
            <span>Enable token budget</span>
          </label>

          <label className="form-field">
            <span className="field-label">Token limit</span>
            <input
              className="search-input"
              disabled={isSubmitting}
              onChange={(event) => setForm((current) => ({ ...current, tokenLimitValue: event.target.value }))}
              placeholder="100000"
              type="number"
              value={form.tokenLimitValue}
            />
          </label>
        </div>

        <div className="client-form-grid">
          <label className="form-field">
            <span className="field-label">Window type</span>
            <select
              className="search-input"
              disabled={isSubmitting}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  tokenLimitWindowType: event.target.value as ClientTokenWindowType,
                }))
              }
              value={form.tokenLimitWindowType}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="fixed">Fixed</option>
            </select>
          </label>

          <label className="form-field">
            <span className="field-label">Fixed window seconds</span>
            <input
              className="search-input"
              disabled={isSubmitting}
              onChange={(event) =>
                setForm((current) => ({ ...current, tokenLimitWindowSizeSeconds: event.target.value }))
              }
              placeholder="86400"
              type="number"
              value={form.tokenLimitWindowSizeSeconds}
            />
          </label>
        </div>

        <label className="form-field form-checkbox">
          <input
            checked={form.tokenLimitHardBlock}
            disabled={isSubmitting}
            onChange={(event) =>
              setForm((current) => ({ ...current, tokenLimitHardBlock: event.target.checked }))
            }
            type="checkbox"
          />
          <span>Hard block when limit is reached</span>
        </label>
      </div>

      <div className="modal-actions">
        <button className="button-link" disabled={isSubmitting} onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="button-link button-primary" disabled={isSubmitting} type="submit">
          {isSubmitting ? (mode === "create" ? "Creating..." : "Saving...") : mode === "create" ? "Create client" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
