# Feature playbook

Follow this playbook when the user asks to build a feature. For any other request, follow the user's instructions; nothing below applies.

The goal is a feature that works for the user, proven by verification methods agreed before implementation and judged by reviewers who did not write the feature.

Six steps take one feature from request to merge. A step is finished when its artifact exists as its skill defines it. Do not start a step before the artifact of the step before it exists.

| Step | Who | Artifact | Defined by |
|---|---|---|---|
| 1. PRD | Lead with the user | `index.md` | [blite-feature](skills/blite-feature/SKILL.md) |
| 2. Architecture | Lead with the user | `design.md` | [blite-architecture](skills/blite-architecture/SKILL.md) |
| 3. Verification | Lead with the user | `checks.md` | [blite-checks](skills/blite-checks/SKILL.md) |
| 4. Implement | `impl` worker | Verified implementation | [blite-build](skills/blite-build/SKILL.md) |
| 5. Clean up and open the PR | `impl` worker | A ready PR at a pinned head | [blite-build](skills/blite-build/SKILL.md) |
| 6. Review and merge | Shipping worker with two `review` sessions | Both verdicts and the merge commit | [blite-shipping](skills/blite-shipping/SKILL.md) |

## After step 3

Committing and pushing the feature branch, opening the PR, merging a PR that passed step 6, and adding to the backlog on the base branch after the merge are part of the work.

## Rework

If a fix brings the implementation into line with the approved requirements, design, and verification methods, send it back to implementation without asking for approval again. If any of those agreements need to change, return to the earliest affected step (PRD, architecture, or verification). Get the user's approval for the changed parts of that step and any later affected steps before delegating implementation again.

## When review does not pass

Find why the Shipping findings were missed and fix the change, not only the findings. Follow the rework path above, then send the new PR head back to the same Shipping run.

Escalate to the user if a finding says it cannot be closed, or if the PR has been reworked twice and still does not pass.

## Backlog

After `MERGED`, work that was found but is not in `checks.md` and behavior that merged wrong or incomplete go to the backlog, as blite-shipping defines.

## Finish

Reply with what was built, each requirement with the evidence that passed it, the merge commit, the checks changed on a reviewer's direction, and open decisions.
