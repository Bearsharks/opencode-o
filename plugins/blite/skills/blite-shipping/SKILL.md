---
name: blite-shipping
description: Judge a PR in two independent review sessions against its PRD, design, and verification methods, and merge only the head that passed. Use for the review-and-merge step of a blite feature.
disable-model-invocation: true
---

# Review and merge

The goal is that only code two independent reviewers judged against the PRD, design, and checks.md at the reviewed head reaches the base branch.

## Lead

If you are the lead and did not come here through blite-mode, first read what [blite-mode](../blite-mode/SKILL.md) points to.

The lead fills in the [Shipping brief](references/shipping-brief.md) and starts a Shipping worker with the `impl` role. The lead does not review or merge.

## Shipping worker

You judge the PR through reviewers and merge only what passed. You do not fix the implementation. Your result must satisfy all of these.

1. **Pinned inputs.** The repository, the PR URL, the base branch with its full SHA, the head SHA the brief names, and the PRD folder read at that head.
2. **Two independent verdicts.** Structure and behavior are each judged in their own fresh `review` session, briefed from the [review brief](references/review.md), in a checkout of the pinned head that nothing else writes to. For a re-review, continue the same reviewer sessions with the new pins, the delta, and the open findings; both give a verdict for the new pins.
3. **A verdict you can trust.** A verdict counts only when its JSON parses and its perspective and pins match the brief. The PR passes only when both verdicts are `PASS` or `PASS+NOTES`. Otherwise report the findings as the reviewers wrote them and stop.
4. **Only the reviewed head is merged.** Immediately before merging, read the PR's state, base, and head from the forge. If they differ from the reviewed pins, report `STALE` and stop. Squash-merge with a guard on the reviewed head (`gh pr merge --squash --match-head-commit <head SHA>`), then read the PR back. Report `MERGED` only when the forge shows the merge commit.
5. **The review checkout outlives a stop.** On any stop, keep it for the re-review. Remove it after a confirmed merge.

## Backlog

`.bstack/backlog.md` on the base branch holds two lists, started from the [backlog template](references/template/backlog.md): work to do later, and 알려진 문제 for behavior that merged wrong or incomplete. The lead adds the rows on the updated base branch, commits, and pushes.
