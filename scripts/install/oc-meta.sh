#!/usr/bin/env bash

# oc-meta installer: stages a self-contained profile snapshot into the user's
# OpenCode config home and points the managed wrapper at the INSTALLED copy.
# The wrapper and snapshot never reference this source checkout at runtime.
#
# Dependencies: the topology plugin's only import is type-only, and OpenCode
# itself materializes config-dir plugin dependencies (package.json,
# package-lock.json, node_modules, .gitignore) pinned to the running OpenCode.
# The installer pre-materializes them inside the staged snapshot during
# validation, so the installed tree resolves on its own with no repo ancestors
# and no first-launch setup.

set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)"
OC_META_SOURCE="$ROOT/profiles/oc-meta"
MARKER_FILE=".oc-meta-managed"
MARKER_CONTENT="managed by opencode-o oc-meta installer"

if [[ "$ROOT" == *$'\n'* ]]; then
  printf 'The checkout path must not contain a newline.\n' >&2
  exit 1
fi

if [[ -n "${OPENCODE_O_META_CONFIG_HOME:-}" ]]; then
  CONFIG_HOME="$OPENCODE_O_META_CONFIG_HOME"
elif [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
  CONFIG_HOME="$XDG_CONFIG_HOME/opencode"
elif [[ -n "${HOME:-}" ]]; then
  CONFIG_HOME="$HOME/.config/opencode"
else
  printf 'Cannot determine the OpenCode config home because HOME is unset.\n' >&2
  exit 1
fi

if [[ "$CONFIG_HOME" == *$'\n'* ]]; then
  printf 'The config home path must not contain a newline.\n' >&2
  exit 1
fi

PROFILES_PARENT="$CONFIG_HOME/profiles"
INSTALL_DIR="$PROFILES_PARENT/oc-meta"

if [[ -n "${OPENCODE_O_BIN_DIR:-}" ]]; then
  BIN_DIR="$OPENCODE_O_BIN_DIR"
elif [[ -n "${HOME:-}" ]]; then
  BIN_DIR="$HOME/.local/bin"
else
  printf 'Cannot determine the install directory because HOME is unset.\n' >&2
  exit 1
fi

WRAPPER="$BIN_DIR/oc-meta"
WRAPPER_MARKER="# oc-meta-install: $INSTALL_DIR"
LEGACY_WRAPPER_MARKER="# oc-meta-root: $ROOT"

profile_assets=(
  "opencode.jsonc"
  "agents/MetaOrchestrator.md"
  "agents/runner.md"
  "plugins/oc-meta-topology.ts"
)

die() {
  printf '%s\n' "$1" >&2
  exit 1
}

write_wrapper() {
  local target="$1"
  {
    printf '#!/usr/bin/env bash\n'
    printf '%s\n' "$WRAPPER_MARKER"
    printf 'set -euo pipefail\n'
    printf 'OPENCODE_O_META_INSTALLED=%q\n' "$INSTALL_DIR"
    printf 'export OPENCODE_EXPERIMENTAL_LSP_TOOL=true\n'
    printf 'OPENCODE_CONFIG_DIR="$OPENCODE_O_META_INSTALLED" exec opencode "$@"\n'
  } >"$target"
  chmod 755 "$target"
}

printf 'Running oc-meta preflight checks...\n'
"$ROOT/scripts/doctor/oc-meta.sh" --preflight

printf '\nInstalling locked dependencies (repo root)...\n'
(cd "$ROOT" && bun install --frozen-lockfile)

printf '\nRunning oc-meta checks...\n'
(cd "$ROOT" && bun run check:oc-meta)

# ---- Read-only ownership prechecks: refuse unmanaged collisions before any
# mutation, so a refusal leaves both the install directory and wrapper intact.
if [[ -e "$INSTALL_DIR" || -L "$INSTALL_DIR" ]]; then
  if [[ ! -d "$INSTALL_DIR" || -L "$INSTALL_DIR" ]]; then
    die "Refusing to touch an unmanaged path: $INSTALL_DIR is not a plain directory"
  fi
  if [[ ! -f "$INSTALL_DIR/$MARKER_FILE" ]]; then
    die "Refusing to overwrite an unmanaged directory: $INSTALL_DIR (no $MARKER_FILE marker)"
  fi
fi

wrapper_was_legacy=0
if [[ -e "$WRAPPER" || -L "$WRAPPER" ]]; then
  if [[ ! -f "$WRAPPER" ]]; then
    die "Refusing to touch an unmanaged path: $WRAPPER is not a regular file"
  fi
  if grep -Fqx "$WRAPPER_MARKER" "$WRAPPER"; then
    :
  elif grep -Fqx "$LEGACY_WRAPPER_MARKER" "$WRAPPER"; then
    wrapper_was_legacy=1
  else
    die "Refusing to overwrite an unmanaged wrapper: $WRAPPER"
  fi
fi

# ---- Stage the snapshot.
mkdir -p "$PROFILES_PARENT"
stage="$(mktemp -d "$PROFILES_PARENT/.oc-meta-stage.XXXXXX")"
stage_cleanup() {
  if [[ -n "${stage:-}" && -d "$stage" ]]; then
    rm -rf -- "$stage"
  fi
}
trap stage_cleanup EXIT

for asset in "${profile_assets[@]}"; do
  if [[ ! -f "$OC_META_SOURCE/$asset" ]]; then
    die "Missing source profile asset: $OC_META_SOURCE/$asset"
  fi
done

mkdir -p "$stage/agents" "$stage/plugins"
cp -- "$OC_META_SOURCE/opencode.jsonc" "$stage/opencode.jsonc"
cp -- "$OC_META_SOURCE/agents/MetaOrchestrator.md" "$stage/agents/MetaOrchestrator.md"
cp -- "$OC_META_SOURCE/agents/runner.md" "$stage/agents/runner.md"
cp -- "$OC_META_SOURCE/plugins/oc-meta-topology.ts" "$stage/plugins/oc-meta-topology.ts"
printf '%s\n' "$MARKER_CONTENT" >"$stage/$MARKER_FILE"

printf 'Validating staged snapshot (also materializes plugin dependencies)...\n'
if ! staged_config="$(
  cd "$stage" &&
    OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$stage" opencode debug config 2>/dev/null
)" || ! grep -Fq "oc-meta-topology.ts" <<<"$staged_config"; then
  die "Staged snapshot failed config validation; nothing was installed"
