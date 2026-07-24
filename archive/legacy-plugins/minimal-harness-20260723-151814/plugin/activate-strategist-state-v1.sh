#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="/Users/jsp1226/.config/opencode/plugin"
AGENT_DIR="/Users/jsp1226/.config/opencode/agents"
STRATEGIST_AGENT_DIR="$PLUGIN_DIR/_strategist-state-v1/agents"
if [ -L "$PLUGIN_DIR/advisor-state.ts" ]; then
  mv -f "$PLUGIN_DIR/advisor-state.ts" "$PLUGIN_DIR/advisor-state.v5-link.disabled"
fi
if [ -L "$PLUGIN_DIR/phase-gate.ts" ]; then
  mv -f "$PLUGIN_DIR/phase-gate.ts" "$PLUGIN_DIR/phase-gate.v3-link.disabled"
fi
ln -sfn "$PLUGIN_DIR/_strategist-state-v1/strategist-state.ts" "$PLUGIN_DIR/strategist-state.ts"
cp -p "$STRATEGIST_AGENT_DIR/driver.md" "$AGENT_DIR/driver.md"
cp -p "$STRATEGIST_AGENT_DIR/strategist.md" "$AGENT_DIR/strategist.md"
cp -p "$STRATEGIST_AGENT_DIR/probe-code.md" "$AGENT_DIR/probe-code.md"
if [ -f "$AGENT_DIR/advisor.md" ]; then
  mv -f "$AGENT_DIR/advisor.md" "$AGENT_DIR/advisor.v5.disabled"
fi
echo "strategist v1 activated: state plugin and agent prompts restored"
