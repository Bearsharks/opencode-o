# Shipping → 판정표 검수: 원본, 이식 범위, 재현 근거

이식 단위는 PR 병합 코드가 아니라 검수 대상 고정과 재작업 상태 전이다. 현재 검수 단위는 두 행뿐 아니라 PRD 관련 문서의 파일명·제목·본문과 로컬 참조 파일의 해시를 포함한다. 본문·참조 변경 시 양 관점의 이전 승인은 재사용하지 않는다. 채팅의 `PASS`가 아니라 `bstack_review`의 반환 기록과 실제로 발행된 묶음이 인계 근거다.

| pstack 근거 | bstack 실행 근거 | 차이 |
|---|---|---|
| [`pstack_ship` 독립 세션과 대상 검증](../../pstack/plugins/pstack/shipping.ts), [두 검수자](../../pstack/pr-review.md#L3-L10) | [review 도구](../plugins/review/index.ts)가 작성 세션에서 사용자 원문을 가져오고 두 검수 세션을 생성·보관한다. 두 ID는 부모 및 서로와 달라야 한다. | 별도 Shipping 프라이머리 모델 대신 코드가 제출·취합을 맡는다. 관점은 구조/행동 대신 제품/기능이다. |
| [고정 base/head, 기준·관찰·판정](../../pstack/pr-review.md#L14-L24) | [identity/parseReport](../plugins/review/cycle.ts): 사용자 원문·공통 근거·두 행의 세 항목으로 SHA-256을 계산한다. 해당 요청 이후 실제로 종료된 검수 응답만 쓰며 lane·head가 틀리면 UNCONFIRMED다. | Git SHA나 병합 검사는 아니다. 승인된 표 자체가 도구 응답에 포함된다. 채팅 자유 텍스트 자체를 차단하지는 않는다. |
| [영향받은 관점을 같은 검수자에게 재제출](../../pstack/pr-review.md#L20) | 관점별 입력은 자기 행·양쪽 정의·사용자 원문·공통 근거다. 영향받은 범위는 이전 지적과 함께 같은 세션에 재제출한다. 바뀌지 않은 범위의 PASS만 이전 head와 검수자 ID를 유지해 재사용한다. | 공통 근거나 정의 변경은 양쪽을 무효화한다. |
| [최초 REWORK 후 서로 다른 수정본 세 개 실패 시 중지](../../pstack/plugins/pstack/rework.ts#L12-L20) | [conclude](../plugins/review/cycle.ts)가 중복 head·BLOCKED를 제외하고 RESOLVE를 센다. 최초 + 서로 다른 수정본 3개면 AWAITING_USER. 상태는 작성 세션별 플러그인 저장소에 남는다. | 새 사용자 메시지의 전문과 일치를 확인한다. 메시지가 실제 재개 지시인지 해석하는 것은 작성자의 책임이다. |

`bun profiles/bstack/tests/rework.live.ts`: 실제 OpenCode 호스트·도구 호출·검수 세션·저장소를 사용하고 모델 응답만 로컬 고정 fixture로 제공한다. 잘못된 클릭 지표로 제품 RESOLVE/기능 PASS → 수정한 제품 행을 같은 세션에서 재검수 → 두 관점 PASS → 다음 수정본에 잘못된 해시 응답을 주입해 승인 거부까지 검증한다. 외부 모델의 판단 정확도를 확인하는 시험은 아니다.

`bun test profiles/bstack/tests/cycle.test.ts`: 중복 수정본, BLOCKED, 서로 다른 수정본 3회 실패, 공통 입력 변경을 분리해 검증한다.
