#!/usr/bin/env bash

set -u

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
OC_LITE_ROOT="$ROOT/profiles/oc-lite"
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
    'Usage: ./scripts/doctor/oc-lite.sh [--preflight]' \
    '' \
    '  --preflight  Check prerequisites and oc-lite-profile conflicts without' \
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
    warn "OpenCode $opencode_version is installed; oc-lite is tested with $EXPECTED_OPENCODE_VERSION"
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
  "scripts/install/oc-lite.sh"
  "scripts/doctor/oc-lite.sh"
  "profiles/oc-lite/opencode.jsonc"
  "profiles/oc-lite/agents/worker.md"
  "profiles/oc-lite/agents/runner.md"
  "profiles/oc-lite/plugins/oc-lite-topology.ts"
  "profiles/oc-lite/plugins/_oc-lite-topology-v1/oc-lite-topology.smoke.ts"
)

for file in "${required_files[@]}"; do
  if [[ -f "$ROOT/$file" ]]; then
    pass "Repository file $file"
  else
    fail "Missing repository file $file"
  fi
done

conflicting_agents=(worker runner HTOrchestrator orchestrator terraworker lunaworker probe)

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
      \( -name '*harness-state*' -o -name '*a-max*' -o -name '*max-topology*' -o -name '*oc-lite-topology*' \) -print)
  done

  for config in "$GLOBAL_CONFIG_DIR/opencode.json" "$GLOBAL_CONFIG_DIR/opencode.jsonc"; do
    if [[ -f "$config" ]] && grep -Eq 'harness-state|a-max|max-topology|oc-lite-topology' "$config"; then
      fail "Global config references a harness plugin: $config"
    fi
    if [[ -f "$config" ]] && grep -Eq '"default_agent"[[:space:]]*:[[:space:]]*"(worker|HTOrchestrator|orchestrator)"' "$config"; then
      fail "Global config makes a harness coordinator or oc-lite worker the default agent: $config"
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
      \( -name '*harness-state*' -o -name '*a-max*' -o -name '*max-topology*' -o -name '*oc-lite-topology*' \) -print)
  done
fi

if command -v opencode >/dev/null 2>&1 && command -v bun >/dev/null 2>&1; then
  diagnostic_root="$(mktemp -d "${TMPDIR:-/tmp}/opencode-o-oc-lite-doctor.XXXXXX" 2>/dev/null || true)"
  if [[ -n "$diagnostic_root" ]]; then
    mkdir -p "$diagnostic_root/data" "$diagnostic_root/work"
    if bare_config="$(
      cd "$diagnostic_root/work" &&
        XDG_DATA_HOME="$diagnostic_root/data" opencode debug config 2>/dev/null
    )"; then
      if grep -Fq "oc-lite-topology.ts" <<<"$bare_config"; then
        fail "Bare OpenCode resolves oc-lite-topology without the oc-lite wrapper"
      else
        pass "Bare OpenCode does not resolve the oc-lite plugin"
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
  if (cd "$ROOT" && bun run check:oc-lite >/dev/null 2>&1); then
    pass "oc-lite smoke check"
  else
    fail "oc-lite smoke check failed; run 'bun run check:oc-lite' for diagnostics"
  fi
fi

