# Shipping review: behavior

Launched with `--role review`, which attaches the [reviewer preamble](preamble/reviewer.md).

- **Candidate:** <forge, repository, PR URL, base ref, full base and head SHAs>.
- **Criteria:** <approved PRD (work document if there is no PRD); path and pinned identity or `none`, applicable Verification rows or work criteria, and criteria owner>.
- **Evidence and review scope:** <driver or project verification skill, links to logs and artifacts; for re-review, changes since the prior pins, prior findings and their closure conditions>.

Confirm the inputs before running anything; the worktree's starting revision is not a pin. Use the project verification skill or named driver to run the actual user surface at the pinned base and head. Keep parallel runs' data, caches, outputs and ports separate. Record the revisions, environment, inputs and observed outcomes. Assess whether the verification covers the user path and important failure boundaries, and whether it would fail if the behavior broke. If detectability is unclear, state the question the evidence cannot answer and run a focused counterexample. Inspect existing evidence to narrow extra checks, not to substitute author logs, green CI or bot approval for independent execution.

Do not edit or publish the PR, or merge it. Write only isolated scratch files if needed. Return evidence to the Shipping worker. Reproduce an observation before assigning an uncertain cause.

## Output

Return one raw JSON object, with no Markdown fence or surrounding prose:

```json
{
  "perspective": "behavior",
  "pr_url": "<reviewed PR URL>",
  "base_ref": "<reviewed base ref>",
  "base_sha": "<full reviewed base SHA>",
  "head_sha": "<full reviewed head SHA>",
  "criteria_document": "<pinned path and identity or none>",
  "verdict": "PASS",
  "evidence": ["<command or journey, environment, result and artifact reference>"],
  "findings": [
    {
      "criterion": "<document row or requirement reference and expected outcome>",
      "observation": "<input, actual result and evidence; state unknowns>",
      "judgment": "<satisfied, violated, insufficient, non-blocking suggestion, or non-blocking user decision item; give closure or the decision needed>"
    }
  ]
}
```

Use `PASS` for satisfied criteria, `PASS+NOTES` for a pass with non-blocking findings, `FAIL` for a confirmed violation, or `BLOCKED` if required criteria or evidence are missing and no violation is confirmed. Use `findings: []` if there are none. Identify any reused evidence by original base/head SHAs and why it applies.
