#!/usr/bin/env python3
"""Deterministic bstack-run replacement, installed only in a test fixture."""

import json
import os
from pathlib import Path
import sys
import time
import uuid


cmd, *args = sys.argv[1:]
state = Path(__file__).resolve().parents[1] / "state"
state.mkdir(parents=True, exist_ok=True)
token = (os.environ.get("FAKE_ID") or "run-" + uuid.uuid4().hex) if cmd == "run" else None
log = state / "calls.jsonl"
with log.open("a", encoding="utf-8") as stream:
    stream.write(json.dumps([cmd, *args, *([token] if token else [])]) + "\n")
runs = state / "runs"
if cmd == "run":
    assert args == ["--role", "review", "--brief", "-"], args
    config = json.loads(os.environ.get("FAKE_CONFIG", "{}"))
    run = runs / token
    run.mkdir(parents=True)
    (run / "brief.md").write_bytes(sys.stdin.buffer.read())
    (run / "meta.json").write_text(json.dumps({
        "id": token, "status": config.get("status", "done"),
        "exit_code": config.get("exit_code", 0), "parent_id": None,
        "session_id": "session-" + token,
        "run_dir": str(run),
    }))
    (run / "answer").write_text(config.get("answer", '{"verdict":"READY","basis":"checked","findings":[]}'),
                                encoding="utf-8")
    (run / "result.md").write_text("Fake preview or footer. Do not parse me.\n")
    if config.get("hold"):
        (run / "entered").touch()
        expires = time.monotonic() + 15
        while not (run / "release").exists() and time.monotonic() < expires:
            time.sleep(0.01)
        if not (run / "release").exists():
            sys.exit("Test did not release the gate")
    print(f"id={token} status=done model=fake")
    print("Unparseable preview")
    sys.exit(config.get("run_exit", 0))
elif cmd in {"status", "result"} and len(args) == 1:
    path = runs / args[0] / ("meta.json" if cmd == "status" else "answer")
    sys.stdout.buffer.write(path.read_bytes())
else:
    sys.exit(f"Unexpected launcher arguments: {sys.argv}")
