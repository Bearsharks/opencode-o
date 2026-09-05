#!/usr/bin/env bash

set -u

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
B_MAX_ROOT="$ROOT/profiles/b-max"
CALLER_DIR="$PWD"
EXPECTED_OPENCODE_VERSION="1.18.4"
MODE="full"
failures=0
warnings=0
diagnostic_root=""

cleanup() { [[ -n "$diagnostic_root" && -d "$diagnostic_root" ]] && rm -rf -- "$diagnostic_root"; }
trap cleanup EXIT

if [[ "${1:-}" == "--preflight" ]]; then
  MODE="preflight"
elif [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  printf '%s\n' 'Usage: ./scripts/doctor/b-max.sh [--preflight]' '' \
    '  --preflight  Check prerequisites and B-Max profile conflicts without' \
    '               smoke tests or resolved-config validation.'
  exit 0
elif [[ $# -gt 0 ]]; then
  printf 'Unknown argument: %s\n' "$1" >&2
  exit 2
fi

pass() { printf 'PASS  %s\n' "$1"; }
warn() { warnings=$((warnings + 1)); printf 'WARN  %s\n' "$1"; }
fail() { failures=$((failures + 1)); printf 'FAIL  %s\n' "$1"; }
finish() { printf '\nSummary: %d failure(s), %d warning(s)\n' "$failures" "$warnings"; (( failures == 0 )); }

if [[ -n "${OPENCODE_O_GLOBAL_CONFIG_DIR:-}" ]]; then
  GLOBAL_CONFIG_DIR="$OPENCODE_O_GLOBAL_CONFIG_DIR"
elif [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
  GLOBAL_CONFIG_DIR="$XDG_CONFIG_HOME/opencode"
elif [[ -n "${HOME:-}" ]]; then
  GLOBAL_CONFIG_DIR="$HOME/.config/opencode"
else
  GLOBAL_CONFIG_DIR=""
  fail "Cannot determine the global OpenCode config directory because HOME is unset"
fi
if [[ -n "${OPENCODE_O_BIN_DIR:-}" ]]; then BIN_DIR="$OPENCODE_O_BIN_DIR"; elif [[ -n "${HOME:-}" ]]; then BIN_DIR="$HOME/.local/bin"; else BIN_DIR=""; fi

if command -v opencode >/dev/null 2>&1; then
  opencode_version="$(opencode --version 2>/dev/null | head -n 1)"
  [[ "$opencode_version" == "$EXPECTED_OPENCODE_VERSION" ]] && pass "OpenCode $opencode_version" || warn "OpenCode $opencode_version is installed; B-Max is tested with $EXPECTED_OPENCODE_VERSION"
else fail "OpenCode is not available on PATH"; fi
command -v bun >/dev/null 2>&1 && pass "Bun is available" || fail "Bun is not available on PATH"

required_files=(package.json bun.lock scripts/install/b-max.sh scripts/doctor/b-max.sh profiles/b-max/README.md profiles/b-max/.gitignore profiles/b-max/opencode.jsonc profiles/b-max/agents/manager.md profiles/b-max/agents/terraworker.md profiles/b-max/agents/runner.md profiles/b-max/plugins/b-max.ts profiles/b-max/plugins/_b-max-v1/b-max.smoke.ts profiles/b-max/plugins/_b-max-v1/README.md)
for file in "${required_files[@]}"; do [[ -f "$ROOT/$file" ]] && pass "Repository file $file" || fail "Missing repository file $file"; done

inheritance_links=("profiles/b-max/opencode.jsonc|../max/opencode.jsonc" "profiles/b-max/agents/terraworker.md|../../max/agents/terraworker.md" "profiles/b-max/agents/runner.md|../../max/agents/runner.md")
for entry in "${inheritance_links[@]}"; do
  path="${entry%%|*}"; target="${entry#*|}"
  [[ -L "$ROOT/$path" && "$(readlink "$ROOT/$path")" == "$target" ]] && pass "B-Max inherits $path from $target" || fail "B-Max inheritance link is incorrect: $path -> $target"
done
if [[ -f "$B_MAX_ROOT/agents/manager.md" && ! -L "$B_MAX_ROOT/agents/manager.md" ]]; then pass "B-Max manager is profile-local"; else fail "B-Max manager must be a regular profile-local file"; fi
[[ ! -e "$B_MAX_ROOT/agents/HTOrchestrator.md" && ! -L "$B_MAX_ROOT/agents/HTOrchestrator.md" ]] && pass "B-Max has no HTOrchestrator agent file" || fail "B-Max must not retain an HTOrchestrator agent file"

conflicting_agents=(manager HTOrchestrator orchestrator terraworker lunaworker probe runner)
check_conflicts() {
  local base="$1" label="$2" agent directory path config
  for agent in "${conflicting_agents[@]}"; do path="$base/agents/$agent.md"; [[ ! -e "$path" && ! -L "$path" ]] || fail "$label agent conflict: $path"; done
  for directory in "$base/plugin" "$base/plugins"; do
    [[ -d "$directory" ]] || continue
    while IFS= read -r path; do fail "$label local-plugin conflict: $path"; done < <(find "$directory" -maxdepth 1 \( -type f -o -type l \) \( -name '*harness-state*' -o -name '*a-max*' -o -name '*b-max*' -o -name '*max-topology*' -o -name '*max-harness*' \) -print)
  done
  for config in "$base/opencode.json" "$base/opencode.jsonc"; do
    [[ -f "$config" && $(grep -Ec 'harness-state|a-max|b-max|max-topology|max-harness' "$config") -gt 0 ]] && fail "$label config references a harness plugin: $config"
    [[ -f "$config" && $(grep -Ec '"default_agent"[[:space:]]*:[[:space:]]*"(HTOrchestrator|orchestrator)"' "$config") -gt 0 ]] && fail "$label config makes a harness coordinator the default agent: $config"
  done
}
[[ -n "$GLOBAL_CONFIG_DIR" ]] && check_conflicts "$GLOBAL_CONFIG_DIR" "Global"
[[ "$CALLER_DIR" != "$ROOT" ]] && check_conflicts "$CALLER_DIR/.opencode" "Project"

if command -v opencode >/dev/null 2>&1 && command -v bun >/dev/null 2>&1; then
  diagnostic_root="$(mktemp -d "${TMPDIR:-/tmp}/opencode-o-b-max-doctor.XXXXXX" 2>/dev/null || true)"
  if [[ -n "$diagnostic_root" ]]; then
    mkdir -p "$diagnostic_root/data" "$diagnostic_root/work"
    if bare_config="$(cd "$diagnostic_root/work" && XDG_DATA_HOME="$diagnostic_root/data" opencode debug config 2>/dev/null)"; then
      grep -Fq 'b-max.ts' <<<"$bare_config" && fail "Bare OpenCode resolves b-max without the B-Max wrapper" || pass "Bare OpenCode does not resolve the B-Max plugin"
    else warn "Could not resolve bare OpenCode config in an isolated diagnostic directory"; fi
  else warn "Could not create an isolated directory for bare OpenCode diagnostics"; fi
fi

if [[ "$MODE" == "preflight" ]]; then
  finish
  exit $?
fi

if command -v bun >/dev/null 2>&1; then (cd "$ROOT" && bun run check:b-max >/dev/null 2>&1) && pass "B-Max smoke check" || fail "B-Max smoke check failed; run 'bun run check:b-max' for diagnostics"; fi
if command -v opencode >/dev/null 2>&1; then
  if models="$(opencode models 2>/dev/null)"; then for model in openai/gpt-5.6-sol openai/gpt-5.6-terra-fast openai/gpt-5.6-luna-fast; do grep -Fq "$model" <<<"$models" && pass "Model $model" || warn "Model is unavailable in the active global provider configuration: $model"; done; else warn "Could not list OpenCode models"; fi
  if resolved="$(cd "$CALLER_DIR" && OPENCODE_DB=:memory: OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true OPENCODE_CONFIG_DIR="$B_MAX_ROOT" opencode debug config 2>&1)"; then
    b_max_origin_count="$(grep -E '"spec": "file:.*b-max\.ts"' <<<"$resolved" | wc -l | tr -d '[:space:]')"
    max_origin_count="$(grep -E '"spec": "file:.*max-topology\.ts"' <<<"$resolved" | wc -l | tr -d '[:space:]')"
    default_origin_count="$(grep -E '"spec": "file:.*plugins/harness-state\.ts"' <<<"$resolved" | wc -l | tr -d '[:space:]')"
    [[ "$b_max_origin_count" == 1 ]] && pass "Exactly one B-Max plugin origin" || fail "Expected one B-Max plugin origin, found $b_max_origin_count"
    [[ "$max_origin_count" == 0 ]] && pass "Max topology plugin is absent from B-Max" || fail "Max topology plugin leaked into B-Max"
    [[ "$default_origin_count" == 0 ]] && pass "Default harness plugin is absent from B-Max" || fail "Default harness plugin leaked into B-Max"
    if RESOLVED="$resolved" bun -e 'const c=JSON.parse(process.env.RESOLVED); if(c.default_agent!=="manager"||c.agent?.HTOrchestrator||!c.agent?.manager)process.exit(1)'; then pass "B-Max resolves manager as default without HTOrchestrator"; else fail "B-Max resolved agent map/default is incorrect"; fi
  else fail "Could not resolve B-Max config with OPENCODE_CONFIG_DIR=$B_MAX_ROOT"; fi

  for agent in manager terraworker runner; do
    if agent_config="$(cd "$CALLER_DIR" && OPENCODE_DB=:memory: OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true OPENCODE_CONFIG_DIR="$B_MAX_ROOT" opencode debug agent "$agent" 2>/dev/null)"; then
      pass "Resolved B-Max agent $agent"
      if bun -e 'const a=JSON.parse(await Bun.stdin.text()); const ok=(p)=>a.permission?.some(r=>r.permission==="bash"&&r.pattern===p&&r.action==="allow"); if(!ok("agent-browser *")||!ok("npx agent-browser *"))process.exit(1)' <<<"$agent_config"; then pass "B-Max agent $agent allows agent-browser without approval"; else fail "B-Max agent $agent does not allow agent-browser without approval"; fi
      max_agent_name="$agent"; [[ "$agent" == "manager" ]] && max_agent_name="HTOrchestrator"
      if max_agent="$(cd "$CALLER_DIR" && OPENCODE_DB=:memory: OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$ROOT/profiles/max" opencode debug agent "$max_agent_name" 2>/dev/null)" && MAX_AGENT="$max_agent" B_MAX_AGENT="$agent_config" AGENT="$agent" bun -e '
        const base=JSON.parse(process.env.MAX_AGENT), b=JSON.parse(process.env.B_MAX_AGENT), name=process.env.AGENT, eq=(x,y)=>JSON.stringify(x)===JSON.stringify(y)
        for(const k of ["model","reasoningEffort","textVerbosity","mode","hidden"])if(!eq(base[k],b[k]))process.exit(1)
        for(const r of base.permission??[])if(!(b.permission??[]).some(x=>eq(x,r)))process.exit(1)
        for(const [tool,on] of Object.entries(base.tools??{}))if(b.tools?.[tool]!==on)process.exit(1)
        if(name==="manager"){
          if(b.description===base.description||b.prompt===base.prompt||!b.prompt?.includes("B-Max"))process.exit(1)
          for(const t of ["a_max_board","a_max_move","a_max_inspect","a_max_interrupt"])if(b.tools?.[t]!==true)process.exit(1)
        } else {
          if(b.description!==base.description||b.prompt!==base.prompt)process.exit(1)
          for(const t of ["a_max_board","a_max_move","a_max_inspect","a_max_interrupt"])if(b.tools?.[t]===true)process.exit(1)
        }
      '; then pass "B-Max agent $agent preserves the Max contract"; else fail "B-Max agent $agent drifted from the Max contract"; fi
    else fail "Could not resolve B-Max agent $agent"; fi
  done
  if manager_agent="$(cd "$CALLER_DIR" && OPENCODE_DB=:memory: OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true OPENCODE_CONFIG_DIR="$B_MAX_ROOT" opencode debug agent manager 2>/dev/null)" && bun -e 'const a=JSON.parse(await Bun.stdin.text()); if(a.tools?.harness_state===true||a.tools?.investigate===true||a.tools?.task!==true||a.tools?.read!==true||(a.tools?.apply_patch!==true&&!(a.tools?.edit===true&&a.tools?.write===true)))process.exit(1); for(const t of ["a_max_board","a_max_move","a_max_inspect","a_max_interrupt"])if(a.tools?.[t]!==true)process.exit(1)' <<<"$manager_agent"; then pass "Manager has Max capabilities plus A-Max-derived intervention tools"; else fail "Manager B-Max tool isolation is incorrect"; fi
  if runner_agent="$(cd "$CALLER_DIR" && OPENCODE_DB=:memory: OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true OPENCODE_CONFIG_DIR="$B_MAX_ROOT" opencode debug agent runner 2>/dev/null)" && bun -e 'const a=JSON.parse(await Bun.stdin.text()), ok=(p,x)=>a.permission?.some(r=>r.permission===p&&r.pattern===x&&r.action==="allow"); if(a.tools?.task===true||a.tools?.apply_patch===true||a.tools?.read!==true||a.tools?.bash!==true||!ok("codex-self-improvement_skill_view","*")||ok("codex-self-improvement_skill_list","*")||ok("codex-self-improvement_skill_manage","*")||!ok("skill","agent-browser")||!ok("bash","agent-browser *")||!ok("bash","npx agent-browser *"))process.exit(1); for(const t of ["a_max_board","a_max_move","a_max_inspect","a_max_interrupt"])if(a.tools?.[t]===true)process.exit(1)' <<<"$runner_agent"; then pass "Runner remains read/command-only and has no B-Max tools"; else fail "Runner B-Max tool isolation is incorrect"; fi
  if (cd "$CALLER_DIR" && OPENCODE_DB=:memory: OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true OPENCODE_CONFIG_DIR="$B_MAX_ROOT" opencode debug agent lunaworker >/dev/null 2>&1); then fail "lunaworker leaked into B-Max"; else pass "lunaworker is absent from B-Max"; fi
  if (cd "$CALLER_DIR" && OPENCODE_DB=:memory: OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true OPENCODE_CONFIG_DIR="$B_MAX_ROOT" opencode debug agent HTOrchestrator >/dev/null 2>&1); then fail "HTOrchestrator leaked into B-Max"; else pass "HTOrchestrator is absent from B-Max"; fi
fi

if [[ -n "$BIN_DIR" ]]; then
  wrapper="$BIN_DIR/oc-bmax"
  if [[ -f "$wrapper" ]]; then
    if grep -Fqx "# opencode-o-b-max-root: $ROOT" "$wrapper" && grep -Fqx 'export OPENCODE_EXPERIMENTAL_LSP_TOOL=true' "$wrapper" && grep -Fqx 'export OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true' "$wrapper" && grep -Fqx 'export OPENCODE_DB=opencode-b-max.db' "$wrapper" && grep -Fqx 'OPENCODE_CONFIG_DIR="$OPENCODE_O_B_MAX_ROOT/profiles/b-max" exec opencode "$@"' "$wrapper"; then pass "Installed B-Max wrapper oc-bmax enables background subagents and an isolated session database"; else fail "B-Max wrapper oc-bmax is not managed by this checkout; rerun ./scripts/install/b-max.sh"; fi
  else warn "B-Max wrapper oc-bmax is not installed at $wrapper"; fi
  case ":$PATH:" in *":$BIN_DIR:"*) pass "$BIN_DIR is on PATH" ;; *) warn "$BIN_DIR is not on PATH" ;; esac
fi
finish
