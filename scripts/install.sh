#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT_DIR/scripts/profile.sh"

require_docker
ensure_env_file
ensure_host_logs_dir

compose_run up --build -d responses-proxy telegram-bot telegram-bot-worker

cat <<EOF

responses-proxy and Telegram bot services are installed and running.

Profile:
  $(resolve_profile)

Open UI:
  http://127.0.0.1:8318/

Useful commands:
  $ROOT_DIR/scripts/start.sh
  $ROOT_DIR/scripts/stop.sh
  $ROOT_DIR/scripts/status.sh
  $ROOT_DIR/scripts/logs.sh
  $ROOT_DIR/scripts/open.sh

EOF
