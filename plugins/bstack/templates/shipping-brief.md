# Shipping worker brief

Fill in every field. Use `none` for absent inputs or permissions.

- **Goal:** <operator's requested landing outcome>
- **Target:** <absolute repository directory, remote repository, trunk ref, target PR URL>
- **Stack:** <PR URLs and branch/base pairs from bottom to top; requested ceiling>
- **Criteria:** <approved PRD path (work document path if there is no PRD), with the approved revision or source when supplied; criteria owner>. Read the PR's `Task-Doc:` selector and the selected document at the pinned head if tracked there. For an approved PRD, give reviewers the applicable row IDs and their Verification expectations.
- **Tools:** <absolute path to the plugin's `bin/bstack-run`>; <absolute path to `skills/bstack-mode/playbooks/shipping.md`>; <absolute paths to `templates/review-structure.md`, `templates/review-behavior.md`, and any project verification skill or named driver>.
- **Prior evidence:** <PR/CI runs, artifact links, reviewed base/head and document identity, and prior findings if any>.
- **Authority:** <operator-authorized PRs and actions: merge, post review comments, retarget, rebase and push with lease; identify permitted branches>. Only you, the OpenCode/OpenAI Shipping worker, may merge the authorized remote PRs. Neither Claude nor the reviewers may merge them. This brief does not grant permissions the operator did not give; stop if a needed action is not authorized. Do not repair implementation yourself.

Follow the Shipping playbook. You may start independent reviewers using the supplied absolute `bstack-run` path. Each perspective needs its own `bstack-run` session, with a reviewer who did not author the change. In-session helpers such as oc-lite runner do not count.

Start each reviewer brief with `NO-PREAMBLE`, then give the absolute path to the [reviewer preamble](preamble/reviewer.md) and have them apply it first.

## Report to Claude

- Verified contiguous run and ceiling (or `none`), with the first gap.
- Per PR: reviewed forge/repository, base ref/SHA, head SHA, criteria document identity, both perspective verdicts with reviewer/run IDs, checks and evidence links. List reused evidence with original SHAs and reasons. Include the verdict comment link if posted.
- Per PR: `MERGED`, `PENDING`, `STALE`, `BLOCKED`, `FAIL`, or `NOT_ATTEMPTED` for the landing outcome. For `MERGED` give the confirmed target branch, merge commit and forge read-back. For `PENDING` give the confirmed queue evidence. For `STALE` give the old and new inputs and the impact assessment needed. `STALE` applies to the merge candidate, not to the historical reviewer verdicts; do not treat any reused pass as current until reassessment is complete. Record resolved staleness, any retarget/rebase/push, and the failure, blocker, or next action where applicable. A passing review or completed run is not proof of a merge.
- The archived PRD path and the commit that moved it, or why it was not archived.
- Worktrees removed, and each one kept with its reason.
