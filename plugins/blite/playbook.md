# Feature playbook

The goal is a feature that works for the user, proven by checks fixed before its code was written and judged by reviewers who did not write it.

Six steps take one feature from request to merge. A step is finished when its artifact exists as its skill defines it. Do not start a step before the artifact of the step before it exists.

| Step | Who | Artifact | Defined by |
|---|---|---|---|
| 1. PRD | Lead with the user | `index.md`, and the `approval` record of its review | [blite-feature](skills/blite-feature/SKILL.md) |
| 2. Architecture | Lead with the user | `design.md` | [blite-architecture](skills/blite-architecture/SKILL.md) |
| 3. Verification | Lead with the user; an `impl` worker prepares the tests | `checks.md` and its failing tests, pinned as the check SHA | [blite-checks](skills/blite-checks/SKILL.md) |
| 4. Implement | `impl` worker | Code at which every pinned check passes | [blite-build](skills/blite-build/SKILL.md) |
| 5. Clean up and open the PR | `impl` worker | A ready PR at a pinned head | [blite-build](skills/blite-build/SKILL.md) |
| 6. Review and merge | Shipping worker with two `review` sessions | Both verdicts and the merge commit | [blite-shipping](skills/blite-shipping/SKILL.md) |

## User approval

In steps 1 to 3 the user approves the content before the artifact is written. Propose with your reasons, showing each decision with its options and what each would change, and write the artifact from the version they approved. An answer that settles some decisions and raises a new question or alternative is not approval yet.

A later user decision approves what it changes. Record it as blite-feature defines, update the artifacts it affects, and continue without asking again.

After step 3 the user approves nothing more. Committing and pushing the feature branch, opening the PR, and merging a PR that passed step 6 are part of the work. Decide what comes up and continue. If the user has said to run without stopping, continue through the approvals of steps 1 to 3 as well.

## When review does not pass

- `FAIL`: one `impl` worker finds why the findings were missed and fixes the change, not only the findings.
- `BLOCKED`: get the missing evidence before sending the PR again.
- `STALE`: one `impl` worker rebases onto the current base.

Each time, rerun the checks and send the new head to the same Shipping run, until `MERGED`.

## Work outside the checks

Work that is not in `checks.md` and needs doing later goes to the backlog, whoever found it. Do not add it to the PRD or `checks.md`, and do not widen this change to fix it. After `MERGED`, add it to the backlog as blite-shipping defines.

## Finish

Reply with what was built, each requirement with the evidence that passed it, the merge commit, and open decisions.
