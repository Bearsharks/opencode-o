#!/usr/bin/env bash
#
# Resolve the Orca development CLI following the orca-cli skill and verify it
# with bounded, read-only capability probes.
#
# Selection order (orca-cli skill: "Resolve the CLI for this session"):
#   1. $ORCA_CLI_COMMAND when set: a SINGLE executable path. A value with
#      whitespace is rejected with guidance (never eval/split).
#   2. `orca-dev` when $ORCA_DEV_REPO_ROOT is present (dev checkout).
#   3. On Linux, `orca-ide` (bare `orca` there is normally the GNOME screen
#      reader; it is never executed by this script on Linux).
#   4. Otherwise `orca`.
#
# Identity probes (both bounded and read-only; no app launch, no state
# mutation; an offline desktop is NOT a missing CLI):
#   P1 `<exe> --version` : exit 0, nonempty, not GNOME/screen-reader.
#   P2 `<exe> --help`    : exit 0, mentions orca, and lists at least one
#                          Orca domain command (worktree/terminal/skills/
#                          automations/status).
# On failure the exact error is reported and there is no fallthrough to
# another executable.
#
# Environment:
#   OPENCODE_O_ORCA_PROBE_TIMEOUT   probe bound seconds (default 20, min 1)
#   OPENCODE_O_ORCA_PROBE_NO_TIMEOUT=1  test-only: skip timeout/gtimeout and
#                                   exercise the portable fallback ladder
#
# Exit 0 prints ORCA_CLI=/ORCA_CLI_VERSION=/ORCA_CLI_REASON=; exit 1 prints
# actionable guidance.

set -u

PROBE_TIMEOUT="${OPENCODE_O_ORCA_PROBE_TIMEOUT:-20}"
if ! [[ "$PROBE_TIMEOUT" =~ ^[0-9]+$ ]] || [[ "$PROBE_TIMEOUT" -lt 1 ]]; then
  PROBE_TIMEOUT=20
fi

REASON=""
EXE=""

if [[ -n "${ORCA_CLI_COMMAND:-}" ]]; then
  if [[ "$ORCA_CLI_COMMAND" =~ [[:space:]] ]]; then
    printf 'FAIL  ORCA_CLI_COMMAND must be a single executable path without whitespace (got: "%s").\n' "$ORCA_CLI_COMMAND" >&2
    printf 'Put arguments in a small wrapper script and point ORCA_CLI_COMMAND at it.\n' >&2
    exit 1
  fi
  EXE="$ORCA_CLI_COMMAND"
  REASON="ORCA_CLI_COMMAND is set"
elif [[ -n "${ORCA_DEV_REPO_ROOT:-}" ]]; then
  EXE="orca-dev"
  REASON="ORCA_DEV_REPO_ROOT is present"
elif [[ "$(uname -s 2>/dev/null)" == "Linux" ]]; then
  EXE="orca-ide"
  REASON="Linux default (bare orca is normally the GNOME screen reader)"
else
  EXE="orca"
  REASON="default"
fi

if [[ -z "$EXE" ]]; then
  printf 'FAIL  Orca CLI selection is empty.\n' >&2
  exit 1
fi

if ! command -v "$EXE" >/dev/null 2>&1; then
  printf 'FAIL  Orca CLI "%s" (selected: %s) is not installed or not on PATH.\n' "$EXE" "$REASON" >&2
  printf 'Install the Orca app for your OS so its development CLI is on PATH ' >&2
  printf '(on Linux use the orca-ide build; bare orca is normally the GNOME ' >&2
  printf 'screen reader), or point ORCA_CLI_COMMAND at it, then rerun doctor.\n' >&2
  printf 'Meta cannot coordinate Orca job sessions without it.\n' >&2
  exit 1
fi

