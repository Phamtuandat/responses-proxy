import { useEffect, useMemo, useState } from "react";
import type {
  ClientConfigStatus,
  ClientRouteSummary,
  ProviderSummary,
  QuickApplyClientKey,
} from "../api/types";
import { InlineAlert } from "./InlineAlert";
import { StatusBadge } from "./StatusBadge";

type QuickApplyDraft = {
  client: QuickApplyClientKey;
  baseUrl: string;
  routeApiKey: string;
  model: string;
};

type QuickApplyCardProps = {
  client: QuickApplyClientKey;
  label: string;
  status?: ClientConfigStatus;
  providerOptions: ProviderSummary[];
  proxyBaseUrl: string;
  clientRoutes: ClientRouteSummary[];
  modelOptions: string[];
  modelsLoading?: boolean;
  modelsError?: string | null;
  onApiKeyChange?: (routeApiKey: string) => void;
  onApply: (draft: QuickApplyDraft) => void;
  isSubmitting: boolean;
  error?: string | null;
  successMessage?: string | null;
};

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "••••";
  }
  return `••••${value.slice(-4)}`;
}

function getClientApiKeyOptions(clientRoutes: ClientRouteSummary[]) {
  return clientRoutes.flatMap((route) => {
    const keys = Array.isArray(route.apiKeys) ? route.apiKeys.filter(Boolean) : [];
    return keys.map((apiKey, index) => ({
      apiKey,
      routeKey: route.key,
      providerId: route.providerId ?? "",
      providerName: route.providerName ?? "",
      label: `${route.key}${keys.length > 1 ? ` (${index + 1})` : ""} • ${maskSecret(apiKey)}`,
      preferredModel: route.modelOverride ?? "",
    }));
  });
}

