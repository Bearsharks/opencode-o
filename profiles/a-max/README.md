# opencode-o A-Max profile

A-Max is a separately installed, multi-background-worker extension of the
current Max profile. Run it through `oc-amax`; `opencode-o-a-max` remains as a
backward-compatible command, and `opencode-o-max` remains unchanged.

```text
HTOrchestrator --background task--> terraworker (zero or more, concurrently)
HTOrchestrator --foreground task--> runner
terraworker    --foreground task--> runner
```

The profile reuses Max's `opencode.jsonc` and all three Max agent files through
relative symlinks. Max prompt, model, reasoning, permission, browser, Runner,
and directed self-improvement skill contracts therefore remain the source of
truth. The A-Max plugin also composes Max's topology plugin directly, then
appends only its asynchronous orchestration contract and tool permissions at
config resolution time.

A-Max uses OpenCode's built-in experimental background subagent execution. Its
plugin tracks each background Terra child as a process-local Kanban card:

- `Working`: the child is running;
- `Review`: the child finished and awaits orchestrator verification;
- `Done`: the orchestrator verified and accepted the result;
- `Blocked`: the child failed or needs intervention.

When a **known A-Max parent session** becomes idle, A-Max derives unhandled
input from that session's persisted OpenCode messages and assistant `parentID`
watermarks. If recovery is needed, it sends one short synthetic wake through
the existing OpenCode client API to HTOrchestrator. The wake lists the exact
current `Review` task IDs but does not copy pending messages or task-result
bodies. This is not a separate queue or persistence layer, and it does not
cover generic OpenCode sessions without A-Max cards.

There is no fixed A-Max concurrency limit. HTOrchestrator must assign disjoint
edit scopes to parallel workers. New parallel work omits `task_id`; continuation
or rework reuses the card's existing `task_id`. Runner is never asynchronous.

The `oc-amax` wrapper uses a dedicated OpenCode database while sharing the
normal OpenCode authentication store. This keeps A-Max sessions separate from
ordinary OpenCode, `opencode-o`, and `opencode-o-max`.

Kanban remains process-local: restarting OpenCode interrupts active background
work and clears the board.

See the [proposed context-strategy design](CONTEXT-STRATEGY.md) for future
direction; it does not describe implemented A-Max behavior.
