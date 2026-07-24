# Advisor-State 운영 가이드

## 목적

v4는 advisor-as-tool 구조다.

```text
driver = 사용자 목표를 높은 품질로 끈질기게 완수하는 owner
advisor = 부족한 정보, 다음 행동, 검증, final claim을 돕는 판단 도구
advisor_state = advisor 사용과 반영 상태, stale 여부를 기록하는 도구
```

## 구성 요소

- `driver`: 작업 owner. 부족함을 인정하고 advisor와 협업하면서 목표를 완수한다.
- `advisor`: read-only decision tool. 부족한 정보, 계획 판단, 다음 작업을 구체화한다.
- `advisor_state`: advisor 호출, 적용 요약, 현재 diff 기준 stale 여부를 기록한다.
- `probe-code`: 좁은 repo evidence 수집자. advisor 대체가 아니다.
- `scout-web`: 외부 문서/dependency/current evidence 수집자.

## v4 원칙

- 난이도 분류 없음
- 필수 middle review 없음
- 별도 승인 단계 없음
- edit 차단 없음
- 첫 edit 전 advisor를 예외 없이 최소 1회 호출
- 이후에도 불확실한 방향, 약한 evidence, 검증 전략, 넓은 final claim이 있으면 advisor를 적극 활용
- gate는 edit을 막지 않음

첫 advisor 호출은 direction check다. 파일마다 부르는 review가 아니며, phase-gate처럼
edit을 막는 절차도 아니다. 다만 driver는 source, test, config, prompt, workflow
contract, docs, artifact를 처음 수정하기 전에 반드시 advisor에게 한 번 판단을 맡긴다.

## 재상담 루브릭

첫 advisor 호출 이후에는 파일마다 다시 묻지 않는다. 대신 아래 기준으로 재상담한다.

재상담한다:

- plan validity 변경: advisor plan과 다른 boundary, file family, owner, approach가 필요해짐
- semantics 변경: shared helper, policy, registry, loader, permission, cache, routing,
  execution order, persistence, public contract, model-visible behavior에 영향
- evidence 변경: 새 사실이 기존 조언을 반박, 약화, 확장, 좁힘
- scope 변경: raw user request에서 드리프트하거나 final claim이 evidence보다 넓어짐
- validation 변경: validation 실패 후 다음 수정이 기계적이지 않거나 검증 전략이 불확실함
- required item ambiguity: advisor required를 여러 의미 있는 방식으로 처리할 수 있음
- broad claim risk: `all`, `no other`, `always`, `safe`, `preserved`, `unchanged` 주장 위험

대체로 재상담하지 않는다:

- advisor plan과 같은 boundary 안에서 실행 중
- semantics, scope, validation strategy, final claim을 바꾸지 않는 좁은 구현 디테일
- advisor가 요구한 validation을 추가하거나 실행하는 중
- behavior/contract에 영향 없는 기계적 편집

애매하면 advisor에게 묻는다. 의미 있는 선택을 재상담 없이 진행했다면
`advisor_state(event="record_application")`에 이유를 남긴다.

## Advisor Context

필수:

```json
{
  "ask": "choose_direction|unstick|continue_or_replan|finalize_claim",
  "raw_user_request": "",
  "context_digest": ""
}
```

선택:

```json
{
  "objective": "",
  "facts": [],
  "evidence": [],
  "constraints": [],
  "candidate_actions": [],
  "unknowns": [],
  "current_diff": [],
  "validation": [],
  "advisor_history": []
}
```

driver는 advisor가 제대로 도울 수 있도록 충분히 자세한 정보를 준다. 짧고 모호한
packet은 약한 판단을 만든다. 목표, 지금까지 한 일, 확인한 사실, 증거, 제약,
미확인점, 현재 diff, validation 상태, advisor에게 묻고 싶은 판단 질문을 가능한 한
구체적으로 제공한다.

