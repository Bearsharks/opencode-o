#!/usr/bin/env bash
set -u

CLAUDE_ONLY_KEYS=(disable-model-invocation argument-hint model paths user-invocable when_to_use)
validator="${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator/scripts/quick_validate.py"

if (( $# == 0 )); then
    plugin_dir=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P) || exit 1
    shopt -s nullglob
    set -- "$plugin_dir"/skills/*/
fi

temp_root=$(mktemp -d) || exit 1
trap 'rm -rf -- "$temp_root"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

strip_claude_keys() {
    uv run --quiet --with pyyaml python3 - "$1" "${CLAUDE_ONLY_KEYS[@]}" <<'PY'
import re
import sys
from pathlib import Path

import yaml


def strip_keys(skill_file, allowed_keys):
    if not skill_file.is_file():
        return  # Let quick_validate.py report a missing SKILL.md.

    content = skill_file.read_text(encoding="utf-8")
    match = re.match(r"\A---\n(.*?)\n---[ \t]*(?=\n|\Z)", content, re.DOTALL)
    if not match:
        return  # Let quick_validate.py report missing or malformed frontmatter.

    loader = yaml.SafeLoader(match[1])
    try:
        root = loader.get_single_node()
        if not isinstance(root, yaml.MappingNode):
            return
        loader.flatten_mapping(root)
        kept = []
        removed = False
        for key_node, value_node in root.value:
            if key_node.tag != "tag:yaml.org,2002:str" or key_node.value not in allowed_keys:
                kept.append((key_node, value_node))
                continue
            key = key_node.value
            value = loader.construct_object(value_node, deep=True)
            if key in {"disable-model-invocation", "user-invocable"}:
                if type(value) is not bool or value_node.value.lower() not in {"true", "false"}:
                    raise ValueError(f"{key} must be true or false")
            elif key == "paths":
                if not isinstance(value, list) or any(not isinstance(p, str) for p in value):
                    raise ValueError(f"{key} must be a list of strings")
            elif not isinstance(value, str):
                raise ValueError(f"{key} must be a string")
            removed = True

        if removed:
            root.value = kept
            cleaned = yaml.serialize(root, Dumper=yaml.SafeDumper)
            # Replace the copy instead of writing through a copied symlink.
            skill_file.unlink()
            skill_file.write_text(f"---\n{cleaned}---{content[match.end():]}", encoding="utf-8")
    finally:
        loader.dispose()


try:
    strip_keys(Path(sys.argv[1]), set(sys.argv[2:]))
except (OSError, ValueError, yaml.YAMLError) as exc:
    sys.exit(str(exc))
PY
}

validate_skill() {
    local source copy="$2"
    source=$(CDPATH= cd -- "$1" && pwd -P) || return 1
    mkdir -- "$copy" && cp -R "$source/." "$copy" || return 1
    strip_claude_keys "$copy/SKILL.md" || return 1
    uv run --quiet --with pyyaml python3 "$validator" "$copy"
}

passed=0
total=0
for skill_dir in "$@"; do
    total=$((total + 1))
    name=$(basename -- "$skill_dir")
    if output=$(validate_skill "$skill_dir" "$temp_root/$total" 2>&1); then
        printf 'PASS %s\n' "$name"
        passed=$((passed + 1))
    else
        printf 'FAIL %s: %s\n' "$name" "${output//$'\n'/; }"
    fi
done

printf 'Summary: %d/%d passed\n' "$passed" "$total"
(( passed == total ))
