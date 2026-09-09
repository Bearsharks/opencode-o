# opencode-o

A lightweight OpenCode orchestration harness with one coordinator, two
implementation workers, and one reusable investigation Probe per caller
session. Independently installed Max, A-Max, oc-lite, oc-meta, and agent-only
profiles are also available.

```text
orchestrator --task--------> terraworker | lunaworker
orchestrator --investigate--> reusable Probe
terraworker  --investigate--> reusable Probe
lunaworker   --investigate--> reusable Probe
```

## What is included

- `orchestrator`: owns routing, evidence sufficiency, planning, verification,
  and the final response.
- `terraworker`: handles work with unresolved ownership, interface, boundary, or
  implementation-direction uncertainty.
- `lunaworker`: handles well-specified work, including complex or multi-file
  implementation when contracts and stop conditions are explicit.
- `probe`: a hidden read-only Luna evidence worker reached only through the
  `investigate` tool.
- `harness-state`: enforces task topology, reusable Probe slots, and discounted
  read-budget accounting.

See [`plugins/_harness-state-v1/README.md`](plugins/_harness-state-v1/README.md)
for the full runtime contract.

## Requirements

- OpenCode `1.18.4`
- Bun
- Access to the model IDs configured in the agent front matter:
  - `openai/gpt-5.6-sol`
  - `openai/gpt-5.6-terra-fast`
  - `openai/gpt-5.6-luna-fast`

Change the `model` fields under `agents/` before use if your provider exposes
different IDs.

## Install

```bash
git clone https://github.com/Bearsharks/opencode-o.git
cd opencode-o
./scripts/install/default.sh
```

The installer does not copy or modify `~/.config/opencode`. It checks for
conflicting global or project agents and plugins, installs locked dependencies,
runs the harness smoke test, and creates:

```text
~/.local/bin/opencode-o
```

Run:

```bash
opencode-o
opencode-o run "Hello"
```

The wrapper sets `OPENCODE_CONFIG_DIR` to this checkout and enables OpenCode's
experimental LSP tool for Probe symbol queries. OpenCode still loads global and
project config before the custom directory, so the installer refuses known
same-name agent and local-plugin conflicts rather than relying on undocumented
local-plugin deduplication.

The wrapper does not change the behavior of the ordinary `opencode` command.
Do not export this repository as `OPENCODE_CONFIG_DIR` in your shell profile if
you want the two commands to remain independent.

If `~/.local/bin` is not on `PATH`, add it to your shell configuration or invoke
the wrapper by its absolute path.

## Install max mode separately

Max mode has its own config root, installer, doctor, and wrapper. Installing it
does not replace or modify the default `opencode-o` wrapper.

```bash
./scripts/install/max.sh
opencode-o-max
opencode-o-max run "Hello"
```

```text
HTOrchestrator --task--> terraworker
HTOrchestrator --task--> runner
terraworker    --task--> runner
```

- `HTOrchestrator` owns goals, plans, delegation, final verification, and the
  user response. Implementation normally goes to Terra, while difficult
  documents or reports, conflicts, small final corrections, and repair of an
  unsatisfactory Terra result may be handled directly.
- `terraworker` executes scoped implementation with high reasoning.
- `runner` is a read-only Luna-fast subagent with medium reasoning. It performs
  broad file or external research and high-output test or verification commands,
  then returns compact results. For exploration, local claims require `path:line`
  evidence; web and MCP claims require direct source URLs or resource identifiers.
- Max mode has no lunaworker, Probe, `investigate` tool, `harness_state` tool, or
  read-budget accounting.

The max topology plugin registers no tools; it only enforces
`HTOrchestrator -> terraworker|runner` and `terraworker -> runner`. The profile
lives under [`profiles/max/`](profiles/max/) so OpenCode never auto-loads it
beside the default harness plugin.

OpenCode still merges global and project plugins by design. `scripts/doctor/max.sh` rejects
known harness-agent and local-plugin conflicts, verifies exactly one max plugin
origin, and verifies that the default harness plugin did not leak into max
mode:

```bash
./scripts/doctor/max.sh --preflight
./scripts/doctor/max.sh
```

## Install oc-lite separately

oc-lite is a single-primary-worker profile with one read-only Runner. The
Worker implements directly; Runner handles broad exploration and high-output
verification. It has its own profile, topology plugin, installer, doctor, and
wrapper, and does not include Terra or A-Max background execution.

```bash
./scripts/install/oc-lite.sh
oc-lite
oc-lite run "Hello"
```

```text
worker --task--> runner
runner           --------> none
```

The oc-lite plugin registers no tools. It only enforces the two-agent task
topology. The Worker prompt contains role, context management, reading
strategy, and completion conditions; Runner keeps the read-only Max contract.

