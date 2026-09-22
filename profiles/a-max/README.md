# opencode-o A-Max profile

A-Max is a separately installed, standalone multi-background-worker profile.
Run it through `oc-amax`.

```text
HTOrchestrator --background subagent--> terraworker (zero or more, concurrently)
HTOrchestrator --foreground subagent--> runner
terraworker    --foreground subagent--> runner
```

The profile owns its `opencode.jsonc`, all three agent files, and its topology
plugin under `profiles/a-max/plugins/a-max-v2`. V2 loads the profile document
and plugin, while the plugin registers the three agents from their Markdown
files so they remain available from other working directories. It enforces the
local topology and adds the asynchronous orchestration contract and tool
permissions. The external model/effort config described below can override
the agents' models and reasoning effort when the plugin loads.

A-Max uses OpenCode's background subagent execution. Its
plugin tracks each background Terra child as a process-local Kanban card:

- `Working`: the child is running;
- `Review`: the child finished and awaits orchestrator verification;
- `Done`: the orchestrator verified and accepted the result;
- `Blocked`: the child failed or needs intervention.

The board displays the last observed V2 session status for each card: `busy`,
`retry`, `idle`, or `unknown`. This is independent from the Kanban lifecycle;
it flags a `Working` card last observed idle. It does not poll. The default
view omits `Done` cards; pass
`include_done: true` when completion history is relevant.

HTOrchestrator can call `a_max_inspect` to read a background Terra child's
last observed session status and latest tool state without changing it. When it needs
to intervene, `a_max_interrupt` aborts the current execution without rolling
back persisted conversation or file effects. After inspecting the current
changes, HTOrchestrator can continue the same child with its existing `sessionID`
and revised instructions.

When a **known A-Max parent session** becomes idle, A-Max derives unhandled
input from that session's persisted V2 context. If recovery is needed, it sends one short synthetic wake through
the existing OpenCode client API to HTOrchestrator. The wake lists the exact
current `Review` session IDs but does not copy pending messages or task-result
bodies. This is not a separate queue or persistence layer, and it does not
cover generic OpenCode sessions without A-Max cards.

There is no fixed A-Max concurrency limit. HTOrchestrator must assign disjoint
edit scopes to parallel workers. New parallel work omits `sessionID`; continuation
or rework reuses the card's existing `sessionID`. Runner is never asynchronous.
Card mutations and continuations use the exact full `sessionID` from a subagent result
or current board output. IDs are never abbreviated or fuzzy-matched, and
`a_max_move` takes `session_id` and returns the exact ID, description, and resulting state for
confirmation.

The `oc-amax` wrapper uses a dedicated OpenCode database while sharing the
normal OpenCode authentication store. This keeps A-Max sessions separate from
ordinary OpenCode, `opencode-o`, and `opencode-o-max`.

## External model/effort config

A-Max can override its configured model settings from one user-owned JSON file.
The plugin auto-discovers the first existing location:

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
- When the file applies, the plugin selects the default model and sets
  `model` and request-time `reasoningEffort` on all three A-Max agents: `HTOrchestrator`,
  `terraworker`, and `runner`. External values win over A-Max's configured
  frontmatter and config. Prompts, permissions, and tools are untouched.
- An absent default file is a no-op: A-Max keeps its configured defaults.
- `OPENCODE_O_A_MAX_MODEL_CONFIG=/absolute/path/to/file.json` points at an
  explicit file and must then exist and be valid; a relative, missing,
  unreadable, or invalid explicit path fails with a concise
  `A-Max model config error` naming the path. Setting the variable to the
  empty string disables external loading, which is how the repository's smoke
  checks stay deterministic.
- Config is read once at startup, so restart `oc-amax` after creating or
  editing the file. The `oc-amax` wrapper inherits the environment variable,
  so no reinstall or wrapper change is needed.
- `./scripts/doctor/a-max.sh --preflight` checks local V2 prerequisites. Full
  diagnostics exercise both plugin smoke checks and the active V2 agent/plugin
  registry. A malformed active config fails plugin loading with a clear error.

Kanban remains process-local: restarting OpenCode interrupts active background
work and clears the board.

See the [proposed context-strategy design](CONTEXT-STRATEGY.md) for future
direction; it does not describe implemented A-Max behavior.
