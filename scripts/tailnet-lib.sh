#!/bin/zsh
set -euo pipefail

TAILSCALE_LOCAL_TARGET="${TAILSCALE_LOCAL_TARGET:-http://127.0.0.1:8318}"
TAILSCALE_FUNNEL_HTTPS_PORT="${TAILSCALE_FUNNEL_HTTPS_PORT:-443}"

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
  case "$TAILSCALE_LOCAL_TARGET" in
    http://127.0.0.1:*|http://localhost:*)
      ;;
    *)
      echo "TAILSCALE_LOCAL_TARGET must point at localhost, got: $TAILSCALE_LOCAL_TARGET"
      echo "Expose responses-proxy through Tailscale Funnel only after binding Docker to 127.0.0.1."
      exit 1
      ;;
  esac

  if ! curl -fsS "$TAILSCALE_LOCAL_TARGET/health" >/dev/null 2>&1; then
    echo "responses-proxy is not responding at $TAILSCALE_LOCAL_TARGET"
    echo "Start it first with: $(cd "$(dirname "$0")/.." && pwd)/scripts/start.sh"
    exit 1
  fi
}

require_valid_funnel_https_port() {
  case "$TAILSCALE_FUNNEL_HTTPS_PORT" in
    443|8443|10000)
      ;;
    *)
      echo "TAILSCALE_FUNNEL_HTTPS_PORT must be one of 443, 8443, or 10000."
      echo "Got: $TAILSCALE_FUNNEL_HTTPS_PORT"
      exit 1
      ;;
  esac
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
