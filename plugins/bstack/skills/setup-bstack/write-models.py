#!/usr/bin/env python3
"""Update the approved model settings from a JSON object on stdin."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


PLUGIN_ROOT = Path(__file__).resolve().parents[2]
CONFIG = PLUGIN_ROOT / "config" / "models.json"
LAUNCHER = PLUGIN_ROOT / "bin" / "bstack-run"
EDITABLE = {"roles", "fast", "deny"}
MODEL = re.compile(r"[^/#\s]+/[^/#\s]+(?:#[^/#\s]+)?")
BARE_MODEL = re.compile(r"[^/#\s]+/[^/#\s]+")
ROLES = ("impl", "hard", "explore", "review", "panel")


def validate_update(update):
    if not isinstance(update, dict) or not update or set(update) - EDITABLE:
        raise ValueError("expected a nonempty JSON object containing only roles, fast, or deny")
    if "roles" in update:
        roles = update["roles"]
        if not isinstance(roles, dict) or set(roles) != set(ROLES):
            raise ValueError("expected exactly " + ", ".join(ROLES) + " roles")
        panel = roles["panel"]
        if not isinstance(panel, list) or not panel:
            raise ValueError("panel must be a nonempty model list")
        for model in [*(roles[role] for role in ROLES[:-1]), *panel]:
            if not isinstance(model, str) or not (model.startswith("claude:") or MODEL.fullmatch(model)):
                raise ValueError("expected provider/model, provider/model#variant, or claude:<alias>")
    if "fast" in update:
        fast = update["fast"]
        if not isinstance(fast, dict) or any(
            not BARE_MODEL.fullmatch(source) or not isinstance(target, str)
            or not BARE_MODEL.fullmatch(target) for source, target in fast.items()
        ):
            raise ValueError("fast must map bare provider/model IDs to bare provider/model IDs")


def check_config(path, *, capture=False):
    return subprocess.run(
        [str(LAUNCHER), "config"], env=dict(os.environ, BSTACK_CONFIG=str(path)),
        capture_output=capture, text=True,
    )


def main():
    update = json.load(sys.stdin)
    validate_update(update)
    path = Path(os.environ.get("BSTACK_CONFIG") or CONFIG).resolve()
    previous = path.read_bytes()
    before = json.loads(previous)
    if not isinstance(before, dict):
        raise ValueError("existing config must be a JSON object")
    # An invalid baseline can be repaired by an update to the editable keys.
    baseline = check_config(path)
    after = {**before, **update}
    changed = after != before
    if changed:
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".models-", delete=False) as draft:
                temporary = Path(draft.name)
                draft.write((json.dumps(after, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
            checked = check_config(temporary, capture=True)
            if checked.returncode:
                raise ValueError(f"proposed settings failed validation:\n{checked.stdout}{checked.stderr}")
            os.chmod(temporary, path.stat().st_mode & 0o777)
            if path.read_bytes() != previous:
                raise ValueError("config changed during setup; rerun with the current settings")
            temporary.replace(path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    checked = check_config(path) if changed else baseline
    actual = json.loads(path.read_bytes())
    if not isinstance(actual, dict) or (
        {key: value for key, value in before.items() if key not in update}
        != {key: value for key, value in actual.items() if key not in update}
    ):
        raise ValueError("config keys outside the approved update changed")
    if actual != after:
        raise ValueError("read-back config differs from the approved update")
    if checked.returncode:
        raise ValueError("config failed validation")
    print(f"{'updated' if changed else 'unchanged'}: {path}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        sys.exit(f"setup-bstack: {error}")
