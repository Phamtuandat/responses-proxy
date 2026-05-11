#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/profile.sh"

require_docker

compose_run logs --tail "${1:-200}" -f responses-proxy telegram-bot telegram-bot-worker
