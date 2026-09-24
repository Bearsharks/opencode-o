# oc-lite profile

`oc-lite` is a single-primary-worker profile with one read-only Runner.

```text
worker --subagent--> runner
runner           --------> none
```

The Worker performs implementation directly. Its prompt keeps only role,
context management, reading strategy, and completion conditions. Runner is
copied from Max with its read-only permissions and evidence-backed compact
result contract.

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
also uses a private, isolated V2 server to check the effective agents,
permissions, and exactly one local topology plugin without requiring model
credentials. It does not run a paid model request; when using the wrapper in
another project, rerun preflight from that project to inspect its merged files.
