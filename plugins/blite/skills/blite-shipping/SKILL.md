---
name: blite-shipping
description: Judge a PR in two independent review sessions against its PRD, design, and pinned checks, and merge only the head that passed. Use for the review-and-merge step of a blite feature.
disable-model-invocation: true
---

# Review and merge

The goal is that only code two independent reviewers judged against the approved criteria reaches the base branch.

## Lead

If you are the lead and did not come here through blite-mode, read [the instructions for every agent](../../instructions/global.md), [the lead role](../../instructions/roles/lead.md), and [bstack-run](../../docs/bstack-run.md) first.

Fill in the [Shipping brief](references/shipping-brief.md) and start the Shipping worker in the background from the target repository with `bstack-run run --role impl`. When it reports, check the verdicts and the forge read-back. The lead does not review or merge.

## Shipping worker

You judge the PR through reviewers and merge only what passed. You do not fix the implementation. Your result must satisfy all of these.

1. **Pinned inputs.** The repository, the PR URL, the base ref with its full SHA, the full head SHA, and the PRD folder with `design.md` and `checks.md` read at that head.
2. **Two independent verdicts.** Structure and behavior are each judged in their own fresh `review` session, briefed from the [review brief](references/review.md), in a checkout of the pinned head that nothing else writes to. Keep review outputs outside that checkout, and run one at a time anything that shares a build, a port, or another single resource. For a new head after rework, continue the same reviewer sessions with the new pins, the delta, and the open findings, and only for the perspectives the change affects.
3. **A verdict you can trust.** A verdict counts only when its JSON parses and its perspective and pins match the brief. The PR passes only when both verdicts are `PASS` or `PASS+NOTES`. Otherwise report the findings as the reviewers wrote them and stop.
4. **Only the reviewed head is merged.** Immediately before merging, read the PR's state, base, and head from the forge. If they differ from the reviewed pins, report `STALE` and stop. Squash-merge with a guard on the reviewed head (`gh pr merge --squash --match-head-commit <head SHA>`), then read the PR back. Report `MERGED` only when the forge shows the merge commit.
5. **The review checkout outlives a stop.** After a confirmed merge, remove it if it is clean and no run uses it. On any stop, keep it for the re-review.

## Backlog

`.bstack/backlog.md` on the base branch lists the work that was found but is not in `checks.md`, and the rows the user removed from the PRD. A removed row is resolved when its check in the archived `checks.md` passes. Behavior that merged wrong or incomplete goes under 알려진 문제, including what remains of the code written for a removed row. Start it from the [backlog template](references/template/backlog.md). The lead adds the rows on the updated base branch, commits, and pushes.
