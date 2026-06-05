import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyClientConfig,
  getClientConfigsStatus,
  getProviderModels,
  getProviders,
} from "../api/client";
import type {
  ClientConfigApplyInput,
  ClientConfigStatus,
  ClientConfigsStatusResponse,
  ClientRouteSummary,
  ProviderSummary,
  QuickApplyClientKey,
} from "../api/types";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { QuickApplyCard } from "../components/QuickApplyCard";
import { RefreshButton } from "../components/RefreshButton";
import { SurfaceCard } from "../components/SurfaceCard";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { formatDateTime, formatUnknown } from "../lib/format";

type ConfigHelperData = {
  configStatus: ClientConfigsStatusResponse;
  clientRoutes: ClientRouteSummary[];
  providerOptions: ProviderSummary[];
};

type ApplyDraft = {
  client: QuickApplyClientKey;
  baseUrl: string;
  routeApiKey: string;
  model: string;
};

type ApplyFeedback = {
  variant: "success" | "error";
  message: string;
};

function buildApplyMessage(result: {
  changed?: boolean;
  backupCreated?: boolean;
  configChanged?: boolean;
  authChanged?: boolean;
  proxyBaseUrl?: string;
}) {
  const parts = [
    result.changed ? "files updated" : "no file changes",
    result.backupCreated ? "backup created" : "no backup needed",
    result.configChanged ? "config changed" : null,
    result.authChanged ? "auth changed" : null,
    result.proxyBaseUrl ? `base URL ${result.proxyBaseUrl}` : null,
  ].filter((value): value is string => Boolean(value));

  return parts.join(" • ");
}

function CopyableCodeBlock({ code, language = "BASH" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="terminal-wrapper" style={{ margin: "var(--space-3) 0", border: "1px solid var(--line)", borderRadius: "var(--radius-md)" }}>
      <div className="terminal-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255, 255, 255, 0.05)", padding: "var(--space-2) var(--space-4)", borderTopLeftRadius: "var(--radius-md)", borderTopRightRadius: "var(--radius-md)", borderBottom: "1px solid var(--line)" }}>
        <div className="terminal-dots" style={{ display: "flex", gap: "6px" }}>
          <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#ff5f56", display: "inline-block" }} />
          <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#ffbd2e", display: "inline-block" }} />
          <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#27c93f", display: "inline-block" }} />
        </div>
        <span className="terminal-title" style={{ fontSize: "var(--font-xs)", fontFamily: "var(--font-mono)", opacity: 0.8 }}>{language}</span>
        <button
          className="copy-command-button"
          onClick={handleCopy}
          style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "var(--font-xs)", fontWeight: "bold" }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <div className="terminal-body" style={{ background: "rgba(0, 0, 0, 0.2)", padding: "var(--space-4)", borderBottomLeftRadius: "var(--radius-md)", borderBottomRightRadius: "var(--radius-md)", overflowX: "auto" }}>
        <pre style={{ margin: 0 }}>
          <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-sm)", color: "var(--text)", whiteSpace: "pre" }}>{code}</code>
        </pre>
      </div>
    </div>
  );
}

