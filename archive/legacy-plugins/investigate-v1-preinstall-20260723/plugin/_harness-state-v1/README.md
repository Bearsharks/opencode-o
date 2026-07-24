# Minimal Harness State

## Agents

```text
orchestrator -> terraworker | lunaworker | probe
terraworker  -> probe
lunaworker   -> probe
probe        -> none
```

## Child task continuity

- Each parent session keeps one continuing task per allowed child Agent.
- The first completed child call records its `task_id`.
- Later calls with no `task_id` automatically resume the remembered task.
- A different explicit or observed `task_id` is rejected.
- Continuity state is process-local. After a restart, an explicitly supplied existing `task_id` is accepted and remembered again.
- The continuing child transcript, including prior `scope_searched` and gaps, is the exploration memory; this plugin does not maintain a separate file/range cache.

## Read budget

- Every harness Agent session starts with 600 returned lines and 25,000 returned characters.
- Direct `read` output costs 100% of that Agent's own budget.
- Delegated Agent read usage costs 25% to its caller, rounded up.
- Nested delegation compounds: a probe read delegated through a worker reaches the orchestrator at 25% of the worker's charged awareness usage.
- Remaining budget is reported on the first charge, at 75/50/25/10/0% milestones, and for reads of at least 500 lines or 20,000 characters.
- Synthetic-only context does not initialize a budget.

Every Agent may add budget to its own session:

```json
{"event":"allocate_read_budget","reason":"...","strategy":"...","requested_lines":1200,"requested_chars":50000}
```
