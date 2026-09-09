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
  "profiles/a-max/plugins/_a-max-v1/a-max-topology.ts"
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

profile_local_files=(
  "profiles/a-max/opencode.jsonc"
  "profiles/a-max/agents/HTOrchestrator.md"
  "profiles/a-max/agents/terraworker.md"
  "profiles/a-max/agents/runner.md"
  "profiles/a-max/plugins/_a-max-v1/a-max-topology.ts"
)

for path in "${profile_local_files[@]}"; do
  if [[ -f "$ROOT/$path" && ! -L "$ROOT/$path" ]]; then
    pass "A-Max profile-local regular file $path"
  else
    fail "A-Max requires a profile-local regular file: $path"
  fi
done

if command -v bun >/dev/null 2>&1; then
  if A_MAX_CONFIG_PATH="$A_MAX_ROOT/opencode.jsonc" bun -e '
    const config = JSON.parse(await Bun.file(process.env.A_MAX_CONFIG_PATH ?? "").text())
    const disabled = ["build", "plan", "general", "explore"]
    if (
      config.model !== "zai-coding-plan/glm-5.3-flash" ||
      config.subagent_depth !== 2 ||
      config.default_agent !== "HTOrchestrator" ||
      config.compaction?.auto !== true || config.compaction?.reserved !== 25600 ||
      config.provider?.["opencode-go"]?.models?.["gpt-5.6-luna"]?.limit?.context !== 272000 ||
      disabled.some((name) => config.agent?.[name]?.disable !== true) ||
      config.permission?.harness_state !== "deny" || config.permission?.investigate !== "deny"
    ) process.exit(1)
  '; then
    pass "A-Max standalone config preserves its configured defaults"
  else
    fail "A-Max standalone config is invalid or missing required defaults"
  fi
