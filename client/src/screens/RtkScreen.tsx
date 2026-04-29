import { useCallback, useEffect, useMemo, useState } from "react";
import { getProviders, getUsageStats, updateRtkPolicy } from "../api/client";
import type {
  ClientRouteSummary,
  ProviderSummary,
  ProvidersResponse,
  RtkPolicyInput,
  UsageStatsBucket,
  UsageStatsResponse,
} from "../api/types";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { InlineAlert } from "../components/InlineAlert";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { RefreshButton } from "../components/RefreshButton";
import { StatCard } from "../components/StatCard";
import { SurfaceCard } from "../components/SurfaceCard";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatNumber, formatPercent, formatUnknown, isRecord } from "../lib/format";

type RtkScreenData = {
  providers: ProvidersResponse;
  usage: UsageStatsResponse;
};

type MutationFeedback = {
  variant: "success" | "error";
  message: string;
};

type RouteRow = {
  clientRoute: string;
  provider: string;
  modelOverride: string;
  apiKeys: number;
  policySummary: string;
};

type ProviderRow = {
  provider: string;
  authMode: string;
  defaultPolicy: string;
};

type TriStateValue = "inherit" | "true" | "false";
type DetectFormatValue = "inherit" | "auto" | "plain" | "json" | "stack" | "command";

type RtkFormState = {
  enabled: TriStateValue;
  toolOutputEnabled: TriStateValue;
  maxChars: string;
  maxLines: string;
  tailLines: string;
  tailChars: string;
  detectFormat: DetectFormatValue;
};

const DEFAULT_FORM_STATE: RtkFormState = {
  enabled: "inherit",
  toolOutputEnabled: "inherit",
  maxChars: "",
  maxLines: "",
  tailLines: "",
  tailChars: "",
  detectFormat: "inherit",
};

function formatRtkPolicySummary(policy: unknown): string {
  if (!isRecord(policy)) {
    return "Inherit";
  }

  const parts: string[] = [];

  if (typeof policy.enabled === "boolean") {
    parts.push(policy.enabled ? "enabled" : "disabled");
  }
  if (typeof policy.toolOutputEnabled === "boolean") {
    parts.push(policy.toolOutputEnabled ? "tool-output:on" : "tool-output:off");
  }
  if (typeof policy.maxChars === "number") {
    parts.push(`chars:${policy.maxChars}`);
  }
  if (typeof policy.maxLines === "number") {
    parts.push(`lines:${policy.maxLines}`);
  }
  if (typeof policy.tailLines === "number") {
    parts.push(`tail:${policy.tailLines}`);
  }
  if (typeof policy.tailChars === "number") {
    parts.push(`tailChars:${policy.tailChars}`);
  }
  if (typeof policy.detectFormat === "string" && policy.detectFormat.trim()) {
    parts.push(`format:${policy.detectFormat}`);
  }

  return parts.length ? parts.join(" | ") : "Inherit";
}

function getRouteApiKeyCount(route: ClientRouteSummary): number {
  return Array.isArray(route.apiKeys) ? route.apiKeys.length : 0;
}

function getProviderList(response: ProvidersResponse): ProviderSummary[] {
  if (Array.isArray(response.providers) && response.providers.length) {
    return response.providers;
  }
  if (Array.isArray(response.providerOptions)) {
    return response.providerOptions;
  }
  return [];
}

function toUsageBucket(value: unknown): UsageStatsBucket {
  return isRecord(value) ? (value as UsageStatsBucket) : {};
}

function toTriStateBoolean(value: unknown): TriStateValue {
  return typeof value === "boolean" ? String(value) as "true" | "false" : "inherit";
}

function toDetectFormatValue(value: unknown): DetectFormatValue {
  return typeof value === "string" && value.trim()
    ? (value as DetectFormatValue)
    : "inherit";
}

