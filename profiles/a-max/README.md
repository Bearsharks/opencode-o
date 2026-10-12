# opencode-o A-Max profile

A-Max is a separately installed, standalone multi-background-worker profile.
Run it through `oc-amax`.

```text
HTOrchestrator --background subagent--> terraworker (zero or more, concurrently)
HTOrchestrator --foreground/background subagent--> runner (read-only)
terraworker    --foreground/background subagent--> runner (read-only)
```

The profile owns its `opencode.jsonc`, all three agent files, and its topology
plugin under `profiles/a-max/plugins/a-max-v2`. V2 loads the profile document
and plugin, while the plugin registers the three agents from their Markdown
files so they remain available from other working directories. It enforces the
local topology and adds the asynchronous orchestration contract and tool
permissions. The external model/effort config described below can override
the agents' models and reasoning effort when the plugin loads.

A-Max uses OpenCode's background subagent execution. Its plugin tracks each
background Terra child as a process-local Kanban card:

- `Working`: the child is running;
- `Review`: the child finished and awaits orchestrator verification;
- `Done`: the orchestrator verified and accepted the result;
- `Blocked`: the child failed or needs intervention.

Runner sessions, including background ones, are read-only evidence tasks and
do not create Terra cards.

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
edit scopes to parallel implementation workers and protect shared generated
outputs, ports, processes, saves, and provider budgets during parallel work.
New parallel work omits `sessionID`; continuation or rework reuses the exact
returned `sessionID`. Runner may run in the foreground or background for bounded
read-only exploration and checks; HTOrchestrator or Terra owns interpretation
and implementation. Only background Terra work uses the Kanban lifecycle.
Terra card mutations and continuations use the exact full `sessionID` from a
subagent result or current board output. Runner continuations use the exact
returned `sessionID`. IDs are never abbreviated or fuzzy-matched, and
`a_max_move` takes `session_id` and returns the exact ID, description, and resulting state for
confirmation.

The `oc-amax` wrapper uses a dedicated OpenCode database while sharing the
normal OpenCode authentication store. This keeps A-Max sessions separate from
ordinary OpenCode, `opencode-o`, and `opencode-o-max`.
Before isolating `XDG_CONFIG_HOME` for OpenCode, the wrapper preserves a nonempty
`GH_CONFIG_DIR`. Otherwise, it selects the caller's original
`$XDG_CONFIG_HOME/gh` when `hosts.yml` or `config.yml` exists there, falling
back to `$HOME/.config/gh`. This keeps `gh` authentication available to child
shells without changing the isolation of other XDG consumers. Existing A-Max
processes must be restarted to inherit an updated wrapper; do not interrupt
active sessions merely to apply this change.

To check the installed wrapper without a model call, run
`bash profiles/a-max/gh-config.fixtures.sh "$HOME/.local/bin/oc-amax" "$PWD" --live-auth`.
For an optional read-only end-to-end check, run
`bash profiles/a-max/gh-api.probe.sh`; it starts a private server with disposable
data, cache, and state, checks the A-Max plugin/agent topology, then checks
GitHub issue 145 from `/api/shell`. It inherits the caller's original
`XDG_CONFIG_HOME`, so it can also be run under another profile's XDG setting.

Runner is **product-read-only**, not prohibited from local execution or temporary
writes. It shares oc-lite's [Runner authority policy](../RUNNER-POLICY.md):
delegated builds/tests, isolated outputs, read-only SQLite diagnostics,
task-owned loopback servers/browser checks, and requested Git fetches are
ordinary capabilities. Shell is generally allowed with role-violation
guardrails; there is no per-script or compiled-test-path allowlist. Core owns
shell parsing/permissions; this topology plugin does not parse test commands.
Product edits, Git authoring, credentials, actual provider sends and external
publication are not authorized. These rules are not a shell/network sandbox;
in particular shell allow cannot remedy an OS/sandbox `listen EPERM`.

Runner can run delegated Graft analysis under its local verification role; Terra retains explicit allows for `npm run graft -- build|ask|grep|skeleton|callers|check`. Graft may write its local analysis cache; Runner's product-source restriction still applies. `npm run graft:setup` requires approval for HTOrchestrator and Terra and remains denied for Runner because it changes project setup. The repository wrapper owns supported options; shell rules do not confine executable code to a particular checkout.

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
