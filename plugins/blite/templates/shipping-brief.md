# Shipping brief

Fill in every field. Use `none` for absent inputs.

- **Goal:** <the feature, from the PRD's 목표>
- **Target:** <absolute repository directory, GitHub repository, trunk ref, PR URL>
- **Criteria:** <PRD folder path at the head, its `approval` line, and the `checks.md` path>
- **Tools:** <absolute paths to the plugin's `bin/bstack-run`, `skills/blite-mode/playbooks/shipping.md`, `templates/review-structure.md`, `templates/review-behavior.md`, and any project verification skill or named driver>
- **Prior review:** <review checkout path, latest run ID per perspective, reviewed pins, and open findings, or `none`>

Follow the Shipping playbook. Do not fix the implementation yourself.

## Report to Claude

- Reviewed pins: base ref and SHA, head SHA.
- Each perspective: verdict, run ID, evidence references, and findings with closure conditions.
- Outcome: `MERGED` with the merge commit and forge read-back, `FAIL`, `BLOCKED`, or `STALE` with the old and new pins.
- The review checkout path and whether it was removed.
