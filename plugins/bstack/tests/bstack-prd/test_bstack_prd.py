import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import struct
import subprocess
import tempfile
import time
import unittest


HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parents[1]
FIXTURES = HERE / "fixtures"
READY = '{"verdict":"READY","basis":"checked","findings":[]}'
FINDING = dict(cell="F-01/검증 근거", criterion="actual result", gap="prior gap", resolve="add the check")


def answer(name, *findings):
    return json.dumps(dict(verdict=name, basis="reason", findings=findings))


def fingerprint(path):
    return {str(p.relative_to(path)): (p.read_bytes(), p.stat().st_mtime_ns, p.stat().st_ctime_ns)
            for p in path.rglob("*") if p.is_file()}


def independent_hash(path):
    data = []
    for item in sorted(path.rglob("*.md"), key=lambda p: p.relative_to(path).as_posix().encode()):
        relative = item.relative_to(path)
        if relative.parts[0] != "reviews":
            data.extend((relative.as_posix().encode(), item.read_bytes()))
    return hashlib.sha256(b"".join(struct.pack(">Q", len(value)) + value for value in data)).hexdigest()


def independent_reviewer_hash(plugin):
    paths = ("skills/bstack-feature/references/reviewer.md", "templates/preamble/reviewer.md")
    data = (value for path in paths for value in (path.encode(), (plugin / path).read_bytes()))
    return hashlib.sha256(b"".join(struct.pack(">Q", len(value)) + value for value in data)).hexdigest()


