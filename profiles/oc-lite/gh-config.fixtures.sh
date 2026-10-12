#!/usr/bin/env bash
# Offline checks of environment inherited by the real installed wrapper's child.
set -euo pipefail
wrapper="$1"
root="$2"
mode="${3:-offline}"
original_home="$HOME"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/oc-lite-gh.XXXXXX")"
trap 'rm -rf -- "$fixture"' EXIT
mkdir -p "$fixture/bin" "$fixture/home" "$fixture/hostile" "$fixture/custom/gh" "$fixture/empty"
cat >"$fixture/bin/opencode" <<'SH'
#!/usr/bin/env bash
[[ "${GH_CONFIG_DIR:-}" == "$EXPECTED_GH" ]] || exit 1
[[ "${XDG_CONFIG_HOME:-}" == "$HOME/.config/opencode-o/oc-lite" ]] || exit 1
[[ "${OPENCODE_CONFIG_DIR:-}" == "$EXPECTED_PROFILE" ]] || exit 1
[[ "${OPENCODE_DB:-}" == "fixture-db" ]] || exit 1
[[ "$*" == '--standalone' ]] || exit 1
if [[ "${VERIFY_GH:-}" == 1 ]]; then gh auth status >/dev/null 2>&1 || exit 1; fi
SH
chmod +x "$fixture/bin/opencode"
export PATH="$fixture/bin:$PATH" HOME="$fixture/home" OPENCODE_DB=fixture-db
export EXPECTED_PROFILE="$root/profiles/oc-lite"
export XDG_CONFIG_HOME="$fixture/hostile" EXPECTED_GH="$fixture/home/.config/gh"
unset GH_CONFIG_DIR
"$wrapper"
GH_CONFIG_DIR="$fixture/explicit" EXPECTED_GH="$fixture/explicit" "$wrapper"
touch "$fixture/custom/gh/hosts.yml"
XDG_CONFIG_HOME="$fixture/custom" EXPECTED_GH="$fixture/custom/gh" "$wrapper"
rm "$fixture/custom/gh/hosts.yml"
touch "$fixture/custom/gh/config.yml"
XDG_CONFIG_HOME="$fixture/custom" EXPECTED_GH="$fixture/custom/gh" "$wrapper"
GH_CONFIG_DIR='' XDG_CONFIG_HOME="$fixture/empty" EXPECTED_GH="$fixture/home/.config/gh" "$wrapper"
printf 'PASS  5 offline GH/XDG/DB wrapper cases\n'
if [[ "$mode" == --live-auth ]]; then
  HOME="$original_home" XDG_CONFIG_HOME="$fixture/hostile" EXPECTED_GH="$original_home/.config/gh" VERIFY_GH=1 "$wrapper"
  HOME="$original_home" XDG_CONFIG_HOME="$fixture/hostile" GH_CONFIG_DIR="$original_home/.config/gh" EXPECTED_GH="$original_home/.config/gh" VERIFY_GH=1 "$wrapper"
  printf 'PASS  2 live gh auth status cases (fallback and explicit override)\n'
elif [[ "$mode" != offline ]]; then
  echo 'Usage: gh-config.fixtures.sh WRAPPER ROOT [--live-auth]' >&2
  exit 2
fi
