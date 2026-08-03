#!/usr/bin/env bash

set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
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

PRIMARY_WRAPPER="$BIN_DIR/oc-amax"
LEGACY_WRAPPER="$BIN_DIR/opencode-o-a-max"
created_primary_wrapper=0
created_legacy_wrapper=0

write_wrapper() {
  local target="$1"
  {
    printf '#!/usr/bin/env bash\n'
    printf '# opencode-o-a-max-root: %s\n' "$ROOT"
    printf 'set -euo pipefail\n'
    printf 'OPENCODE_O_A_MAX_ROOT=%q\n' "$ROOT"
    printf 'export OPENCODE_EXPERIMENTAL_LSP_TOOL=true\n'
    printf 'export OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true\n'
    printf 'export OPENCODE_DB=opencode-a-max.db\n'
    printf 'OPENCODE_CONFIG_DIR="$OPENCODE_O_A_MAX_ROOT/profiles/a-max" exec opencode "$@"\n'
  } >"$target"
  chmod 755 "$target"
}

is_managed_wrapper() {
  local wrapper="$1"
  [[ -f "$wrapper" ]] && grep -Fqx "# opencode-o-a-max-root: $ROOT" "$wrapper"
}

install_wrapper() {
  local wrapper="$1"
  local temporary

  INSTALLED_WRAPPER=0
  temporary="$(mktemp "$BIN_DIR/.opencode-o-a-max.XXXXXX")"
  if ! write_wrapper "$temporary"; then
    rm -f "$temporary"
    return 1
  fi
  if [[ -e "$wrapper" || -L "$wrapper" ]]; then
    if cmp -s "$temporary" "$wrapper"; then
      rm -f "$temporary"
      printf 'Wrapper is already up to date: %s\n' "$wrapper"
    else
      if ! mv "$temporary" "$wrapper"; then
        rm -f "$temporary"
        return 1
      fi
      printf 'Updated managed wrapper: %s\n' "$wrapper"
    fi
  else
    if ! mv "$temporary" "$wrapper"; then
      rm -f "$temporary"
      return 1
    fi
    printf 'Installed wrapper: %s\n' "$wrapper"
    INSTALLED_WRAPPER=1
  fi
}

printf 'Running A-Max preflight checks...\n'
"$ROOT/doctor-a-max" --preflight

printf '\nInstalling locked dependencies...\n'
(cd "$ROOT" && bun install --frozen-lockfile)

printf '\nRunning A-Max checks...\n'
(cd "$ROOT" && bun run check:a-max)

mkdir -p "$BIN_DIR"

for wrapper in "$PRIMARY_WRAPPER" "$LEGACY_WRAPPER"; do
  if [[ -e "$wrapper" || -L "$wrapper" ]] && ! is_managed_wrapper "$wrapper"; then
    printf 'Refusing to overwrite an unmanaged path: %s\n' "$wrapper" >&2
    exit 1
  fi
done

install_wrapper "$PRIMARY_WRAPPER"
created_primary_wrapper=$INSTALLED_WRAPPER
install_wrapper "$LEGACY_WRAPPER"
created_legacy_wrapper=$INSTALLED_WRAPPER

printf '\nRunning final A-Max diagnostics...\n'
if ! "$ROOT/doctor-a-max"; then
  if [[ $created_primary_wrapper -eq 1 ]]; then
    rm -f "$PRIMARY_WRAPPER"
  fi
  if [[ $created_legacy_wrapper -eq 1 ]]; then
    rm -f "$LEGACY_WRAPPER"
  fi
  if [[ $created_primary_wrapper -eq 1 || $created_legacy_wrapper -eq 1 ]]; then
    printf '\nA-Max diagnostics failed. Removed newly installed wrapper(s).\n' >&2
  else
    printf '\nA-Max diagnostics failed. Existing managed wrappers were preserved.\n' >&2
  fi
  exit 1
fi

printf '\nA-Max installation complete. Run: oc-amax\n'
