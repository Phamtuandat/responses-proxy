#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "$0")/.." && pwd)/scripts/profile.sh"

open "http://127.0.0.1:8318/"
