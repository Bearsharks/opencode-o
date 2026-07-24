#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/jsp1226/.config/opencode/plugin"
rm -f "$ROOT/phase-gate.ts"
ln -s "$ROOT/_phase-gate-v2/phase-gate.ts" "$ROOT/phase-gate.ts"
echo "Activated phase-gate.ts -> _phase-gate-v2/phase-gate.ts"
