/**
 * Derives which client-facing APIs a custom provider can serve from its transport
 * mode. The proxy translates between formats, so a single provider serves both the
 * OpenAI surfaces and Claude Code (Anthropic Messages) regardless of the upstream
 * wire format — only `codewhisperer` (Kiro, system-managed) is special.
 */

export type TransportMode = "responses" | "chat_completions" | "codewhisperer";

export type ApiCompat = {
  /** Short label, e.g. "OpenAI Responses". */
  label: string;
  /** The client endpoint path this maps to. */
  endpoint: string;
};

export function normalizeTransportMode(value: unknown): TransportMode {
  if (value === "chat_completions" || value === "codewhisperer") {
    return value;
  }
  return "responses";
}

export const TRANSPORT_LABELS: Record<TransportMode, string> = {
  responses: "OpenAI Responses",
  chat_completions: "OpenAI Chat Completions",
  codewhisperer: "Kiro CodeWhisperer",
};

/**
 * The client APIs a provider serves. Both OpenAI transports serve all three
 * OpenAI-compatible endpoints plus Claude Code via translation. CodeWhisperer
 * (Kiro) is handled by its own path and also serves Claude Code.
 */
export function clientApisForTransport(mode: TransportMode): ApiCompat[] {
  if (mode === "codewhisperer") {
    return [
      { label: "OpenAI Responses", endpoint: "/v1/responses" },
      { label: "Claude Code", endpoint: "/v1/messages" },
    ];
  }
  return [
    { label: "OpenAI Responses", endpoint: "/v1/responses" },
    { label: "OpenAI Chat", endpoint: "/v1/chat/completions" },
    { label: "Claude Code", endpoint: "/v1/messages" },
  ];
}