fi

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
        env -u OPENCODE_CONFIG_DIR XDG_DATA_HOME="$diagnostic_root/data" opencode debug config 2>/dev/null
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

  # A-Max external model/effort config detection mirrors the plugin contract:
  # - OPENCODE_O_A_MAX_MODEL_CONFIG unset: auto-discover the default file;
  # - set to a non-empty value: that absolute path is required to exist and be valid;
  # - set to the empty string: external loading is disabled.
  # A missing auto-discovered default file is a no-op; A-Max defaults then apply.
  a_max_external_model=""
  a_max_external_effort=""
  external_config_path=""
  external_from_env=0
  if [[ -n "${OPENCODE_O_A_MAX_MODEL_CONFIG+x}" ]]; then
    external_from_env=1
    if [[ -n "$OPENCODE_O_A_MAX_MODEL_CONFIG" ]]; then
      external_config_path="$OPENCODE_O_A_MAX_MODEL_CONFIG"
      case "$external_config_path" in
        /*) ;;
        *)
          fail "A-Max model config override is not an absolute path: $external_config_path"
          external_config_path=""
          ;;
      esac
    fi
  elif [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
    external_config_path="$XDG_CONFIG_HOME/opencode/a-max-model.json"
  elif [[ -n "${HOME:-}" ]]; then
    external_config_path="$HOME/.config/opencode/a-max-model.json"
  fi

  if [[ -n "$external_config_path" ]] && [[ "$external_from_env" -eq 0 ]] && [[ ! -e "$external_config_path" ]]; then
    external_config_path=""
  fi

  if [[ -n "$external_config_path" ]]; then
    if ! command -v bun >/dev/null 2>&1; then
      fail "Cannot validate the active A-Max model config without Bun"
      external_config_path=""
    elif external_values="$(
      A_MAX_MODEL_CONFIG_PATH="$external_config_path" bun -e '
        const configPath = process.env.A_MAX_MODEL_CONFIG_PATH ?? ""
        let raw: string
        try {
          raw = await Bun.file(configPath).text()
        } catch (error) {
          console.error(`A-Max model config error: cannot read ${configPath}: ${error instanceof Error ? error.message : String(error)}`)
          process.exit(1)
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch (error) {
          console.error(`A-Max model config error: ${configPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
          process.exit(1)
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          console.error(`A-Max model config error: ${configPath} must contain a JSON object, not ${Array.isArray(parsed) ? "an array" : typeof parsed}`)
          process.exit(1)
        }
        const record = parsed as Record<string, unknown>
        const keys = Object.keys(record).sort()
        if (keys.length !== 2 || keys[0] !== "effort" || keys[1] !== "model") {
          console.error(`A-Max model config error: ${configPath} must contain exactly the "model" and "effort" keys`)
          process.exit(1)
        }
        const rawModel = record.model
        const rawEffort = record.effort
        if (typeof rawModel !== "string" || typeof rawEffort !== "string") {
          console.error(`A-Max model config error: ${configPath} fields "model" and "effort" must be strings`)
          process.exit(1)
        }
        const model = rawModel.trim()
        const effort = rawEffort.trim()
        if (!model || !/^\S+\/\S+$/.test(model)) {
          console.error(`A-Max model config error: ${configPath} field "model" must be a trimmed non-empty "provider/model" identifier without surrounding or internal whitespace`)
          process.exit(1)
        }
        if (!effort) {
          console.error(`A-Max model config error: ${configPath} field "effort" must be a trimmed non-empty string`)
          process.exit(1)
        }
        process.stdout.write(`${model}\t${effort}`)
      '
    )"; then
      a_max_external_model="${external_values%%$'\t'*}"
      a_max_external_effort="${external_values##*$'\t'}"
      pass "A-Max external model config is active: $external_config_path (model=$a_max_external_model, effort=$a_max_external_effort)"
    else
      fail "A-Max external model config is not usable: $external_config_path"
      external_config_path=""
    fi
  else
    pass "No active A-Max external model config; A-Max configured defaults apply"
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
    legacy_profile_origin_count="$(
      grep -E '"spec": "file:.*profiles/max/' <<<"$resolved" | wc -l | tr -d '[:space:]'
    )"
    default_origin_count="$(
      grep -E '"spec": "file:.*plugins/harness-state\.ts"' <<<"$resolved" | wc -l | tr -d '[:space:]'
    )"
    if [[ "$a_max_origin_count" == "1" ]]; then
      pass "Exactly one A-Max plugin origin"
    else
      fail "Expected one A-Max plugin origin, found $a_max_origin_count"
    fi
    if [[ "$legacy_profile_origin_count" == "0" ]]; then
      pass "Deleted Max profile is absent from A-Max resolution"
    else
      fail "Deleted Max profile leaked into A-Max resolution"
    fi
    if [[ "$default_origin_count" == "0" ]]; then
      pass "Default harness plugin is absent from A-Max"
    else
      fail "Default harness plugin leaked into A-Max"
    fi

    if bun -e '
      const config = JSON.parse(await Bun.stdin.text())
      if (config.default_agent !== "HTOrchestrator") process.exit(1)
      for (const name of ["HTOrchestrator", "terraworker", "runner"]) {
        if (!config.agent?.[name]) process.exit(1)
      }
    ' <<<"$resolved"; then
      pass "Resolved A-Max config selects HTOrchestrator and all three local agents"
    else
      fail "Resolved A-Max config is missing HTOrchestrator or a local A-Max agent"
    fi

    if [[ -n "$a_max_external_model" ]]; then
      if A_MAX_EXTERNAL_MODEL="$a_max_external_model" A_MAX_EXTERNAL_EFFORT="$a_max_external_effort" bun -e '
        const config = JSON.parse(await Bun.stdin.text())
        const expectedModel = process.env.A_MAX_EXTERNAL_MODEL
        const expectedEffort = process.env.A_MAX_EXTERNAL_EFFORT
        if (config.model !== expectedModel) process.exit(1)
        for (const name of ["HTOrchestrator", "terraworker", "runner"]) {
          const agent = config.agent?.[name]
          if (agent?.model !== expectedModel || agent?.reasoningEffort !== expectedEffort) process.exit(1)
        }
      ' <<<"$resolved"; then
        pass "A-Max top-level model and all three A-Max agents reflect the external model config"
      else
        fail "A-Max resolved config does not reflect the external model config (model=$a_max_external_model, effort=$a_max_external_effort)"
      fi
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

      if [[ -n "$a_max_external_model" ]]; then
        # With an active external config, model/reasoningEffort are owned by the
        # external file (reasoningEffort is asserted by the resolved-config
        # check above; model identity here).
        if A_MAX_AGENT_JSON="$agent_config" A_MAX_EXTERNAL_MODEL="$a_max_external_model" bun -e '
          const extended = JSON.parse(process.env.A_MAX_AGENT_JSON)
          const externalModel = process.env.A_MAX_EXTERNAL_MODEL ?? ""
          const separator = externalModel.indexOf("/")
          if (separator <= 0) process.exit(1)
          const resolved = extended.model ?? {}
          if (resolved.providerID !== externalModel.slice(0, separator)) process.exit(1)
          if (resolved.modelID !== externalModel.slice(separator + 1)) process.exit(1)
        '; then
          pass "A-Max agent $agent model identity follows the external model config"
        else
          fail "A-Max agent $agent does not follow the external model config ($a_max_external_model)"
        fi
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
  )" && A_MAX_EXTERNAL_MODEL="$a_max_external_model" bun -e '
    const agent = JSON.parse(await Bun.stdin.text())
    const externalModel = process.env.A_MAX_EXTERNAL_MODEL ?? ""
    if (agent.tools?.harness_state === true || agent.tools?.investigate === true) process.exit(1)
    if (agent.tools?.task !== true || agent.tools?.read !== true) process.exit(1)
    if (externalModel) {
      // An overriding model owns which concrete editing tools OpenCode derives;
      // require the editing capability in either form.
      if (agent.tools?.apply_patch !== true && !(agent.tools?.edit === true && agent.tools?.write === true)) process.exit(1)
    } else if (agent.tools?.apply_patch !== true) {
      process.exit(1)
    }
    if (
      agent.tools?.a_max_board !== true ||
      agent.tools?.a_max_move !== true ||
      agent.tools?.a_max_inspect !== true ||
      agent.tools?.a_max_interrupt !== true
    ) process.exit(1)
  ' <<<"$ht_agent"; then
    pass "HTOrchestrator has A-Max capabilities and intervention tools"
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
    const denied = (permission, pattern) =>
      agent.permission?.some((rule) =>
        rule.permission === permission && rule.pattern === pattern && rule.action === "deny",
      )
    if (agent.tools?.task === true || agent.tools?.apply_patch === true) process.exit(1)
    if (agent.tools?.read !== true || agent.tools?.bash !== true) process.exit(1)
    if (!allowed("codex-self-improvement_skill_view", "*")) process.exit(1)
    if (allowed("codex-self-improvement_skill_list", "*")) process.exit(1)
    if (allowed("codex-self-improvement_skill_manage", "*")) process.exit(1)
    if (!allowed("skill", "agent-browser")) process.exit(1)
    if (!allowed("bash", "agent-browser *")) process.exit(1)
    if (!allowed("bash", "npx agent-browser *")) process.exit(1)
    if (!allowed("bash", "python3 -m unittest Tools/*")) process.exit(1)
    if (!allowed("bash", "pgrep -fal *")) process.exit(1)
    if (!allowed("bash", "make help")) process.exit(1)
    if (!allowed("bash", "make docs-check")) process.exit(1)
    if (!allowed("bash", "make verify-*")) process.exit(1)
    if (!allowed("bash", "make *-test")) process.exit(1)
    if (!denied("edit", "*")) process.exit(1)
    if (!denied("write", "*")) process.exit(1)
    if (!denied("apply_patch", "*")) process.exit(1)
    if (!denied("task", "*")) process.exit(1)
    if (!denied("bash", "*")) process.exit(1)
    if (!denied("bash", "orca *")) process.exit(1)
    if (!denied("bash", "orca-dev *")) process.exit(1)
    if (!denied("bash", "orca-ide *")) process.exit(1)
    if (!denied("read", "*.env")) process.exit(1)
    if (!denied("read", "*.env.*")) process.exit(1)
    if (!allowed("read", "*.env.example")) process.exit(1)
    if (allowed("bash", "*")) process.exit(1)
    if (allowed("bash", "make *")) process.exit(1)
    if (allowed("bash", "make docs-*")) process.exit(1)
    const escapeRegExp = (part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    const globToRegExp = (glob) => new RegExp("^" + String(glob).split("*").map(escapeRegExp).join(".*") + "$")
    const rulesFor = (permission) => (agent.permission ?? []).filter((rule) => rule.permission === permission)
    const effective = (rules, command) => {
      let decision
      for (const rule of rules) {
        let pattern
        try {
          pattern = globToRegExp(rule.pattern)
        } catch {
          continue
        }
        if (pattern.test(command)) decision = rule.action
      }
      return decision
    }
    const bashRules = rulesFor("bash")
    const readRules = rulesFor("read")
    for (const command of ["make docs-check", "make help", "make verify-docs", "make unit-test"]) {
      if (effective(bashRules, command) !== "allow") process.exit(1)
    }
    for (
      const command of [
        "make docs-index",
        "make install",
        "make custom-target",
        "git add .",
        "git commit -m check",
        "git push",
        "rm -rf /tmp/a-max-doctor-probe",
        "python3 -c print(1)",
        "python3 arbitrary.py",
        "orca probe",
        "orca-dev probe",
        "orca-ide probe",
        "find /tmp -delete",
      ]
    ) {
      if (effective(bashRules, command) !== "deny") process.exit(1)
    }
    if (effective(bashRules, "find . -type f") !== "allow") process.exit(1)
    if (effective(readRules, "secrets.env") !== "deny") process.exit(1)
    if (effective(readRules, "secrets.env.backup") !== "deny") process.exit(1)
    if (effective(readRules, ".env.example") !== "allow") process.exit(1)
    if (!allowed("bash", "git rev-parse*")) process.exit(1)
    if (!allowed("bash", "git rev-list*")) process.exit(1)
    if (!allowed("bash", "git fetch origin main")) process.exit(1)
    if (!allowed("bash", "git branch --show-current")) process.exit(1)
    if (!allowed("bash", "git branch -vv")) process.exit(1)
    if (!allowed("bash", "git remote -v")) process.exit(1)
    if (!allowed("bash", "git remote get-url*")) process.exit(1)
    if (!allowed("bash", "gh pr list*")) process.exit(1)
    if (!allowed("bash", "gh pr view*")) process.exit(1)
    if (!allowed("bash", "gh issue list*")) process.exit(1)
    if (!allowed("bash", "gh issue view*")) process.exit(1)
    if (
      agent.tools?.a_max_board === true ||
      agent.tools?.a_max_move === true ||
      agent.tools?.a_max_inspect === true ||
      agent.tools?.a_max_interrupt === true
    ) process.exit(1)
  ' <<<"$runner_agent"; then
    pass "Runner is read/command-only with bounded diagnostic and verification command families"
  else
    fail "Runner tool isolation or bounded diagnostic/verification permissions are incorrect"
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
