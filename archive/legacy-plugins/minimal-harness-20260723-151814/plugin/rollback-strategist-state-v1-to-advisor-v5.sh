#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR="/Users/jsp1226/.config/opencode/plugin"
AGENT_DIR="/Users/jsp1226/.config/opencode/agents"
BACKUP_AGENT_DIR="/Users/jsp1226/.config/opencode/backups/strategist-v1-20260722/agents"
if [ -L "$PLUGIN_DIR/strategist-state.ts" ]; then
  mv -f "$PLUGIN_DIR/strategist-state.ts" "$PLUGIN_DIR/strategist-state.v1-link.disabled"
fi
if [ -L "$PLUGIN_DIR/advisor-state.v5-link.disabled" ]; then
  mv -f "$PLUGIN_DIR/advisor-state.v5-link.disabled" "$PLUGIN_DIR/advisor-state.ts"
else
  ln -sfn "$PLUGIN_DIR/_advisor-state-v5/advisor-state.ts" "$PLUGIN_DIR/advisor-state.ts"
fi
cp -p "$BACKUP_AGENT_DIR/driver.md" "$AGENT_DIR/driver.md"
cp -p "$BACKUP_AGENT_DIR/advisor.md" "$AGENT_DIR/advisor.md"
cp -p "$BACKUP_AGENT_DIR/probe-code.md" "$AGENT_DIR/probe-code.md"
if [ -f "$AGENT_DIR/strategist.md" ]; then
  mv -f "$AGENT_DIR/strategist.md" "$AGENT_DIR/strategist.v1.disabled"
fi
echo "advisor v5 restored: state plugin and agent prompts restored"
