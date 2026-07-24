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
- `probe`: a read-only Minimax M3 evidence worker reached only through the
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
  - `openai/gpt-5.6-terra`
  - `openai/gpt-5.6-luna-fast`
  - `opencode-go/minimax-m3`

Change the `model` fields under `agents/` before use if your provider exposes
different IDs.

## Try without modifying global config

```bash
git clone https://github.com/Bearsharks/opencode-o.git
cd opencode-o
bun install
bun run check

export OPENCODE_CONFIG_DIR="$PWD"
opencode
```

`OPENCODE_CONFIG_DIR` is the recommended installation mode. OpenCode loads this
directory using the standard config layout while leaving
`~/.config/opencode` untouched. It is loaded after global and project config,
so it overrides conflicting values but may still inherit unrelated global
settings.

To validate resolved agents:

```bash
OPENCODE_CONFIG_DIR="$PWD" opencode debug agent orchestrator
OPENCODE_CONFIG_DIR="$PWD" opencode debug agent terraworker
OPENCODE_CONFIG_DIR="$PWD" opencode debug agent lunaworker
OPENCODE_CONFIG_DIR="$PWD" opencode debug agent probe
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
