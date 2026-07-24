#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/jsp1226/.config/opencode/plugin"
rm -f "$ROOT/phase-gate.ts"
cp "$ROOT/_phase-gate-backup/phase-gate.v1.ts" "$ROOT/phase-gate.ts"
echo "Restored phase-gate.ts from _phase-gate-backup/phase-gate.v1.ts"
