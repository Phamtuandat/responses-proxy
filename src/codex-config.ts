import { homedir } from "node:os";
import { readFileSync } from "node:fs";

export type CodexProviderConfig = {
  name: string;
  baseUrl: string;
  wireApi?: string;
};

export function resolveDefaultCodexConfigPath(): string {
  return `${homedir()}/.codex/config.toml`;
}

export function readCodexProviderFromConfig(
  filePath: string,
): CodexProviderConfig | undefined {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }

  const providerName = readTopLevelTomlString(raw, "model_provider");
  if (!providerName) {
    return undefined;
  }

  const section = readTomlSection(raw, `model_providers.${providerName}`);
  if (!section) {
    return undefined;
  }

  const baseUrl = readTomlString(section, "base_url");
  if (!baseUrl) {
    return undefined;
  }

  return {
    name: readTomlString(section, "name") ?? providerName,
    baseUrl,
    wireApi: readTomlString(section, "wire_api"),
  };
}

function readTopLevelTomlString(raw: string, key: string): string | undefined {
  const match = raw.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*\"([^\"]+)\"\\s*$`, "m"));
  return match?.[1];
}

function readTomlSection(raw: string, sectionName: string): string | undefined {
  const escaped = escapeRegExp(sectionName);
  const match = raw.match(new RegExp(`^\\[${escaped}\\]\\s*$([\\s\\S]*?)(?=^\\[|\\Z)`, "m"));
  return match?.[1];
}

function readTomlString(rawSection: string, key: string): string | undefined {
  const match = rawSection.match(
    new RegExp(`^${escapeRegExp(key)}\\s*=\\s*\"([^\"]+)\"\\s*$`, "m"),
  );
  return match?.[1];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
