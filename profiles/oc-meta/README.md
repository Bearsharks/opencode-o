# oc-meta profile

`oc-meta` is a single-primary Meta coordinator profile with one read-only
Runner.

```text
MetaOrchestrator --task--> runner
runner                    --------> none
```

MetaOrchestrator owns a user-authorized multi-job outcome and coordinates
existing separate job sessions through their own orchestrators via Orca; it
does not perform leaf implementation. Its prompt keeps role identity, entry
and permissions, coordination sources, the two-level plan, context
management, reading strategy, and completion conditions. Coordination uses
one initial plan document per outcome (purpose, dependencies, job links,
user decision gates) with the job tracker as the actual status source and
no duplicate state ledger; user holds live in a clearly owned decision or
handoff section. Orca is operated through the existing `orca-cli` skill.
Runner is derived from oc-lite with its read-only permissions and
evidence-backed compact result contract, and it never runs Orca, mutates
source, or creates jobs.

Requires the Orca development CLI on PATH. `./scripts/doctor/oc-meta.sh`
checks the prerequisite following the `orca-cli` skill's executable
resolution and reports the selected executable with install guidance.

The topology plugin only enforces the two-agent task graph. It does not
provide Terra or Verifier subagents, A-Max background execution, Kanban,
custom tools, or a state engine.

Use the profile through the separately installed `oc-meta` wrapper. The
installer copies a self-contained snapshot into
`~/.config/opencode/profiles/oc-meta` (or `$OPENCODE_O_META_CONFIG_HOME`, else
`$XDG_CONFIG_HOME/opencode`) and pre-materializes the OpenCode-managed plugin
dependencies inside the snapshot; the wrapper references that installed copy,
never this checkout:

```bash
./scripts/install/oc-meta.sh
oc-meta
oc-meta run "Hello"
./scripts/uninstall/oc-meta.sh
```
