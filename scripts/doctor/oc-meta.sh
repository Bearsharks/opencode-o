#!/usr/bin/env bash

# oc-meta doctor.
#
# --preflight : prerequisites, repository layout, Orca CLI prerequisite, and
#               global/project conflicts. No smoke tests, no resolved config.
# full        : validates the INSTALLED self-contained snapshot when present
#               (marker, exact asset set, dependency resolution from the
#               installed tree, no source-checkout references, resolved
#               agents/topology, wrapper); otherwise validates the SOURCE
#               profile through a throwaway staged copy (so validation never
#               materializes OpenCode-managed dependency files into the
#               repository) and warns that oc-meta is not installed.

set -u

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
OC_META_SOURCE="$ROOT/profiles/oc-meta"
MARKER_FILE=".oc-meta-managed"
CALLER_DIR="$PWD"
EXPECTED_OPENCODE_VERSION="1.18.4"
MODE="full"
failures=0
warnings=0
diagnostic_root=""
validation_dir=""

cleanup() {
  if [[ -n "$diagnostic_root" && -d "$diagnostic_root" ]]; then
    rm -rf -- "$diagnostic_root"
  fi
  if [[ -n "$validation_dir" && -d "$validation_dir" ]]; then
    rm -rf -- "$validation_dir"
  fi
}

trap cleanup EXIT

if [[ "${1:-}" == "--preflight" ]]; then
  MODE="preflight"
elif [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  printf '%s\n' \
    'Usage: ./scripts/doctor/oc-meta.sh [--preflight]' \
    '' \
    '  --preflight  Check prerequisites and oc-meta-profile conflicts without' \
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

if [[ -n "${OPENCODE_O_META_CONFIG_HOME:-}" ]]; then
  CONFIG_HOME="$OPENCODE_O_META_CONFIG_HOME"
elif [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
  CONFIG_HOME="$XDG_CONFIG_HOME/opencode"
elif [[ -n "${HOME:-}" ]]; then
  CONFIG_HOME="$HOME/.config/opencode"
else
  CONFIG_HOME=""
  fail "Cannot determine the OpenCode config home because HOME is unset"
fi
PROFILES_PARENT="${CONFIG_HOME:+$CONFIG_HOME/profiles}"
INSTALL_DIR="${PROFILES_PARENT:+$PROFILES_PARENT/oc-meta}"

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
    warn "OpenCode $opencode_version is installed; oc-meta is tested with $EXPECTED_OPENCODE_VERSION"
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
  "scripts/install/oc-meta.sh"
  "scripts/doctor/oc-meta.sh"
  "scripts/doctor/oc-meta-orca.sh"
  "scripts/doctor/oc-meta-orca.fixtures.sh"
  "scripts/uninstall/oc-meta.sh"
  "profiles/oc-meta/opencode.jsonc"
  "profiles/oc-meta/agents/MetaOrchestrator.md"
  "profiles/oc-meta/agents/runner.md"
  "profiles/oc-meta/plugins/oc-meta-topology.ts"
  "profiles/oc-meta/plugins/_oc-meta-topology-v1/oc-meta-topology.smoke.ts"
)

for file in "${required_files[@]}"; do
  if [[ -f "$ROOT/$file" ]]; then
    pass "Repository file $file"
  else
    fail "Missing repository file $file"
  fi
done

if orca_probe="$("$ROOT/scripts/doctor/oc-meta-orca.sh" 2>&1)"; then
  orca_exe="$(grep -E '^ORCA_CLI=' <<<"$orca_probe" | cut -d= -f2-)"
  orca_version="$(grep -E '^ORCA_CLI_VERSION=' <<<"$orca_probe" | cut -d= -f2-)"
  pass "Orca CLI available: $orca_exe ($orca_version)"
else
  fail "Orca CLI prerequisite failed; Meta cannot coordinate Orca job sessions without it"
  printf '%s\n' "$orca_probe" | sed 's/^/  /'
fi

conflicting_agents=(MetaOrchestrator worker runner HTOrchestrator orchestrator terraworker lunaworker probe)

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
      \( -name '*harness-state*' -o -name '*a-max*' -o -name '*max-topology*' -o -name '*oc-lite-topology*' -o -name '*oc-meta-topology*' \) -print)
  done

  for config in "$GLOBAL_CONFIG_DIR/opencode.json" "$GLOBAL_CONFIG_DIR/opencode.jsonc"; do
    if [[ -f "$config" ]] && grep -Eq 'harness-state|a-max|max-topology|oc-lite-topology|oc-meta-topology' "$config"; then
      fail "Global config references a harness plugin: $config"
    fi
    if [[ -f "$config" ]] && grep -Eq '"default_agent"[[:space:]]*:[[:space:]]*"(MetaOrchestrator|worker|HTOrchestrator|orchestrator)"' "$config"; then
      fail "Global config makes a harness coordinator or oc-meta worker the default agent: $config"
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
      \( -name '*harness-state*' -o -name '*a-max*' -o -name '*max-topology*' -o -name '*oc-lite-topology*' -o -name '*oc-meta-topology*' \) -print)
  done
