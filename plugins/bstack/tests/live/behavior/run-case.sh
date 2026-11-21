#!/usr/bin/env bash
set -euo pipefail

usage() {
    echo "usage: $0 <case> <model> --max-cost-usd <positive USD> [--ask <previous-run-id>]" >&2
    exit 2
}

[[ $# == 4 || $# == 6 ]] || usage
[[ $3 == --max-cost-usd && $4 =~ ^[0-9]+([.][0-9]+)?$ && $4 =~ [1-9] ]] || usage
suite=$(cd -- "$(dirname "$0")" && pwd -P)
case_name=$1
model=$2
cap=$4
python3 -B -c 'import sys; sys.path.insert(0, sys.argv[1]); from fixture import MODELS; sys.exit(MODELS.get(sys.argv[2]) != sys.argv[3])' \
    "$suite" "$case_name" "$model" || usage
if [[ $# == 6 ]]; then
    [[ $5 == --ask && $6 =~ ^[0-9]{8}-[0-9]{6}-panel-[0-9a-f]{4}$ ]] || usage
    case "$case_name" in
        clear|question|mode-positive|resume) ;;
        *) usage ;;
    esac
    root=$(python3 -B -c 'import sys; sys.path.insert(0, sys.argv[1]); from fixture import SCRATCH; print((SCRATCH / sys.argv[2]).resolve(strict=True))' "$suite" "$case_name")
    turn=answered
    checkpoint=("$6")
    audit="$(dirname -- "$root")/.$case_name-state/turns"
    first_id="$audit/first/id.json"
    if [[ -d "$audit/answered" ]]; then
        [[ $case_name == question || $case_name == mode-positive ]] || usage
        turn=confirmed
        checkpoint=("$(python3 -B -c 'import json, sys; print(json.load(open(sys.argv[1])))' "$first_id")" "$6")
    fi
    # The operator must also read the latest question/confirmation before approving the next turn.
    python3 -B "$suite/check-case.py" "$case_name" "${checkpoint[@]}"
    args=(ask "$6" --brief -)
else
    root=$(python3 -B "$suite/fixture.py" "$case_name")
    args=(run --role panel --model "claude:$model" --plugin-dir "$root/plugins/bstack" --brief -)
    turn=first
fi
cd -- "$root"
export CLAUDE_PLUGIN_ROOT="$root/plugins/bstack"
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_INDEX_FILE
export BSTACK_CLAUDE_MAX_BUDGET_USD="$cap"
printf 'Cost ceiling: USD %s (claude --max-budget-usd)\n' "$cap" >&2
printf 'Executing in %s:' "$root" >&2
printf ' %q' "$CLAUDE_PLUGIN_ROOT/bin/bstack-run" "${args[@]}" >&2
printf '\n' >&2
exec python3 -B "$suite/turn.py" "$case_name" "$turn" "$cap" "$CLAUDE_PLUGIN_ROOT/bin/bstack-run" "${args[@]}"
