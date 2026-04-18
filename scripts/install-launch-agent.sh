#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$ROOT_DIR/packaging/macos/ai.openclaw.responses-proxy.plist.template"
TARGET="$HOME/Library/LaunchAgents/ai.openclaw.responses-proxy.plist"

mkdir -p "$HOME/Library/LaunchAgents"
sed "s|__ROOT_DIR__|$ROOT_DIR|g" "$TEMPLATE" >"$TARGET"
launchctl unload "$TARGET" >/dev/null 2>&1 || true
launchctl load "$TARGET"

echo "Installed LaunchAgent: $TARGET"
echo "responses-proxy will auto-start at login."
