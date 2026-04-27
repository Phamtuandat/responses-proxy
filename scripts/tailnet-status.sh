#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/tailnet-lib.sh"

require_tailscale

if url="$(tailnet_https_url)"; then
  echo "Tailnet base URL: $url"
  echo
fi

echo "Serve status:"
tailscale serve status
echo
echo "Funnel status:"
tailscale funnel status
