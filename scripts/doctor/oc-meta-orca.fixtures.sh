#!/usr/bin/env bash
#
# Fixture coverage for scripts/doctor/oc-meta-orca.sh.
#
# Each case builds a stub bindir (fake `uname`, stub Orca executables) and
# runs the helper with a controlled environment. No real Orca, desktop, or
# network is touched.
#
# Cases:
#   1.  available CLI, default platform            -> 0, selects orca
#   2.  missing executable                         -> 1, install guidance
#   3.  Linux resolver never picks bare orca       -> 0, selects orca-ide
#   4.  Linux without orca-ide                     -> 1, names orca-ide
#   5.  ORCA_CLI_COMMAND single-path override      -> 0, selects override
#   6.  ORCA_DEV_REPO_ROOT                         -> 0, selects orca-dev
#   7.  GNOME screen-reader version                -> 1, no fallthrough
#   8.  offline desktop (status fails) still OK    -> 0 via --version probe
#   9.  ORCA_CLI_COMMAND with whitespace rejected  -> 1, wrapper guidance
#   10. hanging --version killed by bound (no timeout/gtimeout) -> 1
#   11. version ok but no Orca command surface     -> 1, identity mismatch
#   12. bounded ladder with timeout present        -> 0 (same stub, both paths)

set -u

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
HELPER="$ROOT/scripts/doctor/oc-meta-orca.sh"
failures=0
cases=0

stub_uname() {
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s"\n' "$2" >"$1/uname"
  chmod 755 "$1/uname"
}

stub_exe() {
  local path="$1" body="$2"
  printf '#!/usr/bin/env bash\n%s\n' "$body" >"$path"
  chmod 755 "$path"
}

check() {
  local name="$1" expected_exit="$2" expected_text="$3"
  cases=$((cases + 1))
  local output status
  output="$("$HELPER" 2>&1)"
  status=$?
  if [[ $status -ne "$expected_exit" ]]; then
    printf 'FAIL  %s: exit %s, expected %s\noutput:\n%s\n' "$name" "$status" "$expected_exit" "$output"
    failures=$((failures + 1))
    return
  fi
  if [[ -n "$expected_text" ]] && ! grep -Fq "$expected_text" <<<"$output"; then
    printf 'FAIL  %s: missing expected text %s\noutput:\n%s\n' "$name" "$expected_text" "$output"
    failures=$((failures + 1))
    return
  fi
  printf 'PASS  fixture %s\n' "$name"
}

# Behaves like the Orca development CLI: --version/--help succeed read-only;
# anything touching the desktop (status) fails while offline.
GOOD_ORCA='if [[ "${1:-}" == "--version" ]]; then printf "1.4.197\\n"; exit 0; fi
if [[ "${1:-}" == "--help" ]]; then printf "orca\\n\\nUsage: orca <command> [options]\\n\\n  status    Show readiness\\n  worktree  Manage worktrees\\n  skills    Version-matched guides\\n"; exit 0; fi
printf "desktop offline\\n"; exit 3'

d1="$(mktemp -d "${TMPDIR:-/tmp}/oc-meta-orca-fix.XXXXXX")"
stub_uname "$d1" Darwin
stub_exe "$d1/orca" "$GOOD_ORCA"
PATH="$d1:/usr/bin:/bin" ORCA_CLI_COMMAND="" ORCA_DEV_REPO_ROOT="" check "available selects orca" 0 "ORCA_CLI=orca"

d2="$(mktemp -d "${TMPDIR:-/tmp}/oc-meta-orca-fix.XXXXXX")"
stub_uname "$d2" Darwin
PATH="$d2:/usr/bin:/bin" ORCA_CLI_COMMAND="" ORCA_DEV_REPO_ROOT="" check "missing reports install guidance" 1 "not installed or not on PATH"

d3="$(mktemp -d "${TMPDIR:-/tmp}/oc-meta-orca-fix.XXXXXX")"
stub_uname "$d3" Linux
stub_exe "$d3/orca" 'printf "GNOME orca 40.0\\n"; exit 0'
stub_exe "$d3/orca-ide" "$GOOD_ORCA"
PATH="$d3:/usr/bin:/bin" ORCA_CLI_COMMAND="" ORCA_DEV_REPO_ROOT="" check "linux selects orca-ide never bare orca" 0 "ORCA_CLI=orca-ide"

d4="$(mktemp -d "${TMPDIR:-/tmp}/oc-meta-orca-fix.XXXXXX")"
stub_uname "$d4" Linux
PATH="$d4:/usr/bin:/bin" ORCA_CLI_COMMAND="" ORCA_DEV_REPO_ROOT="" check "linux missing names orca-ide" 1 "orca-ide"

