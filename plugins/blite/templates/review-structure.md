# Review: structure

Launched with `--role review`, which attaches the [reviewer preamble](preamble/reviewer.md).

- **Candidate:** <repository, PR URL, base ref, full base and head SHAs>.
- **Criteria:** <PRD folder path at the pinned head, its `approval` line, and its `design.md` and `checks.md` at the pinned head>.
- **Evidence and review scope:** <links to diffs, logs and artifacts; for re-review, the changes since the prior pins, prior findings and their closure conditions>.

Review the pinned diff and read the selected criteria at its pinned revision. Trace each changed contract from producer through its consumers. Check ownership, retired paths and remaining callers, duplicate decisions, and exception branches.

Confirm the inputs before assessing them; the worktree's starting revision is not a pin. Do not edit or publish the PR, or merge it. Write only isolated scratch files if needed. Return evidence to the Shipping worker. Reproduce an observation before assigning an uncertain cause.

## Output

Return one raw JSON object, with no Markdown fence or surrounding prose:

```json
{
  "perspective": "structure",
  "pr_url": "<reviewed PR URL>",
  "base_ref": "<reviewed base ref>",
  "base_sha": "<full reviewed base SHA>",
  "head_sha": "<full reviewed head SHA>",
  "criteria_document": "<pinned path and identity or none>",
  "verdict": "PASS",
  "evidence": ["<source or artifact reference and what it proves>"],
  "findings": [
    {
      "criterion": "<document row or requirement reference and expected outcome>",
      "observation": "<file:line, input, observed outcome and evidence; state unknowns>",
      "judgment": "<satisfied, violated, insufficient, non-blocking suggestion, or non-blocking user decision item; give closure or the decision needed>"
    }
  ]
}
```

Use `PASS` for satisfied criteria, `PASS+NOTES` for a pass with non-blocking findings, `FAIL` for a confirmed violation, or `BLOCKED` if required criteria or evidence are missing and no violation is confirmed. Use `findings: []` if there are none. Identify any reused evidence by original base/head SHAs and why it applies.
