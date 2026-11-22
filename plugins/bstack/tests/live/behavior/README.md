# `bstack-feature` 라이브 행동 시험

**오케스트레이터만 실행한다.** `--max-cost-usd`는 승인받은 해당 턴의 양수 USD 상한이다.
실행기는 이 값을 `claude --max-budget-usd`로 넘겨 상위 Claude 턴의 비용을 끊는다. 하위 opencode
작업자 비용은 여기에 들어가지 않으니 오케스트레이터가 따로 확인한다. 기존 인증을 사용하고 인증 파일은 복사하지 않는다.

## 실행

소스 레포 루트에서 실행한다. `CAP_FIRST`, `CAP_NEXT`는 승인받은 각 턴 상한이다.
명령이 출력한 `id=…`를 해당 변수에 넣고, **다음 턴을 실행하기 전에 사람이 해당 질문이나 확인문을 읽는다.**

```bash
suite="$PWD/plugins/bstack/tests/live/behavior"
bash "$suite/run-case.sh" question opus --max-cost-usd "${CAP_FIRST:?}"
bash "$suite/run-case.sh" question opus --max-cost-usd "${CAP_NEXT:?}" --ask "$FIRST_ID"
# 확인의 의미를 검토하고 세 번째 턴 예산이 승인된 경우에만:
bash "$suite/run-case.sh" question opus --max-cost-usd "${CAP_CONFIRM:?}" --ask "$ANSWER_ID"
```

다른 사례도 표의 이름과 모델을 사용한다. 판정은 사람이 한다. 각 턴의 마지막 메시지와 PRD를 읽고 아래 표의 기대와 비교한다.
첫 턴은 `<source plugin>/state/behavior/<case>/`에 별도 Git 루트와 제품·플러그인 복사본을 생성한다. 입력 및 검증 기록은 Git 루트 옆의 `.<case>-state/`에 둔다.
모델 없이 생성만 하려면 `python3 -B "$suite/fixture.py" <case>`를 실행한다. `run-case.sh` 첫 실행은
기존 경로를 덮지 않으므로 재시험 전 기존 픽스처와 상태 디렉터리를 다른 곳에 보관한다.

다음 답은 임시 파일 없이 `bstack-run ask --brief -`의 stdin으로 넘겨 동일 세션의 새 run에 전달한다. 플러그인 복사본에
하네스의 소스(`tests/`)를 넣지 않는다. 이 배치는 레포 탐색 중 우연히 미리 읽는 것을 막기 위한 것이지
레포 바깥을 차단하는 파일시스템 샌드박스는 아니다.

| 사례 | 모델 | 사람이 읽을 내용 |
|---|---|---|
| `clear` | `opus` | 작성된 draft, 검수 없이 확인 대기. 사용자 기준(원문)과 에이전트 제안을 나누고, 요구사항의 성공 정의·성공 정의 근거·검증·검증 근거를 확인한다. 기본 목록 숨김, `--all`의 `[x]`, 없는 ID의 stderr `no such item`과 종료 1을 확인한다. 확인을 주는 다음 턴은 승인. |
| `clear-auto` | `opus` | 자율 진행 명시가 `> ` 원문에 포함된다. 별도 확인 턴 없이 독립 승인. |
| `question` | `opus` | 초기 draft: `F-01/성공 정의`에서 복원 위치를 글로 묻고 PRD 본문은 초기 템플릿이다. 다음 턴은 답 원문을 붙이고 ‘내 메모’로 복원하되 폴더는 복원하지 않는 후보를 **확인 대기**한다. 확인을 주는 세 번째 턴은 승인. |
| `mode-positive` | `opus` | mode 진입 → 실제 `bstack-feature` `Read` 완료 → `start`. 초기에는 메모/폴더 범위 질문, 다음 턴은 원문 답을 보존한 후보와 별도 확인, 마지막 턴은 독립 승인. 승인 전 플레이북을 열지 않는다. |
| `mode-negative` | `sonnet` | 승인받은 오타 수정으로 `labels.txt`가 정확히 `Welcome` 한 줄이 된다. PRD·`bstack-feature` 관문 및 다른 제품 변경 없음. 계획만 보고하면 통과가 아니다. |
| `availability` | `sonnet` | 독립 승인, 제품 불변. 사람이 실제 조사/예행 로그에서 CSV와 `tests/pilot.py` 관찰이 작성 전에 있었는지, 목표와 검증 근거가 각각 문제의 증거와 관찰 수단의 가용성·한계를 정확히 인용하는지 확인한다. |
| `resume` | `sonnet` | 30일 기준의 초기 독립 승인, 다음 턴에 45일 답을 그대로 append하고 새로운 독립 승인. 사람이 다른 기준과 변경 범위를 확인한다. 늦게 도착한 판정의 무효화는 비용 없는 `test_start_invalidates_late_ready_without_freeing_review_slot`에서 확인한다. |
| `recover` | `sonnet` | 픽스처 전용 래퍼가 첫 실제 검수 결과를 한 번 자른다. 잘린 검수와 별도인 새 정상 검수로 승인되어야 한다. 복구 불가 보고는 통과가 아니다. 나머지 CLI 장애·경주는 결정론적 PRD 시험에 맡긴다. |

## 기록

턴별 명령, 종료 코드, 전후 경로/바이트 목록, 요청 원문, `status`와 `result`는
`.<case>-state/turns/{first,answered,confirmed}/`에 남는다. Run 기록은
`<fixture>/plugins/bstack/state/runs/<repo-name>-<sha256(repo path)[:12]>/<run id>/`에 무기한 보관된다.
해당 픽스처에서 플러그인 복사본의 `bstack-run status ID`와 `bstack-run result ID`로 확인할 수 있다.

## 비용 없는 검증

```bash
for script in "$suite/run-case.sh" "$suite"/fixtures/*.sh; do bash -n "$script" || break; done
```
