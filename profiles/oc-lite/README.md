# oc-lite profile

`oc-lite` is a single-primary-worker profile with one read-only Runner.

```text
worker --subagent--> runner
runner           --------> none
```

The Worker uses the session/UI-selected model and its variant; it has no agent
model or request overrides. Runner uses exactly `openai/gpt-6-luna` with
high reasoning effort and low text verbosity. The Worker performs implementation directly. Its prompt keeps only role,
context management, reading strategy, and completion conditions. Runner is
product-read-only, with the same ordered role permissions as A-Max and an
evidence-backed compact result contract. See the shared
[Runner authority policy](../RUNNER-POLICY.md): assigned local builds/tests,
temporary output/dependencies, loopback servers/browser checks, read-only
SQLite diagnostics and requested Git fetches are allowed without per-command
exceptions. Product edits, Git authoring, credentials, actual provider sends
and external publication are not authorized. Shell guardrails are not an
OS/network sandbox and cannot fix `listen EPERM` by themselves.

The V2 topology plugin loads this profile's Markdown agents from any working
directory and enforces the two-agent subagent graph. It does not provide
orchestration, Terra workers, A-Max background execution, Kanban, or custom
tools. Runner is visible to the V2 subagent catalog (V2 hides agents from
invocation as well as display when `hidden: true`).

Use OpenCode V2 (tested with v2.0.14) through the separately installed
`oc-lite` wrapper. V2 does not expose LSP tools; use project lint and
typecheck commands instead:

```bash
./scripts/install/oc-lite.sh
oc-lite
oc-lite run "Hello"
./scripts/doctor/oc-lite.sh
```

Preflight rejects conflicting global and caller-project agents, harness plugins,
and inherited permission rules without changing their files. The full doctor
uses a private, isolated V2 server to check the effective agents, permissions,
and exactly one local topology plugin, then checks model availability in the
caller's database. It does not run a paid model request; when using the wrapper in
another project, rerun preflight from that project to inspect its merged files.

The wrapper uses a private server for the TUI, `run`, `mini`, `api`, and
`models`, avoiding another profile's shared background service. It uses a
dedicated global config under `~/.config/opencode-o/oc-lite/opencode`, so an
inherited `XDG_CONFIG_HOME` from A-Max cannot change the selected agents.
Before isolating XDG, the wrapper sets `GH_CONFIG_DIR` for child shell tools:
it keeps a nonempty caller `GH_CONFIG_DIR`; otherwise it uses the original
`$XDG_CONFIG_HOME/gh` if `hosts.yml` or `config.yml` exists there, falling back
to `$HOME/.config/gh`. This lets `gh` reuse an existing login without copying
credentials or changing global settings. Restart oc-lite to inherit a new
wrapper environment; already-running servers keep their old environment.
This is a targeted GitHub CLI fix, not a general remedy for all tools that
read XDG paths.
It **preserves `OPENCODE_DB`** (or OpenCode's normal default database), which
contains both provider connections and sessions. In an A-Max shell with
`OPENCODE_DB=opencode-a-max.db`, the two profiles share that session history.
A resumed session can retain its explicitly selected model and agent; use
`/models` to choose another model, or start a new oc-lite session to use the
Worker default.
`api --standalone` can return an empty agent registry before plugins settle;
the doctor polls a private server for readiness instead.

Run `./scripts/doctor/oc-lite.sh` to verify the active topology, Worker model
inheritance and Runner's exact model availability in the caller's database.
It creates a throwaway session only in a disposable database and makes no
paid model requests. One-shot `oc-lite models` output may be empty before the
private registry is ready.
