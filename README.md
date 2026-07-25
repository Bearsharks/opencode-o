# opencode-o

A lightweight OpenCode orchestration harness with one coordinator, two
implementation workers, and one reusable investigation Probe per caller
session.

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

To validate resolved agents:

```bash
OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PWD" opencode debug agent orchestrator
OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PWD" opencode debug agent terraworker
OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PWD" opencode debug agent lunaworker
OPENCODE_EXPERIMENTAL_LSP_TOOL=true OPENCODE_CONFIG_DIR="$PWD" opencode debug agent probe
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
