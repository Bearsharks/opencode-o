# Phase-Gate v3 Workspace

This directory contains the v3 working copy. v2 is preserved at
`../_phase-gate-v2/phase-gate.ts` and can be reactivated with
`../activate-phase-gate-v2.sh`.

## v3 Contract

v3 removes review levels. The gate has no difficulty-classification contract.

```text
driver reports the case
judge decides the next action
gate records workflow state
```

Required reviews:

- `initial`: required before edits or finalization
- `final`: required before final answer

Optional review:

- `advice`: optional, repeatable, and used when the driver wants judgment before
  continuing

Gate does not force or schedule advice. Driver asks for advice when guidance
would help: before committing to an approach, after repeated errors, when new
evidence may invalidate the current direction, when scope may drift from
`raw_user_request`, when validation strategy is uncertain, or before finalizing
if claims may exceed evidence. Advice does not block work unless judge returns
`more_evidence`, `more_tests`, `replan`, or `block`.

Advice is optional, but skipping it must be justified when a trigger is present.
Before continuing, driver checks for advice triggers and either calls
`open_advice` or records one sentence explaining why advice is unnecessary.

Triggers:

- two or more plausible implementation paths remain
- a shared helper, policy, registry, loader, permission, cache, routing,
  execution, persistence, or model-visible boundary may change
- a judge `required` item is ambiguous or has multiple possible resolutions
- new evidence contradicts, narrows, or broadens the initial judgment
- validation failed once and the next fix is not mechanical
- validation strategy is uncertain
- broad claims such as `all`, `no other`, `always`, `safe`, `preserved`, or
  `unchanged` lack exhaustive evidence
- final claims may exceed evidence

## Case Packet

Driver gives judge facts and context, not a completed decision. Gate preserves
`raw_user_request` from `start` and exposes it in later outputs. Driver may
declare an `objective`; judge may override it with `effective_objective`.
Do not put the case packet into `phase_gate`; the gate records workflow events
only.

```json
{
  "phase": "initial|advice|final",
  "work_kind": "edit|readonly|reflection",
  "goal": "",
  "facts": [],
  "evidence": [],
  "constraints": [],
  "candidate_actions": [],
  "unknowns": [],
  "ask": "decide_next_action|advise|finalize_claim"
}
```

`candidate_actions` is optional. Candidates are not a menu. Judge may select,
replace, extend, ignore, or reject them.

## Judgment

Judge returns the action driver must follow.

```json
{
  "phase": "initial|advice|final",
  "decision": "act|advise|finalize|more_evidence|more_tests|replan|block",
  "effective_objective": "optional corrected objective",
  "summary": "",
  "required": [],
  "allowed_claims": []
}
```

Gate computes `next_action` from `decision`:

- `act` -> `implement`
- `advise` -> `continue`
- `finalize` -> `final_answer`
- `more_evidence` -> `collect_evidence`
- `more_tests` -> `run_validation`
- `replan` -> `replan`
- `block` -> `stop`

## Gate Events

- `start`
- `submit_initial`
- `open_advice`
- `submit_review`
- `resolve_action`
- `record_validation`
- `submit_final`

Gate rules:

- `start` is required first.
- Edits require passed `initial` judgment: `act` + `implement`.
- `final` judgment requires passed `initial` judgment.
- `submit_final` requires passed `initial` judgment and no pending action.
- `advice` is optional and repeatable.
- Pending actions must be resolved before final submission.
- `more_tests` cannot be resolved until a new validation is recorded.

Judge `required` items are obligations, not suggestions. Driver resolves each
one with file:line evidence plus semantic explanation, recorded validation, an
explicit scope-out accepted by judge, or a revised plan. "Inspected code" is not
enough by itself.

## Validation

Validation is explicit. Bash execution is not automatically treated as
validation.

Gate records bash executions as `observed_command_runs`. `record_validation`
promotes one observed run by `run_id`; `command`, `status`, and `exit_code` are
copied from that observed run and cannot be supplied by the driver.

```json
{
  "event": "record_validation",
  "run_id": "last",
  "purpose": "Focused regression",
  "scope": ["explicit bash deny"],
  "summary": ""
}
```

`run_id: "last"` means the most recent completed bash run that has not already
been recorded as validation.

Validation output should stay compact. Do not paste full raw test output into
judge packets unless a short excerpt is needed to diagnose or justify a
failure.

## Activation

Active v3:

```bash
bash /Users/jsp1226/.config/opencode/plugin/activate-phase-gate-v3.sh
```

Rollback to v2:

```bash
bash /Users/jsp1226/.config/opencode/plugin/activate-phase-gate-v2.sh
```
