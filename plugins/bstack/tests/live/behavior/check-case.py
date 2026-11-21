#!/usr/bin/env python3
"""Check mechanical behavior evidence and print the ungraded user-facing text."""

import argparse
import json
import os
from pathlib import Path
import re
import sys

from fixture import ANSWERS, AUTO, MODELS, REVIEWER_MODELS, SCRATCH, state_dir
from turn import ID, PLUGIN, REFS, audit_dir, boundary, get_json, meta, runs_dir, sha, transcript_bytes

PHASES = {
    "clear": ("candidate", "approved"),
    "question": ("initial", "candidate", "approved"),
    "mode-positive": ("initial", "candidate", "approved"),
    "mode-negative": ("typo",),
    "resume": ("approved", "approved"),
    **dict.fromkeys(("clear-auto", "availability", "recover"), ("approved",)),
    **dict.fromkeys(REVIEWER_MODELS, ("reviewer example",)),
}
LABELS = ("first", "answered", "confirmed")


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def done(run):
    return run["status"] == "done" and run["exit_code"] == 0 and bool(run["session_id"])


def text(content):
    if isinstance(content, list):
        return "\n".join(block["text"] for block in content if block["type"] == "text")
    return content


def objects(output):
    # Match JSON returned by tools, not command strings or natural-language claims.
    decoder = json.JSONDecoder()
    while output:
        output = output.lstrip()
        try:
            value, end = decoder.raw_decode(output)
        except ValueError:
            _, _, output = output.partition("\n")
        else:
            if isinstance(value, dict):
                yield value
            output = output[end:]


def evidence(data, session, plugin):
    calls, results, openings = [], {}, {}
    skills = {}
    for skill in ("bstack-mode", "bstack-clarify"):
        directory = plugin / "skills" / skill
        installed = (directory / "SKILL.md").read_text(encoding="utf-8").strip()
        skills[skill] = (f"Base directory for this skill: {directory}\n",
                         {installed, installed.split("\n---\n", 1)[-1].strip()})
    for number, line in enumerate(data.splitlines()):
        row = json.loads(line)
        kind = row.get("type")
        message = row.get("message") or {}
        if kind not in {"user", "assistant"} or message.get("role", kind) != kind:
            continue
        require(row.get("sessionId", session) == session, "transcript session mismatch")
        blocks = message.get("content", [])
        if isinstance(blocks, str):
            blocks = [{"type": "text", "text": blocks}]
        for offset, block in enumerate(blocks):
            order = (number, offset)
            if kind == "assistant" and block["type"] == "tool_use":
                calls.append((order, block))
            if kind == "user" and block["type"] == "tool_result":
                results[block["tool_use_id"]] = (order, block)
            if kind == "user" and block["type"] == "text":
                value = block["text"]
                for skill, (base, bodies) in skills.items():
                    slash = f"<command-message>bstack:{skill}</command-message>\n<command-name>/bstack:{skill}</command-name>"
                    if ((value.startswith(slash + "\n<command-args>") and value.endswith("</command-args>"))
                            or (value.startswith(base) and value[len(base):].strip() in bodies)):
                        openings.setdefault(skill, order)
    return calls, results, openings


def quoted_blocks(request):
    block = b""
    for line in request.splitlines(keepends=True):
        if line.startswith(b"> "):
            block += line[2:]
        elif block:
            yield block
            block = b""
    if block:
        yield block


def preserves(request, original):
    # Match complete byte-for-byte lines, never an unquoted occurrence or lines
    # separated by a heading. The newline framing below cannot change a line.
    return any(b"\n" + original in b"\n" + block for block in quoted_blocks(request))


def body(snapshot, case):
    prefix = case + "/"
    return {path[len(prefix):]: digest for path, digest in snapshot["prd"].items()
            if path.startswith(prefix) and path[len(prefix):].split("/")[0] not in {"request.md", "reviews"}}


