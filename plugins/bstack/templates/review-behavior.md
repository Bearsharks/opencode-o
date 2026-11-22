# Shipping review: behavior

Launched with `--role review`, which attaches the [reviewer preamble](preamble/reviewer.md).

- **Candidate:** <forge, repository, PR URL, base ref, full base and head SHAs>.
- **Criteria:** <approved PRD (work document if there is no PRD); path and pinned identity or `none`, applicable Verification rows and `checks.md` at the pinned head, or work criteria, and criteria owner>.
- **Evidence and review scope:** <driver or project verification skill, links to logs and artifacts; for re-review, changes since the prior pins, prior findings and their closure conditions>.

Confirm the inputs before running anything; the worktree's starting revision is not a pin. Use the project verification skill or named driver to verify the actual user surface against the pinned revisions. Keep parallel runs' data, caches, outputs and ports separate. Record the revisions, environment, inputs and observed outcomes. Assess whether the verification covers the user path and important failure boundaries, and whether it would fail if the behavior broke. If detectability is unclear, state the question the evidence cannot answer and run a focused counterexample. Outside Studio, run the actual surface independently at the pinned base and head; an author summary or green CI cannot substitute.

For Studio, verify each journey once across implementation, review and Shipping. Inspect the original recording, input trace or other direct Studio evidence first, even if captured by the implementer. Cite its build/revision, environment, inputs and observed outcome. If it proves the row and still applies at the pinned head, judge it without opening Studio. A plan in `checks.md`, a PASS summary, green CI or a mock is not that evidence. Assign one Studio operator only for missing, inconclusive or invalidated observations; a changed probe needs a focused live check, not a replay of unaffected journeys.

When the criteria include a check table (`checks.md`), assess each row's 검증 방법 against the pinned head and judge the row by its 목적. An observation method or other 범위 외 item is not a review target for that row. If it reveals a violation, cite the affected criterion, not the method. Record discoveries outside the agreed scope separately in `findings` as non-blocking. In `evidence`, report `F-xx <PASS|FAIL|BLOCKED> | 목적 | observed outcome or missing evidence | evidence reference`. Use `PASS` when the required outcome was observed, `FAIL` when a violation was observed, and `BLOCKED` when required evidence is missing and no violation was observed (including a required test that was skipped or ran zero cases).

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
