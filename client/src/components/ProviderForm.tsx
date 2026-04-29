import { useMemo, useState } from "react";
import { InlineAlert } from "./InlineAlert";

export type ProviderFormData = {
  name: string;
  baseUrl: string;
  authMode: "api_key" | "chatgpt_oauth";
  chatgptAccountId: string;
  providerApiKeysText: string;
};

type ProviderFormSubmitValue = {
  name: string;
  baseUrl: string;
  authMode: "api_key" | "chatgpt_oauth";
  chatgptAccountId?: string;
  providerApiKeys?: string[];
  replaceKeys: boolean;
};

type ProviderFormProps = {
  mode: "create" | "edit";
  initialData?: Partial<ProviderFormData>;
  onSubmit: (value: ProviderFormSubmitValue) => Promise<void> | void;
  onCancel: () => void;
};

function normalizeApiKeysInput(raw: string): string[] {
  return raw
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function ProviderForm({ mode, initialData, onSubmit, onCancel }: ProviderFormProps) {
  const [form, setForm] = useState<ProviderFormData>({
    name: initialData?.name ?? "",
    baseUrl: initialData?.baseUrl ?? "",
    authMode: initialData?.authMode === "chatgpt_oauth" ? "chatgpt_oauth" : "api_key",
    chatgptAccountId: initialData?.chatgptAccountId ?? "",
    providerApiKeysText: initialData?.providerApiKeysText ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const keyReplacementHint = useMemo(
    () =>
      mode === "edit"
        ? "Leave blank to keep the currently configured keys, or enter new keys to replace them."
        : "Optional. Enter one provider API key per line.",
    [mode],
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const name = form.name.trim();
    const baseUrl = form.baseUrl.trim();
    const chatgptAccountId = form.chatgptAccountId.trim();
    const providerApiKeys = normalizeApiKeysInput(form.providerApiKeysText);
    const replaceKeys = form.providerApiKeysText.trim().length > 0;

    if (!name) {
      setError("Name is required.");
      return;
    }

    if (!baseUrl) {
      setError("Base URL is required.");
      return;
    }

    try {
      new URL(baseUrl);
    } catch {
      setError("Base URL must be a valid URL.");
      return;
    }

    if (form.authMode === "chatgpt_oauth" && !chatgptAccountId) {
      setError("Account ID is required for ChatGPT OAuth providers.");
      return;
    }

    if (form.authMode === "api_key" && mode === "create" && providerApiKeys.length === 0) {
      setError("At least one provider API key is recommended for API key providers.");
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        name,
        baseUrl,
        authMode: form.authMode,
        chatgptAccountId: chatgptAccountId || undefined,
        providerApiKeys,
        replaceKeys,
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not save provider.");
      setIsSubmitting(false);
      return;
    }
    setIsSubmitting(false);
  }

  return (
    <form className="provider-form" onSubmit={handleSubmit}>
      <div className="modal-header">
        <div>
          <p className="eyebrow">{mode === "create" ? "Create provider" : "Edit provider"}</p>
          <h2>{mode === "create" ? "New provider" : "Update provider"}</h2>
        </div>
      </div>

      <p className="modal-copy">
        {mode === "create"
          ? "Create a runtime provider with routing metadata, auth mode, and upstream credentials."
          : "Update provider metadata, account binding, and credentials without exposing existing keys."}
      </p>

      {error ? <InlineAlert message={error} title="Could not save provider" variant="error" /> : null}

      <label className="form-field">
        <span className="field-label">Name</span>
        <input
          className="search-input"
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          required
          type="text"
          value={form.name}
        />
      </label>

      <label className="form-field">
        <span className="field-label">Base URL</span>
        <input
          className="search-input"
          onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
          placeholder="https://example.com/v1"
          required
          type="url"
          value={form.baseUrl}
        />
      </label>

      <label className="form-field">
        <span className="field-label">Auth mode</span>
        <select
          className="search-input"
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              authMode: event.target.value === "chatgpt_oauth" ? "chatgpt_oauth" : "api_key",
            }))
          }
          value={form.authMode}
        >
          <option value="api_key">API key</option>
          <option value="chatgpt_oauth">ChatGPT OAuth</option>
        </select>
      </label>

      {form.authMode === "chatgpt_oauth" ? (
        <label className="form-field">
          <span className="field-label">Account ID</span>
          <input
            className="search-input"
            onChange={(event) => setForm((current) => ({ ...current, chatgptAccountId: event.target.value }))}
            placeholder="acct_123"
            type="text"
            value={form.chatgptAccountId}
          />
        </label>
      ) : null}

      <label className="form-field">
        <span className="field-label">
          {mode === "create" ? "Provider API keys" : "Replace provider API keys"}
        </span>
        <textarea
          className="search-input form-textarea"
          onChange={(event) => setForm((current) => ({ ...current, providerApiKeysText: event.target.value }))}
          placeholder={mode === "create" ? "sk-provider-..." : "Enter new keys only if you want to replace them"}
          rows={4}
          value={form.providerApiKeysText}
        />
        <span className="field-help">{keyReplacementHint}</span>
      </label>

      <div className="modal-actions">
        <button className="button-link" disabled={isSubmitting} onClick={onCancel} type="button">
          Cancel
        </button>
        <button className="button-link button-primary" disabled={isSubmitting} type="submit">
          {isSubmitting ? (mode === "create" ? "Creating..." : "Saving...") : mode === "create" ? "Create provider" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
