# Claude Code harness

Claude Code is the coordinator. It reads the playbook, asks the user via `AskUserQuestion`, records tasks in the Claude Code todo list, and owns the final decision. OpenCode workers do implementation, source exploration, and verification. Start them only through `bstack-run`.

## Launch and collect

Use the absolute launcher path in Bash, normally `${CLAUDE_PLUGIN_ROOT}/bin/bstack-run` or `plugins/bstack/bin/bstack-run` resolved against the plugin checkout. Run from the project you are working on, not from the plugin installation. Form each brief from [the worker template](../../templates/worker-brief.md), with source paths, write limits, completion checks, report format, and worker discipline.

```bash
BSTACK_RUN="${CLAUDE_PLUGIN_ROOT}/bin/bstack-run"
printf '%s' "$BRIEF" | "$BSTACK_RUN" run --role explore --brief - --title 'Trace current behavior'
printf '%s' "$VERIFY_BRIEF" | "$BSTACK_RUN" run --role impl --worktree --brief - --bg
# Use the ID printed above and run this wait in background Bash or under Monitor.
"$BSTACK_RUN" wait "$ID"
```

Use background Bash completion notifications or Monitor for long work. One wait per ID; do not loop over `status` or `result`. Read `status ID` to confirm terminal state and exit code: a `wait` or `result` report is not itself a success verdict. `result ID` prints the full final answer. `run`, `ask`, `steer`, and `queue` accept `--brief -` for UTF-8 stdin instead of a staging file.

Run records live in `${XDG_STATE_HOME:-$HOME/.local/state}/bstack/<repo-name>-<path-hash>/runs/<id>/`, shared by a repository's Git worktrees. `BSTACK_STATE_DIR` overrides the directory directly above `runs/`. `status ID` reports `run_dir`; records contain `brief.md`, `meta.json`, and `result.md` once finalized. Only failed or interrupted runs save a bounded diagnostic tail in `stderr.log`. If a run ID is missing from the new store, `status ID`, `result ID`, and `wait ID` can still read the old in-repository record without modifying it.

Workers report in their final result. For permitted throwaway experiments, workers create a temporary directory (e.g. `mktemp -d`) and delete it before finishing. Keep PRD-linked evidence in `.bstack/<name>/evidence/`. There is no other scratch location.

Roles and variants come from [`config/models.json`](../../config/models.json); use `/bstack:setup-bstack` to change them. `--model provider/model#variant` overrides a single call. The launcher chooses only the first configured seat for `--role panel` without an override; for a panel, make one call per seat with `--model`. Do not use terra. Start fresh unless a continuation genuinely needs the prior session; pipe a follow-up to `bstack-run ask ID --brief -` to continue it. The worker CLI uses `oc-lite run --worktree` for isolation and `-s` for continuity; `oc-lite run --fork -s SESSION` is worker-side branching, not a launcher flag.

## Workspaces and scheduling

- Give independent writers and verifiers separate `--worktree` runs. Pin the exact refs and SHAs in the brief; explicitly stage any authorized uncommitted inputs. Name separate ports and output paths where needed. Claude Code's EnterWorktree/ExitWorktree manage the coordinator checkout, not worker isolation.
- For local recurring work, use `/loop` or `CronCreate`; use `ScheduleWakeup` for a later one-shot check. Use `/schedule` for authorized remote recurring runs and ensure the remote environment has the launcher, worker CLI, and project inputs. Scheduling is for work that recurs or must wake later, not for waiting on an active worker.
- For workers, find the native transcript via `export_cmd` (OpenCode) or `transcript_path` (Claude) from `bstack-run status ID`. The launcher's result is not a transcript. For coordinator actions, look in the relevant Claude project under `~/.claude/projects/`. Read only the applicable session and turn; keep full transcripts out of the chat.
- Project skills live in `.claude/skills/`, user skills in `~/.claude/skills/`. Hooks and automatic memory are available for project policy or durable notes, not substitutes for a brief or proof.
- Claude Code provides `/code-review`, `/simplify`, and `/security-review`. They are not bstack worker lanes and do not replace the independent evidence required by bstack playbooks.
