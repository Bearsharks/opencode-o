#!/usr/bin/env bash
set -euo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != --preflight ) ]]; then
  printf 'Usage: %s [--preflight]\n' "$0" >&2
  exit 2
fi
for executable in opencode bun git; do
  command -v "$executable" >/dev/null || { printf 'Missing prerequisite: %s\n' "$executable" >&2; exit 1; }
done
version="$(opencode --version)"
[[ "$version" == opencode\ v2.* ]] || { printf 'OpenCode V2 required; found %s\n' "$version" >&2; exit 1; }
printf 'PASS  %s\n' "$version"
[[ -f "$ROOT/profiles/pstack/provenance/source.json" ]] || { printf 'Missing pinned pstack source manifest\n' >&2; exit 1; }
if [[ "${1:-}" == --preflight ]]; then exit 0; fi
(cd "$ROOT" && bun run check:pstack)
wrapper="${OPENCODE_O_BIN_DIR:-$HOME/.local/bin}/oc-pstack"
if [[ -f "$wrapper" ]] && grep -Fqx "# oc-pstack-root: $ROOT" "$wrapper"; then
  bun "$ROOT/profiles/pstack/scripts/doctor.ts" "$wrapper"
else
  bun "$ROOT/profiles/pstack/scripts/doctor.ts"
fi
