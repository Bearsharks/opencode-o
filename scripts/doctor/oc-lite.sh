#!/usr/bin/env bash
set -u

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
PROFILE="$ROOT/profiles/oc-lite"
MODE="${1:-full}"
if [[ "$MODE" == "--help" || "$MODE" == "-h" ]]; then
  echo 'Usage: ./scripts/doctor/oc-lite.sh [--preflight]'
  exit 0
fi
if [[ "$MODE" != full && "$MODE" != --preflight ]] || [[ $# -gt 1 ]]; then
  echo 'Usage: ./scripts/doctor/oc-lite.sh [--preflight]' >&2
  exit 2
fi

failures=0
warnings=0
diagnostic_root=""
server_pid=""
account_pid=""
cleanup() {
  if [[ -n "$account_pid" ]]; then
    kill "$account_pid" 2>/dev/null || true
    wait "$account_pid" 2>/dev/null || true
  fi
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if [[ -n "$diagnostic_root" ]]; then rm -rf -- "$diagnostic_root"; fi
}
trap cleanup EXIT
pass() { printf 'PASS  %s\n' "$1"; }
warn() { warnings=$((warnings + 1)); printf 'WARN  %s\n' "$1"; }
fail() { failures=$((failures + 1)); printf 'FAIL  %s\n' "$1"; }
finish() {
  printf '\nSummary: %d failure(s), %d warning(s)\n' "$failures" "$warnings"
  [[ $failures -eq 0 ]]
}

if command -v opencode >/dev/null 2>&1; then
  version="$(opencode --version 2>/dev/null | head -n 1)"
  if [[ "$version" == 'opencode v2.0.14' ]]; then pass "$version"
  elif [[ "$version" == opencode\ v2.* ]]; then warn "$version (tested with v2.0.14)"
  else fail "OpenCode V2 is required (found: $version)"; fi
else fail 'opencode is unavailable'; fi
for executable in bun curl; do
  if command -v "$executable" >/dev/null 2>&1; then pass "$executable available"
  else fail "$executable unavailable"; fi
done
for file in package.json bun.lock scripts/install/oc-lite.sh profiles/oc-lite/opencode.jsonc profiles/oc-lite/preflight.ts profiles/oc-lite/preflight.fixtures.sh profiles/oc-lite/gh-config.fixtures.sh profiles/oc-lite/agents/worker.md profiles/oc-lite/agents/runner.md profiles/oc-lite/plugins/oc-lite-v2/index.ts profiles/oc-lite/plugins/oc-lite-v2/oc-lite.smoke.ts; do
  if [[ ! -f "$ROOT/$file" ]]; then fail "Missing $file"; fi
done

if [[ $failures -gt 0 ]]; then finish; exit 1; fi
if [[ -n "${HOME:-}" ]]; then
  # The wrapper deliberately does not read the invoking shell's XDG config:
  # it may be another profile's global config (in particular A-Max).
  global_config_dir="$HOME/.config/opencode-o/oc-lite/opencode"
else
  fail 'Cannot locate isolated oc-lite config without HOME'
  finish
  exit 1
fi
if bun "$PROFILE/preflight.ts" "$ROOT" "$PWD" "$global_config_dir"; then
  pass 'No merged-profile conflicts'
else
  fail 'Global/project oc-lite conflict preflight'
fi
if [[ $failures -gt 0 ]]; then finish; exit 1; fi
if [[ "$MODE" == --preflight ]]; then finish; exit $?; fi

if (cd "$ROOT" && bun run check:oc-lite >/dev/null); then pass 'V2 syntax and smoke matrix'
else fail 'V2 smoke check failed: bun run check:oc-lite'; fi

# The V2 `debug config` command prints configuration sources, not resolved
# agents. Serve a private, isolated V2 API to inspect the actual registries.
# The CLI `api --standalone` stops its temporary server before registries settle.
diagnostic_root="$(mktemp -d "${TMPDIR:-/tmp}/oc-lite-doctor.XXXXXX")" || { fail 'Cannot create isolated directory'; finish; exit 1; }
mkdir -p "$diagnostic_root"/{work,config,data,cache,state}
if [[ -n "${OPENCODE_O_BIN_DIR:-}" ]]; then bin="$OPENCODE_O_BIN_DIR"
else bin="${HOME:-}/.local/bin"; fi
server_command=(opencode)
if [[ -f "$bin/oc-lite" ]] && grep -Fqx "# oc-lite-root: $ROOT" "$bin/oc-lite"; then
  server_command=("$bin/oc-lite")
fi
(
  cd "$ROOT" || exit 1
  export HOME="$diagnostic_root" XDG_DATA_HOME="$diagnostic_root/data" \
    XDG_CACHE_HOME="$diagnostic_root/cache" XDG_STATE_HOME="$diagnostic_root/state" \
    OPENCODE_CONFIG_DIR="$PROFILE"
  if [[ "${server_command[0]}" == opencode ]]; then
    # Pre-install doctor: no wrapper exists yet, so isolate the raw CLI too.
    export XDG_CONFIG_HOME="$diagnostic_root/config" OPENCODE_DB=:memory:
  else
    # Post-install doctor: prove that the wrapper overrides A-Max config while
    # preserving a caller-selected DB. Keep this topology probe disposable.
    export XDG_CONFIG_HOME="$ROOT/profiles/a-max/config-home" OPENCODE_DB=:memory:
  fi
  "${server_command[@]}" serve --hostname 127.0.0.1 --port 0 >"$diagnostic_root/server.out" 2>"$diagnostic_root/server.err"
) &
server_pid=$!
url=''
password=''
for ((i=0; i<100; i++)); do
  if [[ -f "$diagnostic_root/server.out" ]]; then
    url="$(sed -n 's/^server listening on \(http:\/\/127\.0\.0\.1:[0-9]*\)$/\1/p' "$diagnostic_root/server.out" | head -n 1)"
    password="$(sed -n 's/^server password \([^[:space:]]*\)$/\1/p' "$diagnostic_root/server.out" | head -n 1)"
    if [[ -n "$url" && -n "$password" ]]; then break; fi
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ -z "$url" || -z "$password" ]]; then
  fail 'Private V2 server failed to start (inspect OpenCode V2 installation)'
