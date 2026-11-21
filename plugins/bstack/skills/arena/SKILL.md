---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
disable-model-invocation: true
---

# Arena

When coordinating in Claude Code, delegate implementation, exploration, and verification through the [Claude Code harness](../../docs/harness/claude-code.md).

Open a todolist with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Read `roles.panel` in `config/models.json`. Use at least two seats. Add another configured or confirmed model for distinct design directions; repeat a model only for generation-bound work. Do not silently substitute an unavailable model.
4. Give each candidate its own output location (a git worktree where possible, otherwise `/tmp/arena-<slug>/candidate-<n>/`), per the **separate-before-serializing-shared-state** principle skill.

## Phase B: Fan out

Start one `bstack-run run --role panel --model "$MODEL" --worktree --brief "$BRIEF" --bg` per seat when using git. For separate scratch directories, omit `--worktree` and fence writes to each assigned directory. Give each worker the task, shared grounding path, assigned output, and a short rationale naming alternatives and rejections. Collect via background Bash completion or Monitor as described in the harness.

If a candidate produces no output, proceed with N-1 and note the dropout.

## Phase C: Cross-judge

After all Phase B candidates complete, choose one configured panel model from a different provider than the coordinator and, where possible, the candidate it evaluates. Run `bstack-run run --role panel --model "$JUDGE" --brief "$JUDGE_BRIEF" --bg` with a no-writes brief. If no eligible model can run, skip the judge and say so. While you read in Phase D, the judge scores each candidate by path label against each rubric criterion and recommends a base.

## Phase D: Pick a base

Read every candidate end to end before picking. Score each against the rubric criterion by criterion, not on holistic feel, and compare with the cross-judge when Phase C ran one. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, per the Laziness Protocol.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Delegate the graft with `bstack-run run --role impl --brief "$GRAFT_BRIEF"`, per the **redesign-from-first-principles** principle skill, so the result stays coherent under one mental model. Do not paste mechanically.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Delegate verification of the synthesized artifact to a fresh `bstack-run run --role impl --worktree --brief "$VERIFY_BRIEF"`, per the **prove-it-works** principle skill. If verification finds a problem the arena missed, either Phase A was wrong (re-frame and re-run) or a candidate caught it and you missed the graft (go back to Phase E). Do not paper over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, the cross-judge's verdict or that Phase C skipped the judge, each graft with its source candidate, what was rejected and why, any convergence or dropouts, and the verification result.
