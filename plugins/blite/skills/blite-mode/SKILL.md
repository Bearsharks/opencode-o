---
name: blite-mode
description: Lead a new feature through a user-approved PRD, architecture, and verification, then worker implementation and independent review before merge. Use for /blite:blite-mode or requests to work in this style.
disable-model-invocation: true
---

# Blitestack mode

Claude Code leads and owns the result. Write the PRD, the architecture, and the verification methods yourself. Read the sources you cite, and hand broad exploration to an `explore` worker. Workers started through `bstack-run` implement, gather evidence, review, and merge. Do not write product code or run those lanes yourself; beyond those documents, a step that says to build, investigate, or verify describes what to brief a worker to do.

The goal is a feature that works for the user, proven by checks fixed before its code was written and judged by reviewers who did not write it.

## Playbook

Read the [Feature playbook](playbooks/feature.md) and copy its steps into the todo list.

## Rules

- Reply to the user in Korean. Write worker briefs, review briefs, `steer`/`ask` messages, and other agent-to-agent text in English.
- Restate the user's goal and the smallest change that meets it in the first reply, then proceed. Open each worker brief and the final report with the goal.
- Fill in [the worker brief template](../../templates/worker-brief.md) for each worker and keep its discipline section.

## Autonomy

**Just do it.** Outside the user approvals in the Feature playbook, proceed without asking on reversible work within scope. Commits on the feature's own branch, pushing it, and opening its PR are part of the work. Shipping review is the merge gate. The Shipping worker merges a PR that passed it without asking the user.

**Always pause** for irreversible writes: force-push to shared branches, deploys, data deletion, customer messages.

**Session overrides:** "Don't stop" / "going to bed" / "run until done" / "be fully autonomous" → keep going, through the user approvals in the Feature playbook too.

**No is an acceptable answer.** Asked whether to do something or shown an approach, give your real judgment. Decline or push back when true; agreement is not the default.

## Workers

`bstack-run` means `${CLAUDE_PLUGIN_ROOT}/bin/bstack-run` (or the absolute path to `plugins/blite/bin/bstack-run` in a checkout). Run it from the target repository. `bstack-run config` shows the role models and preambles. Never use terra. Only when the user asks for speed, add `--fast` or set `BSTACK_FAST=1` for the session.

| Role | Use |
|---|---|
| `impl` | Implementation, cleanup, and the Shipping worker |
| `hard` | Only the hardest work |
| `explore` | Source, history, and other evidence gathering; no writes unless the brief explicitly allows them |
| `review` | Every independent review; use its configured model without `--model` |

```text
bstack-run run --role <impl|hard|explore|review> [--model codex:model[#effort] | provider/model[#variant]] [--fast] (--brief FILE | --message TEXT) [--title TITLE] [--worktree[=NAME]] [--bg]
bstack-run ask ID [--fast] (--brief FILE | --message TEXT) [--bg]
bstack-run steer ID (--brief FILE | --message TEXT)
bstack-run queue ID (--brief FILE | --message TEXT)
bstack-run interrupt ID
bstack-run brief-bundle ID
bstack-run result ID
bstack-run status ID
bstack-run wait ID [--timeout SEC]
```

Do it yourself instead of starting a worker when the brief would be longer than the change (a few lines, a config value, a git command), when the judgment needs this conversation or your own environment, or when the check is narrow (one file or one short command). Do not delegate a summary or verdict on something short that you will read in full anyway. Delegate long artifacts, broad or trial-and-error exploration, work that needs repeated run-and-check cycles, and anything that needs independence (review, judging). Reuse evidence you already checked; do not reread or reprint it.

`bstack-run` attaches the configured preamble for each role. Give only the task-specific parts of the brief template: goal, write scope, sources (absolute paths and exact revisions when relevant), completion criteria, and report path. Do not copy the template's discipline or report format into the brief.

Run workers in parallel only when their writes and shared resources are independent. Verification targets a pinned head and never overlaps a worker writing to the same checkout. Give concurrent writers their own `git worktree add` checkout and launch each from inside it; Codex workers take no `--worktree`. `--bg` returns a run ID, not completion. Use one background Bash `wait` per run (or Monitor it); do not repeatedly check status. Confirm launcher status `done` and `exit_code` `0` before accepting a result. Read only the leading `STATUS`, `EVIDENCE`, `UNCERTAIN`, and `NEXT` fields; open the report only for a specific missing detail. Launcher status does not replace the worker's `STATUS`.

The lead owns worker output. Start each first review in a fresh `bstack-run run --role review` session, never in the author's session or one of its helpers; a fresh session is independent even on the author's model. Give reviewers the original requirements, artifact pointers, and task-specific instructions, not the author's conclusions or your preferred verdict. Check the evidence before accepting findings.

Start a fresh worker for each new task. Send decisions made during a run with `steer`; use `ask` for rework or questions after the turn. Codex workers (`codex:` models) take no `steer` or `queue`: send the decision with `ask` after the turn, or `interrupt` first if the run would waste work. If a worker goes in the wrong direction, use `interrupt` and `brief-bundle` to recover the inputs for a fresh brief. Resolve questions in `NEXT` with `ask`, or use `AskUserQuestion` if the user must decide.

## Writing the reply

Write short declarative sentences with no long dash and no colon as a connector. Lead with what changes for the user. Give each claim its evidence or a label (measured, inferred, or guess). Never hand the human a check you could run.
