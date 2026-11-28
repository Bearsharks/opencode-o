#!/usr/bin/env python3
"""SessionStart(compact) hook: put a blite entry point's documents back in context after a compaction.

A compaction summary keeps the gist of the rules, not the rules. For each entry point
(/blite:blite-mode, /blite:blite-free) that ran earlier in the session, add its skill and the
documents it links to, in full.
"""
import json
import re
import sys
from pathlib import Path

PLUGIN = Path(__file__).resolve().parent.parent
ENTRIES = ("blite-mode", "blite-free")
LINK = re.compile(r"\]\(([^)#\s]+\.md)\)")


def command(entry):
    return f"<command-name>/blite:{entry}</command-name>"


def user_texts(entry):
    # Only what the user sent. Tool results and assistant text can quote the command.
    if entry.get("type") != "user":
        return []
    content = (entry.get("message") or {}).get("content")
    if isinstance(content, str):
        return [content]
    if isinstance(content, list):
        return [c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"]
    return []


def entries_ran(transcript):
    ran = set()
    with open(transcript, encoding="utf-8", errors="replace") as lines:
        for line in lines:
            candidates = [e for e in ENTRIES if e not in ran and command(e) in line]
            if not candidates:
                continue
            try:
                record = json.loads(line)
            except ValueError:
                continue
            texts = user_texts(record)
            ran.update(e for e in candidates if any(command(e) in text for text in texts))
    return [e for e in ENTRIES if e in ran]


def documents(entries):
    paths = []
    for entry in entries:
        skill = PLUGIN / "skills" / entry / "SKILL.md"
        for path in [skill] + [(skill.parent / t).resolve() for t in LINK.findall(skill.read_text(encoding="utf-8"))]:
            if path.is_file() and path not in paths:
                paths.append(path)
    return [(path, path.read_text(encoding="utf-8")) for path in paths]


def main():
    try:
        event = json.load(sys.stdin)
    except ValueError:
        return
    transcript = event.get("transcript_path") if isinstance(event, dict) else None
    if not transcript or not Path(transcript).is_file():
        return
    entries = entries_ran(transcript)
    if not entries:
        return
    names = " and ".join(f"/blite:{e}" for e in entries)
    header = (f"{names} ran in this session before the compaction. "
              "Each skill and every document it links to follow in full, as they are now.")
    parts = [header] + [f"===== {path} =====\n{text.strip()}" for path, text in documents(entries)]
    json.dump({"hookSpecificOutput": {"hookEventName": "SessionStart",
                                      "additionalContext": "\n\n".join(parts)}},
              sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
