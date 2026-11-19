---
name: acceptance-criteria
description: "Turn an agreed product plan into observable acceptance criteria in the product repository. Use after planning and before splitting implementation, or when review uncovers an undecided expectation."
metadata:
  opencode/autoinvoke: true
---

# 완료조건 결정

기획이 확정된 뒤, 구현을 나누기 전에 실행 프로필이 배정한 담당자가 사용한다. 프로젝트의 기획과 관련 도메인 스킬에서 사용자가 할 행동, 그 상황에서 관찰할 결과, 반드시 보존할 제약을 찾는다. 이미 적절한 기준이 있으면 그 문단을 재사용한다.

행동과 결과를 짝지어 쓴다. 예를 들어 키보드 위를 걸으면 발밑 키가 눌리고, 옆을 지나면 그대로 있으며, 발을 떼면 돌아온다. 후보 기준을 만족해도 이 경험이 깨질 수 있다면 그 기준만으로 인수할 수 없다. 후보 기준을 어겨도 경험과 명시된 제약이 모두 지켜진다면 구현자가 바꿀 수 있는 값이다.

동작은 분명하고 구현 수치만 미정이면 기준을 지금 결정한다. 경험 자체를 어떻게 관찰해야 할지 근거가 부족하면, 대표 사례와 대조군 하나로 이를 알아내는 일을 첫 작업으로 맡긴다. 관찰을 돌려받은 담당자가 기준을 확정한다. 관찰로 결정할 수 없는 제품 선호만 사용자에게 묻는다.

기획이 확정되면 해당 작업의 기존 기획·기능 문서를 연다. 적절한 문서가 없으면 제품 레포에 `docs/tasks/<작업명>.md`를 만든다. 한 워크트리는 한 작업 문서를 쓰며, 독립 작업은 서로 다른 경로를 쓴다. 본문에는 현재 적용할 기획·결정·완료조건을, 문서 하단에는 변경이력을 둔다. 이력에는 무엇이 왜 바뀌었는지, 사용자 결정·에이전트 판단 중 근거가 무엇인지, 적용 범위와 작업 한정 예외 사유를 적는다. 미정인 항목은 첫 조사와 구분해 적는다.

구현을 넘길 수 있을 때 문서를 커밋한다. 이미 적절한 커밋이 있으면 재사용한다. 그 워크트리에서 `git config --worktree pstack.taskDoc 'docs/tasks/<작업명>.md'`로 레포 상대 경로를 한 번 연결한다. 먼저 `git config --bool extensions.worktreeConfig`가 true인지 확인한다. 일반 저장소에서 처음 활성화할 때는 공통 config에 core.worktree 또는 core.bare=true가 있는지 확인하고 Git의 worktreeConfig 이관 규칙을 적용한 뒤 `git config --local extensions.worktreeConfig true`를 사용한다. 기존 연결이 다른 진행 중인 작업을 가리키면 덮어쓰지 않고 작업을 분리한다.

제품 레포의 AGENTS.md에 작업 문서의 역할을 한 번 설명한다. 작업자는 전달된 경로의 현재 본문을 기준으로 구현하고, 검수자는 검수 head의 문서를 읽으며, 반례는 재현 근거로 쓴다. AGENTS.md에 작업별 경로 목록을 쌓지 않는다.

새 사실이나 사용자 결정이 기준을 바꾸면 같은 문서의 현재 본문과 변경이력을 함께 고쳐 커밋한다. PR 본문에는 워크트리 설정에서 읽은 `Task-Doc: <경로>` 한 줄을 넣는다. Shipping은 PR이 가리키는 파일을 해당 head에서 읽는다. squash merge가 확인되면 하네스가 그 워크트리의 연결만 해제한다. 문서와 변경이력은 보존한다.
