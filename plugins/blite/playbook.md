# Feature playbook

The goal is a feature that works for the user, proven by checks fixed before its code was written and judged by reviewers who did not write it.

Six steps take one feature from request to merge. A step is finished when its artifact exists as its skill defines it. Do not start a step before the artifact of the step before it exists.

| Step | Who | Artifact | Defined by |
|---|---|---|---|
| 1. PRD | Lead with the user | `index.md` | [blite-feature](skills/blite-feature/SKILL.md) |
| 2. Architecture | Lead with the user | `design.md` | [blite-architecture](skills/blite-architecture/SKILL.md) |
| 3. Verification | Lead with the user | `checks.md` | [blite-checks](skills/blite-checks/SKILL.md) |
| 4. Implement | `impl` worker | Code at which every pinned check passes | [blite-build](skills/blite-build/SKILL.md) |
| 5. Clean up and open the PR | `impl` worker | A ready PR at a pinned head | [blite-build](skills/blite-build/SKILL.md) |
| 6. Review and merge | Shipping worker with two `review` sessions | Both verdicts and the merge commit | [blite-shipping](skills/blite-shipping/SKILL.md) |

## User approval

In steps 1 to 3 the user approves the content before the artifact is written, and the artifact is written from the version they approved. An answer that changes the proposal or raises a new question is not approval yet; show the version that reflects it and get that approved.

After step 3 the user is asked only in the two cases below. Committing and pushing the feature branch, opening the PR, merging a PR that passed step 6, and adding to the backlog on the base branch after the merge are part of the work. Decide what comes up and continue.

## When review does not pass

Act on what the Shipping report and its findings say must change, and send the PR back to the same Shipping run. Find why a finding was missed and fix the change, not only the finding.

Ask the user in two cases: a finding says it cannot be closed, or the PR has been reworked twice and still does not pass.

## Backlog

After `MERGED`, work that was found but is not in `checks.md` and behavior that merged wrong or incomplete go to the backlog, as blite-shipping defines.

## Finish

Reply with what was built, each requirement with the evidence that passed it, the merge commit, the checks changed on a reviewer's direction, and open decisions.
