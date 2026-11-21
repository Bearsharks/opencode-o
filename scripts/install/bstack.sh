#!/usr/bin/env bash
set -euo pipefail
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
bin=${OPENCODE_O_BIN_DIR:-$HOME/.local/bin}
src="$root/profiles/bstack/bin/oc-bstack"; dest="$bin/oc-bstack"
command -v opencode >/dev/null || { echo 'OpenCode V2 required' >&2; exit 1; }
mkdir -p "$bin"
if [[ -L "$dest" && $(readlink "$dest") == "$src" ]]; then :
elif [[ -e "$dest" || -L "$dest" ]]; then echo "Refusing to replace $dest" >&2; exit 1
else ln -s "$src" "$dest"; fi
printf 'Installed %s\n' "$dest"
