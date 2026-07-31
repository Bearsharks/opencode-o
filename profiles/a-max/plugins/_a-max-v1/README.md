# A-Max runtime

A-Max extends the current Max profile without copying its agent definitions.
`profiles/a-max/opencode.jsonc` and every file under `profiles/a-max/agents/`
are relative symlinks to `profiles/max`, so future Max prompt, model, permission,
browser, Runner, and self-improvement handoff improvements are inherited.

The `a-max.ts` plugin adds only the A-Max delta:

- the existing Max topology by composing `profiles/max/plugins/max-topology.ts`
  rather than copying its hooks;
- multiple concurrent background `terraworker` tasks with no fixed count cap;
- foreground-only Runner enforcement;
- a process-local Kanban keyed by background Terra session ID;
- `a_max_board` for Working, Review, Done, and Blocked cards;
- `a_max_move` for explicit post-verification completion.

OpenCode's built-in `task(background: true)` owns execution and completion
notification. The plugin never polls workers. A child busy-to-idle transition
moves a card to Review. HTOrchestrator must verify it before moving it to Done.

On a parent `session.idle` event, A-Max recovers only parents already known from
their A-Max cards. It reads the persisted OpenCode session messages and uses
assistant `parentID` values as processed-through watermarks. When input is
unhandled, it sends one short synthetic wake through the existing client API to
HTOrchestrator. Its stable source marker and metadata carry the exact current
`Review` task IDs; the wake names those IDs without copying pending input or
background-result bodies. A-Max adds no separate queue or durable recovery
state, and does not recover generic OpenCode sessions without A-Max cards.

Kanban state is intentionally process-local, matching OpenCode 1.18.4's
experimental background-job lifecycle. Restarting OpenCode interrupts active
background work and clears the board.