candidate는 있을 수도 있고 없을 수도 있다. candidate는 메뉴가 아니다. advisor는
후보를 선택, 수정, 대체하거나 더 많은 evidence/tests/replan/block을 요구할 수 있다.

## Advisor Judgment

필수는 `decision`, `summary`뿐이다.
`plan`은 선택 필드다. driver가 방향, 재계획, 막힘 해소, 계속 진행 여부를 물으면
계획 판단은 advisor가 담당한다. 다만 아직 todo-list 형식은 강제하지 않는다.

```json
{
  "decision": "act|continue|request_more_evidence|request_tests|replan|block|finalize",
  "summary": "",
  "plan": [],
  "required": [],
  "allowed_claims": [],
  "risks": [],
  "notes": []
}
```

`plan`은 다음 작업 구간의 진행 계획이다. `required`는 계획이 아니라 obligation,
evidence requirement, completion condition, constraint를 담는다.

advisor `required` 항목은 조언이 아니라 obligation이다. driver는 "읽었다/확인했다"로
완료 처리하지 말고, 각 항목마다 실제 달성 증거를 남긴다.

- obligation
- evidence produced
- validation command, if any
- remaining gap, if any

해소 방식은 file:line + semantic explanation, validation, advisor가 받아들인
explicit scope-out, revised plan 중 하나여야 한다.

## Shell Command Hygiene

이 기준은 주로 driver 프롬프트에 적용된다. 출력은 줄이되 shell control로 억지로 자르지 않는다.

- 한 tool call에는 가능한 한 단순 명령 하나만 사용
- 가능한 경우 tool-level output limit 사용
- `rg -m`, 좁은 경로, 정확한 symbol, focused file/range read, focused test file/filter 사용
- 검색은 `permission` 같은 넓은 키워드보다 `Permission\.disabled\(` 같은 안정적인 call shape부터 시작
- 단일 좁은 조회는 `rg`, 파일 발견은 `rg --files`, 다중 파일 동작 합성은 `probe-code`
- 출력 trimming 목적만으로 `;`, `&&`, `||`, pipe, redirect, command substitution, hidden error 사용 금지
- read-only 명령이 조합/pipe/redirect 때문에 권한 요청을 만들면 승인 요청보다 단순 명령으로 분리

## Advisor State

도구 이벤트:

- `record_advisor_call`
- `record_application`
- `check_staleness`

v4에서 우선 적용하는 습관화는 `record_application`이다. driver는 advisor 조언을
받은 뒤 그것을 어떻게 실행했는지 기록한다. advisor는 다음 조언을 시작할 때
`advisor_state(event="check_staleness")`로 이전 조언 사용 이력과 stale 여부를 직접
확인할 수 있다. 이 이력은 감시용이 아니라, advisor가 "어떻게 조언해야 driver가 더
목표를 잘 달성하는지"를 조정하기 위한 피드백이다.

예시:

```json
{
  "event": "record_application",
  "advisor_id": "advisor_1_abc",
  "applied_summary": "Checked API prefix first, then changed only the frontend endpoint. Did not add backend alias."
}
```

`advisor_state`가 diff hash와 changed files를 계산한다. driver가 직접 넣지 않는다.

`check_staleness`는 최신 advisor 적용 이후 현재 diff가 달라졌는지 알려준다. stale이면
driver는 advisor에게 다시 묻거나 final claim을 좁힌다.

## 활성화와 롤백

v4 활성화:

```bash
bash /Users/jsp1226/.config/opencode/plugin/activate-phase-gate-v4.sh
```

v3 rollback:

```bash
bash /Users/jsp1226/.config/opencode/plugin/rollback-phase-gate-v3.sh
```

v2 rollback:

```bash
bash /Users/jsp1226/.config/opencode/plugin/activate-phase-gate-v2.sh
```

v1 rollback:

```bash
bash /Users/jsp1226/.config/opencode/plugin/rollback-phase-gate-v1.sh
```
