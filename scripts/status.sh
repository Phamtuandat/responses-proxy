#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/profile.sh"

require_docker

compose_run ps responses-proxy telegram-bot telegram-bot-worker
echo
curl -fsS http://127.0.0.1:8318/health || true
echo
