#!/usr/bin/env bash

set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
OC_LITE_ROOT="$ROOT/profiles/oc-lite"

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

WRAPPER="$BIN_DIR/oc-lite"
created_wrapper=0

# Refuse unmanaged paths before any dependency installation or wrapper write.
if [[ -e "$WRAPPER" || -L "$WRAPPER" ]]; then
  if [[ ! -f "$WRAPPER" ]] || ! grep -Fqx "# oc-lite-root: $ROOT" "$WRAPPER"; then
    printf 'Refusing to overwrite an unmanaged path: %s\n' "$WRAPPER" >&2
    exit 1
  fi
fi

write_wrapper() {
  local target="$1"
  {
    printf '#!/usr/bin/env bash\n'
    printf '# oc-lite-root: %s\n' "$ROOT"
    printf 'set -euo pipefail\n'
    printf 'OPENCODE_O_LITE_ROOT=%q\n' "$ROOT"
    printf 'OPENCODE_CONFIG_DIR="$OPENCODE_O_LITE_ROOT/profiles/oc-lite" exec opencode "$@"\n'
  } >"$target"
  chmod 755 "$target"
}

printf 'Running oc-lite preflight checks...\n'
"$ROOT/scripts/doctor/oc-lite.sh" --preflight

printf '\nInstalling locked dependencies...\n'
(cd "$ROOT" && bun install --frozen-lockfile)

printf '\nRunning oc-lite checks...\n'
(cd "$ROOT" && bun run check:oc-lite)

mkdir -p "$BIN_DIR"

if [[ -e "$WRAPPER" || -L "$WRAPPER" ]]; then
  temporary="$(mktemp "$BIN_DIR/.oc-lite.XXXXXX")"
  write_wrapper "$temporary"
  if cmp -s "$temporary" "$WRAPPER"; then
    rm -f "$temporary"
    printf 'Wrapper is already up to date: %s\n' "$WRAPPER"
  else
    mv "$temporary" "$WRAPPER"
    printf 'Updated managed wrapper: %s\n' "$WRAPPER"
  fi
else
  temporary="$(mktemp "$BIN_DIR/.oc-lite.XXXXXX")"
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

printf '\nRunning final oc-lite diagnostics...\n'
if ! "$ROOT/scripts/doctor/oc-lite.sh"; then
  if [[ $created_wrapper -eq 1 ]]; then
    rm -f "$WRAPPER"
    printf '\nOc-lite diagnostics failed. Removed the newly installed wrapper.\n' >&2
  else
    printf '\nOc-lite diagnostics failed. The existing managed wrapper was preserved.\n' >&2
  fi
  exit 1
fi

printf '\noc-lite installation complete. Run: oc-lite\n'