export function ConfigHelperScreen() {
  const [activeTab, setActiveTab] = useState<"quick-patches" | "codex" | "claude" | "cursor" | "cline" | "openai">("quick-patches");
  const [selectedApiKey, setSelectedApiKey] = useState<string>("");
  const [pendingApply, setPendingApply] = useState<ApplyDraft | null>(null);
  const [submittingClient, setSubmittingClient] = useState<QuickApplyClientKey | null>(null);
  const [applyErrors, setApplyErrors] = useState<Partial<Record<QuickApplyClientKey, string | null>>>({});
  const [applySuccess, setApplySuccess] = useState<Partial<Record<QuickApplyClientKey, string | null>>>({});
  const [selectedApiKeys, setSelectedApiKeys] = useState<Partial<Record<QuickApplyClientKey, string>>>({});

  const handleHermesApiKeyChange = useCallback((routeApiKey: string) => {
    setSelectedApiKeys((current) =>
      current.hermes === routeApiKey ? current : { ...current, hermes: routeApiKey },
    );
  }, []);

  const handleCodexApiKeyChange = useCallback((routeApiKey: string) => {
    setSelectedApiKeys((current) =>
      current.codex === routeApiKey ? current : { ...current, codex: routeApiKey },
    );
  }, []);

  const loadConfigStatus = useCallback(async (): Promise<ConfigHelperData> => {
    const [configStatus, providers] = await Promise.all([getClientConfigsStatus(), getProviders()]);
    return {
      configStatus,
      clientRoutes: Array.isArray(providers.clientRoutes) ? providers.clientRoutes : [],
      providerOptions: Array.isArray(configStatus.providerOptions)
        ? configStatus.providerOptions
        : Array.isArray(providers.providerOptions)
          ? providers.providerOptions
          : [],
    };
  }, []);

  const { state, retry } = useAsyncResource<ConfigHelperData>(loadConfigStatus);

  const loadHermesModels = useCallback(async () => {
    const apiKey = selectedApiKeys.hermes || "";
    const route = state.status === "success"
      ? state.data.clientRoutes.find((entry) => Array.isArray(entry.apiKeys) && entry.apiKeys.includes(apiKey))
      : undefined;
    if (!route?.providerId) {
      return [];
    }
    const response = await getProviderModels(route.providerId);
    return Array.isArray(response.models) ? response.models : [];
  }, [selectedApiKeys.hermes, state]);

  const loadCodexModels = useCallback(async () => {
    const apiKey = selectedApiKeys.codex || "";
    const route = state.status === "success"
      ? state.data.clientRoutes.find((entry) => Array.isArray(entry.apiKeys) && entry.apiKeys.includes(apiKey))
      : undefined;
    if (!route?.providerId) {
      return [];
    }
    const response = await getProviderModels(route.providerId);
    return Array.isArray(response.models) ? response.models : [];
  }, [selectedApiKeys.codex, state]);

  const hermesModels = useAsyncResource<string[]>(loadHermesModels);
  const codexModels = useAsyncResource<string[]>(loadCodexModels);

  const clients = state.status === "success" ? state.data.configStatus.clients ?? {} : {};
  const runtime = state.status === "success" ? state.data.configStatus.runtime : undefined;
  const proxyBaseUrl = state.status === "success" ? state.data.configStatus.proxyBaseUrl ?? "" : "";
  const providerOptions = state.status === "success" ? state.data.providerOptions : [];
  const clientRoutes = state.status === "success" ? state.data.clientRoutes : [];

  const apiKeyOptions = useMemo(() => {
    return clientRoutes.flatMap((route) => {
      const keys = Array.isArray(route.apiKeys) ? route.apiKeys.filter(Boolean) : [];
      return keys.map((apiKey, index) => ({
        apiKey,
        routeKey: route.key,
        label: `${route.key}${keys.length > 1 ? ` (${index + 1})` : ""} • ••••${apiKey.slice(-4)}`,
      }));
    });
  }, [clientRoutes]);

  useEffect(() => {
    if (apiKeyOptions.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeyOptions[0].apiKey);
    }
  }, [apiKeyOptions, selectedApiKey]);

  const activeApiKey = selectedApiKey || "your-client-api-key";

  const runtimeReasons = useMemo(() => {
    const entries = [clients.hermes, clients.codex].filter(Boolean);
    return entries
      .map((entry) => entry?.access?.reason)
      .filter((value): value is string => typeof value === "string" && value.trim());
  }, [clients.codex, clients.hermes]);

  async function handleConfirmApply() {
    if (!pendingApply) {
      return;
    }

    const client = pendingApply.client;
    setSubmittingClient(client);
    setApplyErrors((current) => ({ ...current, [client]: null }));
    setApplySuccess((current) => ({ ...current, [client]: null }));

    try {
      const input: ClientConfigApplyInput = {
        client,
        baseUrl: pendingApply.baseUrl,
        routeApiKey: pendingApply.routeApiKey,
        model: pendingApply.model,
      };
      const response = await applyClientConfig(input);
      setApplySuccess((current) => ({
        ...current,
        [client]: buildApplyMessage(response),
      }));
      setPendingApply(null);
      retry();
    } catch (error) {
      setApplyErrors((current) => ({
        ...current,
        [client]: error instanceof Error ? error.message : "Could not apply client config.",
      }));
    } finally {
      setSubmittingClient(null);
    }
  }

  const pendingStatus =
    pendingApply?.client === "hermes"
      ? clients.hermes
      : pendingApply?.client === "codex"
        ? clients.codex
        : undefined;

  if (state.status === "loading" || state.status === "idle") {
    return <LoadingState title="Loading config helper" description="Reading Hermes and Codex quick apply status." />;
  }

  if (state.status === "error") {
    return <ErrorState title="Config status unavailable" description={state.error.message} onRetry={retry} />;
  }

  // Fallback endpoint URL calculation
  const endpointUrl = proxyBaseUrl || `${window.location.origin}/v1`;

  return (
    <div className="screen-stack">
      <PageHeader
        eyebrow="Config Hub"
        title="CLI & Client Developer Hub"
        description="Configure your favorite AI client tools, CLIs, or manual SDK environments to route through responses-proxy."
        actions={<RefreshButton onClick={retry} />}
      />

      <SurfaceCard
        title="Active Client API Key"
        description="Select a Client API Key to dynamically customize the configuration instructions below."
      >
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-4)" }}>
          <div className="form-field" style={{ margin: 0, minWidth: "320px" }}>
            <select
              className="search-input"
              onChange={(e) => setSelectedApiKey(e.target.value)}
              value={selectedApiKey}
            >
              {apiKeyOptions.length === 0 ? (
                <option value="">No client API keys found</option>
              ) : null}
              {apiKeyOptions.map((option) => (
                <option key={option.apiKey} value={option.apiKey}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div style={{ fontSize: "var(--font-sm)", color: "var(--text-secondary)" }}>
            Need a new Client API Key? Go to <a href="#/clients">Clients</a> to create one.
          </div>
        </div>
      </SurfaceCard>

      {/* Developer Hub Navigation Tabs */}
      <div className="tab-navigation" style={{ marginBottom: "var(--space-5)" }}>
        <div className="tab-list" style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)", borderBottom: "1px solid var(--line)", paddingBottom: "var(--space-2)" }}>
          <button
            className={`tab-button ${activeTab === 'quick-patches' ? 'tab-button-active' : ''}`}
            onClick={() => setActiveTab('quick-patches')}
            style={{ background: "none", border: "none", padding: "var(--space-2) var(--space-4)", color: activeTab === 'quick-patches' ? 'var(--accent)' : 'var(--text-secondary)', borderBottom: activeTab === 'quick-patches' ? "2px solid var(--accent)" : "none", cursor: "pointer", fontWeight: "bold" }}
          >
            Quick Patches
          </button>
          <button
            className={`tab-button ${activeTab === 'codex' ? 'tab-button-active' : ''}`}
            onClick={() => setActiveTab('codex')}
            style={{ background: "none", border: "none", padding: "var(--space-2) var(--space-4)", color: activeTab === 'codex' ? 'var(--accent)' : 'var(--text-secondary)', borderBottom: activeTab === 'codex' ? "2px solid var(--accent)" : "none", cursor: "pointer", fontWeight: "bold" }}
          >
            Codex CLI
          </button>
          <button
            className={`tab-button ${activeTab === 'claude' ? 'tab-button-active' : ''}`}
            onClick={() => setActiveTab('claude')}
            style={{ background: "none", border: "none", padding: "var(--space-2) var(--space-4)", color: activeTab === 'claude' ? 'var(--accent)' : 'var(--text-secondary)', borderBottom: activeTab === 'claude' ? "2px solid var(--accent)" : "none", cursor: "pointer", fontWeight: "bold" }}
          >
            Claude Code
          </button>
          <button
            className={`tab-button ${activeTab === 'cursor' ? 'tab-button-active' : ''}`}
            onClick={() => setActiveTab('cursor')}
            style={{ background: "none", border: "none", padding: "var(--space-2) var(--space-4)", color: activeTab === 'cursor' ? 'var(--accent)' : 'var(--text-secondary)', borderBottom: activeTab === 'cursor' ? "2px solid var(--accent)" : "none", cursor: "pointer", fontWeight: "bold" }}
          >
            Cursor
          </button>
          <button
            className={`tab-button ${activeTab === 'cline' ? 'tab-button-active' : ''}`}
            onClick={() => setActiveTab('cline')}
            style={{ background: "none", border: "none", padding: "var(--space-2) var(--space-4)", color: activeTab === 'cline' ? 'var(--accent)' : 'var(--text-secondary)', borderBottom: activeTab === 'cline' ? "2px solid var(--accent)" : "none", cursor: "pointer", fontWeight: "bold" }}
          >
            Cline
          </button>
          <button
            className={`tab-button ${activeTab === 'openai' ? 'tab-button-active' : ''}`}
            onClick={() => setActiveTab('openai')}
            style={{ background: "none", border: "none", padding: "var(--space-2) var(--space-4)", color: activeTab === 'openai' ? 'var(--accent)' : 'var(--text-secondary)', borderBottom: activeTab === 'openai' ? "2px solid var(--accent)" : "none", cursor: "pointer", fontWeight: "bold" }}
          >
            OpenAI SDK
          </button>
        </div>
      </div>

      {/* Tab Contents */}
      {activeTab === "quick-patches" && (
        <>
          <SurfaceCard title="Runtime overview" description="Current quick apply runtime and patch availability.">
            <dl className="detail-list">
              <div><dt>Runtime</dt><dd>{formatUnknown(runtime)}</dd></div>
              <div><dt>Proxy base URL</dt><dd>{formatUnknown(proxyBaseUrl)}</dd></div>
              <div><dt>Hermes can patch</dt><dd>{formatUnknown(clients.hermes?.access?.canPatch)}</dd></div>
              <div><dt>Codex can patch</dt><dd>{formatUnknown(clients.codex?.access?.canPatch)}</dd></div>
              <div><dt>Access status</dt><dd>{runtimeReasons[0] || "Available"}</dd></div>
              <div><dt>Latest Hermes backup</dt><dd>{formatUnknown(clients.hermes?.backups?.[0]?.path)}</dd></div>
              <div><dt>Latest Codex backup</dt><dd>{formatUnknown(clients.codex?.backups?.[0]?.path)}</dd></div>
              <div><dt>Latest backup modified</dt><dd>{formatDateTime(clients.codex?.backups?.[0]?.modifiedAt || clients.hermes?.backups?.[0]?.modifiedAt)}</dd></div>
            </dl>
          </SurfaceCard>

          <div className="quick-apply-layout">
            <QuickApplyCard
              client="hermes"
              clientRoutes={clientRoutes}
              error={applyErrors.hermes ?? null}
              isSubmitting={submittingClient === "hermes"}
              label="Hermes"
              modelOptions={hermesModels.state.status === "success" ? hermesModels.state.data : []}
              modelsError={hermesModels.state.status === "error" ? hermesModels.state.error.message : null}
              modelsLoading={hermesModels.state.status === "loading"}
              onApiKeyChange={handleHermesApiKeyChange}
              onApply={(draft) => setPendingApply(draft)}
              providerOptions={providerOptions}
              proxyBaseUrl={proxyBaseUrl}
              status={clients.hermes}
              successMessage={applySuccess.hermes ?? null}
            />

            <QuickApplyCard
              client="codex"
              clientRoutes={clientRoutes}
              error={applyErrors.codex ?? null}
              isSubmitting={submittingClient === "codex"}
              label="Codex"
              modelOptions={codexModels.state.status === "success" ? codexModels.state.data : []}
              modelsError={codexModels.state.status === "error" ? codexModels.state.error.message : null}
              modelsLoading={codexModels.state.status === "loading"}
              onApiKeyChange={handleCodexApiKeyChange}
              onApply={(draft) => setPendingApply(draft)}
              providerOptions={providerOptions}
              proxyBaseUrl={proxyBaseUrl}
              status={clients.codex}
              successMessage={applySuccess.codex ?? null}
            />
          </div>
        </>
      )}

      {activeTab === "codex" && (
        <SurfaceCard title="Codex CLI Setup" description="Automatically configure the Codex CLI tool on your local machine using a curl script.">
          <p style={{ margin: "0 0 var(--space-4) 0", color: "var(--text-secondary)", fontSize: "var(--font-sm)" }}>
            Run the following command in your terminal to automatically generate the config and authentication credentials for Codex on your local machine:
          </p>
          <CopyableCodeBlock
            code={`curl -fsSL \\\n  -H 'Authorization: Bearer ${activeApiKey}' \\\n  '${window.location.origin}/api/customer/codex/setup.sh' \\\n  | sh`}
            language="BASH"
          />
          <h4 style={{ margin: "var(--space-4) 0 var(--space-2) 0", fontSize: "var(--font-md)" }}>What this does</h4>
          <ul style={{ margin: 0, paddingLeft: "var(--space-4)", fontSize: "var(--font-sm)", color: "var(--text-secondary)", lineHeight: "1.6" }}>
            <li>Downloads the configuration script securely using your Client API Key.</li>
            <li>Backs up any existing configurations in <code>~/.codex/</code>.</li>
            <li>Configures <code>~/.codex/config.toml</code> to use the responses-proxy backend.</li>
            <li>Stores the Client API key in <code>~/.codex/auth.json</code> for seamless authentication.</li>
          </ul>
        </SurfaceCard>
      )}

      {activeTab === "claude" && (
        <SurfaceCard title="Claude Code Configuration" description="Directly configure Claude Code manually via environment flags or diagnostics.">
          <p style={{ margin: "0 0 var(--space-4) 0", color: "var(--text-secondary)", fontSize: "var(--font-sm)" }}>
            To run Claude Code through responses-proxy, export the Anthropic base URL environment variable before starting a session:
          </p>
          <CopyableCodeBlock
            code={`export ANTHROPIC_BASE_URL="${endpointUrl}"\nexport ANTHROPIC_API_KEY="${activeApiKey}"`}
            language="BASH"
          />
          <h4 style={{ margin: "var(--space-4) 0 var(--space-2) 0", fontSize: "var(--font-md)" }}>Diagnostics & Checking</h4>
          <p style={{ margin: "0 0 var(--space-3) 0", color: "var(--text-secondary)", fontSize: "var(--font-sm)" }}>
            Run the doctor command inside your terminal to confirm setup and connectivity:
          </p>
          <CopyableCodeBlock
            code="claude doctor"
            language="BASH"
          />
        </SurfaceCard>
      )}

      {activeTab === "cursor" && (
        <SurfaceCard title="Cursor AI Editor Setup" description="Configure Custom Anthropic base URL inside Cursor's settings.">
          <p style={{ margin: "0 0 var(--space-4) 0", color: "var(--text-secondary)", fontSize: "var(--font-sm)" }}>
            Cursor allows manual override of the Anthropic Base URL in its developer preferences. Configure these fields:
          </p>
          <CopyableCodeBlock
            code={`// Under Cursor Settings -> Models -> Anthropic\n{\n  "Override Base URL": "${endpointUrl}",\n  "API Key": "${activeApiKey}"\n}`}
            language="JSON"
          />
          <ol style={{ margin: "var(--space-4) 0 0 0", paddingLeft: "var(--space-4)", fontSize: "var(--font-sm)", color: "var(--text-secondary)", lineHeight: "1.6" }}>
            <li>Open Cursor, navigate to <strong>Cursor Settings</strong> (Ctrl/Cmd + ,).</li>
            <li>Click on <strong>Models</strong> on the left pane.</li>
            <li>Under <strong>Anthropic</strong>, expand settings, toggle "Override Base URL", and paste the endpoint URL.</li>
            <li>Provide your local client route API key to enable secure authorization.</li>
          </ol>
        </SurfaceCard>
      )}

      {activeTab === "cline" && (
        <SurfaceCard title="Cline Configuration" description="Route VSCode Cline extensions through the operational proxy.">
          <p style={{ margin: "0 0 var(--space-4) 0", color: "var(--text-secondary)", fontSize: "var(--font-sm)" }}>
            Set Cline to use custom Anthropic base URL configurations:
          </p>
          <CopyableCodeBlock
            code={`Provider: Anthropic\nBase URL: ${endpointUrl}\nAPI Key: ${activeApiKey}\nModel: claude-3-5-sonnet`}
            language="SETTINGS"
          />
          <h4 style={{ margin: "var(--space-4) 0 var(--space-2) 0", fontSize: "var(--font-md)" }}>Alternatively, via OpenAI-Compatible settings:</h4>
          <CopyableCodeBlock
            code={`Provider: OpenAI Compatible\nBase URL: ${endpointUrl}\nAPI Key: ${activeApiKey}\nModel: auto`}
            language="SETTINGS"
          />
        </SurfaceCard>
      )}

      {activeTab === "openai" && (
        <SurfaceCard title="OpenAI SDK Overrides" description="Directly configure standard Python or Javascript SDK clients to communicate with responses-proxy.">
          <h4 style={{ margin: "0 0 var(--space-2) 0", fontSize: "var(--font-md)" }}>NodeJS SDK Example:</h4>
          <CopyableCodeBlock
            code={`import OpenAI from 'openai';\n\nconst openai = new OpenAI({\n  baseURL: '${endpointUrl}',\n  apiKey: '${activeApiKey}'\n});\n\nconst completion = await openai.chat.completions.create({\n  model: 'gpt-4o',\n  messages: [{ role: 'user', content: 'Hello responses-proxy!' }]\n});`}
            language="JAVASCRIPT"
          />
          
          <h4 style={{ margin: "var(--space-4) 0 var(--space-2) 0", fontSize: "var(--font-md)" }}>Python SDK Example:</h4>
          <CopyableCodeBlock
            code={`from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${endpointUrl}",\n    api_key="${activeApiKey}"\n)\n\nresponse = client.chat.completions.create(\n    model="gpt-4o",\n    messages=[{"role": "user", "content": "Hello responses-proxy!"}]\n)`}
            language="PYTHON"
          />
        </SurfaceCard>
      )}

      {pendingApply ? (
        <ConfirmDialog
          confirmLabel={`Apply ${pendingApply.client}`}
          description={`Apply ${pendingApply.client} config patch at ${pendingStatus?.path || "the configured path"} for ${pendingApply.baseUrl} using model ${pendingApply.model}. A backup may be created before files are written.`}
          isSubmitting={submittingClient === pendingApply.client}
          onCancel={() => {
            if (submittingClient !== pendingApply.client) {
              setPendingApply(null);
            }
          }}
          onConfirm={() => void handleConfirmApply()}
          title={`Apply ${pendingApply.client} config`}
        />
      ) : null}
    </div>
  );
}
