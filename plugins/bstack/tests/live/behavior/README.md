# `bstack-clarify` 라이브 행동 시험

**오케스트레이터만 실행한다.** `--max-cost-usd`는 승인받은 해당 턴의 양수 USD 상한이다.
스크립트는 기록만 하며 API 비용을 제한하지 않는다. 상위 Claude, `ask`, 하위 조사·작성·검수를
모두 포함하여 호출·시간·비용을 제한한다. 기존 인증을 사용하고 인증 파일은 복사하지 않는다.

## 실행

소스 레포 루트에서 실행한다. `CAP_FIRST`, `CAP_NEXT`는 승인받은 각 턴 상한이다.
명령이 출력한 `id=…`를 해당 변수에 넣고, **다음 턴을 실행하기 전에 사람이 해당 질문이나 확인문을 읽는다.**

```bash
suite="$PWD/plugins/bstack/tests/live/behavior"
bash "$suite/run-case.sh" question opus --max-cost-usd "${CAP_FIRST:?}"
python3 -B "$suite/check-case.py" question "$FIRST_ID"
bash "$suite/run-case.sh" question opus --max-cost-usd "${CAP_NEXT:?}" --ask "$FIRST_ID"
python3 -B "$suite/check-case.py" question "$FIRST_ID" "$ANSWER_ID"
# 확인의 의미를 검토하고 세 번째 턴 예산이 승인된 경우에만:
bash "$suite/run-case.sh" question opus --max-cost-usd "${CAP_CONFIRM:?}" --ask "$ANSWER_ID"
python3 -B "$suite/check-case.py" question "$FIRST_ID" "$ANSWER_ID" "$CONFIRM_ID"
```

다른 사례도 표의 이름과 모델을 사용한다. `check-case.py`에는 지금까지의 ID를 순서대로 넘긴다.
첫 턴은 `${XDG_STATE_HOME:-$HOME/.local/state}/bstack/behavior/<case>/`에 별도 Git 루트와 제품·플러그인 복사본을 생성한다. 입력 및 검증 기록은 Git 루트 옆의 `.<case>-state/`에 둔다.
모델 없이 생성만 하려면 `python3 -B "$suite/fixture.py" <case>`를 실행한다. `run-case.sh` 첫 실행은
기존 경로를 덮지 않으므로 재시험 전 기존 픽스처와 상태 디렉터리를 다른 곳에 보관한다.
절대경로가 남는 이전 기록을 다시 판정하려면 원래 경로가 필요하다.

다음 답은 임시 파일 없이 `bstack-run ask --brief -`의 stdin으로 넘겨 동일 세션의 새 run에 전달한다. 플러그인 복사본에
하네스의 소스(`tests/`)를 넣지 않는다. 이 배치는 레포 탐색 중 우연히 미리 읽는 것을 막기 위한 것이지
레포 바깥을 차단하는 파일시스템 샌드박스는 아니다.

| 사례 | 모델 | 기계적 체크포인트와 사람이 읽을 내용 |
|---|---|---|
| `clear` | `opus` | 작성된 draft, 검수 없이 확인 대기. 사용자 기준(원문)과 에이전트 제안(필수/제외 질문)을 나눠 행별 성공 기준·두 근거·검증을 보인다. 기본 목록 숨김, `--all`의 `[x]`, 없는 ID의 stderr `no such item`과 종료 1, H 측정을 확인한다. 확인을 주는 다음 턴은 승인. |
| `clear-auto` | `opus` | 자율 진행 명시가 `> ` 원문에 포함된다. 별도 확인 턴 없이 독립 승인. |
| `question` | `opus` | 초기 draft: `F-01/성공 정의`에서 복원 위치를 글로 묻고 PRD 본문은 초기 템플릿이다. 다음 턴은 답 원문을 붙이고 ‘내 메모’로 복원하되 폴더는 복원하지 않는 후보를 **확인 대기**한다. 확인을 주는 세 번째 턴은 승인. |
| `mode-positive` | `opus` | mode 진입 → 실제 clarify `Read` 완료 → `start`. 초기에는 메모/폴더 범위 질문, 다음 턴은 원문 답을 보존한 후보와 별도 확인, 마지막 턴은 독립 승인. 승인 전 플레이북을 열지 않는다. |
| `mode-negative` | `sonnet` | 승인받은 오타 수정으로 `labels.txt`가 정확히 `Welcome` 한 줄이 된다. PRD·clarify 관문 및 다른 제품 변경 없음. 계획만 보고하면 실패. |
| `availability` | `sonnet` | 독립 승인, 제품 불변. 사람이 실제 조사/예행 로그에서 CSV와 `tests/pilot.py` 관찰이 작성 전에 있었는지, H/F가 가용성과 한계를 정확히 인용하는지 확인한다. |
| `resume` | `sonnet` | 30일 기준의 초기 독립 승인, 다음 턴에 45일 답을 그대로 append하고 새로운 독립 승인. 사람이 다른 기준과 변경 범위를 확인한다. 늦게 도착한 판정의 무효화는 비용 없는 `test_start_invalidates_late_ready_without_freeing_review_slot`에서 확인한다. |
| `recover` | `sonnet` | 픽스처 전용 래퍼가 첫 실제 검수 결과를 한 번 자른다. 잘린 검수와 별도인 새 정상 검수로 승인되어야 PASS. 복구 불가 보고는 사람이 읽되 PASS가 아니다. 나머지 CLI 장애·경주는 결정론적 PRD 시험에 맡긴다. |