# Bounded execution: timeout -> gtimeout -> perl alarm-exec -> bash watchdog.
bounded_run() {
  local out status tmpout pids watcher
  if [[ "${OPENCODE_O_ORCA_PROBE_NO_TIMEOUT:-}" != "1" ]] && command -v timeout >/dev/null 2>&1; then
    out="$(timeout "$PROBE_TIMEOUT" "$EXE" "$@" 2>&1)"
    status=$?
  elif [[ "${OPENCODE_O_ORCA_PROBE_NO_TIMEOUT:-}" != "1" ]] && command -v gtimeout >/dev/null 2>&1; then
    out="$(gtimeout "$PROBE_TIMEOUT" "$EXE" "$@" 2>&1)"
    status=$?
  elif command -v perl >/dev/null 2>&1; then
    out="$(perl -e 'alarm shift; exec @ARGV' "$PROBE_TIMEOUT" "$EXE" "$@" 2>&1)"
    status=$?
  else
    # Bash watchdog: capture to a temp file (no pipe to hang on), kill the
    # process and its children when the bound expires.
    tmpout="$(mktemp "${TMPDIR:-/tmp}/oc-meta-orca-probe.XXXXXX")"
    "$EXE" "$@" >"$tmpout" 2>&1 &
    pids=$!
    (sleep "$PROBE_TIMEOUT"; kill "$pids" 2>/dev/null; pkill -P "$pids" 2>/dev/null) &watcher=$!
    wait "$pids"
    status=$?
    kill "$watcher" 2>/dev/null
    wait "$watcher" 2>/dev/null
    out="$(cat "$tmpout")"
    rm -f "$tmpout"
  fi
  printf '%s' "$out"
  return "$status"
}

# P1: version probe.
version_output="$(bounded_run --version)"
version_status=$?
if [[ $version_status -ne 0 ]]; then
  printf 'FAIL  Orca CLI version probe failed for "%s" (selected: %s, exit %s).\n' "$EXE" "$REASON" "$version_status" >&2
  printf 'Exact probe error:\n%s\n' "$version_output" >&2
  printf 'Fix the reported error without switching executables, then rerun doctor.\n' >&2
  exit 1
fi
if [[ -z "$version_output" ]]; then
  printf 'FAIL  Orca CLI "%s" (selected: %s) printed no version output.\n' "$EXE" "$REASON" >&2
  exit 1
fi
if grep -qi -e gnome -e "screen reader" <<<"$version_output"; then
  printf 'FAIL  "%s" (selected: %s) does not look like the Orca development CLI.\n' "$EXE" "$REASON" >&2
  printf 'Version probe output:\n%s\n' "$version_output" >&2
  printf 'On Linux, bare orca is normally the GNOME screen reader: use the ' >&2
  printf 'orca-ide build or set ORCA_CLI_COMMAND to the Orca development CLI.\n' >&2
  exit 1
fi

# P2: identity/capability probe via the read-only command surface.
help_output="$(bounded_run --help)"
help_status=$?
if [[ $help_status -ne 0 ]]; then
  printf 'FAIL  Orca CLI help probe failed for "%s" (selected: %s, exit %s).\n' "$EXE" "$REASON" "$help_status" >&2
  printf 'Exact probe error:\n%s\n' "$help_output" >&2
  exit 1
fi
if ! grep -qi "orca" <<<"$help_output" ||
  ! grep -qE -e "worktree" -e "terminal" -e "skills" -e "automations" -e "status" <<<"$help_output"; then
  printf 'FAIL  "%s" (selected: %s) does not expose the Orca CLI command surface.\n' "$EXE" "$REASON" >&2
  printf 'Help probe output:\n%s\n' "$help_output" >&2
  printf 'It does not look like the Orca development CLI; install it or point ' >&2
  printf 'ORCA_CLI_COMMAND at the correct executable.\n' >&2
  exit 1
fi

printf 'ORCA_CLI=%s\n' "$EXE"
printf 'ORCA_CLI_VERSION=%s\n' "$(head -n 1 <<<"$version_output")"
printf 'ORCA_CLI_REASON=%s\n' "$REASON"
exit 0
