#!/usr/bin/env bash

set -u

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
MAX_ROOT="$ROOT/profiles/max"
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
    'Usage: ./scripts/doctor/max.sh [--preflight]' \
    '' \
    '  --preflight  Check prerequisites and max-profile conflicts without' \
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
    warn "OpenCode $opencode_version is installed; max mode is tested with $EXPECTED_OPENCODE_VERSION"
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
  "scripts/install/max.sh"
  "scripts/doctor/max.sh"
  "profiles/max/opencode.jsonc"
  "profiles/max/agents/HTOrchestrator.md"
  "profiles/max/agents/terraworker.md"
  "profiles/max/agents/runner.md"
  "profiles/max/plugins/max-topology.ts"
  "profiles/max/plugins/_max-topology-v1/max-topology.smoke.ts"
)

for file in "${required_files[@]}"; do
  if [[ -f "$ROOT/$file" ]]; then
    pass "Repository file $file"
  else
    fail "Missing repository file $file"
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
  diagnostic_root="$(mktemp -d "${TMPDIR:-/tmp}/opencode-o-max-doctor.XXXXXX" 2>/dev/null || true)"
  if [[ -n "$diagnostic_root" ]]; then
    mkdir -p "$diagnostic_root/data" "$diagnostic_root/work"
    if bare_config="$(
      cd "$diagnostic_root/work" &&
        XDG_DATA_HOME="$diagnostic_root/data" opencode debug config 2>/dev/null
    )"; then
      if grep -Fq "max-topology.ts" <<<"$bare_config"; then
        fail "Bare OpenCode resolves max-topology without the max wrapper"
      else
        pass "Bare OpenCode does not resolve the max plugin"
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
  if (cd "$ROOT" && bun run check:max >/dev/null 2>&1); then
    pass "Max-mode smoke check"
  else
    fail "Max-mode smoke check failed; run 'bun run check:max' for diagnostics"
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
      OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$MAX_ROOT" opencode debug config 2>&1
  )"; then
    max_origin_count="$(
      grep -E '"spec": "file:.*max-topology\.ts"' <<<"$resolved" | wc -l | tr -d '[:space:]'
    )"
    default_origin_count="$(
      grep -E '"spec": "file:.*plugins/harness-state\.ts"' <<<"$resolved" | wc -l | tr -d '[:space:]'
    )"
    a_max_origin_count="$(
      grep -E '"spec": "file:.*a-max\.ts"' <<<"$resolved" | wc -l | tr -d '[:space:]'
    )"
    if [[ "$max_origin_count" == "1" ]]; then
      pass "Exactly one max-topology plugin origin"
    else
      fail "Expected one max-topology plugin origin, found $max_origin_count"
    fi
    if [[ "$default_origin_count" == "0" ]]; then
      pass "Default harness plugin is absent from max mode"
    else
      fail "Default harness plugin leaked into max mode"
    fi
    if [[ "$a_max_origin_count" == "0" ]]; then
      pass "A-Max plugin is absent from max mode"
    else
      fail "A-Max plugin leaked into max mode"
    fi
  else
    fail "Could not resolve max config with OPENCODE_CONFIG_DIR=$MAX_ROOT"
  fi

  for agent in HTOrchestrator terraworker runner; do
    if agent_config="$(
      cd "$CALLER_DIR" &&
        OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$MAX_ROOT" opencode debug agent "$agent" 2>/dev/null
    )"; then
      pass "Resolved max agent $agent"
      if bun -e '
        const agent = JSON.parse(await Bun.stdin.text())
        const allowed = (pattern) =>
          agent.permission?.some((rule) =>
            rule.permission === "bash" && rule.pattern === pattern && rule.action === "allow",
          )
        if (!allowed("agent-browser *") || !allowed("npx agent-browser *")) process.exit(1)
      ' <<<"$agent_config"; then
        pass "Max agent $agent allows agent-browser without approval"
      else
        fail "Max agent $agent does not allow agent-browser without approval"
      fi
    else
      fail "Could not resolve max agent $agent"
    fi
  done

  if (
    cd "$CALLER_DIR" &&
      OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$MAX_ROOT" opencode debug agent lunaworker >/dev/null 2>&1
  ); then
    fail "lunaworker leaked into max mode"
  else
    pass "lunaworker is absent from max mode"
  fi

  if ht_agent="$(
    cd "$CALLER_DIR" &&
      OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$MAX_ROOT" opencode debug agent HTOrchestrator 2>/dev/null
  )" && bun -e '
    const agent = JSON.parse(await Bun.stdin.text())
    if (agent.tools?.harness_state === true || agent.tools?.investigate === true) process.exit(1)
    if (agent.tools?.task !== true || agent.tools?.read !== true || agent.tools?.apply_patch !== true) process.exit(1)
  ' <<<"$ht_agent"; then
    pass "HTOrchestrator has task/read/write capability without harness custom tools"
  else
    fail "HTOrchestrator tool isolation is incorrect"
  fi

  if runner_agent="$(
    cd "$CALLER_DIR" &&
      OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$MAX_ROOT" opencode debug agent runner 2>/dev/null
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
  ' <<<"$runner_agent"; then
    pass "Runner is read/command-only with agent-browser and directed skill-view capability"
  else
    fail "Runner tool isolation, agent-browser, or directed skill-view capability is incorrect"
  fi
fi

if [[ -n "$BIN_DIR" ]]; then
  wrapper="$BIN_DIR/opencode-o-max"
  if [[ -f "$wrapper" ]]; then
    if grep -Fqx "# opencode-o-max-root: $ROOT" "$wrapper" &&
      grep -Fqx 'export OPENCODE_EXPERIMENTAL_LSP_TOOL=true' "$wrapper" &&
      grep -Fqx 'OPENCODE_CONFIG_DIR="$OPENCODE_O_MAX_ROOT/profiles/max" exec opencode "$@"' "$wrapper"; then
      pass "Installed max wrapper points to this profile with Runner LSP enabled"
    else
      fail "Existing max wrapper is not managed by this checkout; rerun ./scripts/install/max.sh"
    fi
  else
    warn "Max wrapper is not installed at $wrapper"
  fi

  case ":$PATH:" in
    *":$BIN_DIR:"*) pass "$BIN_DIR is on PATH" ;;
    *) warn "$BIN_DIR is not on PATH" ;;
  esac
fi

finish
