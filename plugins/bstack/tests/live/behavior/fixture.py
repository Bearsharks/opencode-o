"""Build fresh fixtures without starting a model."""

import os
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parents[2]
SCRATCH = PLUGIN / "state" / "behavior"
MODELS = {"clear": "opus", "clear-auto": "opus", "question": "opus",
          "mode-positive": "opus", "mode-negative": "sonnet",
          "availability": "sonnet", "resume": "sonnet"}
AUTO = "이 요청은 확인 없이 알아서 독립 검수까지 진행해 줘. 구현은 시작하지 마.\n"
CONFIRM = "보여 준 후보를 독립 검수에 제출해 줘.\n"
ANSWERS = {
    "clear": (CONFIRM,),
    "question": ("내 메모로 복원, 폴더 자체는 복원 안 함.\n", CONFIRM),
    "mode-positive": ("복구 대상은 메모만이야. 폴더는 포함하지 않아. 승인된 PRD 값만 전달하고 구현은 하지 마.\n",
                      CONFIRM),
    "resume": ("휴지통은 45일 보관해. 30일이란 기준을 대체하고 다른 조건은 유지해.\n" + AUTO,),
}


def state_dir(root):
    return root.parent / f".{root.name}-state"


def put(root, name, text):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def clear(root):
    put(root, "todo.py", """import sys

ITEMS = {1: ("First", False), 2: ("Second", True)}

if __name__ == "__main__":
    if sys.argv[1:] != ["list"]:
        sys.exit("usage: todo list")
    for item_id, (title, done) in ITEMS.items():
        if not done:
            print(f"{item_id} [ ] {title}")
""")
    put(root, "tests/test_todo.py", """import subprocess
import sys
from pathlib import Path

import pytest

@pytest.fixture
def todo_cli():
    script = Path(__file__).resolve().parents[1] / "todo.py"
    return lambda *args: subprocess.run(
        [sys.executable, str(script), *args], capture_output=True, text=True)

def test_active_list(todo_cli):
    result = todo_cli("list")
    assert result.returncode == 0
    assert result.stdout == "1 [ ] First\\n"
""")
    put(root, "evidence/list-pilot.md", """Fixture pilot: `python3 todo.py list` printed
`1 [ ] First`, with empty stderr and exit 0. This checks access, not `done`.
""")
    return """Plan `todo done <id>`. A completed item disappears from the default list
and is shown as `[x]` by `list --all`. A nonexistent ID must print exactly
`no such item` on stderr and exit 1. Use the existing pytest subprocess fixture
in `tests/test_todo.py` and observe stdout/stderr/exit status on the local CLI.

I lose my place when completed items mix with active ones. Keep the current
rule that the default list shows active items only. The access rehearsal in
`evidence/list-pilot.md` observes the existing list, not the new feature.
"""


def jot(root):
    put(root, "jot.py", """# Existing note listing only; trash/recovery is not implemented.
NOTES = [("A", "m1", "a note"), ("B", "m2", "b note")]

def notes_for(owner):
    return [(key, text) for account, key, text in NOTES if account == owner]

if __name__ == "__main__":
    for owner in ("A", "B"):
        print(owner, notes_for(owner))
""")


FOLDER_QUESTION = """원래 폴더가 **없어졌을 때만**, '내 메모'(최상위)로 복원할지,
폴더 자체까지 복원할지는 내가 정할게. 이 결정의 주소는 `F-01/성공 정의`야.
AskUserQuestion은 이 환경에서 쓸 수 없으니 내 결정이 필요하면 글로 물어봐.
다음 메시지 전에는 어느 쪽도 선택하거나 범위에서 제외하지 마."""


def question(root):
    jot(root)
    put(root, ".claude/settings.json", '{"permissions":{"deny":["AskUserQuestion"]}}\n')
    put(root, "docs/support/2026-10-tickets.csv",
        "week,tag,count\n1,메모 복구,14\n2,메모 복구,11\n3,메모 복구,13\n4,메모 복구,12\n")
    put(root, "evidence/rehearsal.md", """가상 프로젝트의 예행 기록이며 새 기능 통과는 아니다.
`python3 jot.py`로 접근했고 A와 B에서 각 계정의 ID·본문만 출력됐다.
검증용 CLI 스냅샷, 테스트 저장소 읽기 전용 조회, 밀리초 가상 시계를
같은 테스트 환경에서 이용할 수 있다. 서버를 재기동하거나 요청을 보내지
않고 31일 전진시켜 기존 백그라운드 유지 작업 로그를 관찰했다는 제공 기록이다.
지원 리드는 같은 필터로 내보내기를 재현했다. 문의 건수는 CSV에 있다.
""")
    return f"""Jot에 삭제한 메모용 휴지통을 기획해 줘. 메모가 삭제되면 목록·검색에서
숨기고 휴지통에 삭제 시각을 보여 줘. 소유자만 보고 복원할 수 있어.
복원할 때 ID, 제목, 본문, 수정 시각을 유지하고 남아 있는 원래 폴더로
돌려보내. {FOLDER_QUESTION}

30×24시간이 지나기 전에는 복원이 가능해야 해. 그 경계 이후 1시간 안에
사용자 조작 없이 활성 저장소에서 영구 삭제하고 목록·검색·옛 주소·복원
경로에서 볼 수 없게 해. 백업 정책, HTTP 상태 코드, 활성 메모를 '내 메모'로
옮기는 기존 폴더 삭제 동작은 변경하지 않아. 비우기를 취소하면 그대로,
확인하면 자기 계정만 즉시 영구 삭제하며 다른 계정은 대신 비울 수 없어.

메모 복구 문의는 `docs/support/2026-10-tickets.csv`에 기록돼 있어.
예행은 `evidence/rehearsal.md`에 있어.
기능은 로컬 A·B, CLI 스냅샷, 저장소 관찰, 가상 시계와 기존 자동 경로로
검증해. 만료 직전과 +1시간을 관찰하고 새 기능이 예행됐다고 주장하지 마.
"""


