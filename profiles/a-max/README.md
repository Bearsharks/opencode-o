# opencode-o A-Max profile

A-Max is a separately installed, multi-background-worker extension of the
current Max profile. Run it through `oc-amax`; `opencode-o-max` remains
unchanged.

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
config resolution time. The one exception is the external model/effort config
described below, which can override the inherited model settings at the same
resolution point.

A-Max uses OpenCode's built-in experimental background subagent execution. Its
plugin tracks each background Terra child as a process-local Kanban card:

- `Working`: the child is running;
- `Review`: the child finished and awaits orchestrator verification;
- `Done`: the orchestrator verified and accepted the result;
- `Blocked`: the child failed or needs intervention.

Each authorized `a_max_board` call also takes one current, non-persistent
runtime snapshot for its visible cards: `busy`, `retry`, `idle`, or `unknown`.
This is independent from the Kanban lifecycle, and the board explicitly flags
any `Working` card whose runtime snapshot is `idle`. It does not poll, change
cards, or retain runtime snapshots.

HTOrchestrator can call `a_max_inspect` to read a background Terra child's
current session status and latest tool state without changing it. When it needs
to intervene, `a_max_interrupt` aborts the current execution without rolling
back persisted conversation or file effects. After inspecting the current
changes, HTOrchestrator can continue the same child with its existing `task_id`
and revised instructions.

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

## External model/effort config

A-Max can override the inherited Max model settings from one user-owned JSON
file. The plugin auto-discovers the first existing location:

```text
$XDG_CONFIG_HOME/opencode/a-max-model.json
$HOME/.config/opencode/a-max-model.json
```

The second path is used only when `XDG_CONFIG_HOME` is unset. The file must
contain exactly:

```json
{
  "model": "provider/model-id",
  "effort": "high"
}
```

- `model` is a trimmed `provider/model-id` string with no surrounding or
  internal whitespace; `effort` is any non-empty trimmed string rather than a
  hardcoded provider enum.
- When the file applies, the plugin sets the top-level config `model` plus
  `model` and `reasoningEffort` on all three A-Max agents: `HTOrchestrator`,
  `terraworker`, and `runner`. External values win over the inherited Max
  frontmatter and config. Prompts, permissions, and tools are untouched.
- An absent default file is a no-op: A-Max keeps the exact current Max
  inheritance. This keeps the feature fully backward compatible.
- `OPENCODE_O_A_MAX_MODEL_CONFIG=/absolute/path/to/file.json` points at an
  explicit file and must then exist and be valid; a relative, missing,
  unreadable, or invalid explicit path fails with a concise
  `A-Max model config error` naming the path. Setting the variable to the
  empty string disables external loading, which is how the repository's smoke
  checks stay deterministic.
- Config is read once at startup, so restart `oc-amax` after creating or
  editing the file. The `oc-amax` wrapper inherits the environment variable,
  so no reinstall or wrapper change is needed.
- `./scripts/doctor/a-max.sh --preflight` never requires the file. Full
  diagnostics validate the active file (default or explicit): with no active
  config they assert strict Max inheritance for `model`/`reasoningEffort`, and
  with an active config they assert that the top-level model and every A-Max
  agent reflect its validated values. A malformed active config fails with a
  clear error.

Kanban remains process-local: restarting OpenCode interrupts active background
work and clears the board.

See the [proposed context-strategy design](CONTEXT-STRATEGY.md) for future
direction; it does not describe implemented A-Max behavior.
