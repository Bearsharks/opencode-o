"""Reviewer-only semantic counterexamples; a human checks the full findings."""

from difflib import unified_diff

REVIEWER_MODELS = {
    "ready": "sonnet", "recheck": "sonnet", "omitted": "haiku",
    "manual-expiry": "haiku", "status-code": "haiku", "cross-account": "haiku",
    "comparison": "haiku", "cross": "haiku", "surface": "haiku", "policy": "haiku",
    "single-transition": "haiku",
}


def replace(text, old, new):
    if old not in text:
        raise ValueError(f"stale reviewer example: {old!r}")
    return text.replace(old, new, 1)


def replace_line(text, prefix, new):
    old, = (line for line in text.splitlines(keepends=True) if line.startswith(prefix))
    return replace(text, old, new)


def mutate(case, docs):
    v, r, i, e = (docs[name] for name in ("verification.md", "request.md", "index.md", "evidence.md"))
    if case == "omitted":
        r = replace(r, "## 예시 안내", "### 추가 답변\n\n"
                    "> 키보드만으로 휴지통에서 메모를 보고 복원할 수 있어야 해.\n\n## 예시 안내")
    elif case == "manual-expiry":
        v = replace(v, "그 경로에 시간이 흐른", "수동 전용 테스트 작업에 시간이 흐른")
        v = replace(v, "자동 삭제 작업을 직접 호출하거나, 만료 후 첫 화면 요청·재시작으로 삭제를 유발하면 이 시험은 통과가 아니다.",
                    "검증자가 수동 테스트 작업을 직접 호출해야 만료를 확인할 수 있다.")
        v = replace(v, "요청·재시작·수동 작업 호출 없이 시간을 `m1` 만료 +1시간까지 진행",
                    "시간을 `m1` 만료 +1시간까지 진행하고 작업을 직접 호출")
    elif case == "status-code":
        v = replace(v, "옛 URL의 HTTP 상태 코드 자체는 판정하지 않는다", "옛 URL은 HTTP 404를 반환해야 한다")
    elif case == "cross-account":
        v = replace_line(v, "| B 세션에서 A의 휴지통을 대상으로 ", "")
    elif case == "comparison":
        v = replace_line(v, "**비교 규칙", "**비교 규칙:** 변경 시 비교가 가능하면 판정한다.\n")
    elif case == "cross":
        v = replace(v, "둘 다 휴지통과 저장소에 있고 복원할 수 있다", "둘 다 휴지통과 저장소에 있지만 복원이 실패해야 한다")
    elif case == "surface":
        e = e.split("## E-04", 1)[0] + "## E-04 시계 예행\n\n가상 시간과 자동 경로를 확인할 계획이다. 아직 예행 기록은 없다.\n"
    elif case == "policy":
        r = replace(r, "'내 메모'(최상위)로 복원. 폴더 자체 복원은 이번에 안 해.",
                    "'내 메모'(최상위)로 복원할지, 폴더까지 통째로 복원할지는 아직 정하지 않았어.")
    elif case == "single-transition":
        return {
            "request.md": "# 요청 원문\n\n> 카드 A, B, C 모두, 떠났다가 돌아오면 쓰던 초안이 복원돼야 해.\n\n## 이후 답변\n",
            "index.md": "# 카드 재개\n\n| ID | 성공 정의 | 검증 | 근거 |\n|---|---|---|---|\n"
                        "| H-01 | 카드 전환 뒤 초안 유실 신고 주 4건 → 주 1건 이하 | 운영 리드가 출시 전후 4주 동일 사용자 지원 CSV를 비교, 목표 이하면 지지, 초과면 기각, 표본 변경은 보류. 집계 docs/tickets.md | ① 기존 CSV 기준 주 4건 ② 신고 감소만 확인, 원인 단정 불가 |\n"
                        "| F-01 (→H-01) | 어느 카드에서든 돌아오면 초안을 다시 본다 | 로컬 A에 써 둔 뒤 B로 갔다가 A로 복귀했을 때 A 초안이 보여야 pass. 스크린샷 저장 | ① 요청의 초안 보존 ② 화면에서 돌아왔을 때 초안을 구별. 기존 로컬 앱에서 A·B·C 열기와 캡처 예행 |\n",
        }
    return dict(zip(("verification.md", "request.md", "index.md", "evidence.md"), (v, r, i, e)))


def reviewer_brief(plugin, case):
    refs = plugin / "skills/bstack-clarify/references"
    docs = {path.name: path.read_text(encoding="utf-8") for path in (refs / "example-prd").glob("*.md")}
    extra = "\n전체 검수다.\n"
    if case == "recheck":
        before = mutate("manual-expiry", docs)["verification.md"]
        diff = "".join(unified_diff(before.splitlines(True), docs["verification.md"].splitlines(True),
                                   "before/verification.md", "after/verification.md"))
        extra = ("\n## 직전 지적과 제출본 간 diff\n"
                 "F-02/검증: 수동 실행 없이 정상 자동 경로에서 삭제를 관찰할 수 있는지 봐라.\n\n" + diff)
    inline = "\n".join(f"\n=== {name} ===\n{data}" for name, data in sorted(mutate(case, docs).items()))
    return ("NO-PREAMBLE\n" + (plugin / "templates/preamble/reviewer.md").read_text(encoding="utf-8") +
            "\n\n" + (refs / "reviewer.md").read_text(encoding="utf-8") +
            "\n[제출 사본 절대경로] 대신 아래에 전체 제출 파일을 인라인한다.\n\n[작성 기준]\n" +
            (refs / "prd-format.md").read_text(encoding="utf-8") + extra + inline)
