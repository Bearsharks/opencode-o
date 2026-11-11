#!/usr/bin/env bash
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
[[ "$ROOT" != *$'\n'* ]] || { printf 'Checkout path cannot contain a newline\n' >&2; exit 1; }
BIN_DIR="${OPENCODE_O_BIN_DIR:-$HOME/.local/bin}"
WRAPPER="$BIN_DIR/oc-pstack"
MARKER="# oc-pstack-root: $ROOT"
if [[ -e "$WRAPPER" || -L "$WRAPPER" ]]; then
  if [[ -L "$WRAPPER" || ! -f "$WRAPPER" ]] || ! grep -Fqx "$MARKER" "$WRAPPER"; then
    printf 'Refusing to overwrite unmanaged path: %s\n' "$WRAPPER" >&2
    exit 1
  fi
fi
"$ROOT/scripts/doctor/pstack.sh" --preflight
(cd "$ROOT" && bun install --frozen-lockfile && bun run check:pstack)
(cd "$ROOT/profiles/pstack/skills/poteto-mode/scripts" && bun install --frozen-lockfile)
(cd "$ROOT/profiles/pstack/skills/statechart/scripts" && bun install --frozen-lockfile)
# Complete runtime validation before publishing the launcher.
bun "$ROOT/profiles/pstack/scripts/doctor.ts"
mkdir -p "$BIN_DIR"
temporary="$(mktemp "$BIN_DIR/.oc-pstack.XXXXXX")"
trap 'rm -f -- "$temporary"' EXIT
{
  printf '#!/usr/bin/env bash\n%s\nset -euo pipefail\n' "$MARKER"
  printf 'PSTACK_ROOT=%q\n' "$ROOT"
  cat <<'WRAPPER'
if [[ -z "${GH_CONFIG_DIR:-}" ]]; then
  if [[ -n "${XDG_CONFIG_HOME:-}" && ( -f "$XDG_CONFIG_HOME/gh/hosts.yml" || -f "$XDG_CONFIG_HOME/gh/config.yml" ) ]]; then
    export GH_CONFIG_DIR="$XDG_CONFIG_HOME/gh"
  else
    export GH_CONFIG_DIR="$HOME/.config/gh"
  fi
fi
export OPENCODE_O_PROFILE=pstack
export XDG_CONFIG_HOME="${OPENCODE_O_PSTACK_CONFIG_HOME:-$HOME/.config/opencode-o/pstack}"
export XDG_STATE_HOME="${OPENCODE_O_PSTACK_STATE_HOME:-$HOME/.local/state/opencode-o/pstack}"
export OPENCODE_CONFIG_DIR="${OC_PSTACK_PROFILE_DIR:-$PSTACK_ROOT/profiles/pstack}"
export OPENCODE_CONFIG="$OPENCODE_CONFIG_DIR/opencode.jsonc"
unset OPENCODE_CONFIG_CONTENT
export OPENCODE_DB="${OPENCODE_DB:-opencode-pstack.db}"
exec opencode "$@"
WRAPPER
} > "$temporary"
chmod 755 "$temporary"
bun "$ROOT/scripts/configure-profile-service.ts" "$temporary" "${OC_PSTACK_PROFILE_DIR:-$ROOT/profiles/pstack}" 49376
# Validate this exact launcher while it is still a temporary candidate.
bun "$ROOT/profiles/pstack/scripts/doctor.ts" "$temporary"
mv -f -- "$temporary" "$WRAPPER"
printf '\nInstalled %s\nRun oc-pstack in your target project.\n' "$WRAPPER"
