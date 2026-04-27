#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/tailnet-lib.sh"

require_tailscale
require_local_proxy

tailscale serve --bg "$TAILSCALE_LOCAL_TARGET"

echo "responses-proxy is now exposed inside the tailnet."
if url="$(tailnet_https_url)"; then
  echo "Tailnet URL: $url"
fi
echo
tailscale serve status
