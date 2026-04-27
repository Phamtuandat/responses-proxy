import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { homedir } from "node:os";

export type QuickApplyClient = "hermes" | "codex";

export type QuickApplyPaths = {
  hermesConfigPath: string;
  codexConfigPath: string;
  codexAuthPath: string;
  backupDir: string;
};

export type QuickApplyTargetConfig = {
  client: QuickApplyClient;
  routeApiKey: string;
  proxyBaseUrl: string;
  model?: string;
};

export type QuickApplyStatus = {
  client: QuickApplyClient;
  path: string;
  exists: boolean;
  configured: boolean;
  routeApiKey: string;
  detected: Record<string, string | null>;
  auth?: {
    path: string;
    exists: boolean;
    configured: boolean;
    detectedApiKey: string | null;
    backups: QuickApplyBackupEntry[];
  };
};

export type QuickApplyBackupEntry = {
  path: string;
  fileName: string;
  modifiedAt: string;
  sizeBytes: number;
};

export type QuickConfigWriteResult = {
  changed: boolean;
  backupCreated: boolean;
  backupPath?: string;
};

export function resolveQuickApplyPaths(overrides?: Partial<QuickApplyPaths>): QuickApplyPaths {
  const home = homedir();
  return {
    hermesConfigPath: overrides?.hermesConfigPath?.trim() || `${home}/.hermes/config.yaml`,
    codexConfigPath: overrides?.codexConfigPath?.trim() || `${home}/.codex/config.toml`,
    codexAuthPath: `${home}/.codex/auth.json`,
    backupDir: overrides?.backupDir?.trim() || `${home}/.responses-proxy/client-config-backups`,
  };
}

export function generateRouteApiKey(client: QuickApplyClient): string {
  return `sk-${client}-route-${randomBytes(12).toString("hex")}`;
}

export function normalizeProxyBaseUrl(value: string | null | undefined): string {
  const trimmed = value?.trim() || "";
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/\/+$/, "");
}

export function readQuickApplyStatus(
  raw: string | undefined,
  config: QuickApplyTargetConfig,
  path: string,
): QuickApplyStatus {
  if (config.client === "hermes") {
    return readHermesStatus(raw, config, path);
  }
  return readCodexStatus(raw, config, path);
}

export function applyQuickConfig(raw: string | undefined, config: QuickApplyTargetConfig): string {
  if (config.client === "hermes") {
    return applyHermesConfig(raw, config);
  }
  return applyCodexConfig(raw, config);
}

export function readCodexAuthStatus(
  raw: string | undefined,
  routeApiKey: string,
  path: string,
  options?: { backupDir?: string },
) {
  const data = parseJsonObject(raw);
  const detectedApiKey = typeof data.OPENAI_API_KEY === "string" ? data.OPENAI_API_KEY : null;
  return {
    path,
    exists: typeof raw === "string",
    configured: detectedApiKey === routeApiKey,
    detectedApiKey,
    backups: listRecentConfigBackups(path, 1, options),
  };
}

