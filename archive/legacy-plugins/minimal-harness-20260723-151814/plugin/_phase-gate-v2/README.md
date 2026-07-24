# Phase-Gate v2 Workspace

This directory contains the active v2 working copy. The loaded plugin path is
`../phase-gate.ts`, which is a symlink to `./phase-gate.ts`.

- Active v2 plugin: `../phase-gate.ts -> ./phase-gate.ts`
- v1 rollback backup: `../_phase-gate-backup/phase-gate.v1.ts`
- Rollback command: `bash /Users/jsp1226/.config/opencode/plugin/rollback-phase-gate-v1.sh`
- Reactivate v2: `bash /Users/jsp1226/.config/opencode/plugin/activate-phase-gate-v2.sh`

## v2 Contract

v2 is judge-led:

```text
driver reports the case
judge decides the next action
gate records workflow state
```

Simple work is outside the driver workflow. The gate accepts only:

- `standard`: direction judgment + final judgment
- `complex`: direction judgment + mid judgment + final judgment

Permission filtering, tool visibility, model-visible tool surface, execution
blocking, wildcard/global deny precedence, and definition-time vs
execution-time enforcement boundaries stay `complex` unless the case proves the
work is doc-only/reflection-only or otherwise cannot affect runtime behavior.

## Case Packet

Driver gives judge facts and context, not a completed decision.
Gate preserves `raw_user_request` from `start` and exposes it in later outputs.
Driver may declare an `objective`; judge may override it with
`effective_objective`. Judge uses `raw_user_request` as the authoritative
scope reference.

```json
{
  "phase": "direction|mid|final",
  "work_kind": "edit|readonly|reflection",
  "level": "standard|complex",
  "goal": "",
  "facts": [],
  "evidence": [],
  "constraints": [],
  "candidate_actions": [],
  "unknowns": [],
  "ask": "decide_next_action|continue_or_replan|finalize_claim"
}
```

`candidate_actions` is optional. Candidates are not a menu.
When a candidate creates a rule exception, state the exact boundary. For
permission/tool visibility work, separate explicit action rules from
wildcard/global rules and list the nearest existing contract tests.

## Candidate Action

```json
{
  "id": "A1",
  "action": "",
  "touches": [],
  "validation": [],
  "why_considered": ""
}
```

Do not include `recommended`, `best`, `safest`, or `preferred`.

## Judgment

Judge returns the action driver must follow.

```json
{
  "phase": "direction|mid|final",
  "decision": "act|continue|finalize|request_more_evidence|request_tests|replan|block",
  "level": "standard|complex",
  "candidate_set": "sufficient|incomplete|misleading|not_needed",
  "selected_candidate": "A1|null",
  "new_action": null,
  "effective_objective": "optional corrected objective",
  "driver_action": "implement|continue|collect_evidence|run_validation|replan|stop|final_answer",
  "basis": [],
  "required": [],
  "allowed_claims": [],
  "notes": []
}
```

Gate does not judge quality. It records order, pending action, changed files,
declared validations, and whether the required judgments exist.

If judge downgrades driver-proposed `complex` to `standard`, `basis` or `notes`
must include a concrete downgrade reason. The gate checks only that the reason
exists; judge owns whether it is correct.

## Validation

Validation is explicit. Bash execution is not automatically treated as
validation. Driver records only accepted validation evidence:

```json
{
  "event": "record_validation",
  "run_id": "last",
  "purpose": "Focused regression",
  "scope": ["explicit bash deny"],
  "summary": ""
}
```

Gate records bash executions as `observed_command_runs`. `record_validation`
promotes one observed run by `run_id`; `command`, `status`, and `exit_code` are
copied from that observed run and cannot be supplied by the driver.
`run_id: "last"` means the most recent completed bash run that has not already
been recorded as validation.

If judge returns `request_tests`, the pending action cannot be resolved until a
new `record_validation` event is recorded.

Validation output should stay compact. Driver should not paste full raw test
output into judge packets or the conversation unless the excerpt is needed to
diagnose or justify a failure. Prefer a short human-checkable summary plus the
recorded command, status, exit code, purpose, and scope.

## Review Context

Gate output includes `previous_judgments`, `open_obligations`, and
`declared_validations`. Judge remains stateless; driver includes only the
previous judgment summary, open/resolved obligations, new facts, and new
declared validations in mid/final packets.
