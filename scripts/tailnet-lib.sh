#!/bin/zsh
set -euo pipefail

TAILSCALE_LOCAL_TARGET="${TAILSCALE_LOCAL_TARGET:-http://127.0.0.1:8318}"

require_tailscale() {
  if ! command -v tailscale >/dev/null 2>&1; then
    echo "tailscale is required but not installed."
    exit 1
  fi

  if ! tailscale status >/dev/null 2>&1; then
    echo "tailscaled is not available. Start Tailscale and connect this machine to your tailnet first."
    exit 1
  fi
}

require_local_proxy() {
  if ! curl -fsS "$TAILSCALE_LOCAL_TARGET/health" >/dev/null 2>&1; then
    echo "responses-proxy is not responding at $TAILSCALE_LOCAL_TARGET"
    echo "Start it first with: $(cd "$(dirname "$0")/.." && pwd)/scripts/start.sh"
    exit 1
  fi
}

tailnet_https_url() {
  local dns_name
  dns_name="$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  dns_name="${dns_name%.}"

  if [ -n "$dns_name" ]; then
    printf 'https://%s\n' "$dns_name"
    return 0
  fi

  return 1
}
