# Strategist-State 운영 가이드

## 활성 구조

```text
driver = 사용자 목표를 구현하고 검증하는 owner
strategist = self-improvement skills와 delegated evidence로 판단·전략을 제공하는 read-only agent
probe-code = 좁은 repository evidence 수집자
strategist_state = strategist task 연속성과 driver read-awareness budget 관리
codex-self-improvement-bridge = skill catalog context와 turn-history hook 연결
```

활성 state plugin은 `strategist-state.ts` 하나만 둔다. `advisor-state.ts`와
동시에 활성화하면 read hook이 두 번 실행되어 예산이 이중 차감될 수 있다.

## Strategist 계약

상세 계약은 agent prompt가 아니라 self-improvement MCP가 관리하는 strategist
전용 skills에 있다.

- `advisor`: 기존 advisor의 판단, counterexample, required obligation,
  evidence delegation, decision contract를 보존한다.
- `plan`: 실행 계획을 만든다. 초기에는 plan item의 고정 schema를 두지 않는다.

driver가 strategist를 호출할 때 첫 non-empty line은 다음 canonical header 중
하나여야 한다.

```json
{"ask":"plan|advise|review"}
```

첫 호출은 새 strategist task를 만들고, 이후 호출은 같은 `task_id`를 이어간다.
응답은 기존 advisor envelope를 유지하며 plugin은 non-empty `decision`과
`summary`만 검증한다. 재판단 전 입력은 `needs`, 실행 완료 조건은 `required`에
담고 `plan` 내부 구조는 `plan` skill이 담당한다.

strategist 호출은 driver 수정의 선행 조건이 아니다. 사용자가 strategist 판단이나
계획을 요청했을 때 driver가 호출한다.

## Read budget

- driver session initial budget: 600 returned lines, 25,000 returned characters
- driver direct read: 100%
- driver-launched probe-code read: 25%, rounded up
- strategist-launched probe-code read: free from the driver budget
- remaining budget is reported on first charge, 75/50/25/10/0% milestones,
  and reads of at least 500 lines or 20,000 characters
- synthetic-only context from the self-improvement bridge does not initialize a
  driver budget

추가 예산은 driver가 `strategist_state`로 reason, strategy, 양의 정수 line/char
요청량을 제출하면 별도 승인 없이 누적된다.

```json
{"event":"allocate_read_budget","reason":"...","strategy":"...","requested_lines":1200,"requested_chars":50000}
```

## Agent boundaries

- strategist는 repository를 직접 읽거나 수정하지 않는다.
- strategist는 self-improvement `skill_list`와 `skill_view`만 사용하며
  `skill_manage`는 사용할 수 없다.
- strategist는 판단에 필요한 repository evidence를 probe-code에 직접 위임하고,
  직접 얻을 수 없는 user intent, external state, implementation/test result만 driver에 요청한다.
- probe-code는 evidence만 반환하고 방향이나 최종 결정을 선택하지 않는다.
- driver는 edit target을 직접 확인하고 구현·검증·final claim을 소유한다.

## Shell command hygiene

- 한 tool call에는 가능한 한 단순 명령 하나만 사용한다.
- `rg -m`, 좁은 경로, 정확한 symbol, focused range와 test filter를 선호한다.
- 출력 trimming만을 위해 shell control, pipe, redirect, command substitution을
  추가하지 않는다.
- 다중 파일 동작 합성은 probe-code를 사용하고 edit target은 driver가 직접 읽는다.

## 활성화와 롤백

strategist v1 활성화(state plugin과 driver/strategist/probe-code prompt를 함께 복원):

```bash
bash /Users/jsp1226/.config/opencode/plugin/activate-strategist-state-v1.sh
```

advisor v5 롤백(state plugin과 기존 driver/advisor/probe-code prompt를 함께 복원):

```bash
bash /Users/jsp1226/.config/opencode/plugin/rollback-strategist-state-v1-to-advisor-v5.sh
```

기존 `_advisor-state-v5/` 소스는 변경하지 않은 복구 자산이다. strategist 운영 중에는
두 state plugin이 함께 활성화되지 않도록 위 전용 activation/rollback script를 사용한다.
새 agent prompt snapshot은 `_strategist-state-v1/agents/`에 있고, 기존 agent prompt
snapshot은 아래 backup에 있다.

전환 전 agent와 v5 snapshot은 다음 경로에 있다.

```text
/Users/jsp1226/.config/opencode/backups/strategist-v1-20260722/
```

새 구현의 상세 계약과 smoke coverage는
`_strategist-state-v1/README.md`와 `strategist-state.smoke.ts`를 기준으로 한다.
