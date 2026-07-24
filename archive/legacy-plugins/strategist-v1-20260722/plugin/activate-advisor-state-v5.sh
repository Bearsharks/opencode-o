#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="/Users/jsp1226/.config/opencode/plugin"
ln -sfn "$PLUGIN_DIR/_advisor-state-v5/advisor-state.ts" "$PLUGIN_DIR/advisor-state.ts"
if [ -L "$PLUGIN_DIR/phase-gate.ts" ]; then
  mv -f "$PLUGIN_DIR/phase-gate.ts" "$PLUGIN_DIR/phase-gate.v3-link.disabled"
fi
echo "advisor-state v5 activated: $PLUGIN_DIR/advisor-state.ts -> $PLUGIN_DIR/_advisor-state-v5/advisor-state.ts"
