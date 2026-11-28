#!/usr/bin/env python3
"""SessionStart(compact) hook: put blite mode's documents back in context after a compaction.

A compaction summary keeps the gist of the rules, not the rules. When /blite:blite-mode ran
earlier in the session, add its skill and the documents it links to, in full.
"""
import json
import re
import sys
from pathlib import Path

PLUGIN = Path(__file__).resolve().parent.parent
SKILL = PLUGIN / "skills" / "blite-mode" / "SKILL.md"
COMMAND = "<command-name>/blite:blite-mode</command-name>"
LINK = re.compile(r"\]\(([^)#\s]+\.md)\)")

HEADER = ("/blite:blite-mode ran in this session before the compaction. "
          "Its skill and every document it links to follow in full, as they are now.")


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


def blite_mode_ran(transcript):
    with open(transcript, encoding="utf-8", errors="replace") as lines:
        for line in lines:
            if COMMAND not in line:
                continue
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if any(COMMAND in text for text in user_texts(entry)):
                return True
    return False


def documents():
    skill = SKILL.read_text(encoding="utf-8")
    paths = [SKILL]
    for target in LINK.findall(skill):
        path = (SKILL.parent / target).resolve()
        if path.is_file() and path not in paths:
            paths.append(path)
    return [(path, path.read_text(encoding="utf-8")) for path in paths]


def main():
    try:
        event = json.load(sys.stdin)
    except ValueError:
        return
    transcript = event.get("transcript_path") if isinstance(event, dict) else None
    if not transcript or not Path(transcript).is_file() or not blite_mode_ran(transcript):
        return
    parts = [HEADER] + [f"===== {path} =====\n{text.strip()}" for path, text in documents()]
    json.dump({"hookSpecificOutput": {"hookEventName": "SessionStart",
                                      "additionalContext": "\n\n".join(parts)}},
              sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