else
  # A freshly started V2 server serves HTTP before its plugin registry settles.
  # Wait for the actual agent/plugin records, never treat an empty 200 as proof.
  ready=0
  for ((i=0; i<100; i++)); do
    if curl --silent --fail -u "opencode:$password" "$url/api/agent" > "$diagnostic_root/agent.json" &&
      curl --silent --fail -u "opencode:$password" "$url/api/plugin" > "$diagnostic_root/plugin.json" &&
      bun -e '
        const fs = require("fs")
        const [agents, plugins] = process.argv.slice(1).map((path) => JSON.parse(fs.readFileSync(path, "utf8")).data)
        if (!agents.some((a) => a.id === "worker") || !agents.some((a) => a.id === "runner") || !plugins.some((p) => p.id === "oc-lite-topology" && p.state?.status === "active")) process.exit(1)
      ' "$diagnostic_root/agent.json" "$diagnostic_root/plugin.json" 2>/dev/null; then
      ready=1
      break
    fi
    if ! kill -0 "$server_pid" 2>/dev/null; then break; fi
    sleep 0.1
  done
  if [[ $ready -eq 0 ]]; then fail 'V2 agents/plugin did not become active in the private server'; fi
  # Location requests from an ordinary caller must select the same topology.
  # The server itself was started in the repository (with hostile inherited env).
  caller_location="$(bun -e 'console.log(encodeURIComponent(process.argv[1]))' "$diagnostic_root/work")"
  caller_ready=0
  if [[ $ready -eq 1 ]]; then
    for ((i=0; i<100; i++)); do
      if curl --silent --fail -u "opencode:$password" "$url/api/agent?location%5Bdirectory%5D=$caller_location" > "$diagnostic_root/agent-caller.json" &&
        bun -e '
          const agents = (await Bun.file(process.argv[1]).json()).data
          if (agents.some((a) => a.id === "HTOrchestrator") || agents.find((a) => a.id === "worker")?.mode !== "primary" || agents.find((a) => a.id === "worker")?.model !== undefined || agents.find((a) => a.id === "runner")?.mode !== "subagent" || agents.find((a) => a.id === "runner")?.model?.providerID !== "openai" || agents.find((a) => a.id === "runner")?.model?.id !== "gpt-6-luna") process.exit(1)
        ' "$diagnostic_root/agent-caller.json" 2>/dev/null; then caller_ready=1; break; fi
      if ! kill -0 "$server_pid" 2>/dev/null; then break; fi
      sleep 0.1
    done
  fi
  if [[ $caller_ready -eq 1 ]]; then pass 'Ordinary caller location resolves Worker/Runner without A-Max'
  else fail 'Ordinary caller location leaked agents or failed to resolve'; fi
  if ! curl --silent --show-error --fail -u "opencode:$password" "$url/api/config" > "$diagnostic_root/config.json"; then
    fail 'V2 /api/config inspection failed'
  fi
  if [[ $ready -eq 1 && -f "$diagnostic_root/config.json" ]]; then
    if bun - "$diagnostic_root" "$PROFILE" <<'JS'
