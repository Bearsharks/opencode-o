"""Pass/fail tests with fake launcher records; no model calls or receipts."""

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import fixture
import turn

SPEC = importlib.util.spec_from_file_location("checker", Path(__file__).with_name("check-case.py"))
checker = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(checker)
IDS = ["20261121-000001-panel-aaaa", "20261121-000010-panel-bbbb", "20261121-000020-panel-cccc"]
WRITERS = ["20261121-000002-impl-aaaa", "20261121-000011-impl-bbbb", "20261121-000021-impl-cccc"]
REVIEWS = ["20261121-000003-panel-dddd", "20261121-000012-panel-eeee", "20261121-000022-panel-ffff"]
SLASH = Path(__file__).parent / "fixtures/mode-negative-slash.jsonl"


class Behavior(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory(prefix="bstack-behavior-test-")
        self.addCleanup(scratch.cleanup)
        self.scratch = Path(scratch.name)
        self.addCleanup(os.chdir, Path.cwd())

    def setup_case(self, name):
        self.case = name
        with patch.object(fixture, "SCRATCH", self.scratch):
            self.root = fixture.prepare(name)
        os.chdir(self.root)
        self.plugin = self.root / turn.PLUGIN
        self.prd = self.root / ".bstack" / name
        self.trace = fixture.state_dir(self.root) / "fake.jsonl"
        self.trace.touch()
        self.assertFalse((self.plugin / "tests").exists())
        self.assertFalse((self.root / ".bstack").exists())

    def row(self, kind, block):
        row = {"type": kind, "sessionId": "main",
               "message": {"role": kind, "content": block if isinstance(block, str) else [block]}}
        with self.trace.open("a", encoding="utf-8") as fd:
            fd.write(json.dumps(row, ensure_ascii=False) + "\n")

    def tool(self, name, output="", error=False, **inputs):
        key = str(self.trace.stat().st_size)
        self.row("assistant", {"type": "tool_use", "name": name, "input": inputs, "id": key})
        self.row("user", {"type": "tool_result", "content": output, "is_error": error, "tool_use_id": key})

    def read(self, path, error=False):
        self.tool("Read", "file", error, file_path=str(self.plugin / "skills" / path))

    def metadata(self, key, brief, *, role="panel", session="main", parent=None, model="fake", clock=1):
        folder = turn.runs_dir() / key
        folder.mkdir(parents=True)
        (folder / "brief.md").write_bytes(brief)
        turn.put_json(folder / "meta.json", {
            "id": key, "role": role, "session_id": session, "parent_id": parent, "status": "done",
            "exit_code": 0, "model": model, "cwd": str(self.root), "transcript_path": str(self.trace),
            "plugin_dir": str(self.plugin),
            "started_at": f"2026-11-21T00:00:{clock:02}+00:00",
            "ended_at": f"2026-11-21T00:00:{clock + 1:02}+00:00",
        })

    def fake(self, i=0, *, error_read=False, early_playbook=False, early_review=False,
             review_mismatch=False, shared_session=False, unquoted=False, rewrite_prefix=False,
             change_product=False, no_fix=False, notes="임의 문구 — 자동 판정하지 않는다.", no_author=False):
        key, label, phase = IDS[i], checker.LABELS[i], checker.PHASES[self.case][i]
        cli = str(self.plugin / "bin/bstack-run")
        argv = ([cli, "ask", IDS[i - 1], "--brief", "-"] if i else
                [cli, "run", "--role", "panel", "--model", "claude:" + fixture.MODELS[self.case],
                 "--plugin-dir", str(self.plugin), "--brief", "-"])
        status = {"state": "draft", "index": str(self.prd / "index.md"), "hash": "opaque-cli-value",
                  "revise_count": 0, "revise_records": [], "detail": "opaque comment"}
        status_code = 1

        def record(folder, step, args, brief=None):
            nonlocal status, status_code
            if step == "run":
                self.assertEqual(args[-2:], ["--brief", "-"])
                if i:
                    parent = turn.meta(IDS[i - 1])
                    parent["directives"] = [{"kind": "ask", "run_id": key}]
                    turn.put_json(turn.runs_dir() / IDS[i - 1] / "meta.json", parent)
                self.metadata(key, brief, parent=IDS[i - 1] if i else None,
                              model="claude:" + fixture.MODELS[self.case])
                if not i and self.case.startswith("mode-"):
                    self.row("user", json.loads(SLASH.read_bytes())["message"]["content"])
                if early_playbook:
                    self.read("bstack-mode/playbooks/feature.md")
                if not i and phase != "typo":
                    self.read("bstack-clarify/SKILL.md", error_read)

                if phase == "typo":
                    if not no_fix:
                        Path("labels.txt").write_bytes(b"Welcome\n")
                    status_code, status = 3, {"detail": "no PRD"}
                else:
                    self.prd.mkdir(parents=True, exist_ok=True)
                    request = self.prd / "request.md"
                    index = self.prd / "index.md"
                    prefix = request.read_bytes() if i else b"# Original\n\n"
                    if rewrite_prefix:
                        prefix = b"# Rewritten history\n\n" + prefix
                    quoted = b"".join(b"> " + line for line in brief.splitlines(keepends=True))
                    request.write_bytes(prefix + b"\n## Updated\n\n" + (brief if unquoted else quoted))
                    self.tool("Bash", json.dumps({"path": str(self.prd)}), command="irrelevant command")
                    if not i:
                        index.write_bytes((turn.REFS / "template/index.md").read_bytes())
                    if phase != "initial" and (phase == "candidate" or not i or self.case == "resume"):
                        if not no_author:
                            self.metadata(WRITERS[i], str(self.prd).encode(), role="impl", session="writer", clock=2)
                            self.tool("Bash", f"id={WRITERS[i]} status=done\n", command="delegation")
                        index.write_bytes(f"# PRD body {i}\n".encode())
                    if phase == "approved" or early_review:
                        self.metadata(REVIEWS[i], b"review", session="writer" if shared_session else "review", clock=5)
                        self.tool("Bash", json.dumps({"verdict": "READY", "run_id": REVIEWS[i],
                                                      "hash": status["hash"]}), command="review")
                        if phase == "approved":
                            status_code = 0
                            status.update(state="approved", run_id=REVIEWS[0] if review_mismatch else REVIEWS[i])
                if change_product:
                    Path("new-code.py").write_text("product mutation")
                code, stdout = 0, f"id={key} status=done\n".encode()
            elif step == "status":
                self.assertEqual(args[-2:], ["status", self.case])
                code, stdout = status_code, json.dumps(status).encode()
            else:
                code, stdout = 0, notes.encode()
            turn.put_json(folder / f"{step}.exit", code)
            (folder / f"{step}.stdout").write_bytes(stdout)
            return subprocess.CompletedProcess(args, code, stdout, b"")

        with patch.object(turn, "record", record), contextlib.redirect_stdout(io.TextIOWrapper(io.BytesIO())):
            self.assertEqual(turn.capture(self.case, label, "0.1", argv), 0)

    def check(self, count=1):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            checkpoint = checker.check(self.case, IDS[:count], self.root)
        return checkpoint, output.getvalue()

    def test_clear_writes_candidate_and_waits_then_uses_prior_author(self):
        self.setup_case("clear")
        self.fake(notes="후보의 확인 단계 원문")
        checkpoint, output = self.check()
        self.assertIn("candidate", checkpoint)
        self.assertIn("후보의 확인 단계 원문", output)
        self.fake(1)
        self.assertEqual(self.check(2)[0], "approved")

    def test_clear_cannot_review_before_confirmation_even_if_draft(self):
        self.setup_case("clear")
        self.fake(early_review=True)
        with self.assertRaisesRegex(ValueError, "without review"):
            self.check()

    def test_clear_auto_approves_without_receipts(self):
        self.setup_case("clear-auto")
        self.fake()
        self.assertEqual(self.check()[0], "approved")
        self.assertFalse((self.prd / "reviews").exists())

    def test_review_must_be_independent(self):
        self.setup_case("clear-auto")
        self.fake(shared_session=True)
        with self.assertRaisesRegex(ValueError, "independent session"):
            self.check()

    def test_review_needs_an_attributable_author(self):
        self.setup_case("clear-auto")
        self.fake(no_author=True)
        with self.assertRaisesRegex(ValueError, "no attributable"):
            self.check()

    def test_resume_rejects_stale_status_id(self):
        self.setup_case("resume")
        self.fake()
        self.fake(1, review_mismatch=True)
        with self.assertRaisesRegex(ValueError, "fresh completed READY"):
            self.check(2)

    def test_resume_retains_original_and_accepts_fresh_review(self):
        self.setup_case("resume")
        self.fake()
        self.fake(1)
        self.assertEqual(self.check(2)[0], "approved")

    def test_question_has_separate_decision_and_confirmation(self):
        self.setup_case("question")
        for i, expected in enumerate(("initial", "candidate", "approved")):
            self.fake(i)
            self.assertTrue(self.check(i + 1)[0].startswith(expected))

    def test_question_does_not_accept_unquoted_answer(self):
        self.setup_case("question")
        self.fake()
        self.fake(1, unquoted=True)
        with self.assertRaisesRegex(ValueError, "exact user answer"):
            self.check(2)

    def test_question_preserves_byte_prefix(self):
        self.setup_case("question")
        self.fake()
        self.fake(1, rewrite_prefix=True)
        with self.assertRaisesRegex(ValueError, "append-only"):
            self.check(2)

    def test_quote_comparison_requires_contiguous_lines_and_exact_bytes(self):
        self.assertTrue(checker.preserves(b"> first\n> \n> last  \n", b"first\n\nlast  \n"))
        self.assertFalse(checker.preserves(b"> first\n\n> last  \n", b"first\nlast  \n"))
        self.assertFalse(checker.preserves(b"> last\n", b"last  \n"))

    def test_mode_positive_actual_gate_read(self):
        self.setup_case("mode-positive")
        self.fake()
        self.assertIn("initial", self.check()[0])

    def test_mode_positive_failed_read_does_not_count(self):
        self.setup_case("mode-positive")
        self.fake(error_read=True)
        with self.assertRaisesRegex(ValueError, "clarify gate"):
            self.check()

    def test_mode_positive_cannot_route_before_approval(self):
        self.setup_case("mode-positive")
        self.fake(early_playbook=True)
        with self.assertRaisesRegex(ValueError, "before current approval"):
            self.check()

    def test_mode_negative_fixes_typo_without_prd(self):
        self.setup_case("mode-negative")
        self.fake()
        self.assertEqual(self.check()[0], "typo")

    def test_mode_negative_plan_alone_does_not_pass(self):
        self.setup_case("mode-negative")
        self.fake(no_fix=True)
        with self.assertRaisesRegex(ValueError, "file delta"):
            self.check()

    def test_product_write_in_planning_is_rejected(self):
        self.setup_case("clear")
        self.fake(change_product=True)
        with self.assertRaisesRegex(ValueError, "product boundary"):
            self.check()

    def test_recovery_wrapper_truncates_only_the_first_review_result(self):
        self.setup_case("recover")
        runner = self.plugin / "bin/bstack-run"
        real = runner.with_name("bstack-run.real")
        real.write_text("#!/bin/sh\nprintf '%s' 'whole result'\n")
        fake_prd = self.scratch / "bstack-prd"
        fake_prd.write_text(
            f"import subprocess\nsubprocess.run([{str(runner)!r}, 'result', {REVIEWS[0]!r}], check=True)\n")
        env = dict(os.environ, BSTACK_STATE_DIR=str(fixture.state_dir(self.root)))
        turn.audit_dir().mkdir()
        self.assertEqual(subprocess.check_output([runner, "result", IDS[0]], env=env), b"whole result")
        argv = [sys.executable, str(fake_prd), "review", "recover"]
        self.assertEqual(subprocess.check_output(argv, env=env), b'{"verdict":')
        self.assertEqual((turn.audit_dir() / "recovery-injected").read_text().strip(), REVIEWS[0])
        self.assertEqual(subprocess.check_output(argv, env=env), b"whole result")

    def test_all_reviewer_examples_generate_and_quote_new_requests(self):
        for case in fixture.REVIEWER_MODELS:
            with self.subTest(case=case):
                brief = fixture.reviewer_brief(fixture.PLUGIN, case)
                self.assertTrue(brief.startswith("NO-PREAMBLE\n"))
                self.assertIn("=== request.md ===\n", brief)
                if case in {"single-transition", "omitted"}:
                    self.assertIn({"single-transition": "> 카드 A", "omitted": "> 키보드만"}[case], brief)
