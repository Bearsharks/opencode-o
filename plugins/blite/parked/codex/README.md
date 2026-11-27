# Codex 작업자

blite는 지금 모든 작업자를 oc-lite(OpenCode)로 돌린다고 보고 쓴다. `bin/bstack-run`의 Codex 실행 코드는 그대로 남아 있고, 문서와 설정에서 뺀 Codex 내용을 여기에 모았다.

## 설정 (`config/models.json`)

```json
  "roles": {
    "impl": "codex:gpt-6.2-sol",
    "hard": "codex:gpt-6.2-astra",
    "explore": "openai/gpt-6-luna-fast",
    "review": "codex:gpt-6.2-sol",
  "codex": {
    "config": [
      "model_reasoning_effort=\"high\"",
      "mcp_servers.roblox_studio.command=\"/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP\"",
      "mcp_servers.roblox_studio.disabled_tools=[\"start_stop_play\", \"multi_edit\", \"character_navigation\", \"http_get\", \"subagent\", \"list_roblox_studios\", \"submit_feedback\"]"
    ]
  },
```

## README의 설명

> - 작업자 모델은 `config/models.json`에서 고칩니다. `codex:` 모델(impl·hard·review)은 Codex CLI `codex exec`로 샌드박스 없이 돌고, 남는 권한 요청은 Codex 자동 검토가 판정합니다. 개인 `~/.codex/config.toml`은 읽지 않고 `codex.config`의 설정만 씁니다. 나머지(explore)는 `oc-lite`로 돕니다. 실행 기록은 `state/runs/`에 남습니다.
> - Codex 작업자는 `steer`·`queue`와 `--worktree`를 받지 않습니다. 끝난 뒤 `ask`로 이어 시키고, 동시에 쓰는 작업자는 `git worktree add`로 만든 작업 트리 안에서 띄웁니다.

## 문서에 있던 Codex 제약

`skills/blite-mode/SKILL.md`:

> Give concurrent writers their own `git worktree add` checkout and launch each from inside it; Codex workers take no `--worktree`.

> Codex workers (`codex:` models) take no `steer` or `queue`: send the decision with `ask` after the turn, or `interrupt` first if the run would waste work.

`templates/preamble/impl.md`, `templates/preamble/explore.md`:

> Claude Code worker models use `claude:<model>` and Codex worker models use `codex:<model>`; only OpenCode workers take `steer` or `queue`, so continue the others with `ask`.

> Run a `claude:` worker only if the brief sets a run-count or cost cap; stay within it.

이 제약은 스크립트가 오류 메시지로 알려 준다.
