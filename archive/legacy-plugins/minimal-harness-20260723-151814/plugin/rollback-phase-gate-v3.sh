#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="/Users/jsp1226/.config/opencode/plugin"
if [ -L "$PLUGIN_DIR/advisor-state.ts" ]; then
  mv -f "$PLUGIN_DIR/advisor-state.ts" "$PLUGIN_DIR/advisor-state.v4-link.disabled"
fi
ln -sfn "$PLUGIN_DIR/_phase-gate-v3/phase-gate.ts" "$PLUGIN_DIR/phase-gate.ts"
echo "phase-gate v3 restored: $PLUGIN_DIR/phase-gate.ts -> $PLUGIN_DIR/_phase-gate-v3/phase-gate.ts"
