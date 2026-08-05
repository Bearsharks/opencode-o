#!/usr/bin/env bash

set -u

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
A_MAX_ROOT="$ROOT/profiles/a-max"
CALLER_DIR="$PWD"
EXPECTED_OPENCODE_VERSION="1.18.4"
MODE="full"
failures=0
warnings=0
diagnostic_root=""

cleanup() {
  if [[ -n "$diagnostic_root" && -d "$diagnostic_root" ]]; then
    rm -rf -- "$diagnostic_root"
  fi
}

trap cleanup EXIT

if [[ "${1:-}" == "--preflight" ]]; then
  MODE="preflight"
elif [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  printf '%s\n' \
    'Usage: ./scripts/doctor/a-max.sh [--preflight]' \
    '' \
    '  --preflight  Check prerequisites and A-Max profile conflicts without' \
    '               smoke tests or resolved-config validation.'
  exit 0
elif [[ $# -gt 0 ]]; then
  printf 'Unknown argument: %s\n' "$1" >&2
  exit 2
fi

pass() {
  printf 'PASS  %s\n' "$1"
}

warn() {
  warnings=$((warnings + 1))
  printf 'WARN  %s\n' "$1"
}

fail() {
  failures=$((failures + 1))
  printf 'FAIL  %s\n' "$1"
}

finish() {
  printf '\nSummary: %d failure(s), %d warning(s)\n' "$failures" "$warnings"
  if [[ $failures -gt 0 ]]; then
    exit 1
  fi
  exit 0
}

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

if [[ -n "${OPENCODE_O_BIN_DIR:-}" ]]; then
  BIN_DIR="$OPENCODE_O_BIN_DIR"
elif [[ -n "${HOME:-}" ]]; then
  BIN_DIR="$HOME/.local/bin"
else
  BIN_DIR=""
fi

if command -v opencode >/dev/null 2>&1; then
  opencode_version="$(opencode --version 2>/dev/null | head -n 1)"
  if [[ "$opencode_version" == "$EXPECTED_OPENCODE_VERSION" ]]; then
    pass "OpenCode $opencode_version"
  else
    warn "OpenCode $opencode_version is installed; A-Max is tested with $EXPECTED_OPENCODE_VERSION"
  fi
else
  fail "OpenCode is not available on PATH"
fi

if command -v bun >/dev/null 2>&1; then
  pass "Bun is available"
else
  fail "Bun is not available on PATH"
fi

required_files=(
  "package.json"
  "bun.lock"
  "scripts/install/a-max.sh"
  "scripts/doctor/a-max.sh"
  "profiles/a-max/README.md"
  "profiles/a-max/.gitignore"
  "profiles/a-max/opencode.jsonc"
  "profiles/a-max/agents/HTOrchestrator.md"
  "profiles/a-max/agents/terraworker.md"
  "profiles/a-max/agents/runner.md"
  "profiles/a-max/plugins/a-max.ts"
  "profiles/a-max/plugins/_a-max-v1/a-max.smoke.ts"
  "profiles/a-max/plugins/_a-max-v1/README.md"
)

for file in "${required_files[@]}"; do
  if [[ -f "$ROOT/$file" ]]; then
    pass "Repository file $file"
  else
    fail "Missing repository file $file"
  fi
done

inheritance_links=(
  "profiles/a-max/opencode.jsonc|../max/opencode.jsonc"
  "profiles/a-max/agents/HTOrchestrator.md|../../max/agents/HTOrchestrator.md"
  "profiles/a-max/agents/terraworker.md|../../max/agents/terraworker.md"
  "profiles/a-max/agents/runner.md|../../max/agents/runner.md"
)

for entry in "${inheritance_links[@]}"; do
  path="${entry%%|*}"
  target="${entry#*|}"
  if [[ -L "$ROOT/$path" ]] && [[ "$(readlink "$ROOT/$path")" == "$target" ]]; then
    pass "A-Max inherits $path from $target"
  else
    fail "A-Max inheritance link is incorrect: $path -> $target"
  fi
done

conflicting_agents=(HTOrchestrator orchestrator terraworker lunaworker probe runner)

if [[ -n "$GLOBAL_CONFIG_DIR" ]]; then
  for agent in "${conflicting_agents[@]}"; do
    path="$GLOBAL_CONFIG_DIR/agents/$agent.md"
    if [[ -e "$path" || -L "$path" ]]; then
      fail "Global agent conflict: $path"
    fi
  done

  for directory in "$GLOBAL_CONFIG_DIR/plugin" "$GLOBAL_CONFIG_DIR/plugins"; do
    if [[ ! -d "$directory" ]]; then
      continue
    fi
    while IFS= read -r path; do
      fail "Global local-plugin conflict: $path"
    done < <(find "$directory" -maxdepth 1 \( -type f -o -type l \) \
      \( -name '*harness-state*' -o -name '*a-max*' -o -name '*max-topology*' -o -name '*max-harness*' \) -print)
  done

  for config in "$GLOBAL_CONFIG_DIR/opencode.json" "$GLOBAL_CONFIG_DIR/opencode.jsonc"; do
    if [[ -f "$config" ]] && grep -Eq 'harness-state|a-max|max-topology|max-harness' "$config"; then
      fail "Global config references a harness plugin: $config"
    fi
    if [[ -f "$config" ]] && grep -Eq '"default_agent"[[:space:]]*:[[:space:]]*"(HTOrchestrator|orchestrator)"' "$config"; then
      fail "Global config makes a harness coordinator the default agent: $config"
    fi
  done
fi

if [[ "$CALLER_DIR" != "$ROOT" ]]; then
  for agent in "${conflicting_agents[@]}"; do
    path="$CALLER_DIR/.opencode/agents/$agent.md"
    if [[ -e "$path" || -L "$path" ]]; then
      fail "Project agent conflict: $path"
    fi
  done

  for directory in "$CALLER_DIR/.opencode/plugin" "$CALLER_DIR/.opencode/plugins"; do
    if [[ ! -d "$directory" ]]; then
      continue
    fi
    while IFS= read -r path; do
      fail "Project local-plugin conflict: $path"
    done < <(find "$directory" -maxdepth 1 \( -type f -o -type l \) \
      \( -name '*harness-state*' -o -name '*a-max*' -o -name '*max-topology*' -o -name '*max-harness*' \) -print)
  done
fi

if command -v opencode >/dev/null 2>&1 && command -v bun >/dev/null 2>&1; then
  diagnostic_root="$(mktemp -d "${TMPDIR:-/tmp}/opencode-o-a-max-doctor.XXXXXX" 2>/dev/null || true)"
  if [[ -n "$diagnostic_root" ]]; then
    mkdir -p "$diagnostic_root/data" "$diagnostic_root/work"
    if bare_config="$(
      cd "$diagnostic_root/work" &&
        XDG_DATA_HOME="$diagnostic_root/data" opencode debug config 2>/dev/null
    )"; then
      if grep -Fq "a-max.ts" <<<"$bare_config"; then
        fail "Bare OpenCode resolves a-max without the A-Max wrapper"
      else
        pass "Bare OpenCode does not resolve the A-Max plugin"
      fi
    else
      warn "Could not resolve bare OpenCode config in an isolated diagnostic directory"
    fi
  else
    warn "Could not create an isolated directory for bare OpenCode diagnostics"
  fi
fi

if [[ "$MODE" == "preflight" ]]; then
  finish
fi

if command -v bun >/dev/null 2>&1; then
  if (cd "$ROOT" && bun run check:a-max >/dev/null 2>&1); then
    pass "A-Max smoke check"
  else
    fail "A-Max smoke check failed; run 'bun run check:a-max' for diagnostics"
  fi
fi

if command -v opencode >/dev/null 2>&1; then
  if models="$(opencode models 2>/dev/null)"; then
    model_ids=(
      "openai/gpt-5.6-sol"
      "openai/gpt-5.6-terra-fast"
      "openai/gpt-5.6-luna-fast"
    )
    for model in "${model_ids[@]}"; do
      if grep -Fq "$model" <<<"$models"; then
        pass "Model $model"
      else
        fail "Model is unavailable: $model"
      fi
    done
  else
    fail "Could not list OpenCode models"
  fi

  if resolved="$(
    cd "$CALLER_DIR" &&
      OPENCODE_DB=:memory: \
        OPENCODE_EXPERIMENTAL_LSP_TOOL=true \
        OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true \
        OPENCODE_CONFIG_DIR="$A_MAX_ROOT" \
        opencode debug config 2>&1
  )"; then
    a_max_origin_count="$(
      grep -E '"spec": "file:.*a-max\.ts"' <<<"$resolved" | wc -l | tr -d '[:space:]'
    )"
    max_origin_count="$(
      grep -E '"spec": "file:.*max-topology\.ts"' <<<"$resolved" | wc -l | tr -d '[:space:]'
    )"
    default_origin_count="$(
      grep -E '"spec": "file:.*plugins/harness-state\.ts"' <<<"$resolved" | wc -l | tr -d '[:space:]'
    )"
    if [[ "$a_max_origin_count" == "1" ]]; then
      pass "Exactly one A-Max plugin origin"
    else
      fail "Expected one A-Max plugin origin, found $a_max_origin_count"
    fi
    if [[ "$max_origin_count" == "0" ]]; then
      pass "Max topology plugin is absent from A-Max"
    else
      fail "Max topology plugin leaked into A-Max"
    fi
    if [[ "$default_origin_count" == "0" ]]; then
      pass "Default harness plugin is absent from A-Max"
    else
      fail "Default harness plugin leaked into A-Max"
    fi
  else
    fail "Could not resolve A-Max config with OPENCODE_CONFIG_DIR=$A_MAX_ROOT"
  fi

  for agent in HTOrchestrator terraworker runner; do
    if agent_config="$(
      cd "$CALLER_DIR" &&
        OPENCODE_DB=:memory: \
          OPENCODE_EXPERIMENTAL_LSP_TOOL=true \
          OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true \
          OPENCODE_CONFIG_DIR="$A_MAX_ROOT" \
          opencode debug agent "$agent" 2>/dev/null
    )"; then
      pass "Resolved A-Max agent $agent"
      if bun -e '
        const agent = JSON.parse(await Bun.stdin.text())
        const allowed = (pattern) =>
          agent.permission?.some((rule) =>
            rule.permission === "bash" && rule.pattern === pattern && rule.action === "allow",
          )
        if (!allowed("agent-browser *") || !allowed("npx agent-browser *")) process.exit(1)
      ' <<<"$agent_config"; then
        pass "A-Max agent $agent allows agent-browser without approval"
      else
        fail "A-Max agent $agent does not allow agent-browser without approval"
      fi

      if max_agent_config="$(
        cd "$CALLER_DIR" &&
          OPENCODE_DB=:memory: \
            OPENCODE_EXPERIMENTAL_LSP_TOOL=true \
            OPENCODE_CONFIG_DIR="$ROOT/profiles/max" \
            opencode debug agent "$agent" 2>/dev/null
      )" && MAX_AGENT_JSON="$max_agent_config" A_MAX_AGENT_JSON="$agent_config" AGENT_NAME="$agent" bun -e '
        const base = JSON.parse(process.env.MAX_AGENT_JSON)
        const extended = JSON.parse(process.env.A_MAX_AGENT_JSON)
        const name = process.env.AGENT_NAME
        const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
        for (const key of ["model", "reasoningEffort", "textVerbosity", "mode", "hidden", "description"]) {
          if (!equal(base[key], extended[key])) process.exit(1)
        }
        for (const rule of base.permission ?? []) {
          if (!(extended.permission ?? []).some((candidate) => equal(candidate, rule))) process.exit(1)
        }
        for (const [tool, enabled] of Object.entries(base.tools ?? {})) {
          if (extended.tools?.[tool] !== enabled) process.exit(1)
        }
        if (name === "HTOrchestrator") {
          if (!extended.prompt?.startsWith(base.prompt ?? "")) process.exit(1)
          if (!extended.prompt?.includes("## A-Max asynchronous delegation")) process.exit(1)
          if (
            extended.tools?.a_max_board !== true ||
            extended.tools?.a_max_move !== true ||
            extended.tools?.a_max_inspect !== true ||
            extended.tools?.a_max_interrupt !== true
          ) process.exit(1)
        } else {
          if (extended.prompt !== base.prompt) process.exit(1)
          if (
            extended.tools?.a_max_board === true ||
            extended.tools?.a_max_move === true ||
            extended.tools?.a_max_inspect === true ||
            extended.tools?.a_max_interrupt === true
          ) process.exit(1)
        }
      '; then
        pass "A-Max agent $agent preserves the current Max contract"
      else
        fail "A-Max agent $agent drifted from the current Max contract"
      fi
    else
      fail "Could not resolve A-Max agent $agent"
    fi
  done

  if (
    cd "$CALLER_DIR" &&
      OPENCODE_DB=:memory: \
        OPENCODE_EXPERIMENTAL_LSP_TOOL=true \
        OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true \
        OPENCODE_CONFIG_DIR="$A_MAX_ROOT" \
        opencode debug agent lunaworker >/dev/null 2>&1
  ); then
    fail "lunaworker leaked into A-Max"
  else
    pass "lunaworker is absent from A-Max"
  fi

  if ht_agent="$(
    cd "$CALLER_DIR" &&
      OPENCODE_DB=:memory: \
        OPENCODE_EXPERIMENTAL_LSP_TOOL=true \
        OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true \
        OPENCODE_CONFIG_DIR="$A_MAX_ROOT" \
        opencode debug agent HTOrchestrator 2>/dev/null
  )" && bun -e '
    const agent = JSON.parse(await Bun.stdin.text())
    if (agent.tools?.harness_state === true || agent.tools?.investigate === true) process.exit(1)
    if (agent.tools?.task !== true || agent.tools?.read !== true || agent.tools?.apply_patch !== true) process.exit(1)
    if (
      agent.tools?.a_max_board !== true ||
      agent.tools?.a_max_move !== true ||
      agent.tools?.a_max_inspect !== true ||
      agent.tools?.a_max_interrupt !== true
    ) process.exit(1)
  ' <<<"$ht_agent"; then
    pass "HTOrchestrator has Max capabilities plus A-Max intervention tools"
  else
    fail "HTOrchestrator A-Max tool isolation is incorrect"
  fi

  if runner_agent="$(
    cd "$CALLER_DIR" &&
      OPENCODE_DB=:memory: \
        OPENCODE_EXPERIMENTAL_LSP_TOOL=true \
        OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true \
        OPENCODE_CONFIG_DIR="$A_MAX_ROOT" \
        opencode debug agent runner 2>/dev/null
  )" && bun -e '
    const agent = JSON.parse(await Bun.stdin.text())
    const allowed = (permission, pattern) =>
      agent.permission?.some((rule) =>
        rule.permission === permission && rule.pattern === pattern && rule.action === "allow",
      )
    if (agent.tools?.task === true || agent.tools?.apply_patch === true) process.exit(1)
    if (agent.tools?.read !== true || agent.tools?.bash !== true) process.exit(1)
    if (!allowed("codex-self-improvement_skill_view", "*")) process.exit(1)
    if (allowed("codex-self-improvement_skill_list", "*")) process.exit(1)
    if (allowed("codex-self-improvement_skill_manage", "*")) process.exit(1)
    if (!allowed("skill", "agent-browser")) process.exit(1)
    if (!allowed("bash", "agent-browser *")) process.exit(1)
    if (!allowed("bash", "npx agent-browser *")) process.exit(1)
    if (
      agent.tools?.a_max_board === true ||
      agent.tools?.a_max_move === true ||
      agent.tools?.a_max_inspect === true ||
      agent.tools?.a_max_interrupt === true
    ) process.exit(1)
  ' <<<"$runner_agent"; then
    pass "Runner is read/command-only with agent-browser and directed skill-view capability"
  else
    fail "Runner tool isolation, agent-browser, or directed skill-view capability is incorrect"
  fi
fi

if [[ -n "$BIN_DIR" ]]; then
  wrapper="$BIN_DIR/oc-amax"
  if [[ -f "$wrapper" ]]; then
    if grep -Fqx "# opencode-o-a-max-root: $ROOT" "$wrapper" &&
      grep -Fqx 'export OPENCODE_EXPERIMENTAL_LSP_TOOL=true' "$wrapper" &&
      grep -Fqx 'export OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true' "$wrapper" &&
      grep -Fqx 'export OPENCODE_DB=opencode-a-max.db' "$wrapper" &&
      grep -Fqx 'OPENCODE_CONFIG_DIR="$OPENCODE_O_A_MAX_ROOT/profiles/a-max" exec opencode "$@"' "$wrapper"; then
      pass "Installed A-Max wrapper oc-amax enables background subagents and an isolated session database"
    else
      fail "A-Max wrapper oc-amax is not managed by this checkout; rerun ./scripts/install/a-max.sh"
    fi
  else
    warn "A-Max wrapper oc-amax is not installed at $wrapper"
  fi

  case ":$PATH:" in
    *":$BIN_DIR:"*) pass "$BIN_DIR is on PATH" ;;
    *) warn "$BIN_DIR is not on PATH" ;;
  esac
fi

finish
