# Roblox Studio 증거 재사용

동작 검수 템플릿에 있던 Studio 전용 문단이다. Roblox Studio를 쓰는 대상 레포의 검증 스킬로 옮길 내용이다.

## 원문 (`templates/review-behavior.md`)

> For Studio, verify each journey once across implementation, review and Shipping. Inspect the original recording, input trace or other direct Studio evidence first, even if captured by the implementer. Cite its build/revision, environment, inputs and observed outcome. If it proves the row and still applies at the pinned head, judge it without opening Studio. A plan in `checks.md`, a PASS summary, green CI or a mock is not that evidence. Assign one Studio operator only for missing, inconclusive or invalidated observations; a changed probe needs a focused live check, not a replay of unaffected journeys.

같은 파일의 일반 규칙 끝에는 Studio가 아닌 경우의 문장이 붙어 있었다.

> Outside Studio, run the actual surface independently at the pinned base and head; an author summary or green CI cannot substitute.

`playbooks/shipping.md`는 함께 돌리면 안 되는 자원의 예로 Studio를 들었다.

> serialize checks that share builds, ports, or Studio.