def gate(turn, case, phase, prior):
    starts, playbooks, clarify_reads, reviews, delegated, statuses = [], [], [], [], {}, []
    clarify_attempt = "bstack-clarify" in turn.openings
    review_attempt = False
    for order, call in turn.calls:
        name, args = call["name"], call["input"]
        end, result = turn.results.get(call["id"], (order, {"is_error": True}))
        ok = end > order and not result.get("is_error", False)
        if name == "AskUserQuestion":
            for question in args.get("questions", []):
                print("  질문/확인 도구 원문:\n" + question.get("question", ""))
                for option in question.get("options", []):
                    print(option.get("label", "") + "\n" + option.get("description", ""))
        if name == "Skill" and args.get("skill") in {"bstack:bstack-clarify", "bstack-clarify"}:
            clarify_attempt = True
        if name == "Read":
            path = (turn.root / args["file_path"]).resolve()
            if case in {"clear", "clear-auto"} and path.is_relative_to(turn.root / REFS):
                require(path.name != "methods.md" and "methods" not in path.relative_to(turn.root / REFS).parts,
                        "clear request unexpectedly Read a method")
            if path == turn.plugin / "skills/bstack-clarify/SKILL.md":
                clarify_attempt = True
                if ok:
                    clarify_reads.append((order, end))
            if path == turn.plugin / "skills/bstack-mode/SKILL.md" and ok:
                turn.openings.setdefault("bstack-mode", end)
            if path.parent == turn.plugin / "skills/bstack-mode/playbooks":
                playbooks.append(order)
        if name != "Bash":
            continue
        output = text(result.get("content", ""))
        for value in objects(output):
            if ok and value.get("path") == str(turn.prd):
                starts.append((order, end))
            if value.get("verdict") in {"READY", "REVISE", "BLOCKED"}:
                reviews.append((order, end, ok, value))
            if value.get("error") in {"invalid_verdict", "review_run_failed", "rework_limit_reached",
                                       "preflight_failed", "review_in_progress", "submission_changed"}:
                review_attempt = True
            if ok and value.get("state") == "approved" and value.get("index") == str(turn.prd / "index.md"):
                statuses.append((end, value.get("run_id")))
        if ok:
            for line in output.splitlines():
                if match := re.match(rf"id=({ID})(?=\s|$)", line):
                    delegated[match[1]] = order

    if case.startswith("mode-") and not prior:
        require("bstack-mode" in turn.openings, "no mode entry in transcript")
    if phase == "typo":
        require(not clarify_attempt and not starts and not reviews and not review_attempt,
                "typo went through the PRD gate")
    elif phase != "reviewer example":
        require(starts, "missing successful PRD start")
        if not prior:
            if case == "mode-positive":
                entries = [end for call, end in clarify_reads if turn.openings["bstack-mode"] < call]
            else:
                entries = [end for _, end in clarify_reads]
                if "bstack-clarify" in turn.openings:
                    entries.append(turn.openings["bstack-clarify"])
            require(entries and min(entries) < starts[0][0], "missing successful clarify gate before start")
        require(all(starts[0][1] < x for x in (*delegated.values(), *(r[0] for r in reviews))),
                "delegation or review before PRD start returned")
        if case == "mode-positive" and playbooks:
            require(phase == "approved" and any(
                end < min(playbooks) and run_id == turn.status.get("run_id") for end, run_id in statuses),
                "mode opened a playbook before current approval")
    return reviews, delegated, review_attempt


class Turn:
    def __init__(self, root, case, label, run_id, prior):
        self.root, self.plugin, self.prd = root, root / PLUGIN, root / ".bstack" / case
        folder = audit_dir() / label
        self.main = main = meta(run_id)
        self.before, self.after = (get_json(folder / f"{edge}.json") for edge in ("before", "after"))
        self.code, self.status = (get_json(folder / f"status.{part}") for part in ("exit", "stdout"))
        require(run_id == get_json(folder / "id.json") == main["id"] and done(main)
                and main["role"] == "panel" and main["model"] == f"claude:{MODELS[case]}"
                and main["cwd"] == str(root) and main["plugin_dir"] == str(self.plugin)
                and get_json(folder / "run.exit") == get_json(folder / "result.exit") == 0,
                "missing or failed captured Claude run")
        require(main["parent_id"] == (prior.main["id"] if prior else None)
                and (not prior or main["session_id"] == prior.main["session_id"]
                     and prior.after == self.before), "ask parent, session or boundary mismatch")
        require(all(self.after["runs"].get(key) == digest for key, digest in self.before["runs"].items()),
                "prior run metadata changed")
        added = self.after["runs"].keys() - self.before["runs"].keys()
        require(run_id in added and (prior or not self.before["runs"]), "main run is not new in a fresh chain")
        self.workers = {key: meta(key) for key in added - {run_id}}
        require(all(key == m["id"] and m["cwd"] == str(root) for key, m in self.workers.items()),
                "nested run identity or cwd mismatch")
        span = get_json(folder / "transcript.json")
        start, self.end = span["start"], span["end"]
        data = transcript_bytes(run_id)
        require(start == (prior.end if prior else 0) and 0 <= start < self.end <= len(data)
                and data[self.end - 1:self.end] == b"\n" and sha(data[:start]) == span["prefix_sha256"]
                and sha(data[:self.end]) == span["through_sha256"], "missing, altered or misordered transcript")
        self.calls, self.results, self.openings = evidence(data[start:self.end], main["session_id"], self.plugin)
        self.brief = (runs_dir() / run_id / "brief.md").read_bytes()
        expected = (ANSWERS[case][label == "confirmed"].encode() if prior
                    else (state_dir(root) / "input.md").read_bytes())
        require(self.brief == expected, "captured run brief differs from fixture input")
        self.request = (folder / "request.md").read_bytes() if (folder / "request.md").is_file() else b""
        print(f"  {label} ({run_id}) 질문·확인·결과 메시지 원문 [수동 검토]:")
        print((folder / "result.stdout").read_text(encoding="utf-8"), end="\n")