import { readFileSync } from "node:fs"
import { join } from "node:path"
const [dir, profile] = process.argv.slice(2)
const read = (id) => JSON.parse(readFileSync(join(dir, `${id}.json`), "utf8"))
const sources = read("config")
const doc = sources.find((source) => source.path === join(profile, "opencode.jsonc"))?.info
const agents = read("agent").data
const plugins = read("plugin").data.filter((entry) => entry.source?.type !== "builtin")
const errors = []
const check = (ok, message) => { if (!ok) errors.push(message) }
check(doc?.default_agent === "worker" && doc?.experimental?.subagent_depth === 1 && doc?.compaction?.buffer === 25600, "native V2 default, depth, and compaction")
check(doc?.plugins?.length === 1 && doc.plugins[0] === "./plugins/oc-lite-v2", "single configured topology plugin")
check(plugins.length === 1 && plugins[0]?.id === "oc-lite-topology" && plugins[0].state?.status === "active" && plugins[0].source.path === join(profile, "plugins/oc-lite-v2/index.ts"), "exactly one active oc-lite plugin and no foreign plugins")
const worker = agents.find((agent) => agent.id === "worker")
const runner = agents.find((agent) => agent.id === "runner")
check(worker?.mode === "primary" && runner?.mode === "subagent" && runner.hidden === false && worker.system?.startsWith("You are worker") && runner.system?.startsWith("You are Runner"), "primary Worker and visible Runner loaded from profile")
check(agents.filter((agent) => !["worker", "runner", "compaction", "summary", "title"].includes(agent.id)).length === 0, "no foreign or enabled legacy agents")
check(worker?.model === undefined, "Worker inherits session/UI model")
check(runner?.model?.providerID === "openai" && runner.model.id === "gpt-6-luna", "Runner exact openai/gpt-6-luna model")
check(worker?.request?.body?.reasoningEffort === undefined && runner?.request?.body?.reasoningEffort === "high" && runner?.request?.body?.textVerbosity === "low", "Worker request inherited and Runner high/low request")
const matches = (pattern, value) => new RegExp(`^${pattern.split(/([*?])/).map((part) => part === "*" ? ".*" : part === "?" ? "." : part.replace(/[\\^$+.()|\[\]{}]/g, "\\$&")).join("")}$`).test(value)
const effect = (agent, action, resource) => agent.permissions.reduce((result, rule) => matches(rule.action, action) && matches(rule.resource, resource) ? rule.effect : result, "ask")
if (worker && runner) {
  for (const child of ["worker", "general", "terraworker"]) check(effect(worker, "subagent", child) === "deny", `worker cannot delegate to ${child}`)
  check(effect(worker, "subagent", "runner") === "allow", "worker can delegate to runner")
  for (const child of ["worker", "runner"]) check(effect(runner, "subagent", child) === "deny", `runner cannot delegate to ${child}`)
  for (const cmd of ["rm -rf build", "git reset --hard HEAD~1", "git push --force origin HEAD", "sudo rm file"]) check(effect(worker, "shell", cmd) === "deny", `worker shell safeguard: ${cmd}`)
  check(effect(worker, "edit", "src/file.ts") === "allow" && effect(runner, "edit", "src/file.ts") === "deny", "worker can edit and runner cannot")
  check(effect(runner, "read", ".env") === "deny" && effect(runner, "read", ".env.example") === "allow", "runner sensitive reads")
  for (const cmd of ["git commit -m result", "npm publish", "orca status --json"]) check(effect(runner, "shell", cmd) === "deny", `runner shell safeguard: ${cmd}`)
  check(effect(runner, "shell", "bun test unit.ts") === "allow", "runner verification shell")
}
for (const error of errors) console.error(`FAIL  ${error}`)
if (errors.length) process.exit(1)
console.log(`PASS  V2 API: ${agents.length} agents, ${plugins.length} local plugin, default/model/permissions`)
JS
    then pass 'Isolated V2 API profile resolution'
    else fail 'Isolated V2 API profile resolution'; fi
    # The actual caller database is read-only below. Create a model-selected
    # throwaway session only in this disposable, private topology server.
    if curl --silent --show-error --fail -u "opencode:$password" -H 'Content-Type: application/json' \
      -d '{"title":"oc-lite model inheritance diagnostic","agent":"worker","model":{"providerID":"openai","id":"gpt-6-sol"}}' \
      "$url/api/session" > "$diagnostic_root/session.json" &&
      bun -e '
        const session = (await Bun.file(process.argv[1]).json()).data
        if (session?.agent !== "worker" || session?.model?.providerID !== "openai" || session?.model?.id !== "gpt-6-sol") process.exit(1)
       ' "$diagnostic_root/session.json" 2>/dev/null; then pass 'Disposable oc-lite session retains selected Sol model without inference'
    else fail 'Disposable oc-lite session did not retain selected model'; fi
  fi
