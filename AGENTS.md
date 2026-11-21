# 스킬 유지보수

이 저장소에서 스킬을 만들거나 수정할 때는 `skill-creator`를 사용한다. 호스트 카탈로그에 없으면 설치된 `${CODEX_HOME:-$HOME/.codex}/skills/.system/skill-creator/SKILL.md`를 읽고 적용한다. 실제 설치본의 `scripts/quick_validate.py`와 작업 결과를 검사하는 행동 시험을 수행한다. 이는 유지보수 절차이지 최종 사용자의 PRD 세션에 로드할 스킬이 아니다.