### 검수자 단독 반례

같은 실행기로 `ready`·`recheck`(`sonnet`), 아래 반례(`haiku`)를 개별 실행한다.
`check-case.py`는 런·경계를 확인하고 검수 메시지 원문을 출력한다. **판정이나 지적의 의미는
PASS에 포함하지 않는다.** 서로 다른 실제 세션에서 `ready`/`recheck`를 실행하고,
제출 문서, 이전 지적과 diff, 실제 READY 근거를 대조한다.

| 사례 | 사람이 검토할 기대값 |
|---|---|
| `omitted` | REVISE: 키보드만으로 열람·복원하는 새 원문이 누락됐다. |
| `manual-expiry` | REVISE: 수동 호출은 사용자 조작 없는 자동 만료를 증명하지 못한다. |
| `status-code` | REVISE: 조회·복원 차단과 무관한 HTTP 상태 코드를 강제한다. |
| `cross-account` | REVISE: B가 A의 휴지통을 비울 수 없는지 실제로 확인하지 않는다. |
| `comparison` | REVISE: 채널·FAQ·분류 변경 시 비교 가능/판정불가 경계가 빠졌다. |
| `cross` | REVISE: 만료 전 복원 조건과 검증이 서로 모순된다. |
| `surface` | REVISE: 시계 및 자동 경로에 접근했다는 예행 근거가 없다. |
| `policy` | BLOCKED: 사용자가 정할 복원 위치를 먼저 물어야 한다. |
| `single-transition` | REVISE: A→B→A만으로 모든 카드에서 초안이 복원된다고 결론낼 수 없다. |

## 증거의 한계

턴별 명령, 종료 코드, 전후 경로/바이트 목록, 요청 원문, `status`와 `result`는
`.<case>-state/turns/{first,answered,confirmed}/`에 남는다. 실행기는 `BSTACK_STATE_DIR`을
`.<case>-state/`로 지정한다. run 증거는 해당 픽스처에서 `bstack-run status ID`와
`bstack-run result ID`로 확인할 수 있다(같은 `BSTACK_STATE_DIR` 사용). 판정기는 실제 Claude JSONL의 도구 호출과
결과를 연결한다. 명시 슬래시 invocation/스킬 확장은 바깥 스킬 진입에만 인정한다.
`ask`는 동일 세션 JSONL의 새 범위만 확인한다. 누락, 훼손, ID 불일치나 예상과 다른 종료는 실패다.

`PASS`는 기계적 증거만 뜻한다. 제품 경계, PRD 초기화/작성/확인 경계, `status`의 승인 결과와
실제 검수 run ID를 비교한다. 해시는 CLI가 출력한 값 그대로만 비교한다. 작성자와 검수자의
세션 분리는 후보 변경, 위임 출력, run의 작업 범위와 메타데이터로 확인한다. 이는 프로세스별 쓰기
귀속이 아니며, 간접 셸 명령이나 한 턴 안에서 수정 후 되돌린 파일은 증명하지 못한다.
질문·후보 확인의 마지막 메시지 및 질문 도구 원문을 사람이 읽는다. 그 의미가 틀리면
기계적 PASS를 라이브 행동 승인으로 간주하면 안 된다.

## 비용 없는 검증

```bash
python3 -B -m unittest discover -v -s plugins/bstack/tests/live/behavior -p test_check_case.py
for script in "$suite/run-case.sh" "$suite"/fixtures/*.sh; do bash -n "$script" || break; done
```

단위 시험은 가짜 run/status/JSONL을 사용한다. `fixtures/mode-negative-slash.jsonl`은 실제
run `20261121-130727-panel-3174`에서 익명화한 명령 레코드로, 변경된 입력을 실행한 기록은 아니다.
