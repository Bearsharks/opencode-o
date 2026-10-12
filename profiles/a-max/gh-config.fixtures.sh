#!/usr/bin/env bash
# Offline environment/argument checks against the installed oc-amax launcher.
set -euo pipefail
wrapper="${1:?Usage: gh-config.fixtures.sh WRAPPER ROOT [--live-auth]}"
root="${2:?Usage: gh-config.fixtures.sh WRAPPER ROOT [--live-auth]}"
mode="${3:-offline}"
original_home="$HOME"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/a-max-gh.XXXXXX")"
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture"/{bin,home,custom/gh,other,empty,explicit}
cat >"$fixture/bin/opencode" <<'SH'
#!/usr/bin/env bash
[[ "${GH_CONFIG_DIR:-}" == "$EXPECTED_GH" ]] || exit 1
[[ "${XDG_CONFIG_HOME:-}" == "$EXPECTED_PROFILE/config-home" ]] || exit 2
[[ -z "${OPENCODE_CONFIG_DIR+x}" ]] || exit 3
[[ "${OPENCODE_DB:-}" == opencode-a-max.db ]] || exit 4
[[ "${OPENCODE_O_A_MAX_MODEL_CONFIG:-}" == "$EXPECTED_MODEL" ]] || exit 5
[[ "$*" == "$EXPECTED_ARGS" ]] || exit 6
if [[ "${VERIFY_GH:-}" == 1 ]]; then gh auth status >/dev/null 2>&1 || exit 7; fi
SH
chmod +x "$fixture/bin/opencode"
export PATH="$fixture/bin:$PATH" HOME="$fixture/home"
export EXPECTED_PROFILE="$root/profiles/a-max" EXPECTED_MODEL='' EXPECTED_ARGS='--standalone demo'
unset GH_CONFIG_DIR OPENCODE_O_A_MAX_MODEL_CONFIG
export XDG_CONFIG_HOME="$fixture/empty" EXPECTED_GH="$fixture/home/.config/gh"
"$wrapper" demo
XDG_CONFIG_HOME="$root/profiles/a-max/config-home" "$wrapper" demo
XDG_CONFIG_HOME="$fixture/other" "$wrapper" demo
GH_CONFIG_DIR="$fixture/explicit" EXPECTED_GH="$fixture/explicit" "$wrapper" demo
touch "$fixture/custom/gh/hosts.yml"
XDG_CONFIG_HOME="$fixture/custom" EXPECTED_GH="$fixture/custom/gh" "$wrapper" demo
rm "$fixture/custom/gh/hosts.yml"
touch "$fixture/custom/gh/config.yml"
XDG_CONFIG_HOME="$fixture/custom" EXPECTED_GH="$fixture/custom/gh" "$wrapper" demo
GH_CONFIG_DIR='' XDG_CONFIG_HOME="$fixture/empty" "$wrapper" demo
mkdir -p "$fixture/custom/opencode"
printf '{"model":"example/model","effort":"high"}\n' >"$fixture/custom/opencode/a-max-model.json"
XDG_CONFIG_HOME="$fixture/custom" EXPECTED_GH="$fixture/custom/gh" \
  EXPECTED_MODEL="$fixture/custom/opencode/a-max-model.json" "$wrapper" demo
OPENCODE_O_A_MAX_MODEL_CONFIG="$fixture/explicit-model.json" \
  EXPECTED_MODEL="$fixture/explicit-model.json" "$wrapper" demo
OPENCODE_O_A_MAX_MODEL_CONFIG='' "$wrapper" demo
EXPECTED_ARGS='run --standalone --format json prompt' "$wrapper" run --format json prompt
EXPECTED_ARGS='api --standalone get /api/info' "$wrapper" api get /api/info
EXPECTED_ARGS='debug agent terraworker' "$wrapper" debug agent terraworker
EXPECTED_ARGS='serve --hostname 127.0.0.1 --port 0' "$wrapper" serve --hostname 127.0.0.1 --port 0
printf 'PASS  14 offline A-Max GH/XDG/model/DB/argument cases\n'
if [[ "$mode" == --live-auth ]]; then
  HOME="$original_home" XDG_CONFIG_HOME="$fixture/empty" \
    EXPECTED_GH="$original_home/.config/gh" VERIFY_GH=1 "$wrapper" demo
  HOME="$original_home" XDG_CONFIG_HOME="$fixture/empty" GH_CONFIG_DIR="$original_home/.config/gh" \
    EXPECTED_GH="$original_home/.config/gh" VERIFY_GH=1 "$wrapper" demo
  printf 'PASS  2 live gh auth status cases (fallback and explicit override)\n'
elif [[ "$mode" != offline ]]; then
  echo 'Usage: gh-config.fixtures.sh WRAPPER ROOT [--live-auth]' >&2
  exit 2
fi
