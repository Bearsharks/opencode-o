# Review brief

Send one per perspective, with the other perspective's section removed.

- **Perspective:** <structure | behavior>
- **Candidate:** <repository, PR URL, base branch, full base and head SHAs>
- **Criteria:** <PRD folder at the pinned head (`request.md`, `index.md`, `design.md`, `checks.md`), and the check SHA, the commit that last pinned `checks.md` and its tests>
- **Evidence and scope:** <diffs, logs, artifacts, the project's verification skill or named driver; for a re-review, the changes since the prior pins and the open findings>

Confirm the pins before judging. The revision a checkout happens to start at is not a pin.

A check exists to show its 목적, so passing it and meeting the 목적 should be the same thing. Where they are not, direct the check to be strengthened or weakened under `check`; a mismatch blocks like an unmet criterion. You direct; the lead changes the check, and you do not write it or its tests. You cannot change a 목적.

## Structure

Review the pinned diff against `design.md`. Trace each changed contract from its producer through its consumers. Check ownership, retired paths and their remaining callers, duplicate decisions, and exception branches.

## Behavior

Verify the behavior a user would meet at the pinned head, with the project's verification skill or named driver. An author's summary, a plan in `checks.md`, a green CI run, or a mock is not an observation.

Judge each row of `checks.md` by its 목적, not by its 검증 방법 alone. Ask whether the method covers the path a user takes and its important failure boundaries, and whether it would fail if the behavior broke; when that is unclear, run a focused counterexample.

Of rows with the same F-ID, judge the last. `checks.md` and the tests it names must be unchanged since the check SHA.

A row passes only when its check passes and you saw its 목적 met. Report each row in `evidence` as `F-xx <PASS|FAIL|BLOCKED> | 목적 | observed outcome or missing evidence | evidence reference`.

## Output

Return one raw JSON object, with no Markdown fence or surrounding prose.

```json
{
  "perspective": "<structure | behavior>",
  "pr_url": "<reviewed PR URL>",
  "base_ref": "<reviewed base ref>",
  "base_sha": "<full reviewed base SHA>",
  "head_sha": "<full reviewed head SHA>",
  "criteria_document": "<pinned path and identity or none>",
  "verdict": "PASS",
  "evidence": ["<source, command, or journey; environment; result; artifact reference>"],
  "findings": [
    {
      "criterion": "<the row or requirement, and the outcome it expects>",
      "purpose": "<met, not met, or not determined, and what you saw or what is missing>",
      "code": "<what the code must do that it does not, or must stop doing>",
      "check": "<strengthen or weaken, and what: what the check must also show, or what it demands that the 목적 does not need>",
      "cannot_close": "<why nothing within this scope closes it>",
      "note": "<a suggestion or a decision for the user that blocks nothing>"
    }
  ]
}
```

In a finding, always give `criterion` and `purpose`. Give `code`, `check`, `cannot_close`, and `note` only when they apply. Write each so that a reader without your context can follow it.

- `PASS`: no findings.
- `PASS+NOTES`: a pass whose findings carry only `note`.
- `FAIL`: a finding carries `code`, `check`, or `cannot_close`.
- `BLOCKED`: required criteria or evidence are missing and no violation was observed. A required test that was skipped or ran zero cases is `BLOCKED`.

Use `findings: []` when there are none. Name any reused evidence by its original base and head SHAs and say why it still applies.