fi
if [[ ! -d "$stage/node_modules/@opencode-ai/plugin" ]]; then
  die "Staged snapshot dependencies were not materialized; refusing to install"
fi

# OpenCode bakes the staging directory name into the generated dependency
# lock. Rewrite it to the final install identity so repeated installs are
# byte-identical and no staging paths leak into the installed tree.
stage_basename="$(basename "$stage")"
if ! STAGE_DIR="$stage" INSTALL_DIR_ENV="$INSTALL_DIR" STAGE_BASENAME="$stage_basename" \
  bun -e '
    const fs = require("fs")
    for (const file of [
      process.env.STAGE_DIR + "/package-lock.json",
      process.env.STAGE_DIR + "/node_modules/.package-lock.json",
    ]) {
      if (!fs.existsSync(file)) continue
      let text = fs.readFileSync(file, "utf8")
      text = text.split(process.env.STAGE_DIR).join(process.env.INSTALL_DIR_ENV)
      text = text.split(process.env.STAGE_BASENAME).join("oc-meta")
      fs.writeFileSync(file, text)
    }
  ' >/dev/null 2>&1; then
  die "Could not normalize the staged dependency metadata"
fi

if grep -rFl -- "$ROOT" \
  "$stage/opencode.jsonc" \
  "$stage/agents" \
  "$stage/plugins" \
  "$stage/package-lock.json" >/dev/null 2>&1; then
  die "Staged snapshot references the source checkout; refusing to install"
