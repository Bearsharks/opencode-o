#!/usr/bin/env bash

# Removes only the oc-meta-owned install: the managed wrapper and the managed
# self-contained snapshot. Refuses unmanaged paths; never touches other
# profiles, the config home itself, or unrelated files.

set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
MARKER_FILE=".oc-meta-managed"

if [[ -n "${OPENCODE_O_META_CONFIG_HOME:-}" ]]; then
  CONFIG_HOME="$OPENCODE_O_META_CONFIG_HOME"
elif [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
  CONFIG_HOME="$XDG_CONFIG_HOME/opencode"
elif [[ -n "${HOME:-}" ]]; then
  CONFIG_HOME="$HOME/.config/opencode"
else
  printf 'Cannot determine the OpenCode config home because HOME is unset.\n' >&2
  exit 1
fi

INSTALL_DIR="$CONFIG_HOME/profiles/oc-meta"
WRAPPER_MARKER="# oc-meta-install: $INSTALL_DIR"
LEGACY_WRAPPER_MARKER="# oc-meta-root: $ROOT"

if [[ -n "${OPENCODE_O_BIN_DIR:-}" ]]; then
  BIN_DIR="$OPENCODE_O_BIN_DIR"
elif [[ -n "${HOME:-}" ]]; then
  BIN_DIR="$HOME/.local/bin"
else
  printf 'Cannot determine the install directory because HOME is unset.\n' >&2
  exit 1
fi

WRAPPER="$BIN_DIR/oc-meta"

if [[ ! -e "$WRAPPER" && ! -L "$WRAPPER" ]]; then
  printf 'Managed wrapper is not installed: %s\n' "$WRAPPER"
elif [[ ! -f "$WRAPPER" ]]; then
  printf 'Refusing to remove an unmanaged path: %s\n' "$WRAPPER" >&2
  exit 1
elif grep -Fqx "$WRAPPER_MARKER" "$WRAPPER" || grep -Fqx "$LEGACY_WRAPPER_MARKER" "$WRAPPER"; then
  rm -f -- "$WRAPPER"
  printf 'Removed managed wrapper: %s\n' "$WRAPPER"
else
  printf 'Refusing to remove an unmanaged wrapper: %s\n' "$WRAPPER" >&2
  exit 1
fi

if [[ ! -e "$INSTALL_DIR" && ! -L "$INSTALL_DIR" ]]; then
  printf 'Managed snapshot is not installed: %s\n' "$INSTALL_DIR"
  exit 0
fi

if [[ ! -d "$INSTALL_DIR" || -L "$INSTALL_DIR" ]]; then
  printf 'Refusing to remove an unmanaged path: %s\n' "$INSTALL_DIR" >&2
  exit 1
fi

if [[ ! -f "$INSTALL_DIR/$MARKER_FILE" ]]; then
  printf 'Refusing to remove an unmanaged directory (no %s marker): %s\n' "$MARKER_FILE" "$INSTALL_DIR" >&2
  exit 1
fi

rm -rf -- "$INSTALL_DIR"
printf 'Removed managed snapshot: %s\n' "$INSTALL_DIR"
