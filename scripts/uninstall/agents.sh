#!/usr/bin/env bash

set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
MANAGED_MARKER="# opencode-o-agents-root: $ROOT"

if [[ "$ROOT" == *$'\n'* ]]; then
  printf 'The checkout path must not contain a newline.\n' >&2
  exit 1
fi

if [[ -n "${OPENCODE_O_BIN_DIR:-}" ]]; then
  BIN_DIR="$OPENCODE_O_BIN_DIR"
elif [[ -n "${HOME:-}" ]]; then
  BIN_DIR="$HOME/.local/bin"
else
  printf 'Cannot determine the install directory because HOME is unset.\n' >&2
  exit 1
fi

WRAPPER="$BIN_DIR/oc-agents"

if [[ ! -e "$WRAPPER" && ! -L "$WRAPPER" ]]; then
  printf 'Managed wrapper is not installed: %s\n' "$WRAPPER"
  exit 0
fi

if [[ ! -f "$WRAPPER" ]] || ! grep -Fqx "$MANAGED_MARKER" "$WRAPPER"; then
  printf 'Refusing to remove an unmanaged path: %s\n' "$WRAPPER" >&2
  exit 1
fi

rm -f -- "$WRAPPER"
printf 'Removed managed wrapper: %s\n' "$WRAPPER"