```bash
./scripts/doctor/oc-lite.sh --preflight
./scripts/doctor/oc-lite.sh
```

## Install oc-meta separately

oc-meta is a single-primary Meta coordinator profile with one read-only
Runner. MetaOrchestrator owns a user-authorized multi-job outcome and
coordinates existing separate job sessions through their own orchestrators via
Orca; it does not perform leaf implementation. It has its own profile,
topology plugin, installer, doctor, and wrapper, and does not include Terra
or Verifier as profile subagents. It requires the Orca development CLI on
PATH (`./scripts/doctor/oc-meta.sh` reports the selected executable and
install guidance); Meta operates it through the existing `orca-cli` skill.

```bash
./scripts/install/oc-meta.sh
oc-meta
oc-meta run "Hello"
```

Unlike the other profiles, the installer copies a self-contained snapshot
(`opencode.jsonc`, both agents, and the topology plugin) into
`~/.config/opencode/profiles/oc-meta` and pre-materializes the plugin
dependencies inside that directory (OpenCode manages config-dir plugin
dependencies itself). The `~/.local/bin/oc-meta` wrapper references that
installed copy, never this checkout, and keeps working when the repository is
absent. Override the target locations with `OPENCODE_O_META_CONFIG_HOME` (the
OpenCode config home) and `OPENCODE_O_BIN_DIR`; an unset
`OPENCODE_O_META_CONFIG_HOME` follows `XDG_CONFIG_HOME` and then the default
`~/.config/opencode`.

```text
MetaOrchestrator --task--> runner
runner                    --------> none
```

- `MetaOrchestrator` owns outcome boundaries, shared contracts, the two-level
  plan, cross-job join verification, and the user response. Job orchestrators
  own their internal DAG, delegation, sequencing, and same-job rework; Meta
  does not micromanage or repeat leaf review. An independently reviewed,
  merged result is accepted after confirming actual merge, target base, and
  reviewed head identity. Newly discovered post-merge defects require a new
  job.
- `runner` is a read-only Luna-fast subagent with medium reasoning. It performs
  broad file or external research and high-output test or verification commands,
  then returns compact results. For exploration, local claims require `path:line`
  evidence; web and MCP claims require direct source URLs or resource identifiers.
  Runner never runs Orca, mutates source, or creates jobs.

The oc-meta plugin registers no tools; it only enforces
`MetaOrchestrator -> runner`. Coordination uses one initial plan document
per outcome (purpose, dependencies, job links, user decision gates) with
the job tracker as the actual status source and no duplicate state ledger;
Orca is operated through the existing `orca-cli` skill. The profile lives
under [`profiles/oc-meta/`](profiles/oc-meta/) so OpenCode never auto-loads
it beside the default harness plugin.

OpenCode still merges global and project plugins by design. `scripts/doctor/oc-meta.sh` rejects
known harness-agent and local-plugin conflicts, validates the installed
snapshot (exact asset set, dependency resolution from the installed tree, no
source-checkout references) when present, verifies exactly one oc-meta plugin
origin, and verifies that the default harness, Max, A-Max, and oc-lite plugins
did not leak into oc-meta mode:

```bash
./scripts/doctor/oc-meta.sh --preflight
./scripts/doctor/oc-meta.sh
```

To remove only the oc-meta-owned wrapper and snapshot without touching
configuration or other profiles:

```bash
./scripts/uninstall/oc-meta.sh
```

## Install A-Max separately

A-Max extends the current Max profile with multiple concurrent background Terra
workers and a process-local Kanban. It has its own profile, plugin, installer,
doctor, wrapper, and session database; installing it does not modify
`opencode-o-max`.

```bash
./scripts/install/a-max.sh
oc-amax
oc-amax run "Hello"
```

```text
HTOrchestrator --background task--> terraworker (zero or more, concurrently)
HTOrchestrator --foreground task--> runner
terraworker    --foreground task--> runner
```

A-Max does not copy the Max agents. Its config and agent files are relative
symlinks to [`profiles/max/`](profiles/max/), and the A-Max plugin appends only
the asynchronous contract and Kanban tool permissions at config resolution
time. Current and future Max prompts, models, reasoning settings, permissions,
browser access, Runner handoff shape, and directed self-improvement skill
contract therefore remain the source of truth. A-Max also composes the Max
topology plugin directly instead of copying its task-edge enforcement.

`a_max_board` displays background Terra cards in Working, Review, Done, and
Blocked columns. OpenCode completion moves a card to Review; HTOrchestrator
must verify it before `a_max_move` can mark it Done. There is no fixed worker
count limit, but parallel edit scopes must be disjoint. Runner is always
foreground and the plugin rejects `runner` calls with `background: true`.
Every board call also shows a current per-card `busy`, `retry`, `idle`, or
`unknown` runtime snapshot without changing the Kanban lifecycle.

