---
name: arena
description: "Spawn N parallel candidates at the same task, pick a base, graft the strongest parts of the losers into it. Use for /arena, 'arena this', 'throw it in the arena', or when one attempt at a non-trivial artifact would lock in the wrong shape."
metadata:
  opencode/autoinvoke: false
---

# Arena

Use `pstack_todo` with `action: "write"` to open an ordered todo list with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything. Keep skipped phases with a reason and update the stored statuses as work proceeds.

## Phase A: Frame

Every candidate gets the same prompt, so the prompt is the contract.

1. State the artifact each candidate is producing.
2. Derive the rubric, 3-6 concrete gradeable criteria for what success looks like on *this* task. It is the picker's tool in Phase D. Candidates only see the task.
3. Pick the runners. Call `pstack_models` with `action: "resolve", role: "arena runners"`, or the caller's explicitly selected panel role such as `architect runners`. It reads the profile's `pstack-models.json`. If the file or that role is missing, default to one Claude Opus 5.5 at xhigh reasoning and one Grok 4.7 at xhigh reasoning with fast speed, using advertised OpenCode `provider/model#variant` identities. The list's order, length, duplicates and `auto`/`inherit-parent` seats all count; aliases run on the parent chat model. Pass the selected role and each zero-based `seat` to every native `subagent` call. If a configured entry is rejected, use its family's default and say so. The model selector identifies Claude and Grok families from advertised identities or explicit family mappings; Composer belongs to the Grok fallback family. If that default is rejected or unavailable, use the closest advertised valid identity in the same family, or drop the seat and say so when none remains. Never reuse a rejected identity. If dropped seats leave fewer than two runners, replenish to two, or one when the configured list has one entry. Replacements use a remaining runner's model or the parent when none remain; report every fallback and dropped seat. `pstack_models` returns these resolved seats and notices, and native `subagent` execution rechecks them. Spawn additional runners when the arena covers multiple design directions; a seat may be used by multiple fresh runners. Use the same model N times when the work is generation-bound rather than judgment-sensitive. Pick reasoning level and fast or standard speed per the Subagents section of **poteto-mode**, using `difficulty` and `urgent`; an explicit comparison-arm model may be supplied with `model` while retaining the role. An adjusted model refusal returns to the unadjusted role choice before the family fallback above.
4. Give each candidate its own output location (a git worktree where possible, otherwise `/tmp/arena-<slug>/candidate-<n>/`), per the **separate-before-serializing-shared-state** principle skill.

## Phase B: Fan out

Spawn all N native `subagent` calls in one message with `background: true`, `agent: "general"`, the selected panel `role` and `seat`, each with the task, the path to the shared grounding, its own output path, and instructions to produce the artifact and a short rationale naming the alternatives it considered and what it rejected. Completion notifications resume the parent; do not poll the child sessions.

If a candidate produces no output, proceed with N-1 and note the dropout.

## Phase C: Cross-judge

After all Phase B candidates complete, call `pstack_models` with `action: "resolve", role: "arena cross-judge pool"`. It reads that ordered pool from the profile's `pstack-models.json`; if missing, the pool is Claude Opus 5.5 at xhigh reasoning followed by Grok 4.7 at xhigh reasoning with fast speed, resolved to advertised native model identities. Spawn one readonly judge using `subagent` with `agent: "explore", role: "arena cross-judge pool", background: true`. The judge is never from the known parent's family. Try eligible entries in pool order; `auto` and `inherit-parent` never judge. With the default pool, a Claude parent gets Grok, and other parents get Claude first. If an entry is rejected, try a valid identity of the same model at the closest level or speed, then move to the next entry. If no configured entry from another family runs, try the default pool's entries from another family in the same way. The selector records refused identities and never sends them again. If neither pool yields a judge, skip this phase, pick the base alone in Phase D, and say so. If the parent's model family is unknown, try the pool's real identities in order and explicitly report that the family check did not run. Report the selector's notices. The judge sees the rubric and candidates by path label, scores every criterion, and recommends a base with rationale. It runs in parallel with your reading in Phase D. Do not launch it while candidates are still writing.

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
