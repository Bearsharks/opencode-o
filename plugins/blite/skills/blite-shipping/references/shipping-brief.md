# Shipping brief

Fill in every field. Use `none` for an absent input.

- **Goal:** <the feature, from the PRD's 목표>
- **Target:** <absolute repository directory, GitHub repository, base branch, PR URL, pinned head SHA>
- **Criteria:** <PRD folder path at the head>
- **Authority:** start `review` sessions with `bstack-run`, and merge the PR once it has passed. No changes to the code, and none to the PR other than merging it.
- **Write scope:** a review checkout and a directory for review outputs, both outside the repository's working tree.
- **Tools:** <absolute paths to the plugin's `bin/bstack-run`, `docs/bstack-run.md`, `skills/blite-shipping/SKILL.md`, `skills/blite-shipping/references/review.md`, and any project verification skill or named driver>
- **Prior review:** <review checkout path, latest run ID per perspective, reviewed pins, and open findings, or `none`>

Follow the Shipping worker section of `skills/blite-shipping/SKILL.md`.

## Report

- Reviewed pins: base branch and SHA, head SHA.
- Each perspective: verdict, run ID, evidence references, and its findings as written.
- Outcome: `MERGED` with the merge commit and the forge read-back, `FAIL`, `BLOCKED`, or `STALE` with the old and new pins.
- The review checkout path and whether it was removed.
