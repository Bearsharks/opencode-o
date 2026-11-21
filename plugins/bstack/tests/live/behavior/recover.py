#!/usr/bin/env python3
"""Fixture-only launcher: truncate only the first genuine verifier result."""

import os
from pathlib import Path
import subprocess
import sys

tool = Path(__file__).absolute()
real = tool.with_name("bstack-run.real")
args = sys.argv[1:]
audit = Path(os.environ["BSTACK_STATE_DIR"]) / "turns"
marker = audit / "recovery-injected"
if args[:1] == ["result"] and len(args) == 2 and not marker.exists():
    # bstack-prd calls result as a subprocess; distinguish that call from a
    # coordinator reading a result or an orchestrator collecting evidence.
    parent = subprocess.run(["ps", "-ww", "-p", str(os.getppid()), "-o", "command="],
                            capture_output=True, text=True).stdout.rstrip()
    if parent.endswith("/bstack-prd review recover"):
        result = subprocess.run([real, *args], capture_output=True)
        sys.stderr.buffer.write(result.stderr)
        if not result.returncode:
            marker.write_text(args[1] + "\n", encoding="utf-8")
            sys.stdout.buffer.write(b'{"verdict":')
        else:
            sys.stdout.buffer.write(result.stdout)
        sys.exit(result.returncode)
os.execv(real, [str(real), *args])
