# Shipping brief

Fill in every field. Use `none` for an absent input.

- **Goal:** <the feature, from the PRD's 목표>
- **Target:** <absolute repository directory, GitHub repository, trunk ref, PR URL>
- **Criteria:** <PRD folder path at the head and its `approval` line>
- **Authority:** start `review` sessions with `bstack-run`, and merge the PR once it has passed. No changes to the code or the PR.
- **Tools:** <absolute paths to the plugin's `bin/bstack-run`, `docs/bstack-run.md`, `skills/blite-shipping/SKILL.md`, `skills/blite-shipping/references/review.md`, and any project verification skill or named driver>
- **Prior review:** <review checkout path, latest run ID per perspective, reviewed pins, and open findings, or `none`>

Follow the Shipping worker section of `skills/blite-shipping/SKILL.md`.

## Report

- Reviewed pins: base ref and SHA, head SHA.
- Each perspective: verdict, run ID, evidence references, and findings with closure conditions.
- Outcome: `MERGED` with the merge commit and the forge read-back, `FAIL`, `BLOCKED`, or `STALE` with the old and new pins.
- The review checkout path and whether it was removed.