export function QuickApplyCard({
  client,
  label,
  status,
  providerOptions: _providerOptions,
  proxyBaseUrl,
  clientRoutes,
  modelOptions,
  modelsLoading = false,
  modelsError,
  onApiKeyChange,
  onApply,
  isSubmitting,
  error,
  successMessage,
}: QuickApplyCardProps) {
  const apiKeyOptions = useMemo(() => getClientApiKeyOptions(clientRoutes), [clientRoutes]);
  const latestBackup = Array.isArray(status?.backups) ? status?.backups[0] : undefined;
  const access = status?.access;
  const [baseUrl, setBaseUrl] = useState("");
  const [routeApiKey, setRouteApiKey] = useState("");
  const [model, setModel] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setBaseUrl(
      typeof status?.detected?.baseUrl === "string" && status.detected.baseUrl.trim()
        ? status.detected.baseUrl
        : proxyBaseUrl || "",
    );
    setRouteApiKey(
      typeof status?.detected?.apiKey === "string" && status.detected.apiKey.trim()
        ? status.detected.apiKey
        : typeof status?.routeApiKey === "string"
          ? status.routeApiKey
          : apiKeyOptions[0]?.apiKey || "",
    );
    setModel(
      typeof status?.route?.modelOverride === "string" && status.route.modelOverride.trim()
        ? status.route.modelOverride
        : typeof status?.detected?.model === "string" && status.detected.model.trim()
          ? status.detected.model
          : "",
    );
    setValidationError(null);
  }, [apiKeyOptions, proxyBaseUrl, status]);

  const selectedApiKeyOption = apiKeyOptions.find((option) => option.apiKey === routeApiKey) ?? null;

  useEffect(() => {
    if (routeApiKey) {
      onApiKeyChange?.(routeApiKey);
    }
  }, [onApiKeyChange, routeApiKey]);

  function handleApply() {
    setValidationError(null);

    if (access?.canPatch === false) {
      setValidationError(access.reason || "Config patching is unavailable for this client.");
      return;
    }

    const trimmedBaseUrl = baseUrl.trim();
    const trimmedModel = model.trim();
    if (!trimmedBaseUrl) {
      setValidationError("Base URL is required.");
      return;
    }
    try {
      new URL(trimmedBaseUrl);
    } catch {
      setValidationError("Base URL must be a valid URL.");
      return;
    }
    if (!routeApiKey) {
      setValidationError("Choose a client API key before applying.");
      return;
    }
    if (!trimmedModel) {
      setValidationError("Model is required.");
      return;
    }

    onApply({
      client,
      baseUrl: trimmedBaseUrl,
      routeApiKey,
      model: trimmedModel,
    });
  }

  return (
    <section className="surface-card quick-apply-card">
      <div className="quick-apply-header">
        <div>
          <h2>{label}</h2>
          <p>{client === "hermes" ? "Patch the Hermes config file." : "Patch the Codex config and auth files."}</p>
        </div>
        <div className="card-inline-status">
          <StatusBadge variant={status?.configured ? "success" : "warning"}>
            {status?.configured ? "Configured" : "Needs attention"}
          </StatusBadge>
          <StatusBadge variant={access?.canPatch ? "accent" : "neutral"}>
            {access?.canPatch ? "Can patch" : "Unavailable"}
          </StatusBadge>
        </div>
      </div>

      {validationError ? <InlineAlert message={validationError} title="Validation" variant="error" /> : null}
      {error ? <InlineAlert message={error} title="Apply failed" variant="error" /> : null}
      {successMessage ? <InlineAlert message={successMessage} title="Apply result" variant="success" /> : null}

      <div className="quick-apply-grid">
        <label className="form-field">
          <span className="field-label">Base URL</span>
          <input
            className="search-input"
            disabled={isSubmitting}
            onChange={(event) => setBaseUrl(event.target.value)}
            type="url"
            value={baseUrl}
          />
        </label>

        <label className="form-field">
          <span className="field-label">Client API key</span>
          <select
            className="search-input"
            disabled={isSubmitting || apiKeyOptions.length === 0}
            onChange={(event) => setRouteApiKey(event.target.value)}
            value={routeApiKey}
          >
            {apiKeyOptions.length === 0 ? (
              <option value="">No client API keys</option>
            ) : null}
            {apiKeyOptions.map((option) => (
              <option key={`${option.routeKey}:${option.apiKey.slice(-6)}`} value={option.apiKey}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="field-help">
            {selectedApiKeyOption
              ? `Selected route: ${selectedApiKeyOption.routeKey}`
              : "Choose a configured client API key."}
          </span>
        </label>
      </div>

      <label className="form-field">
        <span className="field-label">Model</span>
        {modelOptions.length > 0 ? (
          <select
            className="search-input"
            disabled={isSubmitting || modelsLoading}
            onChange={(event) => setModel(event.target.value)}
            value={model}
          >
            {!modelOptions.includes(model) && model ? <option value={model}>{model}</option> : null}
            {modelOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="search-input"
            disabled={isSubmitting}
            onChange={(event) => setModel(event.target.value)}
            placeholder={modelsLoading ? "Loading models..." : "Enter model manually"}
            type="text"
            value={model}
          />
        )}
        <span className="field-help">
          {modelsLoading
            ? "Loading models for the selected client key provider."
            : modelsError
              ? modelsError
              : modelOptions.length > 0
                ? "Choose one of the available provider models."
                : "No provider models returned, so manual entry is available."}
        </span>
      </label>

      <div className="modal-actions">
        <button
          className="button-link button-primary"
          disabled={isSubmitting || access?.canPatch === false}
          onClick={handleApply}
          type="button"
        >
          {isSubmitting ? "Applying..." : `Apply ${label}`}
        </button>
      </div>

      <dl className="detail-list">
        <div><dt>Config path</dt><dd>{status?.path || "Not reported"}</dd></div>
        <div><dt>Detected base URL</dt><dd>{status?.detected?.baseUrl || "Not reported"}</dd></div>
        <div><dt>Detected model</dt><dd>{status?.detected?.model || "Not reported"}</dd></div>
        <div><dt>Route provider</dt><dd>{status?.route?.providerName || status?.route?.providerId || "Not reported"}</dd></div>
        <div><dt>Route key</dt><dd>{status?.route?.key || "Not reported"}</dd></div>
        <div><dt>Latest backup</dt><dd>{latestBackup?.path || "Not reported"}</dd></div>
        <div><dt>Unavailable reason</dt><dd>{access?.reason || "Available"}</dd></div>
      </dl>
    </section>
  );
}
