#!/usr/bin/env bash
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
WRAPPER="${OPENCODE_O_BIN_DIR:-$HOME/.local/bin}/oc-pstack"
if [[ ! -e "$WRAPPER" && ! -L "$WRAPPER" ]]; then printf 'oc-pstack wrapper is not installed\n'; exit 0; fi
if [[ -L "$WRAPPER" || ! -f "$WRAPPER" ]] || ! grep -Fqx "# oc-pstack-root: $ROOT" "$WRAPPER"; then
  printf 'Refusing to remove unmanaged path: %s\n' "$WRAPPER" >&2
  exit 1
fi
rm -- "$WRAPPER"
printf 'Removed %s. Repository skills, configuration, and sessions were retained.\n' "$WRAPPER"
