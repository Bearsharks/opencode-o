#!/usr/bin/env bash

set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
A_MAX_ROOT="$ROOT/profiles/a-max"

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

WRAPPER="$BIN_DIR/oc-amax"
created_wrapper=0

write_wrapper() {
  local target="$1"
  {
    printf '#!/usr/bin/env bash\n'
    printf '# opencode-o-a-max-root: %s\n' "$ROOT"
    printf 'set -euo pipefail\n'
    printf 'OPENCODE_O_A_MAX_ROOT=%q\n' "$ROOT"
    printf 'export OPENCODE_DB=opencode-a-max.db\n'
    printf 'if [[ -z "${OPENCODE_O_A_MAX_MODEL_CONFIG+x}" ]]; then\n'
    printf '  old_config_home="${XDG_CONFIG_HOME:-$HOME/.config}"\n'
    printf '  external_model="$old_config_home/opencode/a-max-model.json"\n'
    printf '  if [[ -f "$external_model" ]]; then export OPENCODE_O_A_MAX_MODEL_CONFIG="$external_model"\n'
    printf '  else export OPENCODE_O_A_MAX_MODEL_CONFIG=""; fi\n'
    printf 'fi\n'
    printf 'export XDG_CONFIG_HOME="$OPENCODE_O_A_MAX_ROOT/profiles/a-max/config-home"\n'
    printf 'unset OPENCODE_CONFIG_DIR\n'
    printf 'case "${1:-}" in\n'
    printf '  run|mini|api|models) command="$1"; shift; exec opencode "$command" --standalone "$@" ;;\n'
    printf '  debug|plugin|service|auth|mcp|session) exec opencode "$@" ;;\n'
    printf '  *) exec opencode --standalone "$@" ;;\n'
    printf 'esac\n'
  } >"$target"
  chmod 755 "$target"
}

printf 'Running A-Max preflight checks...\n'
"$ROOT/scripts/doctor/a-max.sh" --preflight

if [[ "$(readlink "$A_MAX_ROOT/config-home/opencode")" != ".." ]]; then
  printf 'A-Max V2 config-home/opencode link is missing or incorrect.\n' >&2
  exit 1
fi

printf '\nInstalling locked dependencies...\n'
(cd "$ROOT" && bun install --frozen-lockfile)
(cd "$A_MAX_ROOT" && bun install)

printf '\nRunning A-Max checks...\n'
(cd "$ROOT" && bun run check:a-max)

mkdir -p "$BIN_DIR"

if [[ -e "$WRAPPER" || -L "$WRAPPER" ]]; then
  if [[ ! -f "$WRAPPER" ]] || ! grep -Fqx "# opencode-o-a-max-root: $ROOT" "$WRAPPER"; then
    printf 'Refusing to overwrite an unmanaged path: %s\n' "$WRAPPER" >&2
    exit 1
  fi
  temporary="$(mktemp "$BIN_DIR/.oc-amax.XXXXXX")"
  write_wrapper "$temporary"
  if cmp -s "$temporary" "$WRAPPER"; then
    rm -f "$temporary"
    printf 'Wrapper is already up to date: %s\n' "$WRAPPER"
  else
    mv "$temporary" "$WRAPPER"
    printf 'Updated managed wrapper: %s\n' "$WRAPPER"
  fi
else
  temporary="$(mktemp "$BIN_DIR/.oc-amax.XXXXXX")"
  cleanup() {
    if [[ -n "${temporary:-}" && -e "$temporary" ]]; then
      rm -f "$temporary"
    fi
  }
  trap cleanup EXIT

  write_wrapper "$temporary"
  mv "$temporary" "$WRAPPER"
  created_wrapper=1
  temporary=""
  trap - EXIT
  printf 'Installed wrapper: %s\n' "$WRAPPER"
fi

printf '\nRunning final A-Max diagnostics...\n'
if ! "$ROOT/scripts/doctor/a-max.sh"; then
  if [[ $created_wrapper -eq 1 ]]; then
    rm -f "$WRAPPER"
    printf '\nA-Max diagnostics failed. Removed the newly installed wrapper.\n' >&2
  else
    printf '\nA-Max diagnostics failed. The existing managed wrapper was preserved.\n' >&2
  fi
  exit 1
fi

printf '\nA-Max installation complete. Run: oc-amax\n'