fi

# ---- Save rollback material for the wrapper.
old_wrapper_bytes=""
if [[ -e "$WRAPPER" ]]; then
  old_wrapper_bytes="$(mktemp "${TMPDIR:-/tmp}/oc-meta-wrapper.XXXXXX")"
  cp -- "$WRAPPER" "$old_wrapper_bytes"
fi

# ---- Atomic snapshot swap with rollback on failure.
backup=""
if [[ -d "$INSTALL_DIR" ]]; then
  backup="$PROFILES_PARENT/.oc-meta-backup.$$"
  mv -- "$INSTALL_DIR" "$backup"
fi
if ! mv -- "$stage" "$INSTALL_DIR"; then
  if [[ -n "$backup" ]]; then
    mv -- "$backup" "$INSTALL_DIR"
    printf 'Restored previous install directory after staging failure.\n' >&2
  fi
  die "Could not move the staged snapshot into place: $INSTALL_DIR"
fi
stage=""
trap - EXIT

# ---- Wrapper install/upgrade.
created_wrapper=0
mkdir -p "$BIN_DIR"
wrapper_temp="$(mktemp "$BIN_DIR/.oc-meta.XXXXXX")"
write_wrapper "$wrapper_temp"
if [[ -e "$WRAPPER" ]]; then
  if cmp -s "$wrapper_temp" "$WRAPPER"; then
    rm -f "$wrapper_temp"
    printf 'Wrapper is already up to date: %s\n' "$WRAPPER"
  else
    if [[ $wrapper_was_legacy -eq 1 ]]; then
      printf 'Upgrading managed legacy source wrapper: %s\n' "$WRAPPER"
    else
      printf 'Updated managed wrapper: %s\n' "$WRAPPER"
    fi
    mv -- "$wrapper_temp" "$WRAPPER"
  fi
else
  mv -- "$wrapper_temp" "$WRAPPER"
  created_wrapper=1
  printf 'Installed wrapper: %s\n' "$WRAPPER"
fi

restore_previous() {
  local had_snapshot="$1"
  if [[ $created_wrapper -eq 1 ]]; then
    rm -f -- "$WRAPPER"
    printf 'Removed the newly installed wrapper: %s\n' "$WRAPPER" >&2
  elif [[ -n "$old_wrapper_bytes" ]]; then
    cp -- "$old_wrapper_bytes" "$WRAPPER"
    chmod 755 "$WRAPPER"
    printf 'Restored the previous wrapper: %s\n' "$WRAPPER" >&2
  fi
  if [[ "$had_snapshot" == "yes" && -n "$backup" ]]; then
    rm -rf -- "$INSTALL_DIR"
    mv -- "$backup" "$INSTALL_DIR"
    printf 'Restored the previous known-good profile: %s\n' "$INSTALL_DIR" >&2
  else
    rm -rf -- "$INSTALL_DIR"
    printf 'Removed the newly installed profile: %s\n' "$INSTALL_DIR" >&2
  fi
  [[ -n "$old_wrapper_bytes" ]] && rm -f -- "$old_wrapper_bytes"
}

printf '\nRunning final oc-meta diagnostics...\n'
if ! "$ROOT/scripts/doctor/oc-meta.sh"; then
  if [[ -n "$backup" ]]; then
    restore_previous "yes"
  else
    restore_previous "no"
  fi
  printf 'Oc-meta diagnostics failed; previous state was restored.\n' >&2
  exit 1
fi

[[ -n "$old_wrapper_bytes" ]] && rm -f -- "$old_wrapper_bytes"
if [[ -n "$backup" ]]; then
  rm -rf -- "$backup"
fi

printf '\noc-meta installation complete.\n'
printf '  Profile snapshot: %s\n' "$INSTALL_DIR"
printf '  Wrapper:          %s\n' "$WRAPPER"
printf 'Run: oc-meta\n'