fi

if command -v opencode >/dev/null 2>&1 && command -v bun >/dev/null 2>&1; then
  diagnostic_root="$(mktemp -d "${TMPDIR:-/tmp}/opencode-o-oc-meta-doctor.XXXXXX" 2>/dev/null || true)"
  if [[ -n "$diagnostic_root" ]]; then
    mkdir -p "$diagnostic_root/data" "$diagnostic_root/work"
    if bare_config="$(
      cd "$diagnostic_root/work" &&
        XDG_DATA_HOME="$diagnostic_root/data" opencode debug config 2>/dev/null
    )"; then
      if grep -Fq "oc-meta-topology.ts" <<<"$bare_config"; then
        fail "Bare OpenCode resolves oc-meta-topology without the oc-meta wrapper"
      else
        pass "Bare OpenCode does not resolve the oc-meta plugin"
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

# ---- Full mode: pick the validation target.
PROFILE_DIR=""
PROFILE_LABEL=""
installed=0
if [[ -n "$INSTALL_DIR" && ( -e "$INSTALL_DIR" || -L "$INSTALL_DIR" ) ]]; then
  if [[ ! -d "$INSTALL_DIR" || -L "$INSTALL_DIR" ]]; then
    fail "Installed oc-meta path is not a plain directory: $INSTALL_DIR"
  elif [[ ! -f "$INSTALL_DIR/$MARKER_FILE" ]]; then
    fail "Unmanaged oc-meta install directory (no $MARKER_FILE marker): $INSTALL_DIR"
  else
    installed=1
    PROFILE_DIR="$INSTALL_DIR"
    PROFILE_LABEL="installed"
    pass "Installed oc-meta snapshot is marker-managed: $INSTALL_DIR"
  fi
fi

if [[ $installed -eq 1 ]]; then
  expected_top="$(printf '%s\n' .gitignore .oc-meta-managed agents node_modules opencode.jsonc package-lock.json package.json plugins | sort)"
  actual_top="$(ls -A "$INSTALL_DIR" 2>/dev/null | sort)"
  if [[ "$actual_top" == "$expected_top" ]]; then
    pass "Installed snapshot has exactly the intended assets plus OpenCode-managed dependencies"
  else
    fail "Installed snapshot top-level assets differ from the intended set"
    diff <(printf '%s\n' "$expected_top") <(printf '%s\n' "$actual_top") | sed 's/^/  /'
  fi

  expected_agents="$(printf '%s\n' MetaOrchestrator.md runner.md | sort)"
  actual_agents="$(ls -A "$INSTALL_DIR/agents" 2>/dev/null | sort)"
  if [[ "$actual_agents" == "$expected_agents" ]]; then
    pass "Installed snapshot has exactly MetaOrchestrator and runner agents"
  else
    fail "Installed snapshot agent set is not exactly {MetaOrchestrator, runner}"
  fi

  expected_plugins="$(printf '%s\n' oc-meta-topology.ts)"
  actual_plugins="$(ls -A "$INSTALL_DIR/plugins" 2>/dev/null | sort)"
  if [[ "$actual_plugins" == "$expected_plugins" ]]; then
    pass "Installed snapshot has exactly the topology plugin"
  else
    fail "Installed snapshot plugin set is not exactly {oc-meta-topology.ts}"
  fi

  if grep -rFl -- "$ROOT" \
    "$INSTALL_DIR/opencode.jsonc" \
    "$INSTALL_DIR/agents" \
    "$INSTALL_DIR/plugins" \
    "$INSTALL_DIR/package.json" \
    "$INSTALL_DIR/package-lock.json" \
    "$INSTALL_DIR/$MARKER_FILE" >/dev/null 2>&1; then
    fail "Installed snapshot references the source checkout"
  else
    pass "Installed snapshot has no source-checkout references"
  fi

  if command -v bun >/dev/null 2>&1; then
    install_dir_phys="$(cd "$INSTALL_DIR" && pwd -P)"
    resolved_dep="$(cd "$INSTALL_DIR" && bun -e 'console.log(Bun.resolveSync("@opencode-ai/plugin", process.cwd()))' 2>/dev/null)" || resolved_dep=""
    if [[ "$resolved_dep" == "$install_dir_phys/node_modules/@opencode-ai/plugin"* ||
      "$resolved_dep" == "$INSTALL_DIR/node_modules/@opencode-ai/plugin"* ]]; then
      pass "Snapshot dependency resolves from the installed tree itself"
    else
      fail "Snapshot dependency does not resolve from the installed tree (got: ${resolved_dep:-nothing})"
    fi
  fi
