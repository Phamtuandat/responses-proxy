#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/tailnet-lib.sh"

require_tailscale
require_local_proxy

tailscale funnel --bg "$TAILSCALE_LOCAL_TARGET"

echo "responses-proxy is now exposed publicly through Tailscale Funnel."
if url="$(tailnet_https_url)"; then
  echo "Public URL: $url"
fi
echo
tailscale funnel status
