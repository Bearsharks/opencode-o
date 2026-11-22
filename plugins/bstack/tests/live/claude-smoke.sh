#!/usr/bin/env bash
set -euo pipefail

plugin=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/bstack-claude-smoke.XXXXXX")
trap 'rm -rf -- "$scratch"' EXIT
cd -- "$scratch"

run_case() {
  local name=$1 prompt=$2 output header id meta rc=0
  shift 2
  output=$(printf '%s' "$prompt" | "$plugin/bin/bstack-run" run --role panel --model claude:haiku \
    --brief - "$@") || rc=$?
  header=${output%%$'\n'*}
  id=${header#id=}
  id=${id%% *}
  printf '%s: %s\n' "$name" "$header"
  if [[ ! $id =~ ^[0-9]{8}-[0-9]{6}-panel-[0-9a-f]{4}$ ]]; then
    return 1
  fi
  if (( rc != 0 )); then
    run_dir=$("$plugin/bin/bstack-run" status "$id" | python3 -c 'import json, sys; print(json.load(sys.stdin)["run_dir"])')
    cat "$run_dir/stderr.log" >&2
    return 1
  fi
  meta=$("$plugin/bin/bstack-run" status "$id") || return 1
  python3 - "$name" "$meta" <<'PY'
import json
from pathlib import Path
import re
import sys

name, status = sys.argv[1:]
meta = json.loads(status)
print(json.dumps({k: meta[k] for k in ("result", "is_error", "total_cost_usd")},
                 ensure_ascii=False))
answer = (meta["result"] or "").strip()
valid = (answer.casefold() == "pong" if name == "pong"
         else re.fullmatch(r"[1-9][0-9]*", answer) is not None)
if meta["status"] != "done" or not valid or meta["total_cost_usd"] is None:
    sys.exit(f"{name}: unexpected Claude Code smoke result")
transcript = Path(meta["transcript_path"] or "")
if not transcript.is_absolute() or not transcript.is_file():
    sys.exit(f"{name}: no persisted transcript found")
PY
}

status=0
run_case pong "reply pong" || status=1
run_case plugin "List the skills from the bstack plugin you can see. Reply with only their count." \
  --plugin-dir "$plugin" || status=1
exit "$status"
