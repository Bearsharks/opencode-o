#!/usr/bin/env bash
# Manual, read-only integration probe: no model request or credential output.
set -euo pipefail
root="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
probe="$(mktemp -d "${TMPDIR:-/tmp}/oc-lite-gh-api.XXXXXX")"
pid=''
cleanup() {
  if [[ -n "$pid" ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; fi
  rm -rf -- "$probe"
}
trap cleanup EXIT
mkdir -p "$probe"/{data,cache,state}
cd "$root"
XDG_DATA_HOME="$probe/data" XDG_CACHE_HOME="$probe/cache" XDG_STATE_HOME="$probe/state" \
  OPENCODE_DB=:memory: "$HOME/.local/bin/oc-lite" serve --hostname 127.0.0.1 --port 0 >"$probe/server.out" 2>"$probe/server.err" &
pid=$!
url='' password=''
for ((i=0; i<150; i++)); do
  url="$(sed -n 's/^server listening on \(http:\/\/127\.0\.0\.1:[0-9]*\)$/\1/p' "$probe/server.out" | head -1)"
  password="$(sed -n 's/^server password \([^[:space:]]*\)$/\1/p' "$probe/server.out" | head -1)"
  if [[ -n "$url" && -n "$password" ]]; then break; fi
  if ! kill -0 "$pid" 2>/dev/null; then echo 'FAIL  private server terminated'; exit 1; fi
  sleep 0.1
done
[[ -n "$url" && -n "$password" ]] || { echo 'FAIL  private server startup'; exit 1; }
command='test "$GH_CONFIG_DIR" = "$HOME/.config/gh" && test "$XDG_CONFIG_HOME" = "$HOME/.config/opencode-o/oc-lite" && gh auth status >/dev/null 2>&1 && gh issue view 145 --repo Bearsharks/freefy --json number,title,state | jq -c "{number,title,state}"'
jq -n --arg command "$command" '{command:$command, timeout:30000}' > "$probe/request.json"
curl -fsS -u "opencode:$password" -H 'Content-Type: application/json' -d @"$probe/request.json" "$url/api/shell" > "$probe/shell.json"
id="$(jq -r '.data.id // empty' "$probe/shell.json")"
[[ "$id" == sh_* ]] || { echo 'FAIL  shell creation'; exit 1; }
status=''
for ((i=0; i<150; i++)); do
  curl -fsS -u "opencode:$password" "$url/api/shell/$id" > "$probe/state.json"
  status="$(jq -r '.data.status' "$probe/state.json")"
  [[ "$status" != running ]] && break
  sleep 0.2
done
curl -fsS -u "opencode:$password" "$url/api/shell/$id/output" > "$probe/output.json"
printf 'shell status=%s exit=%s\n' "$status" "$(jq -r '.data.exit // "unknown"' "$probe/state.json")"
[[ "$status" == exited && "$(jq -r '.data.exit' "$probe/state.json")" == 0 ]] || exit 1
issue="$(jq -r '.data.output' "$probe/output.json" | jq -ce 'select(.number == 145 and .state == "OPEN" and (.title | type == "string" and length > 0)) | {number,title,state}')"
printf 'PASS  private oc-lite shell: %s\n' "$issue"
