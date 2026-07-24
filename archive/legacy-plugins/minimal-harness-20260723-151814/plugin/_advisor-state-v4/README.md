# Advisor State v4

This plugin enforces a small process-local contract for the OpenCode driver.

## Contract

1. Driver must complete one successful advisor task before `edit`, `write`, or `apply_patch`.
2. Read-budget use is reported to driver. Direct reads cost 100%; reads inside driver-launched probe-code tasks cost 25%; advisor-launched probe-code tasks are free. Driver chooses the investigation strategy.

## Advisor sessions

- The first consultation creates a new advisor task.
- Later consultations must use the same `task_id`.
- The plugin remembers a task ID as soon as it observes the first advisor result, even when the response contract is invalid, so the driver can retry the same task.
- The plugin keeps only process-local task identity and consultation status. It does not write advisor history, staleness state, probe history, application records, or session JSON.

Advisor prompts use one canonical first-line header:

```json
{"ask":"choose_direction"}
```

Allowed values are `choose_direction`, `unstick`, `continue_or_replan`, and `finalize_claim`.

Advisor treats the raw user request as authoritative. Driver supplies every known concrete counterexample; advisor turns counterexamples from the driver packet or its own probes into `required` items and defines proof obligations for broader bypass classes. A counterexample cannot be waived as harmless, intentional, or a no-op; the plan must close it or require explicit user acceptance. Advisor does not claim exhaustive absence beyond the searched scope. Driver executes the returned plan and `required` items rather than deciding from a re-consultation rubric.

## Read budget

Each driver session starts with 600 returned lines and 25,000 returned characters. The plugin reports the remaining amount on the first charge, at milestones, and after a large read. Driver chooses the reading strategy. When more reading is needed, driver submits the exact additional amount with its reason and a strategy naming the paths, symbols, or behavior boundaries to read directly or delegate; the plugin adds that amount without a separate approval step or persistent allocation history.

```json
{"event":"allocate_read_budget","reason":"...","strategy":"which exact paths, symbols, or behavior boundaries will be read directly or delegated","requested_lines":1200,"requested_chars":50000}
```

## Deliberate exclusions

- No Git diff or staleness calculation
- No persistent state directory
- No advisor application history
- No probe output schema enforcement or task-ID bookkeeping
- No automatic re-consultation merely because driver ran another probe
- No unsupported final-response hook
- No bash mutation classification