HTOrchestrator can use `a_max_inspect` to read a Terra child's current OpenCode
session status and latest tool state without changing it. If intervention is
needed, `a_max_interrupt` stops the current execution without rolling back its
conversation or file effects; HTOrchestrator can inspect the current changes
and continue the same child with its existing `task_id`.

The wrapper enables `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` and uses
`opencode-a-max.db`, isolating A-Max sessions while retaining the normal
OpenCode authentication store:

```bash
./scripts/doctor/a-max.sh --preflight
./scripts/doctor/a-max.sh
```

### External model/effort override for A-Max

A-Max can override the inherited Max model and reasoning effort from one
user-owned JSON file. The plugin auto-discovers:

```text
$XDG_CONFIG_HOME/opencode/a-max-model.json
$HOME/.config/opencode/a-max-model.json   (used when XDG_CONFIG_HOME is unset)
```

The file must contain exactly:

```json
{
  "model": "provider/model-id",
  "effort": "high"
}
```

- `model` must be a `provider/model-id` string without whitespace; `effort` is
  any non-empty trimmed string, such as `high`.
- When the file applies, it overrides the top-level `model` and the
  `model`/`reasoningEffort` of all three A-Max agents (`HTOrchestrator`,
  `terraworker`, and `runner`). These external values win over the inherited
  Max frontmatter and config; prompts, permissions, and tool behavior are
  unchanged.
- An absent file changes nothing: A-Max keeps the full Max inheritance.
- Set `OPENCODE_O_A_MAX_MODEL_CONFIG=/absolute/path/to/file.json` to load an
  explicit file instead of the default location, or export it as an empty
  string to disable external loading entirely (deterministic tests and
  diagnostics). The `oc-amax` wrapper inherits this variable, so no reinstall
  is needed.
- A missing auto-discovered default file is a no-op. An explicit override that
  is relative, missing, unreadable, or invalid fails with a concise
  `A-Max model config error` naming the path.
- Config is read once at startup: restart `oc-amax` after creating or editing
  the file. `./scripts/doctor/a-max.sh` validates the currently active file.

## Install B-Max separately

B-Max is an intentionally thin, optimistic A-Max-derived profile. It keeps the
same background Terra workflow and existing `a_max_board`, `a_max_move`,
`a_max_inspect`, and `a_max_interrupt` tools, while its profile-local
Manager directs work rather than independently performing workers'
technical verification.

Terra keeps implementation and validation in one worker-owned unit; after work
finishes, Manager creates the commit and PR and calls `completeJob`.

```bash
./scripts/install/b-max.sh
oc-bmax
oc-bmax run "Hello"
```

Its config plus Terra and Runner agents are relative symlinks to
[`profiles/max/`](profiles/max/); only Manager is B-Max-specific. The
wrapper enables experimental background subagents and uses the dedicated
`opencode-b-max.db` database, so its sessions remain separate from other
profiles. Resolved B-Max uses `manager` as its default.

```bash
./scripts/doctor/b-max.sh --preflight
./scripts/doctor/b-max.sh
```

## Install the agent-only profile separately

The agent-only profile provides `freefy-secretary`, which turns Freefy requests
into GitHub Issues and relies on the existing `issues.opened` workflow for
delegation. It can use the same read-only `runner` as A-Max for Git, PR,
repository, documentation, and web research, including independent parallel
investigations. The shared Runner includes access to the `orca-cli` skill and
Orca command family for Orca-managed state. The profile has no plugin, MCP,
background runtime, or database.

```bash
./scripts/install/agents.sh
oc-agents
oc-agents run "Freefy work request"
./scripts/uninstall/agents.sh
```

The wrapper activates `profiles/agents` only for `oc-agents`; it does not
modify global OpenCode configuration or change the ordinary `opencode` command.

## Migrating an existing global harness

The installer intentionally does not move or delete global agents and plugins.
If preflight reports conflicts, back up the reported paths before moving only
those conflicting files out of `~/.config/opencode`.

Also audit `~/.config/opencode/opencode.json` and `opencode.jsonc`. Moving agent
files without removing their JSON references can leave ordinary OpenCode with a
missing default agent or with every built-in agent disabled. Remove settings
that existed only for the old harness, such as:

- `default_agent: "orchestrator"`;
- `disable: true` overrides for built-in agents when those overrides only
  existed to force the old orchestrator;
- permissions for removed harness tools and plugins.

Do not copy this repository's `opencode.jsonc` into the global config directory.
After migration, close running OpenCode processes and verify both commands
separately:

```bash
opencode debug agent build
opencode-o debug agent orchestrator
./scripts/doctor/default.sh --preflight
./scripts/doctor/default.sh
```

## Diagnose

`doctor` does not edit OpenCode configuration or install files.

