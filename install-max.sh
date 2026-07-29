#!/usr/bin/env bash

set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
MAX_ROOT="$ROOT/profiles/max"

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

WRAPPER="$BIN_DIR/opencode-o-max"
created_wrapper=0

write_wrapper() {
  local target="$1"
  {
    printf '#!/usr/bin/env bash\n'
    printf '# opencode-o-max-root: %s\n' "$ROOT"
    printf 'set -euo pipefail\n'
    printf 'OPENCODE_O_MAX_ROOT=%q\n' "$ROOT"
    printf 'export OPENCODE_EXPERIMENTAL_LSP_TOOL=true\n'
    printf 'OPENCODE_CONFIG_DIR="$OPENCODE_O_MAX_ROOT/profiles/max" exec opencode "$@"\n'
  } >"$target"
  chmod 755 "$target"
}

printf 'Running max-mode preflight checks...\n'
"$ROOT/doctor-max" --preflight

printf '\nInstalling locked dependencies...\n'
(cd "$ROOT" && bun install --frozen-lockfile)

printf '\nRunning max-mode checks...\n'
(cd "$ROOT" && bun run check:max)

mkdir -p "$BIN_DIR"

if [[ -e "$WRAPPER" || -L "$WRAPPER" ]]; then
  if [[ ! -f "$WRAPPER" ]] || ! grep -Fqx "# opencode-o-max-root: $ROOT" "$WRAPPER"; then
    printf 'Refusing to overwrite an unmanaged path: %s\n' "$WRAPPER" >&2
    exit 1
  fi
  temporary="$(mktemp "$BIN_DIR/.opencode-o-max.XXXXXX")"
  write_wrapper "$temporary"
  if cmp -s "$temporary" "$WRAPPER"; then
    rm -f "$temporary"
    printf 'Wrapper is already up to date: %s\n' "$WRAPPER"
  else
    mv "$temporary" "$WRAPPER"
    printf 'Updated managed wrapper: %s\n' "$WRAPPER"
  fi
else
  temporary="$(mktemp "$BIN_DIR/.opencode-o-max.XXXXXX")"
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

printf '\nRunning final max-mode diagnostics...\n'
if ! "$ROOT/doctor-max"; then
  if [[ $created_wrapper -eq 1 ]]; then
    rm -f "$WRAPPER"
    printf '\nMax-mode diagnostics failed. Removed the newly installed wrapper.\n' >&2
  else
    printf '\nMax-mode diagnostics failed. The existing managed wrapper was preserved.\n' >&2
  fi
  exit 1
fi

printf '\nMax-mode installation complete. Run: opencode-o-max\n'
