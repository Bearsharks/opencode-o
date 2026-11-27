#!/usr/bin/env python3
"""Stop hook: keep the turn open once when the reply to the user is clearly not Korean."""
import json
import os
import re
import sys

# Code, URLs and paths stay in their original language, so they are not counted.
NOT_PROSE = re.compile(r"```.*?```|`[^`\n]*`|https?://\S+|(?:~|\.{1,2})?/[\w.\-/@]+", re.S)
HANGUL = re.compile(r"[가-힣]")
LATIN = re.compile(r"[A-Za-z]")

# Blocks only clear English. In past sessions Korean replies had a Hangul share of
# 0.28 or more, and English replies 0.01 or less.
MAX_HANGUL_SHARE = 0.05
MIN_LATIN = 20

REASON = ("사용자에게 한 마지막 답변이 한국어가 아니다. 같은 내용을 한국어로 다시 답하라. "
          "코드, 경로, 명령은 원문 그대로 둔다.")


def is_english(text):
    prose = NOT_PROSE.sub(" ", text)
    hangul = len(HANGUL.findall(prose))
    latin = len(LATIN.findall(prose))
    return latin >= MIN_LATIN and hangul / (hangul + latin) < MAX_HANGUL_SHARE


def main():
    try:
        event = json.load(sys.stdin)
    except ValueError:
        return
    if not isinstance(event, dict) or event.get("stop_hook_active"):
        return
    # Headless runs (claude -p, the SDK) answer another agent, which reads English.
    if os.environ.get("CLAUDE_CODE_ENTRYPOINT", "").startswith("sdk"):
        return
    if is_english(event.get("last_assistant_message") or ""):
        json.dump({"decision": "block", "reason": REASON}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
