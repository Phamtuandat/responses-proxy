#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/tailnet-lib.sh"

require_tailscale

tailscale funnel reset
tailscale serve reset

echo "Tailscale serve and funnel config reset."
