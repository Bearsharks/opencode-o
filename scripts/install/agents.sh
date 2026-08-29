#!/usr/bin/env bash

set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
PROFILE_ROOT="$ROOT/profiles/agents"
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
created_wrapper=0
replaced_wrapper=0
temporary=""
backup=""

if ! command -v opencode >/dev/null 2>&1; then
  printf 'OpenCode is not available on PATH. Install OpenCode before installing this profile.\n' >&2
  exit 1
fi

write_wrapper() {
  local target="$1"
  {
    printf '#!/usr/bin/env bash\n'
    printf '%s\n' "$MANAGED_MARKER"
    printf 'set -euo pipefail\n'
    printf 'OPENCODE_O_AGENTS_ROOT=%q\n' "$ROOT"
    printf 'OPENCODE_CONFIG_DIR="$OPENCODE_O_AGENTS_ROOT/profiles/agents" exec opencode "$@"\n'
  } >"$target"
  chmod 755 "$target"
}

validate_profile() {
  local command_prefix=("$@")
  OPENCODE_CONFIG_DIR="$PROFILE_ROOT" "${command_prefix[@]}" debug config >/dev/null
  OPENCODE_CONFIG_DIR="$PROFILE_ROOT" "${command_prefix[@]}" debug agent freefy-secretary >/dev/null
  OPENCODE_CONFIG_DIR="$PROFILE_ROOT" "${command_prefix[@]}" debug agent runner >/dev/null
}

cleanup() {
  local status="$?"
  if [[ "$status" -ne 0 ]]; then
    if [[ $created_wrapper -eq 1 ]]; then
      rm -f -- "$WRAPPER"
    elif [[ $replaced_wrapper -eq 1 && ( -e "$backup" || -L "$backup" ) ]]; then
      rm -f -- "$WRAPPER"
      mv -- "$backup" "$WRAPPER"
      backup=""
      replaced_wrapper=0
    fi
  fi
  if [[ -n "$temporary" && -e "$temporary" ]]; then
    rm -f -- "$temporary"
  fi
  if [[ -n "$backup" && ( -e "$backup" || -L "$backup" ) ]]; then
    rm -f -- "$backup"
  fi
}

trap cleanup EXIT

printf 'Validating OpenCode agents profile before installation...\n'
validate_profile opencode

mkdir -p "$BIN_DIR"

if [[ -e "$WRAPPER" || -L "$WRAPPER" ]]; then
  if [[ ! -f "$WRAPPER" ]] || ! grep -Fqx "$MANAGED_MARKER" "$WRAPPER"; then
    printf 'Refusing to overwrite an unmanaged path: %s\n' "$WRAPPER" >&2
    exit 1
  fi
  temporary="$(mktemp "$BIN_DIR/.oc-agents.XXXXXX")"
  write_wrapper "$temporary"
  if cmp -s "$temporary" "$WRAPPER"; then
    rm -f -- "$temporary"
    temporary=""
    printf 'Wrapper is already up to date: %s\n' "$WRAPPER"
  else
    backup="$(mktemp "$BIN_DIR/.oc-agents-backup.XXXXXX")"
    rm -f -- "$backup"
    cp -pP -- "$WRAPPER" "$backup"
    mv "$temporary" "$WRAPPER"
    temporary=""
    replaced_wrapper=1
    printf 'Updated managed wrapper: %s\n' "$WRAPPER"
  fi
else
  temporary="$(mktemp "$BIN_DIR/.oc-agents.XXXXXX")"
  write_wrapper "$temporary"
  mv "$temporary" "$WRAPPER"
  temporary=""
  created_wrapper=1
  printf 'Installed wrapper: %s\n' "$WRAPPER"
fi

printf '\nValidating installed wrapper...\n'
if ! validate_profile "$WRAPPER"; then
  if [[ $created_wrapper -eq 1 ]]; then
    rm -f -- "$WRAPPER"
    created_wrapper=0
    printf '\nProfile validation failed. Removed the newly installed wrapper.\n' >&2
  elif [[ $replaced_wrapper -eq 1 && ( -e "$backup" || -L "$backup" ) ]]; then
    rm -f -- "$WRAPPER"
    mv -- "$backup" "$WRAPPER"
    backup=""
    replaced_wrapper=0
    printf '\nProfile validation failed. The existing managed wrapper was preserved.\n' >&2
  else
    printf '\nProfile validation failed. The existing managed wrapper was unchanged.\n' >&2
  fi
  exit 1
fi

if [[ -n "$backup" && ( -e "$backup" || -L "$backup" ) ]]; then
  rm -f -- "$backup"
  backup=""
fi
replaced_wrapper=0

printf '\nOpenCode agents installation complete. Run: oc-agents\n'