fi

managed_wrapper=0
if [[ -f "$bin/oc-lite" ]]; then
  if grep -Fqx "# oc-lite-root: $ROOT" "$bin/oc-lite" &&
    grep -Fqx 'export XDG_CONFIG_HOME="$HOME/.config/opencode-o/oc-lite"' "$bin/oc-lite" &&
    grep -Fqx 'export OPENCODE_CONFIG_DIR="$OPENCODE_O_LITE_ROOT/profiles/oc-lite"' "$bin/oc-lite" &&
    grep -Fqx '  run|mini|api|models) command="$1"; shift; exec opencode "$command" --standalone "$@" ;;' "$bin/oc-lite" &&
    grep -Fqx '    list|login|logout|switch) command="$1"; shift; exec opencode auth "$command" --standalone "$@" ;;' "$bin/oc-lite" &&
    grep -Fqx '  *) exec opencode --standalone "$@" ;;' "$bin/oc-lite" &&
    ! grep -Fq 'export OPENCODE_DB=' "$bin/oc-lite" &&
    ! grep -Fq 'OPENCODE_EXPERIMENTAL_LSP_TOOL' "$bin/oc-lite"; then
    managed_wrapper=1
    pass 'Managed V2 wrapper'
  else fail 'Installed wrapper is stale or unmanaged'; fi
else warn 'oc-lite wrapper not installed'; fi
if [[ $managed_wrapper -eq 1 ]]; then
  if bash "$PROFILE/gh-config.fixtures.sh" "$bin/oc-lite" "$ROOT"; then pass 'Wrapper GH config inheritance fixtures'
  else fail 'Wrapper GH config inheritance fixtures'; fi
  if expected_db="$(opencode debug paths db 2>/dev/null)" &&
    actual_db="$("$bin/oc-lite" debug paths db 2>/dev/null)" &&
    [[ "$actual_db" == "$expected_db" ]]; then pass 'Wrapper preserves caller database for provider connections and sessions'
  else fail 'Wrapper changed caller database; existing provider connections may be unavailable'; fi
