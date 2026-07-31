# opencode-o

A lightweight OpenCode orchestration harness with one coordinator, two
implementation workers, and one reusable investigation Probe per caller
session. Independently installed Max and A-Max profiles are also available for
HTOrchestrator, Terra, and a context-protecting Runner.

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
./install.sh
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
./install-max.sh
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

OpenCode still merges global and project plugins by design. `doctor-max` rejects
known harness-agent and local-plugin conflicts, verifies exactly one max plugin
origin, and verifies that the default harness plugin did not leak into max
mode:

```bash
./doctor-max --preflight
./doctor-max
```

## Install A-Max separately

A-Max extends the current Max profile with multiple concurrent background Terra
workers and a process-local Kanban. It has its own profile, plugin, installer,
doctor, wrapper, and session database; installing it does not modify
`opencode-o-max`.

```bash
./install-a-max.sh
opencode-o-a-max
opencode-o-a-max run "Hello"
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

The wrapper enables `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` and uses
`opencode-a-max.db`, isolating A-Max sessions while retaining the normal
OpenCode authentication store:

```bash
./doctor-a-max --preflight
./doctor-a-max
```

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
./doctor --preflight
./doctor
```

## Diagnose

`doctor` does not edit OpenCode configuration or install files.

```bash
./doctor --preflight
./doctor
./doctor-a-max --preflight
./doctor-a-max
./doctor-max --preflight
./doctor-max
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

For A-Max without installing its wrapper:

```bash
bun run check:a-max
OPENCODE_DB=opencode-a-max.db \
  OPENCODE_EXPERIMENTAL_LSP_TOOL=true \
  OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true \
  OPENCODE_CONFIG_DIR="$PWD/profiles/a-max" \
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
OPENCODE_DB=:memory: OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true OPENCODE_CONFIG_DIR="$PWD/profiles/a-max" opencode debug agent HTOrchestrator
OPENCODE_DB=:memory: OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true OPENCODE_CONFIG_DIR="$PWD/profiles/a-max" opencode debug agent terraworker
OPENCODE_DB=:memory: OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true OPENCODE_CONFIG_DIR="$PWD/profiles/a-max" opencode debug agent runner
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
