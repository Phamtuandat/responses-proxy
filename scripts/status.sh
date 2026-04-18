#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
docker compose -f "$ROOT_DIR/docker-compose.yml" ps responses-proxy
echo
curl -fsS http://127.0.0.1:8318/health || true
echo
