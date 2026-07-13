import { useMemo, useState } from "react";
import { InlineAlert } from "./InlineAlert";
import {
  clientApisForTransport,
  normalizeTransportMode,
  type TransportMode,
} from "../features/providers/transportCompat";

export type ProviderFormData = {
  name: string;
  baseUrl: string;
  authMode: "api_key" | "chatgpt_oauth";
  chatgptAccountId: string;
  providerApiKeysText: string;
  transportMode: "responses" | "chat_completions";
};

type ProviderFormSubmitValue = {
  name: string;
  baseUrl: string;
  authMode: "api_key" | "chatgpt_oauth";
  chatgptAccountId?: string;
  providerApiKeys?: string[];
  replaceKeys: boolean;
  transportMode: "responses" | "chat_completions";
};

type ProviderFormProps = {
  mode: "create" | "edit";
  initialData?: Partial<ProviderFormData>;
  onSubmit: (value: ProviderFormSubmitValue) => Promise<void> | void;
  onCancel: () => void;
};

const TRANSPORT_OPTIONS: Array<{
  value: "responses" | "chat_completions";
  title: string;
  hint: string;
  path: string;
}> = [
  {
    value: "responses",
    title: "Responses API",
    hint: "Upstream speaks the OpenAI Responses protocol (Codex-style, GPT-5).",
    path: "POST /responses",
  },
  {
    value: "chat_completions",
    title: "Chat Completions",
    hint: "Upstream speaks the classic OpenAI Chat Completions protocol.",
    path: "POST /chat/completions",
  },
];

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
    transportMode: initialData?.transportMode === "chat_completions" ? "chat_completions" : "responses",
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const keyReplacementHint = useMemo(
    () =>
      mode === "edit"
        ? "Leave blank to keep the currently configured keys, or enter new keys to replace them."
        : "Enter one provider API key per line. Multiple keys are rotated automatically.",
    [mode],
  );

  // Which client APIs this provider will serve, given the chosen transport. The
  // proxy translates formats, so every custom provider also serves Claude Code.
  const servedApis = useMemo(
    () => clientApisForTransport(normalizeTransportMode(form.transportMode) as TransportMode),
    [form.transportMode],
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
        transportMode: form.transportMode,
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
          ? "Connect an OpenAI or Anthropic compatible upstream. The proxy translates between formats, so one provider can serve OpenAI clients and Claude Code alike."
          : "Update provider metadata, auth mode, and credentials without exposing existing keys."}
      </p>

      {error ? <InlineAlert message={error} title="Could not save provider" variant="error" /> : null}

      <section className="provider-form-section">
        <div className="provider-form-section-head">
          <h3 className="provider-form-section-title">Identity &amp; endpoint</h3>
          <p className="provider-form-section-copy">How the provider is labelled and where requests are sent.</p>
        </div>

        <label className="form-field">
          <span className="field-label">Name</span>
          <input
            className="search-input"
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="e.g. OpenRouter, Local vLLM, DeepSeek"
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
            placeholder="https://api.example.com/v1"
            required
            type="url"
            value={form.baseUrl}
          />
          <span className="field-help">
            The upstream root. The transport path below is appended automatically.
          </span>
        </label>
      </section>

      <section className="provider-form-section">
        <div className="provider-form-section-head">
          <h3 className="provider-form-section-title">Transport</h3>
          <p className="provider-form-section-copy">The wire format the upstream expects.</p>
        </div>

        <div className="transport-picker" role="radiogroup" aria-label="Transport mode">
          {TRANSPORT_OPTIONS.map((option) => {
            const active = form.transportMode === option.value;
            return (
              <button
                aria-checked={active}
                className={`transport-option${active ? " active" : ""}`}
                key={option.value}
                onClick={() => setForm((current) => ({ ...current, transportMode: option.value }))}
                role="radio"
                type="button"
              >
                <span className="transport-option-title">{option.title}</span>
                <span className="transport-option-hint">{option.hint}</span>
                <code className="transport-option-path">{option.path}</code>
              </button>
            );
          })}
        </div>

        <div className="api-compat">
          <span className="api-compat-label">Serves these client APIs</span>
          <div className="api-compat-badges">
            {servedApis.map((api) => (
              <span className="api-compat-badge" key={api.endpoint} title={api.endpoint}>
                {api.label}
                <code>{api.endpoint}</code>
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="provider-form-section">
        <div className="provider-form-section-head">
          <h3 className="provider-form-section-title">Authentication</h3>
          <p className="provider-form-section-copy">How the proxy authenticates to the upstream.</p>
        </div>

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
            <option value="api_key">API key (Bearer token)</option>
            <option value="chatgpt_oauth">ChatGPT OAuth account</option>
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
            <span className="field-help">The ChatGPT OAuth account this provider draws credentials from.</span>
          </label>
        ) : (
          <label className="form-field">
            <span className="field-label">
              {mode === "create" ? "Provider API keys" : "Replace provider API keys"}
            </span>
            <textarea
              className="search-input form-textarea"
              onChange={(event) => setForm((current) => ({ ...current, providerApiKeysText: event.target.value }))}
              placeholder={mode === "create" ? "sk-provider-...\nsk-provider-..." : "Enter new keys only if you want to replace them"}
              rows={4}
              value={form.providerApiKeysText}
            />
            <span className="field-help">{keyReplacementHint}</span>
          </label>
        )}
      </section>

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
