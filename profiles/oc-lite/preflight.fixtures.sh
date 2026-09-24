#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
base="$(mktemp -d "${TMPDIR:-/tmp}/oc-lite-preflight.XXXXXX")"
trap 'rm -rf -- "$base"' EXIT
mkdir -p "$base"/{home,config/opencode,bin,project/sub}

check() {
  local directory="$1" expectation="$2" needle="${3:-}"
  local status=0
  (cd "$directory" && env -u OPENCODE_O_GLOBAL_CONFIG_DIR \
    HOME="$base/home" XDG_CONFIG_HOME="$base/config" OPENCODE_O_BIN_DIR="$base/bin" \
    "$ROOT/scripts/doctor/oc-lite.sh" --preflight) >"$base/result" 2>&1 || status=$?
  if [[ "$expectation" == clean ]]; then
    [[ $status -eq 0 ]] && grep -Fq 'Summary: 0 failure(s)' "$base/result" || {
      cat "$base/result" >&2
      echo 'Expected clean preflight' >&2
      exit 1
    }
  else
    [[ $status -eq 1 ]] && grep -Fq "$needle" "$base/result" || {
      cat "$base/result" >&2
      echo "Expected conflict: $needle" >&2
      exit 1
    }
  fi
}

check "$base/project/sub" clean
check "$ROOT/profiles/oc-lite" clean # Profile's own agent/plugin files are not conflicts.

global="$base/config/opencode/agents/worker.md"
mkdir -p "$(dirname "$global")"
printf '%s\n' '---' 'Global worker remains untouched' > "$global"
cp "$global" "$base/sentinel"
check "$base/project/sub" conflict 'Global agent conflict'
cmp -s "$global" "$base/sentinel"
status=0
(cd "$base/project/sub" && env -u OPENCODE_O_GLOBAL_CONFIG_DIR \
  HOME="$base/home" XDG_CONFIG_HOME="$base/config" OPENCODE_O_BIN_DIR="$base/bin" \
  "$ROOT/scripts/install/oc-lite.sh") >"$base/install-result" 2>&1 || status=$?
[[ $status -eq 1 && ! -e "$base/bin/oc-lite" ]] || {
  cat "$base/install-result" >&2
  echo 'Installer must stop before touching its wrapper when preflight conflicts' >&2
  exit 1
}
cmp -s "$global" "$base/sentinel"
rm "$global"

project="$base/project/.opencode/agents/runner.md"
mkdir -p "$(dirname "$project")"
printf '%s\n' '---' 'Project Runner remains untouched' > "$project"
cp "$project" "$base/sentinel"
check "$base/project/sub" conflict 'Project agent conflict'
cmp -s "$project" "$base/sentinel"
rm "$project"

global_config="$base/config/opencode/opencode.jsonc"
printf '%s\n' '{"agents":{"worker":{"mode":"primary"}}}' > "$global_config"
cp "$global_config" "$base/sentinel"
check "$base/project/sub" conflict 'configured worker conflict'
cmp -s "$global_config" "$base/sentinel"
printf '%s\n' '{"permissions":[{"action":"shell","resource":"*","effect":"deny"}]}' > "$global_config"
check "$base/project/sub" conflict 'merged permissions policy conflict'
printf '%s\n' '{"plugins":["./plugins/a-max"]}' > "$global_config"
check "$base/project/sub" conflict 'configured harness plugin conflict'
printf '%s\n' '{"default_agent":"orchestrator"}' > "$global_config"
check "$base/project/sub" conflict 'harness default-agent conflict'
rm "$global_config"

project_config="$base/project/opencode.jsonc"
printf '%s\n' '{"agents":{"runner":{"mode":"subagent"}}}' > "$project_config"
check "$base/project/sub" conflict 'configured runner conflict'
printf '%s\n' '{"permissions":[{"action":"read","resource":"*.env","effect":"allow"}]}' > "$project_config"
check "$base/project/sub" conflict 'merged permissions policy conflict'
rm "$project_config"

mkdir -p "$base/project/.opencode/plugins"
printf 'export default {}\n' > "$base/project/.opencode/plugins/harness-state.ts"
check "$base/project/sub" conflict 'Project harness plugin conflict'
rm "$base/project/.opencode/plugins/harness-state.ts"

check "$base/project/sub" clean
echo 'oc-lite-preflight-fixtures-ok: 3 clean + 8 conflict cases; installer refuses conflict; sentinels unchanged'
