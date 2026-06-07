/**
 * Claude Code CLI "housekeeping" request bypass.
 *
 * Claude Code fires frequent background requests against the configured model —
 * conversation-title generation, topic detection, warmup pings, token counts —
 * in addition to the user's real prompts. When every one of these is forwarded
 * to a single Kiro/CodeWhisperer account, the extra volume pushes the account
 * into 429 "Too many requests" throttling far sooner.
 *
 * 9router avoids this by short-circuiting these requests: it recognises the
 * Claude CLI housekeeping patterns and returns a canned response WITHOUT calling
 * the upstream provider at all. This module ports that behaviour for the
 * Anthropic Messages (`/v1/messages`) path.
 *
 * Mirrors `open-sse/utils/bypassHandler.js` + `SKIP_PATTERNS` from 9router.
 */

import {
  AnthropicSseEmitter,
  buildAnthropicMessage,
} from "./anthropic-messages.js";
import { estimateTokens } from "./kiro-codewhisperer.js";

/**
 * User text fragments that mark a non-interactive housekeeping request. A user
 * message containing any of these is answered locally instead of upstream.
 * Mirrors 9router's `SKIP_PATTERNS`.
 */
export const ANTHROPIC_SKIP_PATTERNS: readonly string[] = [
  "Please write a 5-10 word title for the following conversation:",
];

/** Canned text returned for a plain (non-naming) bypass. Matches 9router. */
const DEFAULT_BYPASS_TEXT = "CLI Command Execution: Clear Terminal";

type AnthropicMessage = {
  role?: unknown;
  content?: unknown;
};

/** Extract plain text from an Anthropic message/system `content` value. */
function contentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter(
        (block): block is { type?: unknown; text?: unknown } =>
          typeof block === "object" && block !== null,
      )
      .filter((block) => block.type === "text" || typeof block.text === "string")
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .join(" ");
  }
  return "";
}

/** Read the Anthropic top-level `system` field (string or text-block array) as text. */
function systemToText(system: unknown): string {
  if (typeof system === "string") {
    return system;
  }
  if (Array.isArray(system)) {
    return system
      .filter(
        (block): block is { type?: unknown; text?: unknown } =>
          typeof block === "object" && block !== null,
      )
      .filter((block) => block.type === "text")
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .join(" ");
  }
  return "";
}

/** What the bypass produced: the canned assistant text to return to the client. */
export type AnthropicBypassDecision = { text: string };

/**
 * Decide whether an Anthropic Messages request is a Claude CLI housekeeping call
 * that should be answered locally. Returns the canned reply text, or `null` to
 * forward the request upstream.
 *
 * Only Claude CLI requests are eligible (User-Agent contains `claude-cli`), so
 * requests from other clients are never silently short-circuited.
 *
 * @param body       Raw Anthropic request body (`messages`, `system`, ...).
 * @param userAgent  Request User-Agent header.
 * @param options.namingEnabled  Enable the `isNewTopic` title-generation bypass.
 */
export function detectAnthropicBypass(
  body: Record<string, unknown>,
  userAgent: string,
  options: { namingEnabled?: boolean } = {},
): AnthropicBypassDecision | null {
  if (!userAgent.includes("claude-cli")) {
    return null;
  }
  const messages = Array.isArray(body.messages) ? (body.messages as AnthropicMessage[]) : [];
  if (messages.length === 0) {
    return null;
  }

  // Pattern 1: title extraction — Claude CLI seeds the assistant turn with "{"
  // to coerce a JSON title completion.
  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.role === "assistant" && contentToText(lastMsg.content).trim() === "{") {
    return { text: DEFAULT_BYPASS_TEXT };
  }

  // Pattern 2: warmup ping.
  if (contentToText(messages[0]?.content).trim() === "Warmup") {
    return { text: DEFAULT_BYPASS_TEXT };
  }

  // Pattern 3: single "count" probe.
  if (
    messages.length === 1 &&
    messages[0]?.role === "user" &&
    contentToText(messages[0]?.content).trim() === "count"
  ) {
    return { text: DEFAULT_BYPASS_TEXT };
  }

  // Pattern 4: configured skip patterns anywhere in the user text.
  const userText = messages
    .filter((m) => m.role === "user")
    .map((m) => contentToText(m.content))
    .join(" ");
  if (ANTHROPIC_SKIP_PATTERNS.some((pattern) => userText.includes(pattern))) {
    return { text: DEFAULT_BYPASS_TEXT };
  }

  // Pattern 5: topic-naming request — system prompt asks for an `isNewTopic`
  // JSON verdict. Generate a short title from the first user message locally.
  if (options.namingEnabled) {
    const systemText = systemToText(body.system);
    if (systemText.includes("isNewTopic")) {
      const firstUser = messages.find((m) => m.role === "user");
      const title = contentToText(firstUser?.content)
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .join(" ");
      return { text: JSON.stringify({ isNewTopic: true, title }) };
    }
  }

  return null;
}

/** Build the non-streaming Anthropic message payload for a bypassed request. */
export function buildBypassMessage(model: string, text: string): Record<string, unknown> {
  return buildAnthropicMessage({
    text,
    toolUses: [],
    model,
    inputTokens: 1,
    outputTokens: Math.max(1, estimateTokens(text)),
  });
}

/** Build the Anthropic SSE frame sequence for a bypassed streaming request. */
export function buildBypassSseFrames(model: string, text: string): string[] {
  const emitter = new AnthropicSseEmitter({ model, inputTokens: 1 });
  return [
    ...emitter.start(),
    ...emitter.textDelta(text),
    ...emitter.finish(Math.max(1, estimateTokens(text))),
  ];
}
