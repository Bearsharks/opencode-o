# Advisor-State v4 Workspace

This directory contains the v4 working copy. v3 is preserved at
`../_phase-gate-v3/phase-gate.ts` and can be restored with
`../rollback-phase-gate-v3.sh`.

## v4 Contract

v4 is advisor-as-tool.

```text
driver owns the user goal
advisor helps driver make better judgments
advisor_state records advisor usage and staleness
```

v4 has no mandatory middle checkpoint, approval stage, or edit blocking.

## Components

- `driver`: owns the work and completes the goal with persistence and evidence
- `advisor`: high-judgment read-only helper for direction, missing evidence,
  validation, and final claim calibration
- `advisor_state`: records advisor calls, how guidance was applied, and whether
  the latest applied guidance is stale relative to the current diff
- `probe-code`: narrow repo evidence collector
- `scout-web`: external/current evidence collector

## Advisor Context

Required:

```json
{
  "ask": "choose_direction|unstick|continue_or_replan|finalize_claim",
  "raw_user_request": "",
  "context_digest": ""
}
```

Optional:

```json
{
  "objective": "",
  "facts": [],
  "evidence": [],
  "constraints": [],
  "candidate_actions": [],
  "unknowns": [],
  "current_diff": [],
  "validation": []
}
```

Driver should provide enough detail for advisor to help: user goal, work already
done, observed facts, evidence, constraints, unknowns, current diff, validation
state, and the exact decision being asked. Under-reporting important context
produces weak advice.

Candidates are optional and are not a menu. Advisor may select, replace, extend,
ignore, or reject them.

## Advisor Judgment

Only `decision` and `summary` are required.

```json
{
  "decision": "act|continue|request_more_evidence|request_tests|replan|block|finalize",
  "summary": "",
  "required": [],
  "allowed_claims": [],
  "risks": [],
  "notes": []
}
```

Advisor `required` items are obligations, not suggestions. Driver resolves each
one with file:line evidence plus semantic explanation, validation, an explicit
scope-out accepted by advisor, or a revised plan. "Inspected code" is not enough
by itself.

## Advisor State Tool

Tool events:

- `record_advisor_call`
- `record_application`
- `check_staleness`

Example:

```json
{
  "event": "record_advisor_call",
  "ask": "choose_direction",
  "advisor_summary": "Advisor requested API client prefix evidence before editing.",
  "context_digest": "Settings 500 investigation; no edits yet."
}
```

`advisor_state` computes diff hashes and changed files. Driver should not supply
those manually.

`check_staleness` reports whether the current diff differs from the latest
recorded advisor application. If stale, driver should re-consult or narrow final
claims.

## Activation

Active v4:

```bash
bash /Users/jsp1226/.config/opencode/plugin/activate-phase-gate-v4.sh
```

Rollback to v3:

```bash
bash /Users/jsp1226/.config/opencode/plugin/rollback-phase-gate-v3.sh
```

Rollback to v2:

```bash
bash /Users/jsp1226/.config/opencode/plugin/activate-phase-gate-v2.sh
```
