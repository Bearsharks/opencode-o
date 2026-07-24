#!/usr/bin/env bash

set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"

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

WRAPPER="$BIN_DIR/opencode-o"
created_wrapper=0

printf 'Running preflight checks...\n'
"$ROOT/doctor" --preflight

printf '\nInstalling locked dependencies...\n'
(cd "$ROOT" && bun install --frozen-lockfile)

printf '\nRunning harness checks...\n'
(cd "$ROOT" && bun run check)

mkdir -p "$BIN_DIR"

if [[ -e "$WRAPPER" || -L "$WRAPPER" ]]; then
  if [[ ! -f "$WRAPPER" ]] || ! grep -Fqx "# opencode-o-root: $ROOT" "$WRAPPER"; then
    printf 'Refusing to overwrite an unmanaged path: %s\n' "$WRAPPER" >&2
    exit 1
  fi
  printf 'Wrapper already points to this checkout: %s\n' "$WRAPPER"
else
  temporary="$(mktemp "$BIN_DIR/.opencode-o.XXXXXX")"
  cleanup() {
    if [[ -n "${temporary:-}" && -e "$temporary" ]]; then
      rm -f "$temporary"
    fi
  }
  trap cleanup EXIT

  {
    printf '#!/usr/bin/env bash\n'
    printf '# opencode-o-root: %s\n' "$ROOT"
    printf 'set -euo pipefail\n'
    printf 'OPENCODE_O_ROOT=%q\n' "$ROOT"
    printf 'OPENCODE_CONFIG_DIR="$OPENCODE_O_ROOT" exec opencode "$@"\n'
  } >"$temporary"
  chmod 755 "$temporary"
  mv "$temporary" "$WRAPPER"
  created_wrapper=1
  temporary=""
  trap - EXIT
  printf 'Installed wrapper: %s\n' "$WRAPPER"
fi

printf '\nRunning final diagnostics...\n'
if ! "$ROOT/doctor"; then
  if [[ $created_wrapper -eq 1 ]]; then
    rm -f "$WRAPPER"
    printf '\nInstallation diagnostics failed. Removed the newly installed wrapper.\n' >&2
  else
    printf '\nInstallation diagnostics failed. The existing managed wrapper was preserved.\n' >&2
  fi
  exit 1
fi

printf '\nInstallation complete. Run: opencode-o\n'
