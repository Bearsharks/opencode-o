# blite

bstack의 가벼운 판입니다. 새 기능 하나를 증거로 끝까지 만듭니다.

PRD 승인 → 검증 표 고정 → 작업자 구현 → 정리와 PR → Shipping 작업자의 독립 검수와 병합

```bash
claude plugin marketplace add /path/to/opencode-o
claude plugin install blite@opencode-o
```

설치본은 이 폴더를 그대로 읽으므로 여기서 고친 내용이 다음 세션부터 반영됩니다. 대상 레포에서 `claude`를 띄우고 `/blite:blite-mode <요청>`으로 시작합니다. PRD만 쓰려면 `/blite:blite-feature`를 씁니다.

- 작업자 모델은 `config/models.json`에서 고칩니다. `codex:` 모델(impl·hard·review)은 Codex CLI `codex exec`로 샌드박스 없이 돌고, 남는 권한 요청은 Codex 자동 검토가 판정합니다. 개인 `~/.codex/config.toml`은 읽지 않고 `codex.config`의 설정만 씁니다. 나머지(explore)는 `oc-lite`로 돕니다. 실행 기록은 `state/runs/`에 남습니다.
- Codex 작업자는 `steer`·`queue`와 `--worktree`를 받지 않습니다. 끝난 뒤 `ask`로 이어 시키고, 동시에 쓰는 작업자는 `git worktree add`로 만든 작업 트리 안에서 띄웁니다.
- CI·리뷰 코멘트 처리는 아직 없습니다. 필요해지면 `plugins/bstack`에서 가져옵니다.
- 스킬 검사: `bash tests/validate-skills.sh`