```bash
./scripts/doctor/default.sh --preflight
./scripts/doctor/default.sh
./scripts/doctor/a-max.sh --preflight
./scripts/doctor/a-max.sh
./scripts/doctor/b-max.sh --preflight
./scripts/doctor/b-max.sh
./scripts/doctor/max.sh --preflight
./scripts/doctor/max.sh
./scripts/doctor/oc-lite.sh --preflight
./scripts/doctor/oc-lite.sh
./scripts/doctor/oc-meta.sh --preflight
./scripts/doctor/oc-meta.sh
```

Preflight checks prerequisites, repository layout, and global/project
conflicts. Full diagnostics additionally check the smoke test, required model
IDs, resolved agents, the plugin origin count, wrapper target, and `PATH`.

Results are reported as `PASS`, `WARN`, or `FAIL`. A failure exits with status
1; invalid doctor usage exits with status 2.

## Run without installing a wrapper

```bash
bun install --frozen-lockfile
bun run check
OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PWD" opencode
```

For max mode without installing its wrapper:

```bash
bun run check:max
OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PWD/profiles/max" opencode
```

For oc-lite without installing its wrapper:

```bash
bun run check:oc-lite
OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PWD/profiles/oc-lite" opencode
```

For oc-meta without installing its wrappers:

```bash
bun run check:oc-meta
OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PWD/profiles/oc-meta" opencode
```

For A-Max without installing its wrapper:

```bash
bun run check:a-max
OPENCODE_DB=opencode-a-max.db \
  OPENCODE_EXPERIMENTAL_LSP_TOOL=true \
  OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true \
  OPENCODE_CONFIG_DIR="$PWD/profiles/a-max" \
  opencode
```

For B-Max without installing its wrapper:

```bash
bun run check:b-max
OPENCODE_DB=opencode-b-max.db \
  OPENCODE_EXPERIMENTAL_LSP_TOOL=true \
  OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true \
  OPENCODE_CONFIG_DIR="$PWD/profiles/b-max" \
  opencode
```

To validate resolved agents:

```bash
OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PWD" opencode debug agent orchestrator
OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PWD" opencode debug agent terraworker
OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PWD" opencode debug agent lunaworker
OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PWD" opencode debug agent probe
OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PWD/profiles/max" opencode debug agent HTOrchestrator
OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PWD/profiles/max" opencode debug agent terraworker
OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PWD/profiles/max" opencode debug agent runner
OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PWD/profiles/oc-lite" opencode debug agent worker
OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PWD/profiles/oc-lite" opencode debug agent runner
OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PWD/profiles/oc-meta" opencode debug agent MetaOrchestrator
OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PWD/profiles/oc-meta" opencode debug agent runner
OPENCODE_DB=:memory: OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true OPENCODE_CONFIG_DIR="$PWD/profiles/a-max" opencode debug agent HTOrchestrator
OPENCODE_DB=:memory: OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true OPENCODE_CONFIG_DIR="$PWD/profiles/a-max" opencode debug agent terraworker
OPENCODE_DB=:memory: OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true OPENCODE_CONFIG_DIR="$PWD/profiles/a-max" opencode debug agent runner
OPENCODE_DB=:memory: OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true OPENCODE_CONFIG_DIR="$PWD/profiles/b-max" opencode debug agent manager
OPENCODE_DB=:memory: OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true OPENCODE_CONFIG_DIR="$PWD/profiles/b-max" opencode debug agent terraworker
OPENCODE_DB=:memory: OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true OPENCODE_CONFIG_DIR="$PWD/profiles/b-max" opencode debug agent runner
```

## Project-local use

For a repository-specific installation, copy:

- `opencode.jsonc` to the project root.
- `agents/` to `.opencode/agents/`.
- `plugins/` to `.opencode/plugins/`.
- `package.json` to `.opencode/package.json` if the project does not already
  provide the plugin dependency.

Review the root config before committing it: this harness disables OpenCode's
built-in `build`, `plan`, `general`, and `explore` agents in favor of the
orchestrator.

## Portability

This repository intentionally excludes:

- credentials and provider authentication;
- machine-specific paths and external-directory permissions;
- personal MCP servers and local references;
- backups, logs, and prior agent configurations;
- the private `codex-self-improvement` runtime.

The shared orchestrator prompt owns judgment and planning directly, so the
harness does not require the private advisor or plan skills.

## Historical experiments

Previous local plugin experiments are preserved under
[`archive/legacy-plugins/`](archive/legacy-plugins/). They are not loaded by
OpenCode and are retained only for later review. Do not run archived activation
or rollback scripts without auditing their hard-coded paths and obsolete
assumptions.

## Official OpenCode documentation

- [Configuration](https://opencode.ai/docs/config)
- [Agents](https://opencode.ai/docs/agents)
- [Plugins](https://opencode.ai/docs/plugins)
