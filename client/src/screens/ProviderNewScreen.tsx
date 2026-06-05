import { useMemo, useState } from "react";
import { createProvider } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { SurfaceCard } from "../components/SurfaceCard";
import { ProviderForm } from "../components/ProviderForm";
import type { ProviderFormData } from "../components/ProviderForm";
import { ProvidersIcon } from "../components/icons";

type ProviderPreset = "anthropic" | "openai";

const PRESETS: Record<
  ProviderPreset,
  { label: string; description: string; initialData: Partial<ProviderFormData> }
> = {
  anthropic: {
    label: "Anthropic Compatible",
    description: "Claude-style upstream using the Responses API transport.",
    initialData: {
      name: "",
      baseUrl: "",
      authMode: "api_key",
      chatgptAccountId: "",
      providerApiKeysText: "",
      transportMode: "responses",
    },
  },
  openai: {
    label: "OpenAI Compatible",
    description: "OpenAI-style upstream using the Chat Completions transport.",
    initialData: {
      name: "",
      baseUrl: "",
      authMode: "api_key",
      chatgptAccountId: "",
      providerApiKeysText: "",
      transportMode: "chat_completions",
    },
  },
};

export function ProviderNewScreen() {
  const [preset, setPreset] = useState<ProviderPreset>("openai");

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
          title="Provider Type"
          description="Pick the upstream protocol this provider speaks"
        >
          <div className="provider-preset-grid">
            {(Object.keys(PRESETS) as ProviderPreset[]).map((key) => {
              const active = preset === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={`provider-preset-card${active ? " active" : ""}`}
                  onClick={() => setPreset(key)}
                  aria-pressed={active}
                >
                  <span className="provider-preset-name">{PRESETS[key].label}</span>
                  <span className="provider-preset-desc">{PRESETS[key].description}</span>
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
