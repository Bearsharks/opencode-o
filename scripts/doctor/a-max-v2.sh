#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
PROFILE="$ROOT/profiles/a-max"

case "${1:-}" in
  --help|-h)
    printf 'Usage: scripts/doctor/a-max.sh [--preflight]\n'
    exit 0 ;;
  ""|--preflight) ;;
  *) printf 'Unknown argument: %s\n' "$1" >&2; exit 2 ;;
esac

command -v opencode >/dev/null
command -v bun >/dev/null
[[ "$(opencode --version)" == *v2.* ]]
for file in opencode.jsonc package.json agents/HTOrchestrator.md agents/terraworker.md agents/runner.md plugins/a-max-v2/index.ts; do
  [[ -f "$PROFILE/$file" ]] || { printf 'Missing A-Max file: %s\n' "$file" >&2; exit 1; }
done
[[ "$(readlink "$PROFILE/config-home/opencode")" == ".." ]] || { printf 'A-Max V2 global config link is missing\n' >&2; exit 1; }

PROFILE="$PROFILE" bun -e '
  const config = await Bun.file(`${process.env.PROFILE}/opencode.jsonc`).json()
  if (config.default_agent !== "HTOrchestrator" || config.experimental?.subagent_depth !== 2 ||
      config.compaction?.buffer !== 25600 || !config.plugins?.includes("./plugins/a-max-v2") ||
      ["build", "plan", "general", "explore"].some((name) => config.agents?.[name]?.disabled !== true)) process.exit(1)
' || { printf 'Invalid native A-Max config\n' >&2; exit 1; }
printf 'PASS  Native A-Max config and files\n'

if [[ "${1:-}" == --preflight ]]; then exit 0; fi
(cd "$ROOT" && bun run check:a-max)
printf 'PASS  A-Max V1 regression and V2 plugin smoke checks\n'

encoded="$(PROFILE="$PROFILE" python3 -c 'import os,urllib.parse;print(urllib.parse.quote(os.environ["PROFILE"],safe=""))')"
plugins="$(OPENCODE_CONFIG_DIR="$PROFILE" opencode api get "/api/plugin?location%5Bdirectory%5D=$encoded")"
agents="$(OPENCODE_CONFIG_DIR="$PROFILE" opencode api get "/api/agent?location%5Bdirectory%5D=$encoded")"
PLUGINS="$plugins" AGENTS="$agents" python3 - <<'PY'
import json, os
plugins = json.loads(os.environ['PLUGINS'])['data']
agents = {agent['id']: agent for agent in json.loads(os.environ['AGENTS'])['data']}
assert any(plugin.get('id') == 'a-max' and plugin['state']['status'] == 'active' for plugin in plugins), 'A-Max V2 plugin is not active'
for name, mode in [('HTOrchestrator', 'primary'), ('terraworker', 'subagent'), ('runner', 'subagent')]:
    agent = agents[name]
    assert agent['mode'] == mode and agent.get('system'), f'{name} instructions or mode missing'
    assert any(rule['action'] == 'shell' for rule in agent['permissions']), f'{name} shell permissions missing'
assert any(rule == {'action': 'subagent', 'resource': 'terraworker', 'effect': 'allow'} for rule in agents['HTOrchestrator']['permissions'])
assert any(rule == {'action': 'edit', 'resource': '*', 'effect': 'deny'} for rule in agents['runner']['permissions'])
print('PASS  Active V2 plugin, profile agents, modes, and permissions')
PY
