from concurrent.futures import ThreadPoolExecutor
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile
import time
import unittest
import uuid


SOURCE_PLUGIN = Path(__file__).resolve().parents[2]
FAKE_CLI = """\
#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys
import time

args = sys.argv[1:]
sid = args[args.index("-s") + 1] if "-s" in args[:-1] else "ses_fake"
mode = os.environ.get("FAKE_MODE")

if args[0] == "api":
    with Path(os.environ["FAKE_API_LOG"]).open("a") as log:
        print(json.dumps({"argv": args, "cwd": str(Path.cwd())}), file=log)
    if mode == "api-fail":
        print("fake API error", file=sys.stderr)
        sys.exit(1)
    if args[1] == "session.interrupt":
        if mode != "not-interrupted":
            Path(os.environ["FAKE_GATE"]).touch()
        print(json.dumps({"interrupted": mode != "not-interrupted"}))
    else:
        payload = json.loads(args[args.index("-d") + 1])
        print(json.dumps({"data": {"id": "msg_fake", "delivery": payload["delivery"]}}))
    sys.exit()

def event(kind, part_type, **fields):
    print(json.dumps({"type": kind, "sessionID": sid,
                      "part": {"type": part_type, **fields}}), flush=True)

sys.stdout.buffer.write(b"non-JSON diagnostic: \\xff\\r\\n")
sys.stdout.buffer.flush()
print("worker stderr", file=sys.stderr)
event("step_start", "step-start", messageID="msg_tools")
event("text", "text", text="NOT THE FINAL ANSWER")
brief = sys.stdin.buffer.read().decode("utf-8")
if fixture := os.environ.get("FAKE_INPUT_RECORD"):
    Path(fixture).write_text(json.dumps(dict(argv=args, brief=brief)))
event("tool_use", "tool", state={"output": "X" * 110000})
event("step_finish", "step-finish", reason="tool-calls")
if mode == "gate":
    deadline = time.monotonic() + 10
    while not Path(os.environ["FAKE_GATE"]).exists():
        if time.monotonic() >= deadline:
            sys.exit(99)
        time.sleep(.01)
if mode == "fail":
    for i in range(250):
        print(f"stdout marker {i}")
        print(f"stderr marker {i}", file=sys.stderr)
    print("tail " + "Y" * 100000 + " stderr final", file=sys.stderr)
    sys.exit(17)
event("step_start", "step-start", messageID="msg_final")
event("text", "text", text="🍀" * 6100 if mode == "long" else "fake answer")
if mode == "multipart":
    event("text", "text", text="second part")
event("step_finish", "step-finish", reason="stop")
"""

FAKE_CLAUDE = """\
#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys
import time

args = sys.argv[1:]
brief = sys.stdin.buffer.read().decode("utf-8")
flag = "--append-system-prompt"
preamble = args[args.index(flag) + 1] if flag in args else None
mode = os.environ.get("FAKE_MODE")
sid_flag = "--resume" if "--resume" in args else "--session-id"
sid = args[args.index(sid_flag) + 1]
slug = "-fake-project--claude-worktrees-branch" if "-w" in args else "-fake-project"
if sid_flag == "--resume":
    matches = Path(os.environ["CLAUDE_CONFIG_DIR"]).glob(f"projects/*/{sid}.jsonl")
    transcript = next(matches)
else:
    transcript = Path(os.environ["CLAUDE_CONFIG_DIR"]) / "projects" / slug / f"{sid}.jsonl"
if mode not in {"malformed", "no-transcript"}:
    transcript.parent.mkdir(parents=True, exist_ok=True)
    with transcript.open("a") as file:
        print(json.dumps({"type": "user", "message": brief}), file=file)
if mode == "gate":
    print("claude interruption diagnostic", file=sys.stderr, flush=True)
    Path(os.environ["FAKE_CLAUDE_READY"]).write_text(str(os.getpid()))
    time.sleep(10)
if mode == "malformed":
    print("not JSON")
else:
    payload = {
        "type": "result", "session_id": sid, "is_error": mode == "fail",
        "result": "fake Claude error" if mode == "fail" else "fake Claude answer",
        "total_cost_usd": 0.0123, "argv": args, "brief": brief,
        "cwd": str(Path.cwd()), "preamble": preamble,
        "route_env": [k for k in ("ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN",
                                  "ANTHROPIC_DEFAULT_HAIKU_MODEL") if k in os.environ],
    }
    if fixture := os.environ.get("FAKE_INPUT_RECORD"):
        Path(fixture).write_text(json.dumps(payload))
    print(json.dumps(payload, indent=2))
"""


class BstackRunTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="bstack-run-test-")
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name).resolve()
        self.cwd = self.base / "repo"
        self.cwd.mkdir()
        self.plugin = self.base / "plugin"
        for name in ("bin", "config", "templates"):
            shutil.copytree(SOURCE_PLUGIN / name, self.plugin / name)
        self.bstack = self.plugin / "bin" / "bstack-run"
        self.writer = self.plugin / "skills" / "setup-bstack" / "write-models.py"
        self.writer.parent.mkdir(parents=True)
        shutil.copy2(SOURCE_PLUGIN / self.writer.relative_to(self.plugin), self.writer)
        key = hashlib.sha256(os.fsencode(self.cwd)).hexdigest()[:12]
        self.root = self.plugin / "state" / "runs" / f"{self.cwd.name}-{key}"
        self.fixtures = self.base / "fixtures"
        self.fixtures.mkdir()
        self.input_records = {}
        self.fake = self.cwd / "fake cli"
        self.fake.write_text(FAKE_CLI, encoding="utf-8")
        self.fake.chmod(0o700)
        self.claude = self.cwd / "fake claude"
        self.claude.write_text(FAKE_CLAUDE, encoding="utf-8")
        self.claude.chmod(0o700)
        self.claude_ready = self.cwd / "claude-ready"
        self.claude_config = self.cwd / "claude config"
        self.config_path = self.cwd / "test models.json"
        self.config = json.loads((self.plugin / "config" / "models.json").read_bytes())
        self.write_config()
        self.gate = self.cwd / "release"
        self.api_log = self.cwd / "api.jsonl"
        self.env = dict(os.environ, BSTACK_CLI=str(self.fake), FAKE_GATE=str(self.gate),
                         BSTACK_CONFIG=str(self.config_path),
                         BSTACK_CLAUDE_CLI=str(self.claude), FAKE_CLAUDE_READY=str(self.claude_ready),
                         CLAUDE_CONFIG_DIR=str(self.claude_config),
                         FAKE_API_LOG=str(self.api_log), PYTHONIOENCODING="utf-8")
        self.env.pop("FAKE_MODE", None)
        self.env.pop("BSTACK_FAST", None)

    def write_config(self):
        self.config_path.write_text(json.dumps(self.config), encoding="utf-8")

    def call(self, *args, mode=None, stdin=None):
        env = dict(self.env)
        fixture = self.fixtures / f"{uuid.uuid4().hex}.json"
        if args[0] in {"run", "ask"}:
            env["FAKE_INPUT_RECORD"] = str(fixture)
        if mode:
            env["FAKE_MODE"] = mode
        proc = subprocess.run(
            [str(self.bstack), *args], cwd=self.cwd, env=env, capture_output=True,
            input=stdin, encoding="utf-8", timeout=5,
        )
        proc.input_record = fixture
        return proc

    def setup_models(self, update):
        return subprocess.run(
            ["python3", str(self.writer)], cwd=self.cwd,
            env=dict(self.env, BSTACK_CONFIG=self.config_path.name),
            input=json.dumps(update), capture_output=True, encoding="utf-8", timeout=5,
        )

    def test_config_table_shows_effective_fast_models_and_preambles(self):
        preamble = self.cwd / "absolute preamble.md"
        preamble.write_text("An absolute preamble")
        self.config.update(
            roles={
                "impl": "test/build#high", "hard": "test/hard",
                "explore": "test/already-fast", "panel": ["claude:opus", "test/build", "test/other"],
            },
            fast={"test/build": "test/build-fast", "test/original": "test/already-fast"},
            preamble={"impl": "templates/preamble/impl.md", "hard": str(preamble), "panel": None},
        )
        self.write_config()
        self.env["BSTACK_FAST"] = "1"
        proc = self.call("config")
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual(proc.stderr, "")
        lines = proc.stdout.splitlines()
        self.assertEqual(lines[0], f"Config: {self.config_path}")
        self.assertEqual([tuple(cell.strip() for cell in line.split("|")) for line in lines[1:-1]], [
            ("Role", "Default model", "--fast model", "Preamble"),
            ("impl", "test/build#high", "test/build-fast#high",
             str(self.plugin / "templates" / "preamble" / "impl.md")),
            ("hard", "test/hard", "test/hard", str(preamble)),
            ("explore", "test/already-fast", "test/already-fast", "-"),
            ("panel", "claude:opus", "claude:opus", "-"),
            ("panel", "test/build", "test/build-fast", "-"),
            ("panel", "test/other", "test/other", "-"),
        ])
        self.assertIn("Checks: OK", lines[-1])
        self.assertFalse(self.root.exists())

    def assert_config_failure(self, message):
        proc = self.call("config")
        self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
        self.assertIn("Checks: FAILED", proc.stdout)
        self.assertIn(message, proc.stdout)
        return proc

    def test_config_rejects_arguments(self):
        for arg in ("unexpected", "--fast"):
            with self.subTest(arg=arg):
                self.assertEqual(self.call("config", arg).returncode, 2)

    def test_config_reports_all_required_keys(self):
        self.config.pop("cli")
        self.config.pop("roles")
        self.write_config()
        proc = self.assert_config_failure("cli:")
        for role in ("impl", "hard", "explore", "panel"):
            with self.subTest(role=role):
                self.assertIn(f"roles.{role}:", proc.stdout)

    def test_config_checks_denied_default_variant_panel_and_fast_models(self):
        self.config.update(
            roles={
                "impl": "test/build#high", "hard": "test/hard#TeRrA",
                "explore": "test/explore", "panel": ["test/allowed", "test/TeRrA"],
            },
            fast={"test/build": "test/build-fast", "test/terra": "test/terra-fast"},
            deny=["terra", "-FAST#HIGH"],
        )
        self.write_config()
        proc = self.assert_config_failure("roles.impl --fast: denied model: test/build-fast#high")
        for expected in (
            "roles.hard: denied model: test/hard#TeRrA",
            "roles.panel[1]: denied model: test/TeRrA",
            "fast['test/terra'] source: denied model: test/terra",
            "fast['test/terra'] target: denied model: test/terra-fast",
        ):
            self.assertIn(expected, proc.stdout)

    def test_config_checks_missing_preamble_and_rejects_directories(self):
        self.config["preamble"] = {"hard": "missing-preamble.md", "explore": "templates"}
        self.write_config()
        proc = self.assert_config_failure("preamble.hard: not a file:")
        self.assertIn(str(self.plugin / "missing-preamble.md"), proc.stdout)
        self.assertIn(f"preamble.explore: not a file: {self.plugin / 'templates'}", proc.stdout)

    def test_config_checks_claude_aliases_independently_of_deny(self):
        self.config["deny"] = []
        self.config["roles"]["panel"] = ["claude:haiku", "claude:sonnet", "claude:opus"]
        self.write_config()
        self.assertEqual(self.call("config").returncode, 0)
        for alias in ("fable", "claude-sonnet-4-6", "sonnet#high", "Opus", ""):
            with self.subTest(alias=alias):
                self.config["roles"]["panel"][-1] = f"claude:{alias}"
                self.write_config()
                self.assert_config_failure(f"roles.panel[2]: invalid Claude model 'claude:{alias}'")

    def test_config_handles_unreadable_or_malformed_config(self):
        self.config_path.unlink()
        self.assert_config_failure(str(self.config_path))
        self.config_path.write_text("{", encoding="utf-8")
        self.assert_config_failure("Expecting")
        self.config_path.write_text("[]", encoding="utf-8")
        self.assert_config_failure("expected a JSON object")

    def test_setup_updates_only_approved_keys_and_checks_installed_config(self):
        self.config["cli"] = "custom-cli"
        self.config["extension"] = {"unknown": ["保留", {"nested": True}]}
        self.write_config()
        self.config_path.chmod(0o640)
        updates = [
            {"roles": {
                "impl": "test/build#high", "hard": "claude:opus",
                "explore": "test/explore", "panel": ["claude:haiku", "claude:sonnet"],
            }},
            {"fast": {"test/build": "test/build-fast"}, "deny": ["terra", "fable", "custom"]},
        ]
        before = self.config
        for update in updates:
            with self.subTest(keys=list(update)):
                proc = self.setup_models(update)
                self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
                checks = proc.stdout.split(f"Config: {self.config_path}\n")
                self.assertEqual(len(checks), 3, proc.stdout)
                self.assertIn("Checks: OK", checks[1])
                self.assertIn("Checks: OK", checks[2])
                self.assertIn("updated:", checks[2])
                before = {**before, **update}
                self.assertEqual(json.loads(self.config_path.read_bytes()), before)
                self.assertEqual(self.config_path.stat().st_mode & 0o777, 0o640)
                self.assertFalse(list(self.cwd.glob(".models-*")))
        self.assertIn("test/build-fast#high", checks[2])

    def test_setup_leaves_original_untouched_on_invalid_update(self):
        previous = self.config_path.read_bytes()
        for update, message in [
            ({"cli": "different"}, "only roles, fast, or deny"),
            ({"roles": {**self.config["roles"], "hard": "claude:fable"}}, "invalid Claude model"),
            ({"fast": {"test/default": "test/TeRrA"}}, "denied model"),
        ]:
            with self.subTest(update=update):
                proc = self.setup_models(update)
                self.assertEqual(proc.returncode, 1, proc.stdout + proc.stderr)
                self.assertIn(message, proc.stderr)
                self.assertEqual(self.config_path.read_bytes(), previous)
                self.assertFalse(list(self.cwd.glob(".models-*")))

    def test_setup_can_repair_invalid_editable_settings(self):
        roles = self.config["roles"]
        self.config["roles"] = {**roles, "hard": "claude:fable"}
        self.write_config()
        proc = self.setup_models({"roles": roles})
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertLess(proc.stdout.index("Checks: FAILED"), proc.stdout.index("Checks: OK"))
        self.assertEqual(json.loads(self.config_path.read_bytes()), {**self.config, "roles": roles})

    def run_id(self, proc, code=0, stderr=""):
        self.assertEqual(proc.returncode, code, proc.stderr)
        self.assertEqual(proc.stderr, stderr)
        match = re.match(r"id=(\d{8}-\d{6}-\w+-[a-f0-9]{4})(?:[ \n])", proc.stdout)
        self.assertIsNotNone(match, proc.stdout[:200])
        self.input_records[match[1]] = proc.input_record
        return match[1]

    def status(self, run_id):
        proc = self.call("status", run_id)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return json.loads(proc.stdout)

    def await_session(self, run_id):
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            if self.status(run_id)["session_id"] == "ses_fake":
                return
            time.sleep(.01)
        self.fail("worker did not publish a session id")

    def release_worker(self, run_id):
        self.gate.touch()
        return self.call("wait", run_id, "--timeout", "4")

    def gated_run(self, *args):
        run_id = self.run_id(self.call("run", "--role", "explore", "--message", "start",
                                       "--bg", *args, mode="gate"))
        self.addCleanup(self.release_worker, run_id)
        self.await_session(run_id)
        return run_id

    def api_calls(self):
        return [json.loads(line) for line in self.api_log.read_text().splitlines()]

    def worker_input(self, run_id):
        return json.loads(self.input_records[run_id].read_bytes())

    def worker_argv(self, run_id):
        return self.worker_input(run_id)["argv"]

    def claude_input(self, run_id):
        return self.worker_input(run_id)

    def assert_preamble(self, run_id, template, meta=None):
        if meta is None:
            meta = self.status(run_id)
        if template is None:
            self.assertIsNone(meta["preamble"])
            self.assertIsNone(meta["preamble_sha256"])
            return ""
        source = self.plugin / "templates" / "preamble" / f"{template}.md"
        data = source.read_bytes()
        self.assertEqual(meta["preamble"], str(source))
        self.assertEqual(meta["preamble_sha256"], hashlib.sha256(data).hexdigest())
        return data.decode("utf-8")

    def assert_claude_preamble(self, run_id, template, payload):
        preamble = self.assert_preamble(run_id, template)
        argv = payload["argv"]
        i = argv.index("--append-system-prompt")
        self.assertEqual(payload["preamble"], preamble)
        return argv[:i] + argv[i + 2:]

    def test_claude_routes_slug_and_records_result_without_changing_stdout(self):
        proc = self.call("run", "--role", "panel", "--model", "claude:sonnet", "--message", "go")
        run_id = self.run_id(proc)
        meta = self.status(run_id)
        self.assert_preamble(run_id, None, meta)
        sid = meta["session_id"]
        self.assertEqual(proc.stdout, f"id={run_id} status=done model=claude:sonnet "
                                      f"session={sid} fast=false\nfake Claude answer")
        allowed_tools = [f"Bash({shlex.quote(str(self.plugin / 'bin' / name))}:*)"
                         for name in ("bstack-run", "bstack-prd")]
        self.assertEqual(self.claude_input(run_id)["argv"], [
            "-p", "--model", "sonnet", "--output-format", "json", "--permission-mode", "acceptEdits",
            "--allowedTools", *allowed_tools,
            "--session-id", sid,
        ])
        transcript = self.claude_config / "projects" / "-fake-project" / f"{sid}.jsonl"
        self.assertTrue(transcript.is_file())
        expected = dict(cli=str(self.claude), session_id=sid, result="fake Claude answer",
                        is_error=False, total_cost_usd=0.0123, transcript_path=str(transcript),
                        allowed_tools=allowed_tools, plugin_dir=None)
        self.assertEqual({key: meta[key] for key in expected}, expected)
        artifact = (self.root / run_id / "result.md").read_text()
        self.assertEqual({p.name for p in (self.root / run_id).iterdir()},
                         {"brief.md", "meta.json", "result.md"})
        self.assertTrue(artifact.startswith("fake Claude answer\n"))
        for field in (f'`session_id`: `"{sid}"`', "`is_error`: `false`",
                      "`total_cost_usd`: `0.0123`"):
            self.assertIn(field, artifact)
        self.assertEqual(self.call("result", run_id).stdout, "fake Claude answer\n")

    def test_proxy_coordinator_does_not_reroute_workers(self):
        keys = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_DEFAULT_HAIKU_MODEL"]
        self.env.update(dict.fromkeys(keys, "fixture"))
        for marker, expected in [("1", []), ("", keys)]:
            self.env["BSTACK_CPA_COORDINATOR"] = marker
            proc = self.call("run", "--role", "panel", "--model", "claude:sonnet", "--message", "go")
            self.assertEqual(self.claude_input(self.run_id(proc))["route_env"], expected)

    def test_claude_denies_fable_and_invalid_slug(self):
        for model, reason in (
            ("claude:fable", "denied model"),
            ("claude:claude-FaBLe-6", "denied model"),
            ("provider/fable", "denied model"),
            ("claude:", "expected a model"),
            ("claude:--no-session-persistence", "expected a model"),
        ):
            with self.subTest(model=model):
                proc = self.call("run", "--role", "panel", "--model", model, "--message", "go")
                self.assertEqual((proc.returncode, proc.stdout), (2, ""))
                self.assertIn(reason, proc.stderr)
                self.assertFalse(self.root.exists())

    def test_claude_background_worktree_and_large_stdin(self):
        brief = "-첫 줄\r\n" + "🌱" * 80000 + "\n"
        proc = self.call("run", "--role", "impl", "--model", "claude:haiku", "--brief", "-",
                         "--worktree", "--bg", stdin=brief)
        run_id = self.run_id(proc)
        self.assertEqual(self.call("wait", run_id, "--timeout", "4").stdout, "fake Claude answer\n")
        payload = self.claude_input(run_id)
        self.assertEqual(payload["brief"], brief)
        self.assertEqual(self.assert_claude_preamble(run_id, "impl", payload)[-1], "-w")
        meta = self.status(run_id)
        self.assertEqual(Path(meta["transcript_path"]), self.claude_config / "projects" /
                         "-fake-project--claude-worktrees-branch" / f"{meta['session_id']}.jsonl")

    def test_claude_resume_keeps_plugin_and_reads_configured_permission_mode(self):
        plugin = self.cwd / "a local plugin"
        plugin.mkdir()
        self.config["claude"]["permission_mode"] = "plan"
        self.write_config()
        parent = self.run_id(self.call("run", "--role", "hard", "--model", "claude:opus",
                                       "--worktree", "my-tree", "--plugin-dir", plugin.name,
                                       "--message", "start"))
        parent_meta = self.status(parent)
        allowed_tools = [f"Bash('{plugin}/bin/bstack-run':*)",
                         f"Bash('{plugin}/bin/bstack-prd':*)"]
        self.assertEqual(parent_meta["allowed_tools"], allowed_tools)
        self.assertEqual(self.assert_claude_preamble(parent, "impl", self.claude_input(parent)), [
            "-p", "--model", "opus", "--output-format", "json", "--permission-mode", "plan",
            "--allowedTools", *allowed_tools,
            "--session-id", parent_meta["session_id"], "--plugin-dir", str(plugin), "-w", "my-tree",
        ])
        child = self.run_id(self.call("ask", parent, "--brief", "-", stdin="second\n"))
        payload = self.claude_input(child)
        self.assertEqual(self.assert_claude_preamble(child, "impl", payload), [
            "-p", "--model", "opus", "--output-format", "json", "--permission-mode", "plan",
            "--allowedTools", *allowed_tools,
            "--resume", parent_meta["session_id"], "--plugin-dir", str(plugin),
        ])
        self.assertEqual(payload["brief"], "second\n")
        child_meta = self.status(child)
        self.assertEqual(child_meta["parent_id"], parent)
        self.assertEqual(child_meta["allowed_tools"], allowed_tools)
        self.assertEqual(child_meta["transcript_path"], parent_meta["transcript_path"])
        self.assertEqual(self.status(parent)["directive_count"], 1)

    def test_claude_allowed_tools_uses_config_and_can_be_empty(self):
        for rules in (["Read", "Bash(git status)"], []):
            with self.subTest(rules=rules):
                self.config["claude"]["allowed_tools"] = rules
                self.write_config()
                run_id = self.run_id(self.call("run", "--role", "panel", "--model", "claude:haiku",
                                               "--message", "go"))
                meta = json.loads((self.root / run_id / "meta.json").read_bytes())
                self.assertEqual(meta["allowed_tools"], rules)
                self.assertEqual(self.claude_input(run_id)["argv"], [
                    "-p", "--model", "haiku", "--output-format", "json",
                    "--permission-mode", "acceptEdits",
                    *(["--allowedTools", *rules] if rules else []),
                    "--session-id", meta["session_id"],
                ])

    def test_claude_allowed_tools_rejects_malformed_config(self):
        for rules in ("Bash", [None], ["  "], ["--permission-mode"]):
            with self.subTest(rules=rules):
                self.config["claude"]["allowed_tools"] = rules
                self.write_config()
                proc = self.call("run", "--role", "panel", "--model", "claude:haiku",
                                 "--message", "go")
                self.assertEqual(proc.returncode, 2, proc.stderr)
                self.assertIn("invalid claude.allowed_tools", proc.stderr)
                self.assertFalse(self.root.exists())

    def test_claude_allowed_tools_rejects_wildcard_in_plugin_path(self):
        proc = self.call("run", "--role", "panel", "--model", "claude:haiku",
                         "--plugin-dir", "plugin*", "--message", "go")
        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertIn("characters unsafe in Claude tool rules", proc.stderr)
        self.assertFalse(self.root.exists())

    def test_plugin_dir_is_rejected_for_opencode(self):
        proc = self.call("run", "--role", "impl", "--message", "go", "--plugin-dir", ".")
        self.assertEqual((proc.returncode, proc.stdout), (2, ""))
        self.assertIn("--plugin-dir is only supported for Claude Code", proc.stderr)
        self.assertFalse(self.root.exists())

    def test_claude_rejects_live_controls_and_interrupt_kills_process(self):
        run_id = self.run_id(self.call("run", "--role", "panel", "--model", "claude:haiku",
                                       "--message", "go", "--bg", mode="gate"))
        self.addCleanup(self.call, "interrupt", run_id)
        deadline = time.monotonic() + 4
        while not self.claude_ready.exists() and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertTrue(self.claude_ready.exists(), "fake Claude did not start")
        for kind in ("steer", "queue"):
            proc = self.call(kind, run_id, "--brief", "intentionally-missing")
            self.assertEqual((proc.returncode, proc.stdout), (4, ""))
            self.assertIn(f"Claude Code does not support {kind}; use ask {run_id}", proc.stderr)
        pid = self.status(run_id)["child_pid"]
        self.assertEqual(self.status(run_id)["directive_count"], 0)
        self.assertFalse(self.api_log.exists())
        self.assertEqual(self.call("interrupt", run_id).stdout, f"id={run_id} status=interrupted\n")
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                break
            time.sleep(.01)
        else:
            self.fail("Claude process was not terminated")
        meta = self.status(run_id)
        self.assertEqual((meta["status"], meta["exit_code"]), ("interrupted", 130))
        self.assertNotIn("child_pid", meta)
        while not meta["transcript_path"] and time.monotonic() < deadline:
            time.sleep(.01)
            meta = self.status(run_id)
        self.assertTrue(meta["transcript_path"], "interrupted transcript was not published")
        self.assertTrue(Path(meta["transcript_path"]).is_file())
        self.assertEqual(self.call("wait", run_id, "--timeout", "4").returncode, 0)
        self.assertIn("claude interruption diagnostic", (self.root / run_id / "stderr.log").read_text())

    def test_claude_json_error_and_malformed_output_fail(self):
        for mode, error in (("fail", True), ("malformed", None)):
            with self.subTest(mode=mode):
                proc = self.call("run", "--role", "panel", "--model", "claude:haiku",
                                 "--message", "go", mode=mode)
                run_id = self.run_id(proc, code=1)
                meta = self.status(run_id)
                self.assertEqual((meta["status"], meta["is_error"]), ("failed", error))
                if error:
                    self.assertEqual(meta["total_cost_usd"], 0.0123)
                    self.assertTrue(proc.stdout.endswith("fake Claude error"))
                else:
                    self.assertNotIn("not JSON", proc.stdout)
                    self.assertIn("bstack-run:", (self.root / run_id / "stderr.log").read_text())

    def test_claude_missing_transcript_is_null_without_success_log(self):
        run_id = self.run_id(self.call("run", "--role", "panel", "--model", "claude:haiku",
                                       "--message", "go", mode="no-transcript"))
        meta = self.status(run_id)
        self.assertIsNone(meta["transcript_path"])
        self.assertFalse((self.root / run_id / "stderr.log").exists())

    def test_denied_model_is_not_run(self):
        denied = self.call("run", "--role", "impl", "--model", "provider/TeRRa-test",
                           "--message", "do not run")
        self.assertEqual(denied.returncode, 2)
        self.assertEqual(denied.stdout, "")
        self.assertIn("denied model", denied.stderr)
        self.assertFalse(self.root.exists())

    def assert_speed(self, run_id, base, model, fast):
        meta = self.status(run_id)
        self.assertEqual((meta["base_model"], meta["model"]), (base, model))
        self.assertIs(meta["fast"], fast)
        return meta

    def test_fast_uses_explicit_mapping_and_preserves_variant(self):
        for role, override, base, model in (
            ("explore", "openai/gpt-6-luna", "openai/gpt-6-luna", "openai/gpt-6-luna-fast"),
            ("hard", None, "openai/gpt-6.2-astra", "openai/gpt-6.2-astra-fast"),
            ("explore", "openai/gpt-6.2-sol#high",
             "openai/gpt-6.2-sol#high", "openai/gpt-6.2-sol-fast#high"),
        ):
            with self.subTest(role=role, override=override):
                args = ["--model", override] if override else []
                proc = self.call("run", "--role", role, "--fast", "--message", "hello", *args)
                run_id = self.run_id(proc)
                self.assert_speed(run_id, base, model, True)
                self.assertEqual(self.worker_argv(run_id)[:3], ["run", "-m", model])
                self.assertIn(f"model={model} session=ses_fake fast=true\n", proc.stdout)
                status_line = next(line for line in self.call("status").stdout.splitlines()
                                   if line.startswith(f"id={run_id} "))
                self.assertTrue(status_line.endswith(" fast=true"), status_line)

    def test_fast_unmapped_model_warns_and_keeps_original_model(self):
        for model in ("zai-coding-plan/glm-5.3", "other/custom#high", "claude:sonnet"):
            with self.subTest(model=model):
                proc = self.call("run", "--role", "panel", "--fast", "--model", model,
                                 "--message", "hello")
                run_id = self.run_id(proc, stderr=(
                    f"bstack-run: warning: no fast mapping for {model!r}; using it unchanged\n"
                ))
                self.assert_speed(run_id, model, model, False)
                if model.startswith("claude:"):
                    argv = self.claude_input(run_id)["argv"]
                    self.assertEqual(argv[:3], ["-p", "--model", "sonnet"])
                    self.assertNotIn("--settings", argv)
                else:
                    self.assertEqual(self.worker_argv(run_id)[:3], ["run", "-m", model])

    def test_fast_is_a_quiet_noop_for_already_fast_models(self):
        for args, model in (
            ([], "openai/gpt-6-luna-fast"),
            (["--model", "openai/gpt-6-luna-fast#high"], "openai/gpt-6-luna-fast#high"),
            (["--model", "openai/gpt-6.2-sol-fast"], "openai/gpt-6.2-sol-fast"),
        ):
            with self.subTest(model=model):
                run_id = self.run_id(self.call("run", "--role", "explore", "--fast",
                                               "--message", "hello", *args))
                self.assert_speed(run_id, model, model, False)
                self.assertEqual(self.worker_argv(run_id)[:3], ["run", "-m", model])

    def test_fast_env_controls_mapping_for_explicit_model(self):
        base, fast = "openai/gpt-6-luna", "openai/gpt-6-luna-fast"
        for env, expected in (("1", fast), ("0", base), ("true", base)):
            with self.subTest(env=env):
                self.env["BSTACK_FAST"] = env
                run_id = self.run_id(self.call("run", "--role", "explore", "--model", base,
                                               "--message", "hello"))
                self.assert_speed(run_id, base, expected, expected != base)
                self.assertEqual(self.worker_argv(run_id)[:3], ["run", "-m", expected])

    def test_fast_denies_original_or_mapped_model_before_launch(self):
        self.config["fast"].update({"provider/safe": "provider/FaBlE", "provider/terra": "provider/safe"})
        self.write_config()
        for base, denied in (("provider/safe#high", "provider/FaBlE#high"),
                             ("provider/terra", "provider/terra")):
            with self.subTest(base=base):
                proc = self.call("run", "--role", "impl", "--fast", "--model", base,
                                 "--message", "do not run", "--bg")
                self.assertEqual((proc.returncode, proc.stdout), (2, ""))
                self.assertEqual(proc.stderr, f"bstack-run: denied model: {denied}\n")
                self.assertFalse(self.root.exists())

    def test_role_resolution_and_foreground_output(self):
        for role, model, template in [
            ("impl", "openai/gpt-6.2-sol", "impl"),
            ("hard", "openai/gpt-6.2-astra", "impl"),
            ("explore", "openai/gpt-6-luna-fast", "explore"),
            ("panel", "openai/gpt-6.2-sol", None),
        ]:
            with self.subTest(role=role):
                proc = self.call("run", "--role", role, "--message", "hello", "--title", "My task")
                run_id = self.run_id(proc)
                self.assertEqual(proc.stdout, f"id={run_id} status=done model={model} "
                                              "session=ses_fake fast=false\nfake answer")
                meta = self.status(run_id)
                self.assertEqual((meta["role"], meta["model"], meta["cli"]),
                                 (role, model, str(self.fake)))
                self.assertEqual(meta["export_cmd"], f"'{self.fake}' session export ses_fake")
                self.assertNotIn("allowed_tools", meta)
                self.assertEqual(self.worker_argv(run_id), [
                    "run", "-m", model, "--auto", "--format", "json", "--title", "My task",
                ])
                preamble = self.assert_preamble(run_id, template, meta)
                self.assertEqual(self.worker_input(run_id)["brief"],
                                 preamble + "\n\nhello" if template else "hello")
                directory = self.root / run_id
                files = {"brief.md", "meta.json", "result.md"}
                self.assertEqual({path.name for path in directory.iterdir()}, files)
                self.assertEqual((directory / "brief.md").read_bytes(), b"hello")
                self.assertEqual((directory / "result.md").read_text(), "fake answer")
        proc = self.call("run", "--role", "panel", "--model", "zai-coding-plan/glm-5.3",
                         "--message", "hello", "--worktree=my-panel")
        run_id = self.run_id(proc)
        self.assertEqual(self.status(run_id)["model"], "zai-coding-plan/glm-5.3")
        self.assertEqual(self.worker_argv(run_id)[-1], "--worktree=my-panel")

    def test_no_preamble_marker_is_exact_and_not_sent_to_either_backend(self):
        text = "Custom review 🌱\r\n"
        file = self.cwd / "review brief.md"
        file.write_bytes(("NO-PREAMBLE\r\n" + text).encode("utf-8"))
        for model in ("provider/custom", "claude:haiku"):
            with self.subTest(model=model):
                run_id = self.run_id(self.call("run", "--role", "impl", "--model", model,
                                               "--brief", str(file)))
                self.assert_preamble(run_id, None)
                read_input = self.claude_input if model.startswith("claude:") else self.worker_input
                payload = read_input(run_id)
                self.assertNotIn("--append-system-prompt", payload["argv"])
                self.assertEqual(payload["brief"], text)
                self.assertEqual((self.root / run_id / "brief.md").read_bytes(), file.read_bytes())
        for brief in ("NO-PREAMBLE \ntext", "\nNO-PREAMBLE\ntext", "NO-PREAMBLE extra\ntext"):
            with self.subTest(brief=brief):
                run_id = self.run_id(self.call("run", "--role", "explore", "--message", brief))
                preamble = self.assert_preamble(run_id, "explore")
                self.assertEqual(self.worker_input(run_id)["brief"], preamble + "\n\n" + brief)

    def test_preamble_mapping_can_override_or_omit_a_role(self):
        self.config["preamble"]["impl"] = self.config["preamble"]["explore"]
        del self.config["preamble"]["hard"]
        self.write_config()
        for role, template in (("impl", "explore"), ("hard", None)):
            with self.subTest(role=role):
                run_id = self.run_id(self.call("run", "--role", role, "--message", "go"))
                preamble = self.assert_preamble(run_id, template)
                self.assertEqual(self.worker_input(run_id)["brief"],
                                 preamble + "\n\ngo" if template else "go")

    def test_ask_can_opt_out_without_changing_parent_or_directive(self):
        parent = self.run_id(self.call("run", "--role", "explore", "--message", "start"))
        brief = "NO-PREAMBLE\ncustom follow-up"
        child = self.run_id(self.call("ask", parent, "--brief", "-", stdin=brief))
        self.assert_preamble(child, None)
        self.assert_preamble(parent, "explore")
        self.assertEqual(self.worker_input(child)["brief"], "custom follow-up")
        self.assertIn(brief, self.call("brief-bundle", parent).stdout)

    def test_truncation_only_applies_to_foreground_run(self):
        proc = self.call("run", "--role", "impl", "--message", "large response", mode="long")
        run_id = self.run_id(proc)
        path = self.root / run_id / "result.md"
        self.assertEqual(proc.stdout.split("\n", 1)[1],
                         "🍀" * 6000 + f"\n…(truncated, use bstack-run result {run_id})\n")
        self.assertEqual(path.read_text(encoding="utf-8"), "🍀" * 6100)
        self.assertEqual(self.call("result", run_id).stdout, "🍀" * 6100 + "\n")

    def test_background_running_result_wait_and_status(self):
        proc = self.call("run", "--role", "explore", "--worktree", "--brief", "-", "--bg",
                         stdin="brief from stdin\n", mode="gate")
        run_id = self.run_id(proc)

        def release_worker():
            self.gate.touch()
            self.call("wait", run_id, "--timeout", "4")

        self.addCleanup(release_worker)
        self.assertEqual(proc.stdout, f"id={run_id}\n")
        self.await_session(run_id)
        meta = self.status(run_id)
        self.assertEqual(meta["status"], "running")
        self.assertIsNone(meta["ended_at"])
        self.assertEqual({p.name for p in (self.root / run_id).iterdir()},
                         {"brief.md", "meta.json"})
        for command in [("result", run_id), ("wait", run_id, "--timeout", "0")]:
            running = self.call(*command)
            self.assertEqual((running.returncode, running.stdout, running.stderr),
                             (3, "status=running\n", ""))

        self.gate.touch()
        done = self.call("wait", run_id, "--timeout", "4")
        self.assertEqual((done.returncode, done.stdout, done.stderr), (0, "fake answer\n", ""))
        meta = self.status(run_id)
        self.assertEqual((meta["status"], meta["exit_code"], meta["session_id"]),
                         ("done", 0, "ses_fake"))
        self.assertIsNotNone(meta["ended_at"])
        self.assertEqual(self.worker_argv(run_id)[-1], "--worktree")
        self.assertEqual(self.worker_input(run_id)["brief"],
                         self.assert_preamble(run_id, "explore", meta) + "\n\nbrief from stdin\n")
        self.assertEqual((self.root / run_id / "brief.md").read_bytes(), b"brief from stdin\n")
        self.assertRegex(self.call("status").stdout,
                         rf'^id={run_id} status=done model=openai/gpt-6-luna-fast '
                         r'title="bstack explore" elapsed=\d+s fast=false\n$')
        self.assert_speed(run_id, "openai/gpt-6-luna-fast", "openai/gpt-6-luna-fast", False)

    def test_ask_uses_parent_session_model_and_role(self):
        parent = self.run_id(self.call("run", "--role", "hard", "--model", "provider/custom",
                                       "--message", "start"))
        brief = self.cwd / "follow up.md"
        brief.write_bytes(b"follow up\r\n")
        child = self.run_id(self.call("ask", parent, "--brief", str(brief), mode="multipart"))
        self.assertNotEqual(parent, child)
        meta = self.status(child)
        self.assertEqual((meta["parent_id"], meta["role"], meta["model"], meta["session_id"]),
                         (parent, "hard", "provider/custom", "ses_fake"))
        self.assertEqual(self.worker_argv(child)[:5], ["run", "-s", "ses_fake", "-m", "provider/custom"])
        self.assertEqual(self.worker_input(child)["brief"],
                         self.assert_preamble(child, "impl", meta) + "\n\nfollow up\r\n")
        self.assertEqual((self.root / child / "brief.md").read_bytes(), b"follow up\r\n")
        self.assertEqual(self.call("result", child).stdout, "fake answer\n\nsecond part\n")
        self.assertEqual(self.status(parent)["directive_count"], 1)
        self.assertEqual(self.status(child)["directive_count"], 0)
        directives = json.loads((self.root / parent / "meta.json").read_bytes())["directives"]
        self.assertEqual(directives[0]["run_id"], child)
        self.assertNotIn("text", directives[0])

    def test_killed_foreground_ask_is_orphaned_even_during_new_ask(self):
        parent = self.run_id(self.call("run", "--role", "impl", "--message", "start"))
        fixture = self.fixtures / "abandoned.json"
        with subprocess.Popen(
            [str(self.bstack), "ask", parent, "--message", "abandoned"],
            cwd=self.cwd, env=dict(self.env, FAKE_MODE="gate", FAKE_INPUT_RECORD=str(fixture)),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        ) as launcher:
            try:
                deadline = time.monotonic() + 4
                while time.monotonic() < deadline:
                    paths = [p for p in self.root.glob("*/meta.json") if p.parent.name != parent]
                    if paths and fixture.is_file():
                        break
                    time.sleep(.01)
                else:
                    self.fail("foreground ask did not start its backend")
                record = paths[0]
                abandoned = record.parent.name
                self.await_session(abandoned)
                running = self.status(abandoned)
                self.assertEqual(running["status"], "running")
                self.assertNotIn("child_pid", running)  # OpenCode regression.
                launcher.kill()
                launcher.communicate(timeout=4)
                original = record.read_bytes()
                self.assertEqual(json.loads(original)["status"], "running")

                # Start another ask on the abandoned ask's own session.
                next_run = self.run_id(self.call("ask", abandoned, "--message", "continue",
                                                "--bg", mode="gate"))
                self.addCleanup(self.release_worker, next_run)
                current = self.status(next_run)
                self.assertEqual((current["status"], current["session_id"]), ("running", "ses_fake"))
                stale = self.status(abandoned)
                self.assertEqual((stale["status"], stale["exit_code"]), ("orphaned", None))
                self.assertIn(f"id={abandoned} status=orphaned ", self.call("status").stdout)
                for command in ("result", "wait"):
                    proc = self.call(command, abandoned)
                    self.assertEqual((proc.returncode, proc.stdout, proc.stderr),
                                     (3, "status=orphaned\n", ""))
                self.assertEqual(self.call("interrupt", abandoned).returncode, 4)
                self.assertFalse(self.api_log.exists())
                updated = json.loads(record.read_bytes())
                self.assertEqual(updated.pop("directives")[0]["run_id"], next_run)
                self.assertEqual(updated, json.loads(original))
                completed = self.release_worker(next_run)
                self.assertEqual((completed.returncode, completed.stdout), (0, "fake answer\n"))
                self.assertEqual(self.status(next_run)["status"], "done")
                self.assertEqual(self.status(abandoned)["status"], "orphaned")
            finally:
                self.gate.touch()
                if launcher.poll() is None:
                    launcher.kill()
                    launcher.communicate(timeout=4)

    def test_legacy_running_record_without_owner_does_not_wait_forever(self):
        run_id = self.run_id(self.call("run", "--role", "explore", "--message", "legacy"))
        record = self.root / run_id / "meta.json"
        meta = json.loads(record.read_bytes())
        del meta["launcher_lock"]
        meta.update(status="running", exit_code=None, ended_at=None)
        original = json.dumps(meta).encode()
        record.write_bytes(original)
        value = self.status(run_id)
        self.assertEqual((value["status"], value["exit_code"]), ("orphaned", None))
        proc = self.call("wait", run_id)
        self.assertEqual((proc.returncode, proc.stdout), (3, "status=orphaned\n"))
        self.assertEqual(record.read_bytes(), original)

    def test_legacy_claude_supervisor_lock_still_proves_ownership(self):
        run_id = self.run_id(self.call("run", "--role", "impl", "--model", "claude:haiku",
                                       "--message", "legacy"))
        directory = self.root / run_id
        record = directory / "meta.json"
        meta = json.loads(record.read_bytes())
        del meta["launcher_lock"]
        meta.update(status="running", exit_code=None, ended_at=None)
        record.write_text(json.dumps(meta), encoding="utf-8")
        with (directory / "raw.jsonl").open("xb") as owner:
            fcntl.flock(owner, fcntl.LOCK_EX)
            self.assertEqual(self.status(run_id)["status"], "running")
        self.assertEqual(self.status(run_id)["status"], "orphaned")

    def test_ask_inherits_parent_speed_unless_fast_is_requested(self):
        base = "openai/gpt-6.2-sol#high"
        fast = "openai/gpt-6.2-sol-fast#high"
        parent = self.run_id(self.call("run", "--role", "impl", "--model", base,
                                       "--message", "start"))
        self.env["BSTACK_FAST"] = "1"
        normal = self.run_id(self.call("ask", parent, "--message", "same model"))
        self.assert_speed(normal, base, base, False)
        switched = self.run_id(self.call("ask", parent, "--fast", "--message", "go fast"))
        self.assert_speed(switched, base, fast, True)
        self.assertEqual(self.worker_argv(switched)[:5], ["run", "-s", "ses_fake", "-m", fast])
        self.assert_speed(parent, base, base, False)
        self.env.pop("BSTACK_FAST")
        for options in ([], ["--fast"]):
            inherited = self.run_id(self.call("ask", switched, "--message", "keep fast", *options))
            self.assert_speed(inherited, base, fast, True)
            self.assertEqual(self.worker_argv(inherited)[:5], ["run", "-s", "ses_fake", "-m", fast])

    def test_ask_keeps_explore_default_with_or_without_fast_flag(self):
        model = "openai/gpt-6-luna-fast"
        parent = self.run_id(self.call("run", "--role", "explore", "--message", "start"))
        for options in ([], ["--fast"]):
            with self.subTest(options=options):
                child = self.run_id(self.call("ask", parent, "--message", "continue", *options))
                self.assert_speed(child, model, model, False)
                self.assertEqual(self.worker_argv(child)[:5], ["run", "-s", "ses_fake", "-m", model])

    def test_steer_and_queue_use_original_cli_and_send_exact_payloads(self):
        run_id = self.gated_run()
        self.env["BSTACK_CLI"] = str(self.cwd / "missing CLI")
        text = '첫 지시 "quoted"\n🌱'
        for kind, body in [("steer", text), ("queue", "second\r\nline\n")]:
            proc = self.call(kind, run_id, "--brief", "-", stdin=body)
            self.assertEqual((proc.returncode, proc.stdout, proc.stderr),
                             (0, f"id={run_id} delivery={kind} message_id=msg_fake\n", ""))
        calls = self.api_calls()
        self.assertEqual(len(calls), 2)
        saved = json.loads((self.root / run_id / "meta.json").read_bytes())["directives"]
        for index, (call, kind, body) in enumerate(zip(
                calls, ("steer", "queue"), (text, "second\r\nline\n")), 1):
            self.assertEqual(call["cwd"], str(self.cwd))
            argv = call["argv"]
            self.assertEqual(argv[:-1], ["api", "session.prompt", "--param", "sessionID=ses_fake", "-d"])
            self.assertEqual(json.loads(argv[-1]), {"text": body, "delivery": kind})
            record = saved[index - 1]
            self.assertEqual((record["kind"], record["text"]), (kind, body))
            self.assertRegex(record["time"], r"^\d{4}-\d\d-\d\dT.+\+00:00$")
        self.assertEqual(self.status(run_id)["directive_count"], 2)
        self.assertNotIn("directives", self.status(run_id))

    def test_completed_run_refuses_steer_and_queue(self):
        run_id = self.run_id(self.call("run", "--role", "explore", "--message", "start"))
        for kind in ("steer", "queue"):
            proc = self.call(kind, run_id, "--message", "too late")
            self.assertEqual((proc.returncode, proc.stdout), (4, ""))
            self.assertIn(f"use ask {run_id}", proc.stderr)
        self.assertFalse(self.api_log.exists())
        self.assertEqual(self.status(run_id)["directive_count"], 0)

    def test_api_failure_does_not_record_directive_or_interrupt(self):
        run_id = self.gated_run()
        failed = self.call("steer", run_id, "--message", "not sent", mode="api-fail")
        self.assertEqual(failed.returncode, 2)
        self.assertIn("fake API error", failed.stderr)
        failed = self.call("interrupt", run_id, mode="not-interrupted")
        self.assertEqual(failed.returncode, 2)
        self.assertIn("was not interrupted", failed.stderr)
        meta = self.status(run_id)
        self.assertEqual((meta["status"], meta["directive_count"]), ("running", 0))

    def test_interrupt_status_survives_worker_exit(self):
        with subprocess.Popen(
            [str(self.bstack), "run", "--role", "explore", "--message", "start"], cwd=self.cwd,
            env=dict(self.env, FAKE_MODE="gate"), stdout=subprocess.PIPE, text=True,
        ) as worker:
            try:
                deadline = time.monotonic() + 4
                paths = []
                while not paths and time.monotonic() < deadline:
                    paths = list(self.root.glob("*/meta.json"))
                    if not paths:
                        time.sleep(.01)
                self.assertEqual(len(paths), 1)
                run_id = paths[0].parent.name
                self.await_session(run_id)
                proc = self.call("interrupt", run_id)
                self.assertEqual((proc.returncode, proc.stdout, proc.stderr),
                                 (0, f"id={run_id} status=interrupted\n", ""))
                self.assertEqual(self.api_calls()[0]["argv"],
                                 ["api", "session.interrupt", "--param", "sessionID=ses_fake"])
                stdout, _ = worker.communicate(timeout=5)
                self.assertEqual(worker.returncode, 130)
                self.assertIn(" status=interrupted ", stdout)
                meta = self.status(run_id)
                self.assertEqual((meta["status"], meta["exit_code"]), ("interrupted", 130))
                self.assertIsNotNone(meta["ended_at"])
            finally:
                self.gate.touch()

    def test_brief_bundle_keeps_numeric_delivery_order_and_last_answer(self):
        run_id = self.gated_run()
        pending = self.call("brief-bundle", run_id)
        self.assertEqual(pending.returncode, 0, pending.stderr)
        self.assertIn("(No result yet.)", pending.stdout)
        with ThreadPoolExecutor(max_workers=5) as pool:
            for proc in pool.map(lambda i: self.call("queue", run_id, "--message", f"item {i}"),
                                 range(10)):
                self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.release_worker(run_id).returncode, 0)
        self.run_id(self.call("ask", run_id, "--message", "follow up", mode="multipart"))
        self.assertEqual(self.status(run_id)["directive_count"], 11)
        bundle = self.call("brief-bundle", run_id)
        self.assertEqual((bundle.returncode, bundle.stderr), (0, ""))
        self.assertIn("## Original brief\n\nstart", bundle.stdout)
        self.assertEqual(re.findall(r"^### Directive (\d+): (\w+)$", bundle.stdout, re.M),
                         [(str(i), "queue") for i in range(1, 11)] + [("11", "ask")])
        self.assertEqual(re.findall(r"^item \d+$", bundle.stdout, re.M),
                         [json.loads(call["argv"][-1])["text"] for call in self.api_calls()])
        self.assertIn("follow up\n\n## Last result\n\nfake answer\n\nsecond part\n", bundle.stdout)
        self.assertNotIn("NOT THE FINAL ANSWER", bundle.stdout)

    def test_wait_and_result_terminate_nonempty_output_without_changing_artifact(self):
        run_id = self.run_id(self.call("run", "--role", "impl", "--message", "newline check"))
        artifact = self.root / run_id / "result.md"
        for stored, shown in (("x" * 8192, "x" * 8192 + "\n"),
                              ("already terminated\n\n", "already terminated\n\n"),
                              ("", "")):
            with self.subTest(stored_length=len(stored)):
                artifact.write_bytes(stored.encode("utf-8"))
                for command in ("wait", "result"):
                    proc = self.call(command, run_id)
                    self.assertEqual((proc.returncode, proc.stdout), (0, shown))
                self.assertEqual(artifact.read_bytes(), stored.encode("utf-8"))

    def test_failure_preserves_worker_exit_code_and_omits_tool_preamble(self):
        proc = self.call("run", "--role", "impl", "--message", "fail", mode="fail")
        run_id = self.run_id(proc, code=17)
        self.assertEqual(proc.stdout, f"id={run_id} status=failed model=openai/gpt-6.2-sol "
                                      "session=ses_fake fast=false\n")
        meta = self.status(run_id)
        self.assertEqual((meta["status"], meta["exit_code"]), ("failed", 17))
        self.assertNotIn("NOT THE FINAL ANSWER", self.call("result", run_id).stdout)
        log = (self.root / run_id / "stderr.log").read_bytes()
        for stream in (b"stdout", b"stderr"):
            self.assertNotIn(stream + b" marker 0\n", log)
            self.assertIn(stream + b" marker 249\n", log)
        self.assertIn(b"stderr final", log)
        self.assertLess(len(log), 401 * 1024)

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_git_root_stores_run_but_cli_keeps_invocation_cwd(self):
        subprocess.run(["git", "init", "-q"], cwd=self.cwd, check=True, capture_output=True)
        repo = self.cwd
        self.cwd /= "nested"
        self.cwd.mkdir()
        (repo / ".bstack/jot").mkdir(parents=True)
        run_id = self.run_id(self.call("run", "--role", "impl", "--brief", "-",
                                       stdin="in repo\n"))
        directory = self.root / run_id
        self.assertEqual(self.status(run_id)["run_dir"], str(directory))
        self.assertEqual({p.name for p in directory.iterdir()},
                         {"brief.md", "meta.json", "result.md"})
        self.assertEqual(list((repo / ".bstack").iterdir()), [repo / ".bstack/jot"])
        self.assertFalse(list(self.base.rglob("raw.jsonl")))
        self.assertFalse((self.cwd / ".bstack").exists())
        self.assertEqual(self.status(run_id)["cwd"], str(self.cwd.resolve()))

    @unittest.skipUnless(shutil.which("git"), "git not installed")
    def test_plugin_state_is_shared_by_linked_worktree_and_scoped_per_repo(self):
        repo = self.cwd

        def git(*args):
            subprocess.run(["git", *args], cwd=self.cwd, check=True, capture_output=True)

        git("init", "-q")
        git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.org",
            "commit", "-qm", "fixture", "--allow-empty")
        other = self.base / "linked"
        git("worktree", "add", "--detach", str(other))
        a = self.run_id(self.call("run", "--role", "impl", "--message", "main"))
        self.cwd = other
        self.assertEqual(self.call("result", a).stdout, "fake answer\n")
        b = self.run_id(self.call("ask", a, "--message", "linked"))
        self.assertEqual(self.status(b)["run_dir"], str(self.root / b))
        self.cwd = repo
        self.assertEqual(self.status(a)["run_dir"], str(self.root / a))
        self.assertEqual(self.status(b)["cwd"], str(other))
        self.cwd = self.base / "other" / repo.name
        self.cwd.mkdir(parents=True)
        git("init", "-q")
        self.assertEqual(self.call("status", a).returncode, 2)

    def test_run_records_live_under_the_plugin_copy(self):
        run_id = self.run_id(self.call("run", "--role", "impl", "--message", "test"))
        key = hashlib.sha256(os.fsencode(self.cwd)).hexdigest()[:12]
        directory = self.plugin / f"state/runs/{self.cwd.name}-{key}/{run_id}"
        self.assertEqual(self.status(run_id)["run_dir"], str(directory))
        self.assertEqual({path.name for path in directory.iterdir()},
                         {"brief.md", "meta.json", "result.md"})


if __name__ == "__main__":
    unittest.main()