if command -v opencode >/dev/null 2>&1; then
  if models="$(opencode models 2>/dev/null)"; then
    model_ids=(
      "openai/gpt-5.6-sol"
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
      OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$OC_LITE_ROOT" opencode debug config 2>&1
  )"; then
    oc_lite_origin_count="$(
      grep -E '"spec": "file:.*oc-lite-topology\.ts"' <<<"$resolved" | wc -l | tr -d '[:space:]'
    )"
    max_origin_count="$(
      grep -E '"spec": "file:.*max-topology\.ts"' <<<"$resolved" | wc -l | tr -d '[:space:]'
    )"
    a_max_origin_count="$(
      grep -E '"spec": "file:.*a-max\.ts"' <<<"$resolved" | wc -l | tr -d '[:space:]'
    )"
    default_origin_count="$(
      grep -E '"spec": "file:.*plugins/harness-state\.ts"' <<<"$resolved" | wc -l | tr -d '[:space:]'
    )"
    if [[ "$oc_lite_origin_count" == "1" ]]; then
      pass "Exactly one oc-lite topology plugin origin"
    else
      fail "Expected one oc-lite topology plugin origin, found $oc_lite_origin_count"
    fi
    if [[ "$max_origin_count" == "0" ]]; then
      pass "Max topology plugin is absent from oc-lite"
    else
      fail "Max topology plugin leaked into oc-lite"
    fi
    if [[ "$a_max_origin_count" == "0" ]]; then
      pass "A-Max plugin is absent from oc-lite"
    else
      fail "A-Max plugin leaked into oc-lite"
    fi
    if [[ "$default_origin_count" == "0" ]]; then
      pass "Default harness plugin is absent from oc-lite"
    else
      fail "Default harness plugin leaked into oc-lite"
    fi
    if bun -e '
      const config = JSON.parse(await Bun.stdin.text())
      if (config.default_agent !== "worker" || config.subagent_depth !== 1) process.exit(1)
      if (config.agent?.worker?.model !== "openai/gpt-5.6-sol" || config.agent?.worker?.reasoningEffort !== "high") process.exit(1)
    ' <<<"$resolved"; then
      pass "Oc-lite resolves the Sol/high worker as default with depth-one delegation"
    else
      fail "Oc-lite resolved primary model, effort, default agent, or delegation depth is incorrect"
    fi
  else
    fail "Could not resolve oc-lite config with OPENCODE_CONFIG_DIR=$OC_LITE_ROOT"
  fi

  for agent in worker runner; do
    if agent_config="$(
      cd "$CALLER_DIR" &&
        OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$OC_LITE_ROOT" opencode debug agent "$agent" 2>/dev/null
    )"; then
      pass "Resolved oc-lite agent $agent"
      if bun -e '
        const agent = JSON.parse(await Bun.stdin.text())
        const allowed = (pattern) =>
          agent.permission?.some((rule) =>
            rule.permission === "bash" && rule.pattern === pattern && rule.action === "allow",
          )
        if (!allowed("agent-browser *") || !allowed("npx agent-browser *")) process.exit(1)
      ' <<<"$agent_config"; then
        pass "Oc-lite agent $agent allows agent-browser without approval"
      else
        fail "Oc-lite agent $agent does not allow agent-browser without approval"
      fi
    else
      fail "Could not resolve oc-lite agent $agent"
    fi
  done

  for absent_agent in HTOrchestrator terraworker lunaworker; do
    if (
      cd "$CALLER_DIR" &&
        OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$OC_LITE_ROOT" opencode debug agent "$absent_agent" >/dev/null 2>&1
    ); then
      fail "$absent_agent leaked into oc-lite"
    else
      pass "$absent_agent is absent from oc-lite"
    fi
  done

  if worker_agent="$(
    cd "$CALLER_DIR" &&
      OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$OC_LITE_ROOT" opencode debug agent worker 2>/dev/null
  )" && bun -e '
    const agent = JSON.parse(await Bun.stdin.text())
    const effective = (permission, command) => {
      let decision
      for (const rule of agent.permission ?? []) {
        if (rule.permission !== permission) continue
        const escaped = String(rule.pattern).split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")
        if (new RegExp("^" + escaped + "$").test(command)) decision = rule.action
      }
      return decision
    }
    if (agent.tools?.harness_state === true || agent.tools?.investigate === true) process.exit(1)
    if (agent.tools?.task !== true || agent.tools?.read !== true || agent.tools?.apply_patch !== true) process.exit(1)
    if (agent.model?.providerID !== "openai" || agent.model?.modelID !== "gpt-5.6-sol") process.exit(1)
    if (effective("task", "runner") !== "allow" || effective("task", "worker") !== "deny" || effective("task", "terraworker") !== "deny") process.exit(1)
    for (const command of [
      "bun test test/unit.test.ts",
      "git commit -m result",
      "git merge --no-ff issue-owner",
      "gh pr merge 96",
      "orca orchestration check --json",
    ]) {
      if (effective("bash", command) !== "allow") process.exit(1)
    }
    for (const command of [
      "rm -rf build",
      "git clean -fdx",
      "git reset --hard HEAD~1",
      "git push --force origin HEAD",
      "sudo rm file",
    ]) {
      if (effective("bash", command) !== "deny") process.exit(1)
    }
  ' <<<"$worker_agent"; then
    pass "Worker resolves the Sol primary with direct implementation authority, Runner-only delegation, and destructive safeguards"
  else
    fail "Worker topology, implementation authority, or effective permission matrix is incorrect"
  fi

  if runner_agent="$(
    cd "$CALLER_DIR" &&
      OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$OC_LITE_ROOT" opencode debug agent runner 2>/dev/null
  )" && bun -e '
    const agent = JSON.parse(await Bun.stdin.text())
    const effective = (permission, command) => {
      let decision
      for (const rule of agent.permission ?? []) {
        if (rule.permission !== permission) continue
        const escaped = String(rule.pattern).split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")
        if (new RegExp("^" + escaped + "$").test(command)) decision = rule.action
      }
      return decision
    }
    const allowed = (permission, command) => effective(permission, command) === "allow"
    if (agent.tools?.task === true || agent.tools?.apply_patch === true || agent.tools?.edit === true || agent.tools?.write === true) process.exit(1)
    if (agent.tools?.read !== true || agent.tools?.bash !== true) process.exit(1)
    if (!allowed("codex-self-improvement_skill_view", "*")) process.exit(1)
    if (allowed("codex-self-improvement_skill_list", "*")) process.exit(1)
    if (allowed("codex-self-improvement_skill_manage", "*")) process.exit(1)
    if (!allowed("skill", "agent-browser")) process.exit(1)
    if (!allowed("skill", "orca-cli")) process.exit(1)
    if (!allowed("bash", "agent-browser *")) process.exit(1)
    if (!allowed("bash", "npx agent-browser *")) process.exit(1)
    for (const command of [
      "gh pr view 96",
      "gh api graphql -X POST -f query={viewer{login}}",
      "curl https://api.example.test/graphql -X POST --data {query:{viewer{login}}}",
      "git status --short",
      "bun test test/unit.test.ts --reporter=junit --reporter-outfile=/tmp/runner.xml",
      "npm install --no-save",
      "mkdir -p /tmp/runner-report",
      "agent-browser click @submit",
      "agent-browser fill @email user@example.com",
      "opencode --help",
    ]) {
      if (effective("bash", command) !== "allow") process.exit(1)
    }
    for (const command of [
      "gh pr merge 96",
      "gh issue comment 96 --body done",
      "git fetch origin main",
      "git commit -m result",
      "git push origin HEAD",
      "git reset --hard HEAD~1",
      "apply_patch source.ts",
      "orca status --json",
      "codex exec inspect",
      "npm publish",
      "cat .env",
      "cat ~/.ssh/id_ed25519",
    ]) {
      if (effective("bash", command) !== "deny") process.exit(1)
    }
    for (const command of ["orca status --json", "orca-dev status --json", "orca-ide status --json"]) {
      if (effective("bash", command) !== "deny") process.exit(1)
    }
    if (effective("read", ".env") !== "deny" || effective("read", ".env.example") !== "allow") process.exit(1)
    if (effective("read", "config/credentials.json") !== "deny") process.exit(1)
    if (effective("external_directory", `${process.env.HOME}/.ssh/id_ed25519`) !== "deny") process.exit(1)
    if (effective("external_directory", "/tmp/runner-report") !== "allow") process.exit(1)
  ' <<<"$runner_agent"; then
    pass "Runner allows investigation and verification while retaining authority boundaries"
  else
    fail "Runner effective permission matrix, tool isolation, or authority boundary is incorrect"
  fi
fi

if [[ -n "$BIN_DIR" ]]; then
  wrapper="$BIN_DIR/oc-lite"
  if [[ -f "$wrapper" ]]; then
    if grep -Fqx "# oc-lite-root: $ROOT" "$wrapper" &&
      grep -Fqx 'export OPENCODE_EXPERIMENTAL_LSP_TOOL=true' "$wrapper" &&
      grep -Fqx 'OPENCODE_CONFIG_DIR="$OPENCODE_O_LITE_ROOT/profiles/oc-lite" exec opencode "$@"' "$wrapper"; then
      pass "Installed oc-lite wrapper points to this profile with Runner LSP enabled"
    else
      fail "Existing oc-lite wrapper is not managed by this checkout; rerun ./scripts/install/oc-lite.sh"
    fi
  else
    warn "Oc-lite wrapper is not installed at $wrapper"
  fi

  case ":$PATH:" in
    *":$BIN_DIR:"*) pass "$BIN_DIR is on PATH" ;;
    *) warn "$BIN_DIR is not on PATH" ;;
  esac
fi

finish
