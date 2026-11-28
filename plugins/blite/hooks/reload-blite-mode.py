#!/usr/bin/env python3
"""SessionStart(compact) hook: put blite mode's skill back in context after a compaction.

A compaction summary keeps the gist of the rules, not the rules. When /blite:blite-mode ran
earlier in the session, re-add the skill as invoking it does: its base directory and body.
The skill tells the lead which documents to read; they are not inlined, so the text stays
small enough to arrive in full.
"""
import json
import sys
from pathlib import Path

PLUGIN = Path(__file__).resolve().parent.parent
SKILL = PLUGIN / "skills" / "blite-mode" / "SKILL.md"
COMMAND = "<command-name>/blite:blite-mode</command-name>"

HEADER = "/blite:blite-mode ran in this session before the compaction. Its skill follows as it is now."


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


def skill_body():
    text = SKILL.read_text(encoding="utf-8")
    if text.startswith("---\n"):
        end = text.find("\n---\n", 4)
        if end != -1:
            text = text[end + 5:]
    return text.strip()


def main():
    try:
        event = json.load(sys.stdin)
    except ValueError:
        return
    transcript = event.get("transcript_path") if isinstance(event, dict) else None
    if not transcript or not Path(transcript).is_file() or not blite_mode_ran(transcript):
        return
    context = f"{HEADER}\n\nBase directory for this skill: {SKILL.parent}\n\n{skill_body()}"
    json.dump({"hookSpecificOutput": {"hookEventName": "SessionStart",
                                      "additionalContext": context}},
              sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
