#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/profile.sh"

require_docker
ensure_env_file
ensure_host_logs_dir

compose_run up -d responses-proxy telegram-bot telegram-bot-worker
