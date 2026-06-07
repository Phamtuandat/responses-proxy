/**
 * Backend model-prefix resolution — mirrors the client's providerShortPrefix
 * mapping so we can map a "prefix/model" proxy model string back to a concrete
 * provider id (used by MITM combo resolution and model mapping).
 */

export const PROVIDER_SHORT_PREFIXES: Record<string, string> = {
  "account-kiro": "kr",
  "kiro-ide": "kr",
  "kiro-free": "kr",
  "account-openai-codex": "cx",
  "openai-codex": "cx",
  "codex": "cx",
  "openai": "openai",
  "anthropic": "anthropic",
  "claude-code": "cc",
  "deepseek": "deepseek",
  "groq": "groq",
  "google-gemini": "gemini",
  "gemini": "gemini",
  "mistral": "mistral",
  "openrouter": "or",
  "together-ai": "together",
  "together": "together",
};

export function providerShortPrefix(id: string, name: string): string {
  const direct = PROVIDER_SHORT_PREFIXES[id];
  if (direct) return direct;

  const nameKey = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const byName = PROVIDER_SHORT_PREFIXES[nameKey];
  if (byName) return byName;

  for (const [key, prefix] of Object.entries(PROVIDER_SHORT_PREFIXES)) {
    if (id.startsWith(key)) return prefix;
  }

  return id.replace(/^account-/, "");
}

/**
 * Given a list of providers and a proxy model string (possibly "prefix/model"),
 * resolve the target provider id. The model string is returned unchanged — the
 * downstream provider strips its own prefix via rewriteModelForProvider.
 */
export function resolveProxyModel(
  providers: Array<{ id: string; name: string }>,
  modelStr: string,
): { providerId: string | null; model: string } {
  const slash = modelStr.indexOf("/");
  if (slash < 0) return { providerId: null, model: modelStr };

  const prefix = modelStr.slice(0, slash);
  for (const p of providers) {
    if (providerShortPrefix(p.id, p.name) === prefix) {
      return { providerId: p.id, model: modelStr };
    }
  }
  return { providerId: null, model: modelStr };
}
