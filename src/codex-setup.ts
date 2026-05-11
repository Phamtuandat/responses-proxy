import { createHash } from "node:crypto";

export type CodexConfigFiles = {
  configToml: string;
  authJson: string;
};

export function buildCodexConfigFiles(input: {
  baseUrl: string;
  apiKey: string;
  model?: string;
}): CodexConfigFiles {
  const model = input.model?.trim() || "gpt-5.5";
  const baseUrl = input.baseUrl.trim();
  const apiKey = input.apiKey.trim();

  return {
    configToml: [
      `model = ${tomlString(model)}`,
      `model_provider = "resproxy"`,
      `model_reasoning_effort = "medium"`,
      "",
      `[model_providers.resproxy]`,
      `name = "resproxy"`,
      `base_url = ${tomlString(baseUrl)}`,
      `api_key = ${tomlString(apiKey)}`,
      `wire_api = "responses"`,
      "",
    ].join("\n"),
    authJson: `${JSON.stringify(
      {
        auth_mode: "apikey",
        OPENAI_API_KEY: apiKey,
      },
      null,
      2,
    )}\n`,
  };
}

export function buildCodexSetupEndpointUrl(publicResponsesBaseUrl: string): string {
  const trimmed = publicResponsesBaseUrl.trim().replace(/\/+$/, "");
  const origin = trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
  return `${origin}/api/customer/codex/setup.sh`;
}

export function buildCodexSetupCurlCommand(input: {
  publicResponsesBaseUrl: string;
  apiKey: string;
}): string {
  const setupUrl = buildCodexSetupEndpointUrl(input.publicResponsesBaseUrl);
  return [
    "curl -fsSL \\",
    `  -H 'Authorization: Bearer ${escapeShellSingleQuote(input.apiKey.trim())}' \\`,
    `  '${escapeShellSingleQuote(setupUrl)}' \\`,
    "  | sh",
  ].join("\n");
}

export function buildCodexConfigSetupScript(input: CodexConfigFiles & { targetDir?: string }): string {
  const targetDir = input.targetDir?.trim() || "$HOME/.codex";
  const configDelimiter = buildHeredocDelimiter("RESPONSES_PROXY_CODEX_CONFIG", input.configToml);
  const authDelimiter = buildHeredocDelimiter("RESPONSES_PROXY_CODEX_AUTH", input.authJson);

  return [
    "#!/usr/bin/env sh",
    "set -eu",
    "umask 077",
    'tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/responses-proxy-codex.XXXXXX")"',
    'trap \'rm -rf "$tmpdir"\' EXIT INT TERM',
    `cat > "$tmpdir/config.toml" <<'${configDelimiter}'`,
    input.configToml,
    configDelimiter,
    `cat > "$tmpdir/auth.json" <<'${authDelimiter}'`,
    input.authJson,
    authDelimiter,
    "install_file() {",
    '  src="$1"',
    '  dest="$2"',
    '  dest_dir="$(dirname "$dest")"',
    '  mkdir -p "$dest_dir"',
    '  if [ -f "$dest" ] && cmp -s "$src" "$dest"; then',
    '    printf "%s\\n" "unchanged: $dest"',
    "    return 0",
    "  fi",
    '  if [ -f "$dest" ]; then',
    '    backup="$dest.$(date +%Y%m%d-%H%M%S).bak"',
    '    cp "$dest" "$backup"',
    '    printf "%s\\n" "backup: $backup"',
    "  fi",
    '  mv "$src" "$dest"',
    '  printf "%s\\n" "updated: $dest"',
    "}",
    `install_file "$tmpdir/config.toml" "${targetDir}/config.toml"`,
    `install_file "$tmpdir/auth.json" "${targetDir}/auth.json"`,
    'printf "%s\\n" "Codex setup applied."',
    "",
  ].join("\n");
}

function buildHeredocDelimiter(prefix: string, content: string): string {
  const digest = createHash("sha256").update(content).digest("hex").slice(0, 16).toUpperCase();
  return `${prefix}_${digest}`;
}

function escapeShellSingleQuote(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}
