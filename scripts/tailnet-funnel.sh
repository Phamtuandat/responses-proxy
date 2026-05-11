#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/tailnet-lib.sh"

require_valid_funnel_https_port
require_local_proxy
require_tailscale

tailscale funnel --bg --https "$TAILSCALE_FUNNEL_HTTPS_PORT" "$TAILSCALE_LOCAL_TARGET"

echo "responses-proxy is now exposed publicly through Tailscale Funnel."
if url="$(tailnet_https_url)"; then
  echo "Public URL: $url"
fi
echo
tailscale funnel status