fi

# The topology test uses a disposable database. Inspect the resolved model
# registry in the caller-selected DB separately.
if [[ $managed_wrapper -eq 1 ]]; then
  (cd "$ROOT" && "$bin/oc-lite" serve --hostname 127.0.0.1 --port 0 >"$diagnostic_root/account.out" 2>"$diagnostic_root/account.err") &
  account_pid=$!
  account_url=''
  account_password=''
  for ((i=0; i<100; i++)); do
    account_url="$(sed -n 's/^server listening on \(http:\/\/127\.0\.0\.1:[0-9]*\)$/\1/p' "$diagnostic_root/account.out" | head -n 1)"
    account_password="$(sed -n 's/^server password \([^[:space:]]*\)$/\1/p' "$diagnostic_root/account.out" | head -n 1)"
    if [[ -n "$account_url" && -n "$account_password" ]]; then break; fi
    if ! kill -0 "$account_pid" 2>/dev/null; then break; fi
    sleep 0.1
  done
  account_ready=0
  if [[ -n "$account_url" && -n "$account_password" ]]; then
    for ((i=0; i<100; i++)); do
      if curl --silent --fail -u "opencode:$account_password" "$account_url/api/agent" > "$diagnostic_root/account-agent.json" &&
        curl --silent --fail -u "opencode:$account_password" "$account_url/api/config" > "$diagnostic_root/account-config.json" &&
        curl --silent --fail -u "opencode:$account_password" "$account_url/api/model" > "$diagnostic_root/account-model.json" &&
        curl --silent --fail -u "opencode:$account_password" "$account_url/api/plugin" > "$diagnostic_root/account-plugin.json" &&
        bun -e '
          const agents = (await Bun.file(process.argv[1]).json()).data
          const config = await Bun.file(process.argv[2]).json()
          const models = (await Bun.file(process.argv[3]).json()).data
          const profile = process.argv[4]
          const plugins = (await Bun.file(process.argv[5]).json()).data
          const doc = config.find((source) => source.path === profile + "/opencode.jsonc")?.info
          if (agents.find((a) => a.id === "worker")?.mode !== "primary" ||
              agents.find((a) => a.id === "worker")?.model !== undefined ||
              agents.find((a) => a.id === "runner")?.mode !== "subagent" ||
              agents.find((a) => a.id === "runner")?.model?.providerID !== "openai" ||
              agents.find((a) => a.id === "runner")?.model?.id !== "gpt-6-luna" ||
              agents.some((a) => a.id === "HTOrchestrator") ||
              !plugins.some((p) => p.id === "oc-lite-topology" && p.state?.status === "active") ||
              doc?.default_agent !== "worker" || !Array.isArray(models) || models.length === 0) process.exit(1)
        ' "$diagnostic_root/account-agent.json" "$diagnostic_root/account-config.json" "$diagnostic_root/account-model.json" "$PROFILE" "$diagnostic_root/account-plugin.json" 2>/dev/null; then account_ready=1; break; fi
      if ! kill -0 "$account_pid" 2>/dev/null; then break; fi
      sleep 0.1
    done
  fi
  if [[ $account_ready -eq 0 ]]; then
    fail 'Could not resolve Worker/Runner, plugin and settled oc-lite model registry'
  else
    pass 'Actual oc-lite database: active plugin, Worker default without model, Runner Luna, no HTOrchestrator'
    if bun -e '
      const models = (await Bun.file(process.argv[1]).json()).data
      if (!models.some((m) => m.providerID === "openai" && m.modelID === "gpt-6-luna" && m.enabled !== false)) process.exit(1)
    ' "$diagnostic_root/account-model.json" 2>/dev/null; then pass 'Runner openai/gpt-6-luna selectable in caller database'
    else fail 'Runner openai/gpt-6-luna unavailable in caller database'; fi
  fi
fi
finish