else
  warn "Oc-meta is not installed at ${INSTALL_DIR:-<undetermined>}; validating the source profile through a staged copy"
  validation_dir="$(mktemp -d "${TMPDIR:-/tmp}/opencode-o-oc-meta-srcval.XXXXXX" 2>/dev/null || true)"
  if [[ -n "$validation_dir" ]]; then
    mkdir -p "$validation_dir/agents" "$validation_dir/plugins"
    cp -- "$OC_META_SOURCE/opencode.jsonc" "$validation_dir/opencode.jsonc" &&
      cp -- "$OC_META_SOURCE/agents/MetaOrchestrator.md" "$validation_dir/agents/MetaOrchestrator.md" &&
      cp -- "$OC_META_SOURCE/agents/runner.md" "$validation_dir/agents/runner.md" &&
      cp -- "$OC_META_SOURCE/plugins/oc-meta-topology.ts" "$validation_dir/plugins/oc-meta-topology.ts"
    PROFILE_DIR="$validation_dir"
    PROFILE_LABEL="source"
  else
    fail "Could not create a staged copy for source-profile validation"
  fi
fi

if command -v bun >/dev/null 2>&1; then
  if (cd "$ROOT" && bun run check:oc-meta >/dev/null 2>&1); then
    pass "oc-meta smoke check"
  else
    fail "oc-meta smoke check failed; run 'bun run check:oc-meta' for diagnostics"
  fi
fi