class PRDTest(unittest.TestCase):
    def setUp(self):
        home = tempfile.TemporaryDirectory(prefix="bstack-prd-test-")
        self.addCleanup(home.cleanup)
        base = Path(home.name).resolve()
        self.cwd = base / "repo"
        self.cwd.mkdir()
        self.state = base / "state"
        subprocess.run(["git", "init", "-q"], cwd=self.cwd, check=True)
        self.plugin = self.cwd / "plugin"
        bin_dir = self.plugin / "bin"
        bin_dir.mkdir(parents=True)
        self.cli = bin_dir / "bstack-prd"
        shutil.copy2(PLUGIN / "bin/bstack-prd", self.cli)
        shutil.copyfile(HERE / "fake-bstack-run.py", bin_dir / "bstack-run")
        (bin_dir / "bstack-run").chmod(0o755)
        self.feature = self.plugin / "skills/bstack-feature"
        shutil.copytree(PLUGIN / self.feature.relative_to(self.plugin), self.feature)
        self.preamble = self.plugin / "templates/preamble/reviewer.md"
        self.preamble.parent.mkdir(parents=True)
        shutil.copyfile(PLUGIN / self.preamble.relative_to(self.plugin), self.preamble)
        self.refs = self.feature / "references"
        self.brief = self.cwd / "brief.md"
        self.brief.write_bytes((FIXTURES / "request.md").read_bytes())
        self.prd = self.cwd / ".bstack/jot"
        self.index = self.prd / "index.md"
        self.request = self.prd / "request.md"
        self.reviews = self.prd / "reviews"

    def proc(self, args, config=None, token="", **kwargs):
        env = dict(os.environ, CLAUDE_PLUGIN_ROOT=str(self.plugin), FAKE_CONFIG=json.dumps(config or {}),
                   FAKE_ID=token, BSTACK_STATE_DIR=str(self.state))
        return subprocess.Popen([self.cli, *args], env=env, cwd=kwargs.get("cwd", self.cwd),
                                stdin=kwargs.get("stdin"), stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, encoding="utf-8")

    def finish(self, process, code, *, input_text=None, **fields):
        try:
            output, err = process.communicate(input_text, timeout=20)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            raise
        self.assertEqual(process.returncode, code, output + err)
        self.assertEqual(err, "")
        value = json.loads(output)
        self.assertEqual(len(output.splitlines()), 1)
        for key, expected in fields.items():
            self.assertEqual(value.get(key), expected, value)
        return value

    def cli_call(self, args, code=0, *, config=None, **fields):
        return self.finish(self.proc(args, config), code, **fields)

    def start(self, code=0, **fields):
        return self.cli_call(["start", "jot", "--brief", self.brief], code, **fields)

    def status(self, state="draft", **fields):
        return self.cli_call(["status", "jot"], 1 if state == "draft" else 0,
                             state=state, index=str(self.index), **fields)

    def review(self, code=0, **kwargs):
        return self.cli_call(["review", "jot"], code, **kwargs)

    def example_candidate(self):
        self.start(path=str(self.prd))
        self.assertEqual(self.index.read_bytes(), (self.refs / "template/index.md").read_bytes())
        shutil.copyfile(FIXTURES / "index.md", self.index)
        shutil.copytree(FIXTURES / "evidence", self.prd / "evidence")

    def calls(self):
        path = self.state / "calls.jsonl"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def runs(self):
        return [entry for entry in self.calls() if entry[0] == "run"]

    def latest_brief(self):
        return self.state / "runs" / self.runs()[-1][-1] / "brief.md"

    def append(self, path, text):
        with path.open("a", encoding="utf-8", newline="") as stream:
            stream.write(text)

    def edit(self, path, before, after):
        data = path.read_text(encoding="utf-8")
        self.assertIn(before, data)
        path.write_text(data.replace(before, after, 1), encoding="utf-8")

    def held(self, token):
        proc = self.proc(["review", "jot"], {"hold": True}, token)
        run = self.state / "runs" / token
        expires = time.monotonic() + 10
        while not (run / "entered").exists():
            if proc.poll() is not None or time.monotonic() > expires:
                proc.kill()
                self.fail(proc.communicate())
            time.sleep(0.01)
        self.addCleanup(self.release, proc, run)
        return proc, run

    @staticmethod
    def release(proc, run):
        (run / "release").touch()
        if proc.poll() is None:
            proc.communicate(timeout=20)

    def test_start_resume_and_status_do_not_rewrite(self):
        self.example_candidate()
        before = fingerprint(self.prd)
        self.start(path=str(self.prd))
        self.status()
        self.assertEqual(fingerprint(self.prd), before)
        self.append(self.brief, "\n새로운 사용자 답변\r\n")
        self.start()
        self.assertEqual(self.request.read_bytes(), self.brief.read_bytes())
        self.assertEqual({k: v for k, v in fingerprint(self.prd).items() if k != "request.md"},
                         {k: v for k, v in before.items() if k != "request.md"})
        self.edit(self.brief, "실수로", "바꾼 원문")
        self.start(3, error="brief_not_append_only")
        self.assertNotEqual(self.request.read_bytes(), self.brief.read_bytes())
        self.assertEqual(self.calls(), [])

    def test_start_stdin_preserves_original_and_appends_only(self):
        args = ["start", "jot", "--brief", "-"]
        original = "# 요청 원문\r\n\r\n사용자 \"$HOME\"과 '작은따옴표' 🌱\r\n\r\n## 이후 답변\r\n"
        # There is no staging file, and "-" is stdin even if such a file exists.
        self.brief.unlink()
        (self.cwd / "-").write_bytes(b"not the submitted request")

        def start(text, code=0, **fields):
            return self.finish(self.proc(args, stdin=subprocess.PIPE), code,
                               input_text=text, **fields)

        start("", 3, error="invalid_brief")
        self.assertFalse(self.prd.exists())
        start(original, path=str(self.prd))
        self.assertEqual(self.request.read_bytes(), original.encode())
        appended = original + "\r\n사용자 답: 끝 줄에 줄바꿈 없음"
        start(appended, path=str(self.prd))
        self.assertEqual(self.request.read_bytes(), appended.encode())
        start(original, 3, error="brief_not_append_only")
        self.assertEqual(self.request.read_bytes(), appended.encode())
        self.assertEqual(self.calls(), [])

    def test_argument_and_path_refusals_make_no_runs(self):
        for name in ("../jot", "Jot", "two--parts", "runs", "scratch", "space here", "/tmp"):
            with self.subTest(name=name):
                self.cli_call(["start", name, "--brief", self.brief], 3, error="invalid_name")
        for args in ([], ["--help"], ["check", "jot"], ["start", "jot", "--b", self.brief],
                     ["review", "jot", "--model", "fake"]):
            self.cli_call(args, 3, error="invalid_command")
        sub = self.cwd / "child"
        sub.mkdir()
        self.finish(self.proc(["status", "jot"], cwd=sub), 3, error="invalid_path")
        self.prd.mkdir(parents=True)
        self.start(3, error="invalid_path")
        self.prd.rmdir()
        self.prd.symlink_to(FIXTURES, target_is_directory=True)
        self.start(3)
        self.prd.unlink()
        original = self.brief.with_name("original.md")
        self.brief.rename(original)
        self.brief.symlink_to(original)
        self.start(3)
        self.brief.unlink()
        self.brief = original
        self.example_candidate()
        symlink = self.prd / "escaped.md"
        symlink.symlink_to("../../../brief.md")
        self.review(3, error="invalid_path")
        symlink.unlink()
        os.mkfifo(symlink)
        self.review(3, error="invalid_path")
        self.assertEqual(self.calls(), [])

    def test_preflight_blocks_only_missing_basics(self):
        self.start()
        for index in (None, " \r\n", self.index.read_text()):
            with self.subTest(index=index):
                if index is None:
                    self.index.unlink()
                else:
                    self.index.write_text(index)
                self.review(3, error="preflight_failed")
        self.index.write_bytes((FIXTURES / "index.md").read_bytes())
        self.request.unlink()
        value = self.review(3, error="preflight_failed")
        self.assertIn("request.md: missing", value["detail"])
        self.assertEqual(self.calls(), [])

    def test_preflight_requires_f_row_but_not_a_hypothesis(self):
        self.example_candidate()
        candidate = self.index.read_bytes()
        for index in ("# No rows", "| H-01 | hypothesis |"):
            with self.subTest(index=index):
                self.index.write_text(index)
                result = self.review(3, error="preflight_failed")
                self.assertIn("index.md: at least one F row required", result["detail"])
                self.assertEqual(self.calls(), [])
        self.index.write_bytes(candidate)
        result = self.review(verdict="READY")
        self.assertFalse((Path(result["snapshot"]) / "hypothesis.md").exists())
        self.status("approved")

    def test_preflight_leaves_markup_and_request_format_to_reviewer(self):
        self.brief.write_text("# Natural title\n> A request about <id>.\n")
        self.start()
        self.index.write_text("# Example\n```\n| F-05 | [ref](missing.md#absent) |\n```\n")
        result = self.review(1, config={"answer": answer("REVISE", FINDING)}, verdict="REVISE")
        snapshot = Path(result["snapshot"])
        self.assertEqual((snapshot / "request.md").read_bytes(), self.brief.read_bytes())
        self.assertEqual((snapshot / "index.md").read_bytes(), self.index.read_bytes())
        self.assertEqual(len(self.runs()), 1)
        receipt = json.loads(Path(result["record"]).read_bytes())
        self.assertEqual(receipt["run_record"], str(self.latest_brief().with_name("meta.json")))
        self.assertTrue(self.latest_brief().is_file())
        self.assertIn(f"[작성 기준]: `{self.feature / 'SKILL.md'}`", self.latest_brief().read_text())
        self.assertFalse((snapshot.parent / "brief.md").exists())
        self.assertEqual(list((self.cwd / ".bstack").iterdir()), [self.prd])

    def test_ready_framing_snapshot_and_read_only_reuse(self):
        self.example_candidate()
        hypothesis = self.prd / "hypothesis.md"
        hypothesis.write_text("# Product hypothesis\n\nSelf-service recovery reduces support requests.\n")
        self.review(verdict="READY", config={"answer": "\n```json\r\n" + READY + "\r\n```\n"})
        first = self.status("approved")
        record = json.loads(Path(first["record"]).read_bytes())
        self.assertEqual(record["hash"], independent_hash(self.prd))
        self.assertEqual(first["hash"], record["hash"])
        self.assertEqual(first["run_id"], record["run_id"])
        self.assertEqual(set(first), {"state", "index", "hash", "revise_count", "revise_records",
                                      "run_id", "record"})
        snapshot = Path(record["snapshot"])
        self.assertEqual((snapshot / "hypothesis.md").read_bytes(), hypothesis.read_bytes())
        self.assertEqual(independent_hash(snapshot), record["hash"])
        self.assertTrue(all(not p.stat().st_mode & 0o222 for p in [snapshot, *snapshot.rglob("*")]))
        self.assertTrue(all(stat.S_ISREG(p.lstat().st_mode) for p in snapshot.rglob("*.md")))
        self.assertIn("```json", record["response"])
        # Approval does not rerun the current parser on historical raw evidence.
        record["response"] = "archived response in a different format"
        Path(first["record"]).write_text(json.dumps(record), encoding="utf-8")
        before = fingerprint(self.prd)
        self.start()
        self.review(verdict="READY", run_id=first["run_id"], record=first["record"])
        self.assertEqual(self.status("approved"), first)
        self.assertEqual(fingerprint(self.prd), before)
        self.assertEqual([row[0] for row in self.calls()], ["run", "status", "result"])

    def test_json_schema_and_exit_values(self):
        self.example_candidate()
        bad = [
            READY[:-1], "READY: " + READY, READY + " footer", READY + "\n" + READY,
            "```\n" + READY + "\n```", "```json\n" + READY + "\n```\n```json\n" + READY + "\n```",
            READY.replace('"basis"', '"verdict":"READY","basis"'),
            READY.replace('"basis"', '"extra":0,"basis"'), READY.replace("checked", " "),
            answer("REVISE", dict(FINDING, cell="F-01/근거")),
            answer("REVISE", dict(FINDING, cell="F-01,H-01")),
            answer("REVISE", dict(FINDING, gap=" ")), answer("REVISE"),
            answer("REVISE", dict(FINDING, extra="no")), answer("READY", FINDING),
            READY.replace('"checked"', 'NaN'), answer("REVISE", FINDING).replace('"gap"', '"gap":"old","gap"'),
        ]
        for text in bad:
            with self.subTest(text=text):
                self.review(3, config={"answer": text}, error="invalid_verdict")
                self.status()
                self.assertEqual(list(self.reviews.glob("*.json")), [])
        self.review(1, config={"answer": answer("REVISE", FINDING, dict(FINDING, cell="F-01/성공 정의 근거"))},
                    verdict="REVISE")
        self.status()
        self.review(2, config={"answer": answer("BLOCKED", dict(FINDING, cell="F-99"))}, verdict="BLOCKED")
        self.status()
        self.review(verdict="READY")
        self.status("approved")

    def test_status_required_before_result(self):
        self.example_candidate()
        for config in ({"status": "running"}, {"exit_code": 9}, {"exit_code": False},
                       {"exit_code": None}, {"run_exit": 1}):
            self.review(3, config=config, error="review_run_failed")
            self.status()
        self.assertEqual([row[0] for row in self.calls()], ["run", "status"] * 5)
        self.assertEqual(list(self.reviews.glob("*.json")), [])

    def test_rework_limit_prevents_third_reviewer_for_same_request(self):
        self.example_candidate()
        first_status = self.status(revise_count=0, revise_records=[])
        self.assertEqual(set(first_status), {"state", "index", "hash", "revise_count", "revise_records", "detail"})
        config = {"answer": answer("REVISE", FINDING)}
        first = self.review(1, config=config, verdict="REVISE")
        self.status(revise_count=1, revise_records=[first["record"]])
        self.append(self.index, "\ncandidate reworked\n")
        second = self.review(1, config=config, verdict="REVISE")
        records = [first["record"], second["record"]]
        self.status(revise_count=2, revise_records=records)
        self.assertNotEqual(first["hash"], second["hash"])
        self.start()  # Resuming unchanged bytes does not reset the count.
        self.append(self.refs / "reviewer.md", "\nupdated criteria\n")
        before, calls = fingerprint(self.prd), self.calls()
        result = self.review(4, error="rework_limit_reached", revise_count=2, revise_records=records)
        self.assertIn("재작업 한도 도달", result["detail"])
        self.assertIn("사용자와 쟁점", result["detail"])
        self.assertEqual(fingerprint(self.prd), before)
        self.assertEqual(self.calls(), calls)
        self.assertEqual(len(self.runs()), 2)

    def test_appended_answer_resets_count_and_allows_review(self):
        self.example_candidate()
        config = {"answer": answer("REVISE", FINDING)}
        for count in (1, 2):
            self.review(1, config=config, verdict="REVISE")
            self.status(revise_count=count)
        self.review(4, error="rework_limit_reached")
        self.append(self.brief, "\n사용자 답: 로컬 환경에서 확인.\n")
        self.start()
        self.status(revise_count=0, revise_records=[])
        revised = self.review(1, config=config, verdict="REVISE")
        self.status(revise_count=1, revise_records=[revised["record"]])
        self.review(verdict="READY")
        self.status("approved", revise_count=1, revise_records=[revised["record"]])
        self.assertEqual(len(self.runs()), 4)

    def test_rework_count_uses_legacy_snapshot_and_only_counts_valid_revise(self):
        self.example_candidate()
        first = self.review(1, config={"answer": answer("REVISE", FINDING)}, verdict="REVISE")
        path = Path(first["record"])
        record = json.loads(path.read_bytes())
        del record["request_hash"]
        record["response"] = "archived response in a different format"
        record["findings"][0]["cell"] = "legacy address"
        path.write_text(json.dumps(record), encoding="utf-8")
        self.review(2, config={"answer": answer("BLOCKED", FINDING)}, verdict="BLOCKED")
        self.assertIn("legacy address", self.latest_brief().read_text())
        self.review(3, config={"answer": "invalid"}, error="invalid_verdict")
        self.status(revise_count=1, revise_records=[first["record"]])
        second = self.review(1, config={"answer": answer("REVISE", FINDING)}, verdict="REVISE")
        self.review(4, error="rework_limit_reached", revise_count=2,
                    revise_records=[first["record"], second["record"]])
        self.assertEqual(len(self.runs()), 4)

    def test_each_content_change_drafts_and_criteria_change_forces_full_review(self):
        self.example_candidate()
        old = self.review(verdict="READY")
        evidence = self.prd / "evidence/local-list.md"
        for path in (self.request, evidence):
            before = path.read_bytes()
            self.append(path, "\nchange\n")
            self.assertNotEqual(self.status()["hash"], old["hash"])
            path.write_bytes(before)
            self.assertEqual(self.status("approved")["run_id"], old["run_id"])
        evidence.rename(evidence.with_name("renamed.md"))
        self.status()
        evidence.with_name("renamed.md").rename(evidence)
        self.assertEqual(self.status("approved")["run_id"], old["run_id"])
        reviewer = self.refs / "reviewer.md"
        self.append(reviewer, "\n새 독립 기준\n")
        self.status()
        new = self.review(verdict="READY", hash=old["hash"])
        self.assertEqual(len(self.runs()), 2)
        self.assertEqual(new["reviewer_hash"], independent_reviewer_hash(self.plugin))
        self.assertNotEqual(old["reviewer_hash"], new["reviewer_hash"])
        brief = self.latest_brief().read_bytes()
        self.assertTrue(brief.startswith(self.preamble.read_bytes() + b"\n\n" + reviewer.read_bytes()))
        self.assertNotIn("## 직전 지적과 제출본 간 diff".encode(), brief)

    def test_preamble_only_change_invalidates_approval_and_forces_full_review(self):
        self.example_candidate()
        old = self.review(verdict="READY")
        self.status("approved", run_id=old["run_id"])
        original = self.preamble.read_bytes()
        self.append(self.preamble, "\nupdated shared rules\n")
        self.status(hash=old["hash"])
        new = self.review(verdict="READY", hash=old["hash"])
        self.assertEqual(len(self.runs()), 2)
        self.assertNotEqual(new["run_id"], old["run_id"])
        self.assertNotEqual(new["reviewer_hash"], old["reviewer_hash"])
        brief = self.latest_brief().read_bytes()
        self.assertIn(b"updated shared rules", brief)
        self.assertNotIn("## 직전 지적과 제출본 간 diff".encode(), brief)
        self.status("approved", run_id=new["run_id"])
        self.preamble.write_bytes(original)
        self.status("approved", run_id=old["run_id"])

    def test_legacy_records_are_readable_but_do_not_approve(self):
        self.example_candidate()
        old = self.review(verdict="READY")
        path = Path(old["record"])
        data = json.loads(path.read_bytes())
        del data["reviewer_hash"]
        path.write_text(json.dumps(data), encoding="utf-8")
        self.status()
        data["reviewer_hash"] = hashlib.sha256((self.refs / "reviewer.md").read_bytes()).hexdigest()
        path.write_text(json.dumps(data), encoding="utf-8")
        self.status(hash=old["hash"])
        actual = self.review(verdict="READY")
        self.assertNotEqual(old["run_id"], actual["run_id"])
        self.assertEqual(len(self.runs()), 2)

    def test_recheck_diff_uses_previous_frozen_snapshot(self):
        self.example_candidate()
        self.review(1, config={"answer": answer("REVISE", FINDING)}, verdict="REVISE")
        self.append(self.brief, "\nnew-answer-from-user\n")
        self.start()
        self.append(self.prd / "evidence/local-list.md", "\nfixture changed\n")
        (self.prd / "detail.md").write_text("# Added detail\n")
        self.review(verdict="READY")
        brief = self.latest_brief().read_text()
        diff = brief.split("## 직전 지적과 제출본 간 diff", 1)[1]
        for part in ("prior gap", "+++ after/request.md", "+new-answer-from-user",
                     "+++ after/evidence/local-list.md", "+fixture changed", "--- /dev/null",
                     "+++ after/detail.md"):
            self.assertIn(part, diff)
        self.assertNotIn("after/index.md", diff)

    def test_only_one_review_at_a_time(self):
        self.example_candidate()
        proc, run = self.held("first")
        self.assertIn("active", self.status()["detail"])
        self.review(3, error="review_in_progress")
        self.assertEqual(len(self.runs()), 1)
        (run / "release").touch()
        self.finish(proc, 0, verdict="READY", run_id="first")
        self.status("approved", run_id="first")
        self.assertEqual(len(list(self.reviews.glob("*.json"))), 1)

    def test_running_launcher_keeps_slot_if_review_process_is_killed(self):
        self.example_candidate()
        proc, run = self.held("interrupted")
        proc.kill()
        proc.wait(timeout=5)
        try:
            self.review(3, error="review_in_progress")
            self.assertEqual(len(self.runs()), 1)
        finally:
            (run / "release").touch()
            proc.communicate(timeout=20)
        self.assertNotIn("active", self.status()["detail"])
        self.assertEqual(list(self.reviews.glob("*.json")), [])
        self.review(verdict="READY")

    def test_start_invalidates_late_ready_without_freeing_review_slot(self):
        self.example_candidate()
        for token, new_answer in (("answer", True), ("same", False)):
            with self.subTest(token=token):
                proc, run = self.held(token)
                if new_answer:
                    self.append(self.brief, "\nuser replied\n")
                self.start()
                calls = self.calls()
                self.review(3, error="review_in_progress")
                self.assertEqual(self.calls(), calls)
                (run / "release").touch()
                self.finish(proc, 3, error="submission_changed", run_id=token)
                self.status(revise_count=0, revise_records=[])
        self.assertEqual(list(self.reviews.glob("*.json")), [])
        self.review(verdict="READY")

    def test_current_content_paths_snapshot_and_criteria_must_match(self):
        self.example_candidate()
        for operation in ("file", "paths", "criteria", "preamble", "snapshot", "symlink"):
            with self.subTest(operation=operation):
                proc, run = self.held(operation)
                if operation == "file":
                    self.append(self.index, "edit")
                elif operation == "paths":
                    (self.prd / "new.md").touch()
                elif operation == "criteria":
                    self.append(self.refs / "reviewer.md", "\nchanged\n")
                elif operation == "preamble":
                    self.append(self.preamble, "\nchanged\n")
                elif operation == "snapshot":
                    snapshot = self.reviews / (self.reviews / "active").read_text() / "snapshot/index.md"
                    snapshot.chmod(0o600)
                    self.append(snapshot, "tampered")
                else:
                    (self.prd / "unsafe.md").symlink_to(self.brief)
                (run / "release").touch()
                self.finish(proc, 3, error="submission_changed")
                if operation == "symlink":
                    (self.prd / "unsafe.md").unlink()
                self.status()
        self.assertEqual(list(self.reviews.glob("*.json")), [])

    def test_restored_bytes_do_not_invalidate_submission(self):
        self.example_candidate()
        proc, run = self.held("restored")
        data = self.index.read_bytes()
        self.append(self.index, "temporary edit")
        self.index.write_bytes(data)
        (run / "release").touch()
        self.finish(proc, 0, verdict="READY")
        self.status("approved", run_id="restored")


if __name__ == "__main__":
    unittest.main()