def mode_positive(root):
    jot(root)
    put(root, ".claude/settings.json", '{"permissions":{"deny":["AskUserQuestion"]}}\n')
    return """Jot에 사용자가 삭제한 것을 스스로 복구할 수 있는 새 기능을 기획해 줘.
복구 대상을 메모만으로 할지, 폴더까지 포함할지 아직 결정하지 않았어.
범위에 따라 성공 기준이 달라져. 이 결정의 주소는 `F-01/성공 정의`야.
AskUserQuestion을 쓸 수 없으면 글로 물어봐.
복구 도움 요청 수와 로컬 관찰 예행은 `evidence/pilot.md`에 있어.
로컬 CLI에서 소유자와 타 계정으로 목록 및 저장소를 관찰해.
삭제한 메모는 일반 목록에 숨기고 소유자만 복구할 수 있어야 해.
"""


def mode_negative(root):
    put(root, "labels.txt", "Welcomme\n")
    return """`labels.txt`의 표시 문구 `Welcomme`를 `Welcome`으로 고쳐 줘.
이 오타 수정만 바로 진행해 줘. 다른 파일이나 동작은 바꾸지 말고 커밋하지 마.
`cat labels.txt`가 `Welcome` 한 줄이면 성공이야.
"""


def resolved_jot(root):
    return question(root).replace(FOLDER_QUESTION,
        "'내 메모'로 복원하고 폴더 자체는 복원하지 마.") + AUTO


def availability(root):
    text = resolved_jot(root)
    (root / "evidence/rehearsal.md").unlink()
    put(root, "tests/pilot.py", """# Rehearse access only, not the unimplemented feature.
import sqlite3

db = sqlite3.connect(':memory:')
db.execute('create table notes(owner, body)')
for owner in ('A', 'B'):
    db.execute('insert into notes values (?, ?)', (owner, owner + '-note'))
for owner in ('A', 'B'):
    print(f'capture:{owner}', db.execute('select body from notes where owner=?', (owner,)).fetchall())
wakeups = []
wakeups.append(31 * 24 * 60 * 60 * 1000)
print('simulated background tick', wakeups)
""")
    return text.replace("예행은 `evidence/rehearsal.md`에 있어.",
        "레포 안에서 로컬 관찰 예행을 찾아 조사해. "
        "시뮬레이터는 접근 예행일 뿐이고 실제 앱의 자동 삭제 검증은 아니야.")


def prepare(case):
    # Refuse to replace evidence from any earlier attempt.
    root = (SCRATCH / case).resolve()
    root.mkdir(parents=True)
    state = state_dir(root)
    created_state = False
    try:
        state.mkdir(mode=0o700)
        created_state = True
        env = {key: value for key, value in os.environ.items()
               if key not in ("GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR",
                              "GIT_OBJECT_DIRECTORY", "GIT_INDEX_FILE")}
        subprocess.run(["git", "init", "--quiet", "--template=", str(root)],
                       check=True, env=env)
        for key, value in (("user.name", "Bstack Fixture"), ("user.email", "fixture@example.invalid")):
            subprocess.run(["git", "-C", str(root), "config", "--local", key, value],
                           check=True, env=env)
        put(root, ".git/info/exclude", "/plugins/bstack/state/\n")
        plugin = root / "plugins/bstack"
        ignore = shutil.ignore_patterns("__pycache__", ".git", ".bstack", ".env", ".env.*",
                                       ".credentials.json")
        # Omit run records and the harness (which contains future user replies).
        shutil.copytree(PLUGIN, plugin, ignore=lambda path, names:
                        ignore(path, names) | ({"state", "tests"} if Path(path) == PLUGIN else set()))
        recipe = {"question": question, "mode-positive": mode_positive, "mode-negative": mode_negative,
                  "availability": availability, "resume": resolved_jot}.get(case, clear)
        text = recipe(root)
        if case == "mode-positive":
            put(root, "evidence/pilot.md", "Fixture pilot: 12 recovery requests in 4 weeks; the support lead "
                "replayed the same helpdesk filter. `python3 jot.py` showed only each account's own notes.\n")
        skill = "bstack-mode" if case.startswith("mode-") else "bstack-feature"
        text = (f"/bstack:{skill}\n\n{text}\n필요 시 PRD 이름은 `{case}`, 플러그인 복사본은 `{plugin}`이야. "
                "그 복사본의 도구를 이 레포에서 사용해.\n")
        if case != "mode-negative":
            text += (f"기획만 해. 검수에 필요한 `.bstack/{case}/` 파일만 커밋해도 돼. "
                     "다른 파일의 수정·커밋이나 구현 착수는 승인하지 않아. "
                     "새로 작성해 PRD에 링크하는 예행 기록은 PRD 폴더의 evidence/에 남겨 줘.\n")
        if case == "clear-auto":
            text += AUTO
        put(state, "input.md", text)
    except BaseException:
        shutil.rmtree(root)
        if created_state:
            shutil.rmtree(state)
        raise
    return root


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in MODELS:
        sys.exit(f"usage: {sys.argv[0]} {{{','.join(MODELS)}}}")
    print(prepare(sys.argv[1]))
