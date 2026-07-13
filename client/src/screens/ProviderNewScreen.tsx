import { useMemo, useState } from "react";
import { createProvider } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { ProviderForm } from "../components/ProviderForm";
import type { ProviderFormData } from "../components/ProviderForm";
import { ProvidersIcon } from "../components/icons";

type ProviderPreset = "openai_responses" | "openai_chat";

const BASE_PRESET: Partial<ProviderFormData> = {
  name: "",
  baseUrl: "",
  authMode: "api_key",
  chatgptAccountId: "",
  providerApiKeysText: "",
};

const PRESETS: Record<
  ProviderPreset,
  {
    label: string;
    tagline: string;
    description: string;
    examples: string;
    initialData: Partial<ProviderFormData>;
  }
> = {
  openai_responses: {
    label: "Responses API",
    tagline: "Modern OpenAI protocol",
    description: "For upstreams that speak the OpenAI Responses API (Codex-style, GPT-5).",
    examples: "OpenAI, Azure OpenAI, LiteLLM",
    initialData: { ...BASE_PRESET, transportMode: "responses" },
  },
  openai_chat: {
    label: "Chat Completions",
    tagline: "Classic OpenAI protocol",
    description: "For upstreams that speak the OpenAI Chat Completions API. Most compatible.",
    examples: "OpenRouter, DeepSeek, Groq, vLLM, Ollama",
    initialData: { ...BASE_PRESET, transportMode: "chat_completions" },
  },
};

export function ProviderNewScreen() {
  const [preset, setPreset] = useState<ProviderPreset>("openai_chat");

  const initialData = useMemo(() => PRESETS[preset].initialData, [preset]);

  const goBack = () => {
    window.location.hash = "#/providers";
  };

  const handleCreate = async (values: {
    name: string;
    baseUrl: string;
    authMode: "api_key" | "chatgpt_oauth";
    chatgptAccountId?: string;
    providerApiKeys?: string[];
    transportMode: "responses" | "chat_completions";
  }) => {
    await createProvider({
      name: values.name,
      baseUrl: values.baseUrl,
      authMode: values.authMode,
      chatgptAccountId:
        values.authMode === "chatgpt_oauth" ? values.chatgptAccountId ?? "" : "",
      providerApiKeys: values.providerApiKeys ?? [],
      capabilities: {
        transportMode: values.transportMode,
      },
    });
    goBack();
  };

  return (
    <div className="screen-stack">
      <PageHeader
        icon={ProvidersIcon}
        eyebrow="Providers"
        title="Add Provider"
        description="Connect an OpenAI or Anthropic compatible endpoint"
        actions={
          <div className="page-actions">
            <button className="back-button" onClick={goBack} type="button">
              ← Back to Providers
            </button>
          </div>
        }
      />

      <div className="provider-new-layout">
        <SurfaceCard
          title="Upstream protocol"
          description="Pick the wire format your upstream speaks. Either way, the proxy translates so this provider serves OpenAI clients and Claude Code."
        >
          <div className="provider-preset-grid">
            {(Object.keys(PRESETS) as ProviderPreset[]).map((key) => {
              const active = preset === key;
              const item = PRESETS[key];
              return (
                <button
                  key={key}
                  type="button"
                  className={`provider-preset-card${active ? " active" : ""}`}
                  onClick={() => setPreset(key)}
                  aria-pressed={active}
                >
                  <span className="provider-preset-head">
                    <span className="provider-preset-name">{item.label}</span>
                    <span className="provider-preset-tag">{item.tagline}</span>
                  </span>
                  <span className="provider-preset-desc">{item.description}</span>
                  <span className="provider-preset-examples">e.g. {item.examples}</span>
                </button>
              );
            })}
          </div>
        </SurfaceCard>

        <SurfaceCard
          title="Configuration"
          description="Set the provider name, endpoint, and credentials"
        >
          <ProviderForm
            key={preset}
            mode="create"
            initialData={initialData}
            onCancel={goBack}
            onSubmit={handleCreate}
          />
        </SurfaceCard>
      </div>
    </div>
  );
}
