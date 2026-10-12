#!/usr/bin/env bash
# Read-only integration probe: private server, disposable storage, no model call.
set -euo pipefail
root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
wrapper="${1:-$HOME/.local/bin/oc-amax}"
[[ -f "$wrapper" ]] && grep -Fqx "# opencode-o-a-max-root: $root" "$wrapper" || {
  echo 'FAIL  oc-amax is not managed by this checkout' >&2; exit 1;
}
probe="$(mktemp -d "${TMPDIR:-/tmp}/a-max-gh-api.XXXXXX")"
pid=''
cleanup() {
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  rm -rf -- "$probe"
}
trap cleanup EXIT
mkdir -p "$probe"/{data,cache,state}
cd "$root"
env -u GH_CONFIG_DIR \
  XDG_DATA_HOME="$probe/data" XDG_CACHE_HOME="$probe/cache" XDG_STATE_HOME="$probe/state" \
  OPENCODE_O_A_MAX_MODEL_CONFIG='' \
  "$wrapper" serve --hostname 127.0.0.1 --port 0 >"$probe/server.out" 2>"$probe/server.err" &
pid=$!
url='' password=''
for ((i=0; i<150; i++)); do
  url="$(sed -n 's/^server listening on \(http:\/\/127\.0\.0\.1:[0-9]*\)$/\1/p' "$probe/server.out" | head -1)"
  password="$(sed -n 's/^server password \([^[:space:]]*\)$/\1/p' "$probe/server.out" | head -1)"
  [[ -n "$url" && -n "$password" ]] && break
  if ! kill -0 "$pid" 2>/dev/null; then echo 'FAIL  private A-Max server terminated' >&2; exit 1; fi
  sleep 0.1
done
[[ -n "$url" && -n "$password" ]] || { echo 'FAIL  private A-Max server startup' >&2; exit 1; }
location="$(PROFILE="$root/profiles/a-max" python3 -c 'import os,urllib.parse;print(urllib.parse.quote(os.environ["PROFILE"],safe=""))')"
ready=0
for ((i=0; i<100; i++)); do
  curl -fsS -u "opencode:$password" "$url/api/plugin?location%5Bdirectory%5D=$location" >"$probe/plugins.json"
  curl -fsS -u "opencode:$password" "$url/api/agent?location%5Bdirectory%5D=$location" >"$probe/agents.json"
  if jq -e '.data | any(.id == "a-max" and .state.status == "active")' "$probe/plugins.json" >/dev/null &&
    jq -e '.data | any(.id == "HTOrchestrator") and any(.id == "terraworker") and any(.id == "runner")' "$probe/agents.json" >/dev/null; then
    ready=1; break
  fi
  sleep 0.2
done
[[ "$ready" == 1 ]] || { echo 'FAIL  private A-Max plugin/agents did not become active' >&2; exit 1; }
jq -e '.data | map({key: .id, value: .}) | from_entries |
  .HTOrchestrator.mode == "primary" and .terraworker.mode == "subagent" and .runner.mode == "subagent" and
  (.HTOrchestrator.permissions | any(.action == "subagent" and .resource == "terraworker" and .effect == "allow")) and
  (.runner.permissions | any(.action == "edit" and .resource == "*" and .effect == "deny"))' "$probe/agents.json" >/dev/null || {
  echo 'FAIL  private A-Max agent topology or permissions' >&2; exit 1;
}
printf 'PASS  private A-Max plugin and 3 agent topology/permission checks\n'
command='test "$GH_CONFIG_DIR" = "$HOME/.config/gh" && test "$XDG_CONFIG_HOME" = "'"$root"'/profiles/a-max/config-home" && test "$OPENCODE_DB" = opencode-a-max.db && gh auth status >/dev/null 2>&1 && gh issue view 145 --repo Bearsharks/freefy --json number,title,state'
jq -n --arg command "$command" '{command:$command, timeout:30000}' >"$probe/request.json"
curl -fsS -u "opencode:$password" -H 'Content-Type: application/json' -d @"$probe/request.json" "$url/api/shell" >"$probe/shell.json"
id="$(jq -r '.data.id // empty' "$probe/shell.json")"
[[ "$id" == sh_* ]] || { echo 'FAIL  private shell creation' >&2; exit 1; }
status=''
for ((i=0; i<150; i++)); do
  curl -fsS -u "opencode:$password" "$url/api/shell/$id" >"$probe/state.json"
  status="$(jq -r '.data.status' "$probe/state.json")"
  [[ "$status" != running ]] && break
  sleep 0.2
done
curl -fsS -u "opencode:$password" "$url/api/shell/$id/output" >"$probe/output.json"
exit_code="$(jq -r '.data.exit // "unknown"' "$probe/state.json")"
printf 'shell status=%s exit=%s\n' "$status" "$exit_code"
[[ "$status" == exited && "$exit_code" == 0 ]] || exit 1
jq -r '.data.output' "$probe/output.json" | jq -e 'select(.number == 145 and (.title | type == "string" and length > 0) and (.state == "OPEN" or .state == "CLOSED"))' >/dev/null
printf 'PASS  private A-Max shell gh issue 145 (number/title/state validated)\n'
