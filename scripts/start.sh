#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
docker compose -f "$ROOT_DIR/docker-compose.yml" up -d responses-proxy