export function applyCodexAuth(raw: string | undefined, routeApiKey: string): string {
  const data = parseJsonObject(raw);
  data.OPENAI_API_KEY = routeApiKey;
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function writeQuickConfigFile(
  filePath: string,
  nextRaw: string,
  options?: { backupDir?: string },
): QuickConfigWriteResult {
  mkdirSync(dirname(filePath), { recursive: true });
  if (existsSync(filePath)) {
    const currentRaw = readFileSync(filePath, "utf8");
    if (currentRaw === nextRaw) {
      return { changed: false, backupCreated: false };
    }
    const backupPath = buildTimestampedBackupPath(filePath, new Date(), options?.backupDir);
    mkdirSync(dirname(backupPath), { recursive: true });
    writeFileSync(backupPath, currentRaw, "utf8");
    writeFileSync(filePath, nextRaw, "utf8");
    return { changed: true, backupCreated: true, backupPath };
  }
  writeFileSync(filePath, nextRaw, "utf8");
  return { changed: true, backupCreated: false };
}

export function readQuickConfigFile(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

export function listRecentConfigBackups(
  filePath: string,
  limit = 5,
  options?: { backupDir?: string },
): QuickApplyBackupEntry[] {
  try {
    const directory = options?.backupDir?.trim() || dirname(filePath);
    const fileName = basename(filePath);
    return readdirSync(directory)
      .filter((entry) => entry.startsWith(`${fileName}.`) && entry.endsWith(".bak"))
      .map((entry) => {
        const fullPath = `${directory}/${entry}`;
        const stats = statSync(fullPath);
        return {
          path: fullPath,
          fileName: entry,
          modifiedAt: stats.mtime.toISOString(),
          sizeBytes: stats.size,
        };
      })
      .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
      .slice(0, limit);
  } catch {
    return [];
  }
}

function readHermesStatus(
  raw: string | undefined,
  config: QuickApplyTargetConfig,
  path: string,
): QuickApplyStatus {
  const detected = {
    model: readYamlSectionKey(raw, "model", "default"),
    provider: readYamlSectionKey(raw, "model", "provider"),
    apiKey: readYamlSectionKey(raw, "model", "api_key"),
    baseUrl: readYamlSectionKey(raw, "model", "base_url"),
    apiMode: readYamlSectionKey(raw, "model", "api_mode"),
  };

  return {
    client: "hermes",
    path,
    exists: typeof raw === "string",
    configured:
      detected.provider === "custom" &&
      normalizeProxyBaseUrl(detected.baseUrl) === normalizeProxyBaseUrl(config.proxyBaseUrl) &&
      detected.apiKey === config.routeApiKey &&
      detected.apiMode === "codex_responses",
    routeApiKey: config.routeApiKey,
    detected,
  };
}

function readCodexStatus(
  raw: string | undefined,
  config: QuickApplyTargetConfig,
  path: string,
): QuickApplyStatus {
  const providerName = readTomlTopLevelString(raw, "model_provider");
  const section = providerName ? readTomlSection(raw, `model_providers.${providerName}`) : undefined;
  const detected = {
    model: readTomlTopLevelString(raw, "model") ?? null,
    modelProvider: providerName ?? null,
    providerName: section ? readTomlString(section, "name") ?? providerName ?? null : null,
    apiKey: section ? readTomlString(section, "api_key") ?? null : null,
    baseUrl: section ? readTomlString(section, "base_url") ?? null : null,
    wireApi: section ? readTomlString(section, "wire_api") ?? null : null,
  };

  return {
    client: "codex",
    path,
    exists: typeof raw === "string",
    configured:
      detected.modelProvider === "responses_proxy" &&
      normalizeProxyBaseUrl(detected.baseUrl) === normalizeProxyBaseUrl(config.proxyBaseUrl) &&
      detected.apiKey === config.routeApiKey &&
      detected.wireApi === "responses",
    routeApiKey: config.routeApiKey,
    detected,
  };
}

export function applyHermesConfig(raw: string | undefined, config: QuickApplyTargetConfig): string {
  const currentModel = readYamlSectionKey(raw, "model", "default");
  const nextModel = config.model?.trim() || currentModel || "gpt-5.4";
  const nextBaseUrl = normalizeProxyBaseUrl(config.proxyBaseUrl);
  let nextRaw = typeof raw === "string" && raw.trim() ? raw : "";

  nextRaw = upsertYamlSectionKey(nextRaw, "model", "default", nextModel);
  nextRaw = upsertYamlSectionKey(nextRaw, "model", "provider", "custom");
  nextRaw = upsertYamlSectionKey(nextRaw, "model", "api_key", config.routeApiKey);
  nextRaw = upsertYamlSectionKey(nextRaw, "model", "base_url", nextBaseUrl);
  nextRaw = upsertYamlSectionKey(nextRaw, "model", "api_mode", "codex_responses");

  return ensureTrailingNewline(nextRaw);
}

export function applyCodexConfig(raw: string | undefined, config: QuickApplyTargetConfig): string {
  const currentModel = readTomlTopLevelString(raw, "model");
  const nextModel = config.model?.trim() || currentModel || "gpt-5.4";
  const nextBaseUrl = normalizeProxyBaseUrl(config.proxyBaseUrl);
  let nextRaw = typeof raw === "string" && raw.trim() ? raw : "";

  nextRaw = upsertTomlTopLevelString(nextRaw, "model", nextModel);
  nextRaw = upsertTomlTopLevelString(nextRaw, "model_provider", "responses_proxy");
  nextRaw = upsertTomlSectionString(nextRaw, "model_providers.responses_proxy", "name", "responses-proxy");
  nextRaw = upsertTomlSectionString(nextRaw, "model_providers.responses_proxy", "base_url", nextBaseUrl);
  nextRaw = upsertTomlSectionString(nextRaw, "model_providers.responses_proxy", "api_key", config.routeApiKey);
  nextRaw = upsertTomlSectionString(nextRaw, "model_providers.responses_proxy", "wire_api", "responses");

  return ensureTrailingNewline(nextRaw);
}

function upsertYamlSectionKey(raw: string, section: string, key: string, value: string): string {
  const encodedValue = encodeYamlScalar(value);
  const lines = raw ? raw.split("\n") : [];
  const bounds = findYamlSectionBounds(lines, section);

  if (!bounds) {
    const prefix = raw.trim() ? `${raw.replace(/\s*$/, "\n\n")}` : "";
    return `${prefix}${section}:\n  ${key}: ${encodedValue}\n`;
  }

  const nextLines = [...lines];
  let updated = false;
  for (let index = bounds.start + 1; index < bounds.end; index += 1) {
    if (new RegExp(`^\\s{2}${escapeRegExp(key)}:`).test(nextLines[index])) {
      nextLines[index] = `  ${key}: ${encodedValue}`;
      updated = true;
      break;
    }
  }
  if (!updated) {
    nextLines.splice(bounds.end, 0, `  ${key}: ${encodedValue}`);
  }

  return nextLines.join("\n");
}

function readYamlSectionKey(raw: string | undefined, section: string, key: string): string | null {
  if (!raw) {
    return null;
  }
  const lines = raw.split("\n");
  const bounds = findYamlSectionBounds(lines, section);
  if (!bounds) {
    return null;
  }
  for (let index = bounds.start + 1; index < bounds.end; index += 1) {
    const match = lines[index].match(new RegExp(`^\\s{2}${escapeRegExp(key)}:\\s*(.+?)\\s*$`));
    if (match?.[1]) {
      return stripYamlQuotes(match[1].trim());
    }
  }
  return null;
}

function encodeYamlScalar(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function stripYamlQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function upsertTomlTopLevelString(raw: string, key: string, value: string): string {
  const encodedValue = JSON.stringify(value);
  const pattern = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*\"[^\"]*\"\\s*$`, "m");
  if (pattern.test(raw)) {
    return raw.replace(pattern, `${key} = ${encodedValue}`);
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return `${key} = ${encodedValue}\n`;
  }

  return `${key} = ${encodedValue}\n${raw}`;
}

function upsertTomlSectionString(raw: string, sectionName: string, key: string, value: string): string {
  const encodedValue = JSON.stringify(value);
  const lines = raw ? raw.split("\n") : [];
  const bounds = findTomlSectionBounds(lines, sectionName);
  if (!bounds) {
    const prefix = raw.trim() ? `${raw.replace(/\s*$/, "\n\n")}` : "";
    return `${prefix}[${sectionName}]\n${key} = ${encodedValue}\n`;
  }

  const nextLines = [...lines];
  let updated = false;
  for (let index = bounds.start + 1; index < bounds.end; index += 1) {
    if (new RegExp(`^${escapeRegExp(key)}\\s*=`).test(nextLines[index])) {
      nextLines[index] = `${key} = ${encodedValue}`;
      updated = true;
      break;
    }
  }
  if (!updated) {
    nextLines.splice(bounds.end, 0, `${key} = ${encodedValue}`);
  }

  return nextLines.join("\n");
}

function readTomlTopLevelString(raw: string | undefined, key: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  const match = raw.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*\"([^\"]+)\"\\s*$`, "m"));
  return match?.[1];
}

function readTomlSection(raw: string | undefined, sectionName: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  const lines = raw.split("\n");
  const bounds = findTomlSectionBounds(lines, sectionName);
  if (!bounds) {
    return undefined;
  }
  return lines.slice(bounds.start + 1, bounds.end).join("\n");
}

function readTomlString(rawSection: string, key: string): string | undefined {
  const match = rawSection.match(new RegExp(`^${escapeRegExp(key)}\\s*=\\s*\"([^\"]+)\"\\s*$`, "m"));
  return match?.[1];
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ...parsed }
      : {};
  } catch {
    return {};
  }
}

function ensureTrailingNewline(raw: string): string {
  return raw.endsWith("\n") ? raw : `${raw}\n`;
}

function findYamlSectionBounds(
  lines: string[],
  section: string,
): { start: number; end: number } | undefined {
  const start = lines.findIndex((line) => line.trim() === `${section}:`);
  if (start === -1) {
    return undefined;
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && !/^\s/.test(line)) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function findTomlSectionBounds(
  lines: string[],
  sectionName: string,
): { start: number; end: number } | undefined {
  const start = lines.findIndex((line) => line.trim() === `[${sectionName}]`);
  if (start === -1) {
    return undefined;
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith("[") && lines[index].trim().endsWith("]")) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function buildTimestampedBackupPath(filePath: string, date: Date, backupDir?: string): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const padMs = (value: number) => String(value).padStart(3, "0");
  const timestamp = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    "-",
    padMs(date.getMilliseconds()),
  ].join("");
  const fileName = basename(filePath);
  const targetDir = backupDir?.trim() || dirname(filePath);
  return `${targetDir}/${fileName}.${timestamp}.bak`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