if command -v opencode >/dev/null 2>&1 && [[ -n "$PROFILE_DIR" ]]; then
  if models="$(opencode models 2>/dev/null)"; then
    model_ids=()
    if configured_models="$(PROFILE_DIR="$PROFILE_DIR" bun -e '
      const fs = require("fs")
      for (const name of ["MetaOrchestrator", "runner"]) {
        const text = fs.readFileSync(`${process.env.PROFILE_DIR}/agents/${name}.md`, "utf8")
        const header = text.split(/^---\s*$/m)[1] ?? ""
        const model = header.match(/^model:\s*(\S+)\s*$/m)?.[1]?.replace(/^["\x27]|["\x27]$/g, "")
        if (!model || !model.includes("/")) process.exit(1)
        console.log(model)
      }
    ')"; then
      while IFS= read -r model; do model_ids+=("$model"); done <<<"$configured_models"
    else
      fail "Could not read configured oc-meta agent models"
    fi
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
      OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PROFILE_DIR" opencode debug config 2>&1
  )"; then
    oc_meta_origin_count="$(
      grep -E '"spec": "file:.*oc-meta-topology\.ts"' <<<"$resolved" | wc -l | tr -d '[:space:]'
    )"
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
    if [[ "$oc_meta_origin_count" == "1" ]]; then
      pass "Exactly one oc-meta topology plugin origin ($PROFILE_LABEL profile)"
    else
      fail "Expected one oc-meta topology plugin origin, found $oc_meta_origin_count ($PROFILE_LABEL profile)"
    fi
    if [[ "$oc_lite_origin_count" == "0" ]]; then
      pass "oc-lite topology plugin is absent from oc-meta"
    else
      fail "oc-lite topology plugin leaked into oc-meta"
    fi
    if [[ "$max_origin_count" == "0" ]]; then
      pass "Max topology plugin is absent from oc-meta"
    else
      fail "Max topology plugin leaked into oc-meta"
    fi
    if [[ "$a_max_origin_count" == "0" ]]; then
      pass "A-Max plugin is absent from oc-meta"
    else
      fail "A-Max plugin leaked into oc-meta"
    fi
    if [[ "$default_origin_count" == "0" ]]; then
      pass "Default harness plugin is absent from oc-meta"
    else
      fail "Default harness plugin leaked into oc-meta"
    fi
  else
    fail "Could not resolve the $PROFILE_LABEL oc-meta config with OPENCODE_CONFIG_DIR=$PROFILE_DIR"
  fi

  for agent in MetaOrchestrator runner; do
    if agent_config="$(
      cd "$CALLER_DIR" &&
        OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PROFILE_DIR" opencode debug agent "$agent" 2>/dev/null
    )"; then
      pass "Resolved oc-meta agent $agent ($PROFILE_LABEL profile)"
      if bun -e '
        const agent = JSON.parse(await Bun.stdin.text())
        const effective = (command) => {
          let decision
          for (const rule of agent.permission ?? []) {
            if (rule.permission !== "bash") continue
            const escaped = String(rule.pattern).split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")
            if (new RegExp("^" + escaped + "$").test(command)) decision = rule.action
          }
          return decision
        }
        if (effective("agent-browser open https://example.com") !== "allow") process.exit(1)
        if (effective("npx agent-browser open https://example.com") !== "allow") process.exit(1)
      ' <<<"$agent_config"; then
        pass "Oc-meta agent $agent allows agent-browser without approval"
      else
        fail "Oc-meta agent $agent does not allow agent-browser without approval"
      fi
    else
      fail "Could not resolve oc-meta agent $agent ($PROFILE_LABEL profile)"
    fi
  done

  for absent_agent in HTOrchestrator terraworker worker lunaworker; do
    if (
      cd "$CALLER_DIR" &&
        OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PROFILE_DIR" opencode debug agent "$absent_agent" >/dev/null 2>&1
    ); then
      fail "$absent_agent leaked into oc-meta"
    else
      pass "$absent_agent is absent from oc-meta"
    fi
  done

  if meta_agent="$(
    cd "$CALLER_DIR" &&
      OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PROFILE_DIR" opencode debug agent MetaOrchestrator 2>/dev/null
  )" && bun -e '
    const agent = JSON.parse(await Bun.stdin.text())
    if (agent.tools?.harness_state === true || agent.tools?.investigate === true) process.exit(1)
    if (agent.tools?.task !== true || agent.tools?.read !== true) process.exit(1)
    if (agent.tools?.apply_patch !== true && agent.tools?.edit !== true) process.exit(1)
    for (const key of Object.keys(agent.tools ?? {})) {
      if (key.startsWith("a_max_")) process.exit(1)
    }
    const effective = (permission, command) => {
      let decision
      for (const rule of agent.permission ?? []) {
        if (rule.permission !== permission) continue
        const escaped = String(rule.pattern).split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")
        if (new RegExp("^" + escaped + "$").test(command)) decision = rule.action
      }
      return decision
    }
    if (effective("bash", "orca status --json") !== "allow") process.exit(1)
    if (effective("task", "runner") !== "allow" || effective("task", "terraworker") !== "deny") process.exit(1)
  ' <<<"$meta_agent"; then
    pass "MetaOrchestrator has task/read/edit/apply_patch capability without harness or A-Max tools"
  else
    fail "MetaOrchestrator tool isolation, implementation capability, or Orca access is incorrect"
  fi

  if runner_agent="$(
    cd "$CALLER_DIR" &&
      OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PROFILE_DIR" opencode debug agent runner 2>/dev/null
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
    const expected = new Map([
      ["gh pr view 96", "allow"],
      ["gh api repos/example/project/pulls/96", "allow"],
      ["gh api graphql -X POST -f query={viewer{login}}", "allow"],
      ["curl https://api.example.test/graphql -X POST --data {query:{viewer{login}}}", "allow"],
      ["gh auth status", "allow"],
      ["git status --short", "allow"],
      ["git diff --stat", "allow"],
      ["git show --stat HEAD", "allow"],
      ["git log -5 --oneline", "allow"],
      ["bun test test/unit.test.ts --reporter=junit --reporter-outfile=/tmp/runner.xml", "allow"],
      ["npm install --no-save", "allow"],
      ["pnpm install --frozen-lockfile", "allow"],
      ["bun install --frozen-lockfile", "allow"],
      ["pip install --target /tmp/runner-deps pytest", "allow"],
      ["mkdir -p /tmp/runner-report", "allow"],
      ["cp report.xml /tmp/runner-report/report.xml", "allow"],
      ["tee /tmp/runner-report/summary.txt", "allow"],
      ["make help", "allow"],
      ["opencode --help", "allow"],
      ["agent-browser snapshot", "allow"],
      ["agent-browser click @submit", "allow"],
      ["agent-browser fill @email user@example.com", "allow"],
      ["agent-browser type @search evidence", "allow"],
      ["agent-browser eval document.title", "allow"],
      ["gh pr merge 96", "deny"],
      ["gh issue comment 96 --body done", "deny"],
      ["gh release create v1.0.0", "deny"],
      ["gh pr checkout 96", "deny"],
      ["git fetch origin main", "deny"],
      ["git commit -m result", "deny"],
      ["git push origin HEAD", "deny"],
      ["git reset --hard HEAD~1", "deny"],
      ["apply_patch source.ts", "deny"],
      ["orca status --json", "deny"],
      ["codex exec inspect", "deny"],
      ["npm publish", "deny"],
      ["cat .env", "deny"],
      ["cat ~/.ssh/id_ed25519", "deny"],
    ])
    if (agent.tools?.task === true || agent.tools?.apply_patch === true || agent.tools?.edit === true || agent.tools?.write === true) process.exit(1)
    if (agent.tools?.read !== true || agent.tools?.bash !== true) process.exit(1)
    for (const key of Object.keys(agent.tools ?? {})) {
      if (key.startsWith("a_max_")) process.exit(1)
    }
    if (!allowed("codex-self-improvement_skill_view", "*")) process.exit(1)
    if (allowed("codex-self-improvement_skill_list", "*")) process.exit(1)
    if (allowed("codex-self-improvement_skill_manage", "*")) process.exit(1)
    if (!allowed("skill", "agent-browser")) process.exit(1)
    if (!allowed("bash", "agent-browser *")) process.exit(1)
    if (!allowed("bash", "npx agent-browser *")) process.exit(1)
    for (const command of ["orca status --json", "orca-dev status --json", "orca-ide status --json"]) {
      if (effective("bash", command) !== "deny") process.exit(1)
    }
    for (const [command, action] of expected) {
      if (effective("bash", command) !== action) process.exit(1)
    }
  ' <<<"$runner_agent"; then
    pass "Runner permissions allow scoped investigation/preparation and retain authority boundaries"
  else
    fail "Runner effective permission matrix, tool isolation, or inherited/default rule ordering is incorrect"
  fi
