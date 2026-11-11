---
name: arena
description: Spawn N parallel candidates at the same task, pick a base, graft
  the strongest parts of the losers into it. Use for /arena, 'arena this',
  'throw it in the arena', or when one attempt at a non-trivial artifact would
  lock in the wrong shape.
metadata:
  opencode/autoinvoke: false
---

# Arena

Open a Markdown task checklist with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Pick the runners from `arena-runners`. Call `pstack_models({action: "resolve", role: "arena-runners"})` and use the returned native `agent`, `model`, and `descriptionPrefix` in `subagent`; append the task name to the prefix and provide the full prompt. The execution hook re-resolves the role and enforces its configured model. Launch exactly one candidate per returned panel entry, including repeated models and inheritance aliases. A one-entry panel means one candidate. For an explicitly requested larger race, repeat configured seats and report the count. A caller such as architect or interrogate supplies its own panel role instead. Record any unavailable seat or fallback; do not silently replace the configured panel with a fixed pair.
4. Give each candidate its own output location (a git worktree where possible, otherwise `/tmp/arena-<slug>/candidate-<n>/`), per the **separate-before-serializing-shared-state** principle skill.

## Phase B: Fan out

Spawn the returned N native subagent calls with `background: true` and collect their completion notifications, each with the task, the path to the shared grounding, its own output path, and instructions to produce the artifact and a short rationale naming the alternatives it considered and what it rejected.

If a candidate produces no output, proceed with N-1 and note the dropout.

## Phase C: Cross-judge

After all Phase B candidates complete, resolve `arena-cross-judge-pool` through `pstack_models`. It checks the ordered configured model list against the parent's verified family, skips parent aliases, and returns at most one eligible judge. Use the returned native call and a read-only brief. If no eligible model can run, skip Phase C and explicitly say so; the parent picks the base in Phase D. Do not substitute a same-family judge and call it cross-family. The judge sees the rubric and blinded candidate paths, scores every criterion, and recommends a base with rationale. Start only after candidates finish; it may run alongside the parent's reading in Phase D.

## Phase D: Pick a base

Read every candidate end to end before picking. Score each against the rubric criterion by criterion, not on holistic feel, and compare with the cross-judge when Phase C ran one. Agreement on the base confirms the pick. Disagreement means one of you is biased or the rubric was ambiguous. Read both rationales before deciding.

Pick the base a future maintainer can extend most easily without breaking invariants. When two feel tied, prefer the cleaner boundary or smaller API, per the Laziness Protocol.

## Phase E: Graft

Walk each losing candidate once more for what is worth porting into the base, usually one or two things per candidate, not most of it. Fold each graft in by hand, per the **redesign-from-first-principles** principle skill, so the result stays coherent under one mental model. Don't paste mechanically.

If the candidates converge on one shape, that is strong agreement. Note it and ship the consensus shape. No graft is needed. If they wildly diverge, Phase A was under-specified. Reframe and re-run rather than averaging the divergence.

## Phase F: Verify

Verify the synthesized artifact like any other output, per the **prove-it-works** principle skill. If verification finds a problem the arena missed, either Phase A was wrong (re-frame and re-run) or a candidate caught it and you missed the graft (go back to Phase E). Don't paper over it.

## Outputs

One synthesized artifact, with a short synthesis note alongside naming the base and why, the cross-judge's verdict or that Phase C skipped the judge, each graft with its source candidate, what was rejected and why, any convergence or dropouts, and the verification result.
