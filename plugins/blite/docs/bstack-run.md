# bstack-run

`bin/bstack-run` starts a worker in its own session, keeps the worker's transcript out of the caller's context, and returns only the worker's final answer. It records every run under `state/runs/` in the plugin folder. It does not judge the work.

In a Claude Code session it is `${CLAUDE_PLUGIN_ROOT}/bin/bstack-run`; from a checkout, use the absolute path to `plugins/blite/bin/bstack-run`. Run it from the target repository.

```text
bstack-run run --role <impl|hard|explore|review> (--brief FILE | --message TEXT) [--title TITLE] [--worktree[=NAME]] [--bg] [--model MODEL] [--fast]
bstack-run ask ID (--brief FILE | --message TEXT) [--bg] [--fast]
bstack-run steer ID (--brief FILE | --message TEXT)
bstack-run queue ID (--brief FILE | --message TEXT)
bstack-run interrupt ID
bstack-run wait ID [--timeout SEC]
bstack-run result ID
bstack-run status [ID]
bstack-run brief-bundle ID
bstack-run config
```

`--brief -` reads the brief from stdin.

## Roles

A role selects a model and an instruction file from `config/models.json`; `config` prints them. `hard` has the instructions of `impl` and a stronger model. `--model` overrides the role's model, and `--fast` (or `BSTACK_FAST=1` for the session) selects its configured fast model.

## What the script does not tell you

- **Every worker already has its instructions.** The script puts the common instruction file and the role's file in front of the brief, unless the brief's first line is `NO-PREAMBLE`.
- **`--bg` returns a run ID, not a result.** Wait with a single `wait ID`, run in the background when it may take long. Do not poll `status`.
- **Process status is not the work's status.** `done` with exit code 0 means the worker finished. Whether the work passed is in the worker's answer.
- **A foreground `run` or `ask` prints at most 6,000 characters of the answer.** `wait` and `result` print all of it.
- **`ask` continues the session of an earlier run.** Use it for rework or a follow-up after that run has finished. A new task gets a new `run`.
- **`steer` and `queue` reach a worker that is still running.** `steer` arrives at its next step, `queue` after its current turn.
- **`interrupt` then `brief-bundle` hands a task over.** `brief-bundle` prints the original brief, every later message, and the last result, which is what a fresh worker needs.
