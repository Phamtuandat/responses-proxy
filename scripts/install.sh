#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
EXAMPLE_FILE="$ROOT_DIR/.env.example"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but not installed."
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "docker compose is required but not available."
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  echo "Created $ENV_FILE from .env.example"
fi

mkdir -p "$ROOT_DIR/logs"

echo "Building and starting responses-proxy..."
docker compose -f "$ROOT_DIR/docker-compose.yml" up --build -d responses-proxy

cat <<EOF

responses-proxy is installed and running.

Open UI:
  http://127.0.0.1:8318/

Useful commands:
  $ROOT_DIR/scripts/start.sh
  $ROOT_DIR/scripts/stop.sh
  $ROOT_DIR/scripts/status.sh
  $ROOT_DIR/scripts/logs.sh
  $ROOT_DIR/scripts/open.sh

Optional macOS auto-start:
  $ROOT_DIR/scripts/install-launch-agent.sh
EOF
