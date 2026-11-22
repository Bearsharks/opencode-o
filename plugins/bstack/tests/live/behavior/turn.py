"""Record turn boundaries and run only read-only status probes after the turn."""

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

from fixture import ANSWERS, state_dir

PLUGIN = Path("plugins/bstack")
REFS = PLUGIN / "skills/bstack-feature/references"
ID = r"\d{8}-\d{6}-(?:impl|hard|explore|panel)-[0-9a-f]{4}"


def runs_dir():
    repo = Path.cwd()
    return PLUGIN / "state" / "runs" / f"{repo.name}-{sha(os.fsencode(repo))[:12]}"


def audit_dir():
    return state_dir(Path.cwd()) / "turns"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def files_at(path, exclude=(), ignore_names=()):
    entries = {}

    def scan(folder):
        for child in sorted(folder.iterdir()):
            name = child.relative_to(path).as_posix()
            if name in exclude or child.name in ignore_names:
                continue
            mode = child.lstat().st_mode
            if stat.S_ISDIR(mode):
                entries[name] = None
                scan(child)
            elif stat.S_ISREG(mode):
                entries[name] = child.read_bytes()
            else:
                raise ValueError(f"unsupported fixture path: {child}")

    if path.is_symlink() or (path.exists() and not path.is_dir()):
        raise ValueError(f"not a directory: {path}")
    if path.exists():
        scan(path)
    return entries


def manifest(path, exclude=(), ignore_names=()):
    return {name: sha(data) if data is not None else None
            for name, data in files_at(path, exclude, ignore_names).items()}


def boundary():
    runs = {}
    for path in sorted(runs_dir().glob("*/meta.json")):
        record = get_json(path)
        # ask appends a directive reference to the parent, not a new result.
        record.pop("directives", None)
        runs[path.parent.name] = sha(json.dumps(record, sort_keys=True).encode())
    return {
        "prd": manifest(Path(".bstack")),
        "project": manifest(Path("."), (".git", ".bstack", (PLUGIN / "state").as_posix()),
                            ("__pycache__", ".pytest_cache")),
        "runs": runs,
    }


def put_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def get_json(path):
    return json.loads(path.read_bytes())


def meta(run_id):
    if not isinstance(run_id, str) or not re.fullmatch(ID, run_id):
        raise ValueError(f"invalid run id: {run_id!r}")
    return get_json(runs_dir() / run_id / "meta.json")


def transcript_bytes(run_id):
    path = meta(run_id).get("transcript_path")
    return Path(path).read_bytes() if path and Path(path).is_file() else b""


def record(folder, label, args, brief=None):
    proc = subprocess.run(args, input=brief, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    (folder / f"{label}.stdout").write_bytes(proc.stdout)
    (folder / f"{label}.stderr").write_bytes(proc.stderr)
    put_json(folder / f"{label}.exit", proc.returncode)
    return proc


def capture(case, label, cap, args):
    folder = audit_dir() / label
    folder.mkdir(parents=True)  # No overwrite or reuse.
    put_json(folder / "invocation.json", {"argv": args, "cost_ceiling_usd": cap})
    before = boundary()
    put_json(folder / "before.json", before)
    prefix = b""
    if label != "first":
        prefix = transcript_bytes(args[2])
        if not prefix:
            raise ValueError("missing parent transcript before ask")
        brief = ANSWERS[case][label == "confirmed"].encode()
    else:
        brief = (state_dir(Path.cwd()) / "input.md").read_bytes()
    if args[-2:] != ["--brief", "-"]:
        raise ValueError("fixture brief must be sent on stdin")
    proc = record(folder, "run", args, brief)
    record(folder, "status", [str(PLUGIN.resolve() / "bin/bstack-prd"), "status", case])
    put_json(folder / "after.json", boundary())
    request = Path(".bstack") / case / "request.md"
    if request.is_file():
        (folder / "request.md").write_bytes(request.read_bytes())
    match = re.match(rf"id=({ID})(?:[ \t]|\r?$)".encode(), proc.stdout.split(b"\n", 1)[0])
    if match:
        run_id = match[1].decode("ascii")
        put_json(folder / "id.json", run_id)
        record(folder, "result", [args[0], "result", run_id])
        data = transcript_bytes(run_id)
        put_json(folder / "transcript.json", {"start": len(prefix), "end": len(data),
                 "prefix_sha256": sha(prefix), "through_sha256": sha(data)})
    sys.stdout.buffer.write(proc.stdout)
    sys.stderr.buffer.write(proc.stderr)
    return proc.returncode


if __name__ == "__main__":
    case, label, cap, *args = sys.argv[1:]
    sys.exit(capture(case, label, cap, args))
