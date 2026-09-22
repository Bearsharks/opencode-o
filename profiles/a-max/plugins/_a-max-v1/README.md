# A-Max runtime

A-Max is a standalone profile. Its configuration, agent definitions, topology,
and asynchronous orchestration plugin are all owned under `profiles/a-max`.

The `a-max.ts` plugin adds only the A-Max delta:

- profile-local topology enforcement for the three A-Max agents;
- multiple concurrent background `terraworker` tasks with no fixed count cap;
- foreground-only Runner enforcement;
- a process-local Kanban keyed by background Terra session ID;
- `a_max_board` for Working, Review, Done, and Blocked cards, omitting Done by
  default unless `include_done: true`, plus one
  non-persistent `busy`/`retry`/`idle`/`unknown` runtime snapshot per visible
  card; it flags `Working` cards currently reported as `idle` without changing
  their Kanban state;
- `a_max_move` for explicit post-verification completion by exact full task ID,
  with the exact ID, description, and resulting state returned for confirmation;
- `a_max_inspect` for an on-demand runtime and latest-tool summary without
  mutating the child;
- `a_max_interrupt` for parent-controlled interruption before continuing the
  same child session with its existing `task_id`;
- an external model/effort config applied inside the `config` hook: the plugin
  reads
  `$XDG_CONFIG_HOME/opencode/a-max-model.json`, or
  `$HOME/.config/opencode/a-max-model.json` when `XDG_CONFIG_HOME` is unset,
  or the file named by `OPENCODE_O_A_MAX_MODEL_CONFIG`.

## External model/effort config

The external file must contain exactly `{ "model": "provider/model-id",
"effort": "high" }`. Validation is strict: object roots only, no missing or
unknown keys, no blank values, a whitespace-free `provider/model` identifier,
and a trimmed non-empty `effort` rather than a hardcoded provider enum.

Application semantics:

- The A-Max topology hook is initialized first; the external values are applied
  afterwards at the same config-resolution point, before agent resolution.
- When present and valid, the file sets the top-level `config.model` and
  `model`/`reasoningEffort` on `HTOrchestrator`, `terraworker`, and `runner`,
  winning over A-Max's configured defaults. Nothing else in the config changes.
- If the file requires application but one of the three A-Max agent records is
  unavailable, the hook fails with a named error instead of partially
  applying.
- `OPENCODE_O_A_MAX_MODEL_CONFIG` set to the empty string disables external
  loading (deterministic smoke tests and diagnostics); a non-empty value must
  be an absolute path that exists and reads successfully, otherwise the hook
  fails with a concise `A-Max model config error` naming the path.
- A missing auto-discovered default file is a no-op, so an absent file
  preserves A-Max's configured defaults unchanged.
- The file is read once at startup; restart OpenCode after editing it.

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
