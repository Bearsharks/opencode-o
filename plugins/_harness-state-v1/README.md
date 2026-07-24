# Minimal Harness State

## Agents

```text
orchestrator --task------> terraworker | lunaworker
orchestrator --investigate--> Probe slot owned by orchestrator session
terraworker  --investigate--> Probe slot owned by that Terra session
lunaworker   --investigate--> Probe slot owned by that Luna session
probe        -------------> none
```

## Session identity

- Terra/Luna are native subagents with no harness-level task continuity constraint.
- Raw `task -> probe` calls are blocked.
- `investigate` owns exactly one Probe child session per caller session ID.
- Repeated calls from the same caller reuse that child. A new orchestrator or worker session gets a new child.
- Process restarts recover the slot by listing the caller's children and finding the `harness:probe` title.
- The Probe transcript, including prior `scope_searched` and gaps, is the exploration memory. Default OpenCode automatic compaction is used; V1 adds no custom compaction hook or file/range cache.
- Probe uses `opencode-go/minimax-m3`. Current provider metadata resolves a 1M context limit and a 512K pricing tier, so no local limit override is applied.
- `investigate` treats the Probe schema as validation, not a hard gate. It returns `{schema_valid, probe_result}` when valid; on schema mismatch it also returns compact `schema_warnings` while preserving the parsed Probe object, and on malformed JSON it preserves the raw text as `probe_result_text`.
- Probe read usage is charged even when its response is schema-invalid or malformed. Callers should use preserved evidence cautiously and directly verify decision-critical claims instead of retrying only to repair formatting.

## Reading strategy

- Reuse first when the same question is already covered and the source is unchanged.
- Direct reading is faster and exact, but costs more context and imports source noise. Use it for known small ranges, edit semantics, conflicts, and focused verification.
- `investigate` is cheaper and isolates exploration context, but adds latency and can omit or distort details. Use it for unknown or broad search spaces, cross-file tracing, history, duplicate patterns, and counterexamples.
- The default substantial-task pattern is hybrid: investigate maps candidates, then the caller directly verifies only decision-critical ranges.
- Practical direct-to-Probe cost is roughly 10x for orchestrator, 5x for Terra, and 2x for Luna. Budget is soft steering, not the sole decision rule; quality and elapsed time also matter.

## Read budget

- Orchestrator, Terra, and Luna sessions each start with 600 returned lines and 25,000 returned characters.
- Direct `read` output costs 100% of that caller's budget.
- Probe has no independent budget. `investigate` charges its raw usage to the immediate caller at 10% for orchestrator, 20% for Terra, or 50% for Luna, rounded up.
- Native Terra/Luna task usage costs 25% to orchestrator, rounded up.
- Remaining budget is reported on the first charge, at 75/50/25/10/0% milestones, and for reads of at least 500 lines or 20,000 characters.
- Synthetic-only context does not initialize a budget.

Orchestrator, Terra, and Luna may add budget to their own sessions:

```json
{"event":"allocate_read_budget","reason":"...","strategy":"...","requested_lines":1200,"requested_chars":50000}
```
