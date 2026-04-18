#!/bin/zsh
set -euo pipefail

TARGET="$HOME/Library/LaunchAgents/ai.openclaw.responses-proxy.plist"

if [ -f "$TARGET" ]; then
  launchctl unload "$TARGET" >/dev/null 2>&1 || true
  rm -f "$TARGET"
  echo "Removed LaunchAgent: $TARGET"
else
  echo "LaunchAgent not installed."
fi
