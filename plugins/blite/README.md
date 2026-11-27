# blite

새 기능 하나를 증거로 끝까지 만듭니다.

단계는 PRD, 아키텍처, 검증, 구현, 정리와 PR, 검수와 병합입니다. 순서와 조건은 [playbook](playbook.md)에 있습니다.

```bash
claude plugin marketplace add /path/to/opencode-o
claude plugin install blite@opencode-o
```

설치본은 이 폴더를 그대로 읽으므로 여기서 고친 내용이 다음 세션부터 반영됩니다. 대상 레포에서 `claude`를 띄우고 `/blite:blite-mode <요청>`으로 시작합니다. PRD만 쓰려면 `/blite:blite-feature`를 씁니다.

- 작업자는 모두 `oc-lite`로 돕니다. 역할별 모델과 지침 파일은 `config/models.json`에서 고치고 `bin/bstack-run config`로 확인합니다. 실행 기록은 `state/runs/`에 남습니다.
- 작업자를 띄우는 도구의 사용법은 [docs/bstack-run.md](docs/bstack-run.md)에 있습니다.
- 사용자에게 한 마지막 답변이 영어면 [Stop 훅](hooks/korean-reply.py)이 한 번 막고 한국어로 다시 답하게 합니다. 헤드리스 실행(`claude -p`)은 건너뜁니다. 끄려면 `/hooks`에서 끕니다.
- `/blite:blite-mode`를 쓴 세션이 압축되면 [SessionStart 훅](hooks/reload-blite-mode.py)이 blite-mode와 그것이 가리키는 문서를 원문 그대로 다시 넣습니다. 압축 요약에는 규칙의 요지만 남기 때문입니다.
- CI와 리뷰 코멘트 처리는 아직 없습니다.

## blite를 고칠 때

- 무엇을 어디에 두는지는 [구조 기준](ARCHITECTURE.md)에, 고치는 절차는 [MAINTAINING.md](MAINTAINING.md)에 있습니다.
