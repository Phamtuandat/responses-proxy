/**
 * MITM Model Mappings — maps each tool's native model names to proxy models.
 *
 * e.g. antigravity "gemini-3.5-flash-low" → "kr/claude-sonnet-4.5"
 *
 * Stored as JSON at ~/.responses-proxy/mitm/model-mappings.json
 * Used by the MITM proxy to rewrite the model in intercepted requests.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const MAPPINGS_FILE = path.join(
  process.env.RESPONSES_PROXY_MITM_DIR || path.join(os.homedir(), ".responses-proxy", "mitm"),
  "model-mappings.json",
);

type ToolMappings = Record<string, Record<string, string>>; // { toolId: { nativeModel: proxyModel } }

function load(): ToolMappings {
  try {
    if (!existsSync(MAPPINGS_FILE)) return {};
    return JSON.parse(readFileSync(MAPPINGS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function save(data: ToolMappings): void {
  try {
    mkdirSync(path.dirname(MAPPINGS_FILE), { recursive: true });
    writeFileSync(MAPPINGS_FILE, JSON.stringify(data, null, 2));
  } catch { /* best effort */ }
}

export function getToolMappings(toolId: string): Record<string, string> {
  const all = load();
  return all[toolId] || {};
}

export function setToolMappings(toolId: string, mappings: Record<string, string>): void {
  const all = load();
  // Filter out empty values
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(mappings)) {
    if (v && v.trim()) cleaned[k] = v.trim();
  }
  all[toolId] = cleaned;
  save(all);
}

export function getAllMappings(): ToolMappings {
  return load();
}

/**
 * Resolve the proxy model for an intercepted request.
 * Returns the mapped model, or null if no mapping exists (passthrough).
 *
 * Mapping values may be stored as either:
 *   - "providerId::model"  (provider-aware — preferred)
 *   - "model"              (legacy / provider inferred by proxy)
 */
export function resolveModel(toolId: string, nativeModel: string): string | null {
  const mappings = getToolMappings(toolId);
  const raw = mappings[nativeModel];
  if (!raw) return null;
  const sep = raw.indexOf("::");
  return sep >= 0 ? raw.slice(sep + 2) : raw;
}

/**
 * Resolve both the target provider id and model for routing.
 * Returns null when no mapping exists.
 */
export function resolveModelRouting(
  toolId: string,
  nativeModel: string,
): { providerId: string | null; model: string } | null {
  const mappings = getToolMappings(toolId);
  const raw = mappings[nativeModel];
  if (!raw) return null;
  const sep = raw.indexOf("::");
  if (sep >= 0) {
    return { providerId: raw.slice(0, sep) || null, model: raw.slice(sep + 2) };
  }
  return { providerId: null, model: raw };
}