d5="$(mktemp -d "${TMPDIR:-/tmp}/oc-meta-orca-fix.XXXXXX")"
stub_uname "$d5" Linux
stub_exe "$d5/custom-orca" "$GOOD_ORCA"
PATH="$d5:/usr/bin:/bin" ORCA_CLI_COMMAND="custom-orca" ORCA_DEV_REPO_ROOT="/repo" check "override command wins" 0 "ORCA_CLI=custom-orca"

d6="$(mktemp -d "${TMPDIR:-/tmp}/oc-meta-orca-fix.XXXXXX")"
stub_uname "$d6" Darwin
stub_exe "$d6/orca-dev" "$GOOD_ORCA"
PATH="$d6:/usr/bin:/bin" ORCA_CLI_COMMAND="" ORCA_DEV_REPO_ROOT="/repo" check "dev root selects orca-dev" 0 "ORCA_CLI=orca-dev"

d7="$(mktemp -d "${TMPDIR:-/tmp}/oc-meta-orca-fix.XXXXXX")"
stub_uname "$d7" Darwin
stub_exe "$d7/orca" 'printf "Orca 40.0 - GNOME screen reader\\n"; exit 0'
stub_exe "$d7/orca-ide" "$GOOD_ORCA"
PATH="$d7:/usr/bin:/bin" ORCA_CLI_COMMAND="" ORCA_DEV_REPO_ROOT="" check "screen reader mismatch fails without fallthrough" 1 "does not look like the Orca development CLI"

d8="$(mktemp -d "${TMPDIR:-/tmp}/oc-meta-orca-fix.XXXXXX")"
stub_uname "$d8" Darwin
stub_exe "$d8/orca" "$GOOD_ORCA"
PATH="$d8:/usr/bin:/bin" ORCA_CLI_COMMAND="" ORCA_DEV_REPO_ROOT="" check "offline desktop still available" 0 "ORCA_CLI_VERSION=1.4.197"

d9="$(mktemp -d "${TMPDIR:-/tmp}/oc-meta-orca-fix.XXXXXX")"
stub_uname "$d9" Darwin
PATH="$d9:/usr/bin:/bin" ORCA_CLI_COMMAND="/opt/space path/orca" ORCA_DEV_REPO_ROOT="" check "multiword command rejected" 1 "single executable path without whitespace"

# Hanging --version with the portable fallback ladder forced (env escape
# skips timeout/gtimeout even where present) and a 1s bound: must fail fast,
# bounded. /usr/bin supplies grep; no timeout binary is needed.
d10="$(mktemp -d "${TMPDIR:-/tmp}/oc-meta-orca-fix.XXXXXX")"
stub_uname "$d10" Darwin
stub_exe "$d10/orca" 'if [[ "${1:-}" == "--version" ]]; then exec sleep 60; fi
exit 0'
PATH="$d10:/usr/bin:/bin" ORCA_CLI_COMMAND="" ORCA_DEV_REPO_ROOT="" \
  OPENCODE_O_ORCA_PROBE_TIMEOUT=1 OPENCODE_O_ORCA_PROBE_NO_TIMEOUT=1 \
  check "hanging version killed by portable bound" 1 "version probe failed"

# Version looks fine but the command surface is not the Orca CLI.
d11="$(mktemp -d "${TMPDIR:-/tmp}/oc-meta-orca-fix.XXXXXX")"
stub_uname "$d11" Darwin
stub_exe "$d11/orca" 'if [[ "${1:-}" == "--version" ]]; then printf "9.9.9\\n"; exit 0; fi
if [[ "${1:-}" == "--help" ]]; then printf "usage: orca-copy [-v]\\n"; exit 0; fi
exit 0'
PATH="$d11:/usr/bin:/bin" ORCA_CLI_COMMAND="" ORCA_DEV_REPO_ROOT="" check "no orca command surface rejected" 1 "does not expose the Orca CLI command surface"

# Same stub through the timeout branch when a real `timeout` is available.
if command -v timeout >/dev/null 2>&1; then
  d12="$(mktemp -d "${TMPDIR:-/tmp}/oc-meta-orca-fix.XXXXXX")"
  stub_uname "$d12" Darwin
  stub_exe "$d12/orca" "$GOOD_ORCA"
  PATH="$d12:/usr/bin:/bin" ORCA_CLI_COMMAND="" ORCA_DEV_REPO_ROOT="" check "available via timeout branch" 0 "ORCA_CLI=orca"
else
  cases=$((cases + 1))
  printf 'SKIP  fixture available via timeout branch (no timeout on PATH)\n'
fi

for d in "$d1" "$d2" "$d3" "$d4" "$d5" "$d6" "$d7" "$d8" "$d9" "$d10" "$d11"; do
  rm -rf -- "$d"
done
[[ -n "${d12:-}" ]] && rm -rf -- "$d12"
printf '\nFixture summary: %d case(s), %d failure(s)\n' "$cases" "$failures"
[[ $failures -eq 0 ]]
