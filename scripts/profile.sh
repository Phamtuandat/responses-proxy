#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

resolve_profile() {
  printf '%s\n' "${RESPONSES_PROXY_ENV_PROFILE:-dev-mac}"
}

compose_project_name() {
  case "$(resolve_profile)" in
    dev-mac)
      printf '%s\n' "responses-proxy-dev"
      ;;
    prod-omv)
      printf '%s\n' "responses-proxy-prod"
      ;;
    *)
      printf '%s\n' "responses-proxy-$(resolve_profile)"
      ;;
  esac
}

compose_env_file() {
  case "$(resolve_profile)" in
    dev-mac)
      printf '%s\n' "$ROOT_DIR/env/dev.mac.env"
      ;;
    prod-omv)
      printf '%s\n' "$ROOT_DIR/env/prod.omv.env"
      ;;
    *)
      printf '%s\n' "$ROOT_DIR/env/$(resolve_profile).env"
      ;;
  esac
}

compose_file() {
  printf '%s\n' "$ROOT_DIR/docker-compose.yml"
}

host_logs_dir() {
  local env_file value
  env_file="$(compose_env_file)"
  value="$(grep -E '^RESPONSES_PROXY_HOST_LOGS_DIR=' "$env_file" 2>/dev/null | head -n 1 | cut -d= -f2- || true)"
  if [ -n "$value" ]; then
    printf '%s\n' "$value"
    return 0
  fi
  printf '%s\n' "./logs"
}

host_logs_dir_abs() {
  local value
  value="$(host_logs_dir)"
  case "$value" in
    /*)
      printf '%s\n' "$value"
      ;;
    *)
      printf '%s\n' "$ROOT_DIR/$value"
      ;;
  esac
}

ensure_env_file() {
  local env_file
  env_file="$(compose_env_file)"

  if [ -f "$env_file" ]; then
    return 0
  fi

  case "$(resolve_profile)" in
    dev-mac)
      if [ -f "${env_file}.example" ]; then
        cp "${env_file}.example" "$env_file"
        echo "Created $env_file from example."
        return 0
      fi
      ;;
  esac

  echo "Missing env file: $env_file"
  echo "Set RESPONSES_PROXY_ENV_PROFILE=dev-mac or prod-omv, then create the file."
  exit 1
}

ensure_host_logs_dir() {
  mkdir -p "$(host_logs_dir_abs)"
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker is required but not installed."
    exit 1
  fi

  if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose is required but not available."
    exit 1
  fi
}

compose_run() {
  docker compose \
    --project-name "$(compose_project_name)" \
    --env-file "$(compose_env_file)" \
    -f "$(compose_file)" \
    "$@"
}
