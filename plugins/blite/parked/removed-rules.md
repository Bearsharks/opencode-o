# 지운 규칙

구조를 분야별로 나누면서 지운 규칙이다. 다른 자리로 옮긴 규칙은 여기에 없다. 원문은 `d6602d2` 커밋의 해당 파일에 있다.

## 모델이 지시 없이도 하거나, 방식만 고정하던 규칙

| 규칙 | 있던 곳 | 지운 이유 |
|---|---|---|
| 플레이북의 단계를 todo 목록으로 옮긴다 | `skills/blite-mode/SKILL.md` | 진행을 어떻게 추적할지는 리드가 정한다 |
| 첫 답에서 사용자의 목표와 그것을 이루는 가장 작은 변경을 다시 말한다. 최종 보고를 목표로 시작한다 | `skills/blite-mode/SKILL.md` | PRD 단계가 목표를 사용자와 정한다 |
| 짧은 평서문으로 쓰고 긴 줄표와 연결용 쌍점을 쓰지 않는다 | `skills/blite-mode/SKILL.md` | 문체 규칙이다 |
| 어차피 전부 읽을 짧은 것의 요약이나 판정은 위임하지 않는다. 이미 확인한 근거를 다시 읽거나 다시 적지 않는다 | `skills/blite-mode/SKILL.md` | 위임 기준 한 문장으로 충분하다 |
| 사용자가 정해야 하면 `AskUserQuestion`을 쓴다 | `skills/blite-mode/SKILL.md` | 어떤 도구로 물을지는 리드가 정한다 |
| 검수 체크아웃을 만드는 git 명령, 다시 검수할 때 체크아웃을 옮기고 `HEAD`를 확인하는 명령 | `skills/blite-mode/playbooks/shipping.md` | 지켜야 할 결과(고정한 head의 체크아웃, 다른 작업이 쓰지 않을 것)만 남겼다 |

## 작업자에게 전달되지 않던 규칙

`templates/worker-brief.md`의 규율 절은 `bstack-run`이 붙이지 않았고, 리드 스킬은 brief에 옮기지 말라고 했다. 아래는 그 절에만 있던 규칙이다.

| 규칙 | 지운 이유 |
|---|---|
| 맡은 일을 다른 작업자에게 넘기지 않는다 | Shipping 작업자는 검수자를 띄워야 한다. 넘겨도 되는지는 brief가 정한다 |
| 시작할 때 받은 기준이 기준의 전부다. 그 위에 검사, 관문, 승인, 검수를 더하지 않는다 | 전역 지침의 "요청에 없는 것을 더하지 않는다"에 포함된다 |
| 기준이 없으면 변경은 기준 브랜치보다 나쁘지 않고 자기 테스트를 통과해야 한다 | 모든 구현 brief가 고정한 검증을 기준으로 받는다 |
| 이 head에서 실패하는 실행이나 사용자가 겪을 버그일 때만 붙잡는다. 기준 브랜치에 이미 있던 문제는 한 줄로 보고한다 | 범위 밖 발견의 처리는 전역 지침이 정한다 |
| 작업자 보고는 `PASS`, `ISSUES`, `BLOCKED`로 한다 | 작업자 보고는 `STATUS`의 `done`, `blocked`, `failed`로 통일했다 |
| PR 본문의 `Scope`, `Tradeoffs`, `Blast Radius` 제목 | PR 형식은 `blite-build`의 세 제목으로 통일했다 |
| brief에 산출물의 구조와 최종 답의 최대 줄 수를 적는다 | 완료 기준과 전역 지침의 보고 형식으로 충분하다 |
| 참고 자료는 사실의 출처가 아니다 | 전역 지침의 자료 우선순위로 충분하다 |

## 다른 것이 이미 보장하는 규칙

| 규칙 | 있던 곳 | 보장하는 것 |
|---|---|---|
| terra를 쓰지 않는다 | `skills/blite-mode/SKILL.md` | `config/models.json`의 `deny` |
| 구현 작업자와 조사 작업자는 커밋하지 않는다 | `templates/preamble/impl.md`, `templates/preamble/explore.md` | 권한은 brief가 준다. oc-lite의 작업자 지침도 일괄 금지를 하지 말라고 한다 |
| 독립 검수는 오케스트레이터가 시작한 세션이어야 한다 | `templates/preamble/impl.md`, `templates/worker-brief.md` | 전역 지침이 누가 시작했는지가 아니라 성질로 정의한다 |
| 검수자는 PR을 고치거나 게시하거나 병합하지 않는다 | `templates/review-structure.md`, `templates/review-behavior.md` | 검수 역할 지침의 "읽기만 한다" |
| PRD 검수자는 위임하지 않고 사용자에게 직접 묻지 않는다 | `skills/blite-feature/references/reviewer.md` | 전역 지침의 `NEXT`와 검수 역할 지침 |

## 에이전트가 승인된 것을 스스로 바꾸는 경로

승인된 산출물은 사용자가 지시할 때만 바뀐다. 그때의 방식(행을 빼고 더한다)은 `blite-feature`와 `blite-checks`에 있다.

| 규칙 | 있던 곳 |
|---|---|
| 검증이나 설계가 틀렸다고 본 작업자는 멈추고 보고한다 | `skills/blite-mode/playbooks/feature.md` |
| 3단계 이후 설계나 범위 안의 검증을 바꿔야 하거나 계약 충돌이 작업을 막으면 리드가 스스로 정하고 새 check SHA를 고정한다 | `skills/blite-mode/playbooks/feature.md` |

## 쓰는 곳이 없던 것

| 내용 | 있던 곳 |
|---|---|
| `bstack-run`의 명령 목록과 모델 접두어 설명 | `templates/preamble/impl.md`, `templates/preamble/explore.md` |
| Claude Code 번들 스킬의 경로와 `disable-model-invocation` 설명 | `templates/preamble/impl.md`, `templates/preamble/explore.md` |
| `panel` 역할 | `bin/bstack-run`, `config/models.json` |
