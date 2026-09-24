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
cleanup() {
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
for file in package.json bun.lock scripts/install/oc-lite.sh profiles/oc-lite/opencode.jsonc profiles/oc-lite/preflight.ts profiles/oc-lite/preflight.fixtures.sh profiles/oc-lite/agents/worker.md profiles/oc-lite/agents/runner.md profiles/oc-lite/plugins/oc-lite-v2/index.ts profiles/oc-lite/plugins/oc-lite-v2/oc-lite.smoke.ts; do
  if [[ ! -f "$ROOT/$file" ]]; then fail "Missing $file"; fi
done

if [[ $failures -gt 0 ]]; then finish; exit 1; fi
if [[ -n "${OPENCODE_O_GLOBAL_CONFIG_DIR:-}" ]]; then
  global_config_dir="$OPENCODE_O_GLOBAL_CONFIG_DIR"
elif [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
  global_config_dir="$XDG_CONFIG_HOME/opencode"
elif [[ -n "${HOME:-}" ]]; then
  global_config_dir="$HOME/.config/opencode"
else
  fail 'Cannot locate global config without HOME or XDG_CONFIG_HOME'
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
(
  cd "$diagnostic_root/work" || exit 1
  XDG_CONFIG_HOME="$diagnostic_root/config" \
  XDG_DATA_HOME="$diagnostic_root/data" \
  XDG_CACHE_HOME="$diagnostic_root/cache" \
  XDG_STATE_HOME="$diagnostic_root/state" \
  OPENCODE_DB=:memory: OPENCODE_CONFIG_DIR="$PROFILE" \
    opencode serve --hostname 127.0.0.1 --port 0 >"$diagnostic_root/server.out" 2>"$diagnostic_root/server.err"
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
        if (!agents.some((a) => a.id === "worker") || !agents.some((a) => a.id === "runner") || !plugins.some((p) => p.id === "oc-lite-topology")) process.exit(1)
      ' "$diagnostic_root/agent.json" "$diagnostic_root/plugin.json" 2>/dev/null; then
      ready=1
      break
    fi
    if ! kill -0 "$server_pid" 2>/dev/null; then break; fi
    sleep 0.1
  done
  if [[ $ready -eq 0 ]]; then fail 'V2 agents/plugin did not become active in the private server'; fi
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
check(plugins.length === 1 && plugins[0]?.id === "oc-lite-topology" && plugins[0].source.path === join(profile, "plugins/oc-lite-v2/index.ts"), "exactly one active oc-lite plugin and no foreign plugins")
const worker = agents.find((agent) => agent.id === "worker")
const runner = agents.find((agent) => agent.id === "runner")
check(worker?.mode === "primary" && runner?.mode === "subagent" && runner.hidden === false && worker.system?.startsWith("You are worker") && runner.system?.startsWith("You are Runner"), "primary Worker and visible Runner loaded from profile")
check(agents.filter((agent) => !["worker", "runner", "compaction", "summary", "title"].includes(agent.id)).length === 0, "no foreign or enabled legacy agents")
for (const agent of [worker, runner]) check(agent?.model?.providerID === "opencode-go" && agent.model.id === "muse-spark-1.3-contributor", `${agent?.id || "missing"} model`)
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
  fi
fi

if [[ -n "${OPENCODE_O_BIN_DIR:-}" ]]; then bin="$OPENCODE_O_BIN_DIR"
else bin="${HOME:-}/.local/bin"; fi
if [[ -f "$bin/oc-lite" ]]; then
  if grep -Fqx "# oc-lite-root: $ROOT" "$bin/oc-lite" &&
    grep -Fqx 'OPENCODE_CONFIG_DIR="$OPENCODE_O_LITE_ROOT/profiles/oc-lite" exec opencode "$@"' "$bin/oc-lite" &&
    ! grep -Fq 'OPENCODE_EXPERIMENTAL_LSP_TOOL' "$bin/oc-lite"; then
    pass 'Managed V2 wrapper'
  else fail 'Installed wrapper is stale or unmanaged'; fi
else warn 'oc-lite wrapper not installed'; fi
finish