function toStringNumber(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function policyToFormState(policy: unknown): RtkFormState {
  const record = isRecord(policy) ? policy : {};
  return {
    enabled: toTriStateBoolean(record.enabled),
    toolOutputEnabled: toTriStateBoolean(record.toolOutputEnabled),
    maxChars: toStringNumber(record.maxChars),
    maxLines: toStringNumber(record.maxLines),
    tailLines: toStringNumber(record.tailLines),
    tailChars: toStringNumber(record.tailChars),
    detectFormat: toDetectFormatValue(record.detectFormat),
  };
}

function parsePositiveInteger(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNonNegativeInteger(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function buildPolicyInput(form: RtkFormState): RtkPolicyInput {
  return {
    ...(form.enabled !== "inherit" ? { enabled: form.enabled === "true" } : {}),
    ...(form.toolOutputEnabled !== "inherit"
      ? { toolOutputEnabled: form.toolOutputEnabled === "true" }
      : {}),
    ...(parsePositiveInteger(form.maxChars) !== undefined
      ? { maxChars: parsePositiveInteger(form.maxChars) }
      : {}),
    ...(parsePositiveInteger(form.maxLines) !== undefined
      ? { maxLines: parsePositiveInteger(form.maxLines) }
      : {}),
    ...(parseNonNegativeInteger(form.tailLines) !== undefined
      ? { tailLines: parseNonNegativeInteger(form.tailLines) }
      : {}),
    ...(parseNonNegativeInteger(form.tailChars) !== undefined
      ? { tailChars: parseNonNegativeInteger(form.tailChars) }
      : {}),
    ...(form.detectFormat !== "inherit" ? { detectFormat: form.detectFormat } : {}),
  };
}

function hasPersistedAnchorField(policy: RtkPolicyInput): boolean {
  return (
    typeof policy.enabled === "boolean" ||
    typeof policy.toolOutputEnabled === "boolean" ||
    typeof policy.maxChars === "number" ||
    typeof policy.maxLines === "number"
  );
}

function renderRtkTelemetry(label: string, bucket: UsageStatsBucket) {
  if (typeof bucket.rtkRequests !== "number" || bucket.rtkRequests <= 0) {
    return null;
  }

  return (
    <SurfaceCard title={`${label} RTK telemetry`} description="Observed RTK reductions from recorded requests.">
      <div className="stat-grid">
        <StatCard label="Requests seen" value={formatNumber(bucket.rtkRequests)} />
        <StatCard label="Applied requests" value={formatNumber(bucket.rtkAppliedRequests)} />
        <StatCard label="Applied rate" value={formatPercent(bucket.rtkAppliedRate)} />
        <StatCard label="Tool outputs reduced" value={formatNumber(bucket.rtkToolOutputsReduced)} />
        <StatCard label="Chars before" value={formatNumber(bucket.rtkCharsBefore)} />
        <StatCard label="Chars after" value={formatNumber(bucket.rtkCharsAfter)} />
        <StatCard label="Chars saved" value={formatNumber(bucket.rtkCharsSaved)} />
        <StatCard label="Avg chars saved" value={formatNumber(bucket.rtkAvgCharsSaved)} />
      </div>
    </SurfaceCard>
  );
}

export function RtkScreen() {
  const loadRtk = useCallback(
    async () => {
      const [providers, usage] = await Promise.all([getProviders(), getUsageStats()]);
      return { providers, usage };
    },
    [],
  );
  const { state, retry } = useAsyncResource<RtkScreenData>(loadRtk);
  const [selectedClientRoute, setSelectedClientRoute] = useState<string | null>(null);
  const [formState, setFormState] = useState<RtkFormState>(DEFAULT_FORM_STATE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<MutationFeedback | null>(null);

  const providers = state.status === "success" ? getProviderList(state.data.providers) : [];
  const clientRoutes =
    state.status === "success" && Array.isArray(state.data.providers.clientRoutes)
      ? state.data.providers.clientRoutes
      : [];

  useEffect(() => {
    if (!clientRoutes.length) {
      if (selectedClientRoute !== null) {
        setSelectedClientRoute(null);
      }
      return;
    }

    if (selectedClientRoute && clientRoutes.some((route) => route.key === selectedClientRoute)) {
      return;
    }

    const preferred = clientRoutes.find((route) => route.key !== "default") ?? clientRoutes[0];
    setSelectedClientRoute(preferred.key);
  }, [clientRoutes, selectedClientRoute]);

  const selectedRoute =
    clientRoutes.find((route) => route.key === selectedClientRoute) ?? clientRoutes[0] ?? null;

  useEffect(() => {
    if (!selectedRoute) {
      setFormState(DEFAULT_FORM_STATE);
      return;
    }
    setFormState(policyToFormState(selectedRoute.rtkPolicy));
  }, [selectedRoute?.key, selectedRoute?.rtkPolicy]);

  if (state.status === "loading" || state.status === "idle") {
    return <LoadingState title="Loading RTK overview" description="Reading route policies and RTK usage telemetry." />;
  }

  if (state.status === "error") {
    return <ErrorState title="RTK overview unavailable" description={state.error.message} onRetry={retry} />;
  }

  const stats = isRecord(state.data.usage.stats) ? state.data.usage.stats : {};
  const today = toUsageBucket(stats.today);
  const month = toUsageBucket(stats.month);

  const routeRows: RouteRow[] = clientRoutes.map((route) => ({
    clientRoute: route.key,
    provider: route.providerName || route.providerId || "Unbound",
    modelOverride: route.modelOverride || "Inherited",
    apiKeys: getRouteApiKeyCount(route),
    policySummary: formatRtkPolicySummary(route.rtkPolicy),
  }));

  const providerRows: ProviderRow[] = providers
    .map((provider) => {
      const capabilities = isRecord(provider.capabilities) ? provider.capabilities : null;
      return {
        provider: provider.name || provider.id,
        authMode: provider.authMode || "Not reported",
        defaultPolicy: formatRtkPolicySummary(capabilities?.rtkPolicy),
      };
    })
    .filter((provider) => provider.defaultPolicy !== "Inherit");

  const routesWithPolicy = routeRows.filter((row) => row.policySummary !== "Inherit").length;
  const providersWithDefaults = providerRows.length;
  const hasTelemetry =
    (typeof today.rtkRequests === "number" && today.rtkRequests > 0) ||
    (typeof month.rtkRequests === "number" && month.rtkRequests > 0);

  const pendingPolicy = buildPolicyInput(formState);
  const persistenceWarning =
    Object.keys(pendingPolicy).length > 0 && !hasPersistedAnchorField(pendingPolicy)
      ? "Current backend behavior only persists RTK overrides when at least one of enabled, tool output, max chars, or max lines is set."
      : null;

  async function handleSave() {
    if (!selectedRoute) {
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    try {
      await updateRtkPolicy(selectedRoute.key, pendingPolicy);
      setFeedback({
        variant: "success",
        message:
          Object.keys(pendingPolicy).length === 0
            ? `RTK policy for ${selectedRoute.key} reset to inherit.`
            : `RTK policy for ${selectedRoute.key} saved.`,
      });
      retry();
    } catch (error) {
      setFeedback({
        variant: "error",
        message: error instanceof Error ? error.message : "Could not save RTK policy",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleReset() {
    setFormState(DEFAULT_FORM_STATE);
    setFeedback(null);
  }

  return (
    <div className="screen-stack">
      <PageHeader
        eyebrow="RTK"
        title="RTK reduction overview"
        description="Tune route-level RTK policy, review recent savings, and compare live telemetry against your current rules."
        actions={<RefreshButton onClick={retry} />}
      />

      <SurfaceCard>
        <div className="hero-status">
          <div>
            <p className="eyebrow">Policy coverage</p>
            <h2>{formatNumber(routesWithPolicy)}</h2>
            <p>{routesWithPolicy === 1 ? "client route with explicit RTK policy" : "client routes with explicit RTK policy"}</p>
          </div>
          <div>
            <p className="eyebrow">Provider defaults</p>
            <h2>{formatNumber(providersWithDefaults)}</h2>
            <p>{providersWithDefaults === 1 ? "provider exposes an RTK default" : "providers expose RTK defaults"}</p>
          </div>
        </div>
      </SurfaceCard>

      <div className="stat-grid">
        <StatCard label="Today RTK requests" value={formatNumber(today.rtkRequests)} />
        <StatCard label="Today applied rate" value={formatPercent(today.rtkAppliedRate)} />
        <StatCard label="Month RTK requests" value={formatNumber(month.rtkRequests)} />
        <StatCard label="Month chars saved" value={formatNumber(month.rtkCharsSaved)} />
      </div>

      {renderRtkTelemetry("Today", today)}
      {renderRtkTelemetry("This month", month)}

      {!hasTelemetry ? (
        <EmptyState
          title="No RTK telemetry yet"
          description="RTK telemetry will appear here after requests are processed with session logging enabled."
        />
      ) : null}

      <SurfaceCard
        title="Edit client route RTK policy"
        description="Save route-level RTK policy changes against the live backend contract used by the proxy."
      >
        {feedback ? (
          <InlineAlert
            variant={feedback.variant}
            message={feedback.message}
            title={feedback.variant === "error" ? "Save failed" : "Saved"}
          />
        ) : null}
        {persistenceWarning ? (
          <InlineAlert
            variant="error"
            title="Persistence note"
            message={persistenceWarning}
          />
        ) : null}
        {selectedRoute ? (
          <div className="surface-card-body">
            <div className="client-form-grid rtk-form-grid">
              <label className="form-field">
                <span className="field-label">Client route</span>
                <select
                  className="search-input"
                  value={selectedRoute.key}
                  onChange={(event) => {
                    setSelectedClientRoute(event.target.value);
                    setFeedback(null);
                  }}
                >
                  {clientRoutes.map((route) => (
                    <option key={route.key} value={route.key}>
                      {route.key}
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-field">
                <span className="field-label">Enabled</span>
                <select
                  className="search-input"
                  value={formState.enabled}
                  onChange={(event) => setFormState((current) => ({ ...current, enabled: event.target.value as TriStateValue }))}
                >
                  <option value="inherit">Inherit</option>
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </label>

              <label className="form-field">
                <span className="field-label">Tool output reduction</span>
                <select
                  className="search-input"
                  value={formState.toolOutputEnabled}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      toolOutputEnabled: event.target.value as TriStateValue,
                    }))
                  }
                >
                  <option value="inherit">Inherit</option>
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </label>

              <label className="form-field">
                <span className="field-label">Max chars</span>
                <input
                  className="search-input"
                  inputMode="numeric"
                  placeholder="e.g. 2800"
                  value={formState.maxChars}
                  onChange={(event) => setFormState((current) => ({ ...current, maxChars: event.target.value }))}
                />
              </label>

              <label className="form-field">
                <span className="field-label">Max lines</span>
                <input
                  className="search-input"
                  inputMode="numeric"
                  placeholder="e.g. 90"
                  value={formState.maxLines}
                  onChange={(event) => setFormState((current) => ({ ...current, maxLines: event.target.value }))}
                />
              </label>

              <label className="form-field">
                <span className="field-label">Tail lines</span>
                <input
                  className="search-input"
                  inputMode="numeric"
                  placeholder="e.g. 12"
                  value={formState.tailLines}
                  onChange={(event) => setFormState((current) => ({ ...current, tailLines: event.target.value }))}
                />
              </label>

              <label className="form-field">
                <span className="field-label">Tail chars</span>
                <input
                  className="search-input"
                  inputMode="numeric"
                  placeholder="e.g. 400"
                  value={formState.tailChars}
                  onChange={(event) => setFormState((current) => ({ ...current, tailChars: event.target.value }))}
                />
              </label>

              <label className="form-field">
                <span className="field-label">Detect format</span>
                <select
                  className="search-input"
                  value={formState.detectFormat}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      detectFormat: event.target.value as DetectFormatValue,
                    }))
                  }
                >
                  <option value="inherit">Inherit</option>
                  <option value="auto">Auto</option>
                  <option value="plain">Plain</option>
                  <option value="json">JSON</option>
                  <option value="stack">Stack</option>
                  <option value="command">Command</option>
                </select>
              </label>
            </div>

            <div className="rtk-form-actions">
              <button className="button-link" disabled={isSubmitting} onClick={handleReset} type="button">
                Reset form
              </button>
              <button className="button-link" disabled={isSubmitting} onClick={() => setFormState(policyToFormState(selectedRoute.rtkPolicy))} type="button">
                Load saved policy
              </button>
              <button className="button-primary" disabled={isSubmitting} onClick={handleSave} type="button">
                {isSubmitting ? "Saving..." : "Save RTK policy"}
              </button>
            </div>
          </div>
        ) : (
          <EmptyState
            title="No client routes available"
            description="Create a client route first, then return here to adjust RTK policy."
          />
        )}
      </SurfaceCard>

      <SurfaceCard
        title="Client route RTK policy"
        description="Route-level RTK settings currently configured in the backend. Inherited means the route follows provider defaults."
      >
        <DataTable<RouteRow>
          columns={[
            { key: "clientRoute", label: "Client route" },
            { key: "provider", label: "Provider" },
            { key: "modelOverride", label: "Model override" },
            { key: "apiKeys", label: "API keys", align: "right", render: (value) => formatNumber(value) },
            { key: "policySummary", label: "RTK policy" },
          ]}
          rows={routeRows}
          emptyTitle="No client routes reported"
          emptyDescription="Route policy details will appear after providers are loaded."
        />
      </SurfaceCard>

      <SurfaceCard
        title="Provider RTK defaults"
        description="Provider-level defaults used when a client route inherits RTK behavior."
      >
        <DataTable<ProviderRow>
          columns={[
            { key: "provider", label: "Provider" },
            { key: "authMode", label: "Auth" },
            { key: "defaultPolicy", label: "Default RTK policy" },
          ]}
          rows={providerRows}
          emptyTitle="No provider RTK defaults reported"
          emptyDescription="Providers without explicit RTK defaults will continue to inherit backend behavior."
        />
      </SurfaceCard>

      <SurfaceCard title="Policy notes" description="Helpful context for choosing conservative defaults before widening route-level policy.">
        <dl className="detail-list">
          <div>
            <dt>Selected route</dt>
            <dd>{selectedRoute ? selectedRoute.key : "Not reported"}</dd>
          </div>
          <div>
            <dt>Saved summary</dt>
            <dd>{selectedRoute ? formatRtkPolicySummary(selectedRoute.rtkPolicy) : "Not reported"}</dd>
          </div>
          <div>
            <dt>Provider defaults</dt>
            <dd>{providersWithDefaults > 0 ? `${providersWithDefaults} provider default${providersWithDefaults === 1 ? "" : "s"} detected` : "No explicit provider defaults reported"}</dd>
          </div>
          <div>
            <dt>Telemetry fallback</dt>
            <dd>{hasTelemetry ? "Telemetry is flowing and can be compared against policy summaries above." : "Telemetry is still sparse, so compare recent requests after saving a policy update."}</dd>
          </div>
          <div>
            <dt>Top-level request reduction</dt>
            <dd>{typeof month.rtkAppliedRate === "number" ? `${formatPercent(month.rtkAppliedRate)} applied this month` : "Not reported yet"}</dd>
          </div>
          <div>
            <dt>Tool-output trimming</dt>
            <dd>{formatUnknown(month.rtkToolOutputsReduced)}</dd>
          </div>
        </dl>
      </SurfaceCard>
    </div>
  );
}