fi

if [[ -n "$BIN_DIR" ]]; then
  wrapper="$BIN_DIR/oc-meta"
  if [[ -f "$wrapper" ]]; then
    if grep -Fqx "# oc-meta-install: $INSTALL_DIR" "$wrapper" &&
      grep -Fqx 'export OPENCODE_EXPERIMENTAL_LSP_TOOL=true' "$wrapper" &&
      grep -Fqx 'OPENCODE_CONFIG_DIR="$OPENCODE_O_META_INSTALLED" exec opencode "$@"' "$wrapper"; then
      pass "Installed oc-meta wrapper references the installed snapshot"
    else
      fail "Existing oc-meta wrapper is not managed for $INSTALL_DIR; rerun ./scripts/install/oc-meta.sh"
    fi
    if grep -Fq "$ROOT" "$wrapper"; then
      fail "Installed oc-meta wrapper references the source checkout"
    else
      pass "Installed oc-meta wrapper has no source-checkout references"
    fi
  else
    warn "Oc-meta wrapper is not installed at $wrapper"
  fi

  tools_wrapper="$BIN_DIR/oc-meta-tools"
  if [[ -e "$tools_wrapper" || -L "$tools_wrapper" ]]; then
    fail "Stale oc-meta-tools wrapper is present at $tools_wrapper; remove it, it is not part of oc-meta"
  else
    pass "No stale oc-meta-tools wrapper"
  fi

  case ":$PATH:" in
    *":$BIN_DIR:"*) pass "$BIN_DIR is on PATH" ;;
    *) warn "$BIN_DIR is not on PATH" ;;
  esac
fi

finish