def check(case, ids, root):
    phases = PHASES[case]
    require(1 <= len(ids) <= len(phases), "wrong number of run IDs")
    prior, authors = None, {}
    for label, phase, run_id in zip(LABELS, phases, ids):
        turn = Turn(root, case, label, run_id, prior)
        project = dict(turn.before["project"])
        if phase == "typo":
            require(project.get("labels.txt") == sha(b"Welcomme\n"), "wrong typo fixture input")
            project["labels.txt"] = sha(b"Welcome\n")
        require(project == turn.after["project"], "product boundary differs from the expected file delta")
        for edge in (turn.before, turn.after):
            require(all(name == case or name.startswith(case + "/") for name in edge["prd"]),
                    "unexpected PRD path in isolated fixture")
        reviews, delegated, review_attempt = gate(turn, case, phase, prior)
        panels = {key: m for key, m in turn.workers.items() if m["role"] == "panel"}

        if phase in {"typo", "reviewer example"}:
            require(turn.code == 3 and not turn.before["prd"] and not turn.after["prd"] and not panels,
                    "expected no PRD or review in this fixture")
        else:
            index = str(turn.prd / "index.md")
            require(turn.status.get("index") == index, "status points at the wrong PRD")
            paths = turn.after["prd"]
            require(turn.request and paths.get(f"{case}/request.md") == sha(turn.request), "uncaptured request.md")
            if prior:
                require(turn.request.startswith(prior.request), "request.md is not append-only")
                suffix = turn.request[len(prior.request):]
                require((prior.request.endswith(b"\n") or suffix.startswith(b"\n"))
                        and preserves(suffix, turn.brief), "exact user answer missing from appended > lines")
            else:
                _, separator, arguments = turn.brief.partition(b"\n\n")
                require(preserves(turn.request, turn.brief) or
                        (separator and preserves(turn.request, arguments)), "exact initial request missing from > lines")
                require(not any(preserves(turn.request, answer.encode()) for answer in ANSWERS.get(case, ())),
                        "a future answer was quoted before ask")
                if case in {"clear-auto", "availability", "resume", "recover"}:
                    require(preserves(turn.request, AUTO.encode()), "explicit autonomy not quoted")

            candidate = body(turn.after, case)
            template = sha((REFS / "template/index.md").read_bytes())
            if phase == "initial":
                require(candidate == {"index.md": template}, "unresolved decision: PRD body must stay at template")
            else:
                require("index.md" in candidate and candidate["index.md"] != template,
                        "expected a written PRD, not an initialized index")
                if candidate != body(turn.before, case):
                    writers = {key: m for key, m in turn.workers.items() if m["role"] == "impl"
                               and key in delegated and done(m)
                               and (str(turn.prd).encode() in (runs_dir() / key / "brief.md").read_bytes()
                                    or f".bstack/{case}/".encode() in (runs_dir() / key / "brief.md").read_bytes())}
                    require(writers, "changed PRD body has no attributable completed author run")
                    authors.update(writers)
            if phase in {"initial", "candidate"}:
                require((turn.code, turn.status.get("state")) == (1, "draft")
                        and not panels and not reviews and not review_attempt,
                        "user decision/confirmation must wait in draft without review")
            else:
                require((turn.code, turn.status.get("state")) == (0, "approved"), "status did not approve")
                reviewer_id = turn.status.get("run_id")  # Public approval run ID, not a receipt path.
                reviewer = panels.get(reviewer_id)
                require(reviewer and done(reviewer) and reviewer["parent_id"] is None
                        and any(ok and value["verdict"] == "READY"
                                and value.get("run_id") == reviewer_id
                                and value.get("hash") == turn.status["hash"] for _, _, ok, value in reviews),
                        "approved status does not match a fresh completed READY review")
                require(authors and reviewer["session_id"] != turn.main["session_id"]
                        and all(m["session_id"] != reviewer["session_id"]
                                and m["ended_at"] <= reviewer["started_at"] for m in authors.values()),
                        "reviewer must follow the author in an independent session")
                if case == "recover":
                    marker = (audit_dir() / "recovery-injected").read_text().strip()
                    require(marker in panels and marker != reviewer_id and review_attempt,
                            "missing failed first review / fresh retry")
                print(f"  status approved: {index}; reviewer={reviewer_id}; authors={', '.join(authors)}")
        prior = turn
    require(prior.after == boundary(), "current fixture no longer matches the captured final boundary")
    suffix = " (checkpoint; further turns remain)" if len(ids) < len(phases) else ""
    return phases[len(ids) - 1] + suffix


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("case", choices=MODELS)
    parser.add_argument("run_ids", nargs="+")
    args = parser.parse_args()
    root = (SCRATCH / args.case).resolve()
    try:
        os.chdir(root)
        print(f"PASS {args.case}: {check(args.case, args.run_ids, root)} [mechanical evidence only]")
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        sys.exit(f"FAIL {args.case}: {exc}")
